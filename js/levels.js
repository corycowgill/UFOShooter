// levels.js - Three Chicago levels with procedural landmarks
export const LEVELS = [
  { name: 'DOWNTOWN CHICAGO', builder: buildDowntownChicago },
  { name: 'LINCOLN PARK ZOO', builder: buildLincolnParkZoo },
  { name: 'RAVENSWOOD', builder: buildRavenswood },
];

// ---------------------------------------------------------------------------
// Shared material cache (Phase B perf pass).
//
// Level builders previously allocated ~240 materials — most of them duplicates
// (several hundred cars/buildings/props each creating their own phong material
// with identical params). Three.js renders opaque meshes sorted by material,
// so dedup'ing collapses state-change churn at the renderer level and cuts
// GPU memory. Materials are flagged `__shared` so disposeTree() skips them
// and they survive level transitions in the cache.
// ---------------------------------------------------------------------------
const _matCache = new Map();

function sharedPhongMat(color, emissive = 0x000000, shininess = 35, specular = 0x222233) {
  const key = `p|${color}|${emissive}|${shininess}|${specular}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshPhongMaterial({ color, emissive, shininess, specular });
    m.__shared = true;
    _matCache.set(key, m);
  }
  return m;
}

// Extended phong cache for materials with non-default params (transparency,
// high shininess, custom specular). Used by cars, hydrants, statues, etc.
function sharedPhongMatEx(color, opts = {}) {
  const emissive = opts.emissive ?? 0x000000;
  const shininess = opts.shininess ?? 35;
  const specular = opts.specular ?? 0x222233;
  const transparent = !!opts.transparent;
  const opacity = opts.opacity ?? 1;
  const key = `pE|${color}|${emissive}|${shininess}|${specular}|${transparent ? 1 : 0}|${opacity}`;
  let m = _matCache.get(key);
  if (!m) {
    const mo = { color, emissive, shininess, specular };
    if (transparent) { mo.transparent = true; mo.opacity = opacity; }
    m = new THREE.MeshPhongMaterial(mo);
    m.__shared = true;
    _matCache.set(key, m);
  }
  return m;
}

// Cached MeshBasicMaterial for the extremely common pattern
//   { color, transparent, opacity [, side, blending, depthWrite, toneMapped] }
// Using this everywhere possible dedups hundreds of window/glass/glow mats.
function sharedBasicMat(color, opacity = 1, transparent = false, opts = {}) {
  const side = opts.side ?? THREE.FrontSide;
  const blending = opts.blending ?? THREE.NormalBlending;
  const depthWrite = opts.depthWrite !== false;
  const toneMapped = opts.toneMapped !== false;
  const key = `b|${color}|${opacity}|${transparent ? 1 : 0}|${side}|${blending}|${depthWrite ? 1 : 0}|${toneMapped ? 1 : 0}`;
  let m = _matCache.get(key);
  if (!m) {
    const mo = { color, opacity, transparent, side, blending };
    if (!depthWrite) mo.depthWrite = false;
    if (!toneMapped) mo.toneMapped = false;
    m = new THREE.MeshBasicMaterial(mo);
    m.__shared = true;
    _matCache.set(key, m);
  }
  return m;
}

// HDR light material — bright light sources (streetlight bulbs, headlights,
// taillights, reverse lights, traffic signals, neon signs) that should punch
// through the UnrealBloomPass threshold with a visible halo. toneMapped:false
// + color.multiplyScalar(intensity) pushes the output past [0,1] into real
// HDR range. Cached because these are static geometry (no runtime opacity
// mutation) and are duplicated across hundreds of cars / lamp posts.
function sharedLightMat(color, intensity = 3.0, opacity = 1, transparent = false) {
  const key = `L|${color}|${intensity}|${opacity}|${transparent ? 1 : 0}`;
  let m = _matCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent,
      opacity,
      toneMapped: false,
    });
    if (intensity !== 1.0) m.color.multiplyScalar(intensity);
    m.__shared = true;
    _matCache.set(key, m);
  }
  return m;
}

// Back-compat shim — all existing calls to makeMaterial(color, emissive)
// transparently route through the shared cache.
function makeMaterial(color, emissive = 0x000000) {
  return sharedPhongMat(color, emissive, 35, 0x222233);
}

// ---------------------------------------------------------------------------
// Shared geometry cache for the handful of primitives spawned by the hundreds.
// Building window panes alone were allocating ~1000 PlaneGeometry instances
// per level — all the same size. Each call site now references the shared
// geometry and relies on mesh.position/rotation/scale for placement.
// Flagged __shared so disposeTree() preserves them across level transitions.
// ---------------------------------------------------------------------------
const _SHARED_WINDOW_GEO = new THREE.PlaneGeometry(0.8, 1.5);
_SHARED_WINDOW_GEO.__shared = true;
const _SHARED_WINDOW_FRAME_GEO = new THREE.PlaneGeometry(0.9, 1.6);
_SHARED_WINDOW_FRAME_GEO.__shared = true;

// Freeze static level geometry: compute world matrices once, then disable
// per-frame matrix auto-updates. Huge savings on scene.updateMatrixWorld()
// since static buildings, ground, roads, etc. never move.
function freezeStaticGroup(group) {
  // Phase B+: collapse opaque shared-material meshes into per-material
  // merged BufferGeometries before freezing. Cuts hundreds of draw calls
  // per level (e.g. 40 building boxes in 7 colors → 7 merged meshes).
  mergeStaticByMaterial(group);
  group.updateMatrixWorld(true);
  group.traverse(child => {
    child.matrixAutoUpdate = false;
  });
}

// ---------------------------------------------------------------------------
// Static geometry merge pass.
//
// Walks the level group, buckets meshes that use a shared material (flagged
// __shared by the cache helpers), and merges each bucket into a single Mesh
// whose BufferGeometry is the world-space concatenation of all the source
// geometries. The originals are removed from the tree.
//
// Bucketing strategy:
//  - Every mesh buckets by (material, spatial cell). Opaque cells are large
//    (48 units — just enough that looking in one direction culls the meshes
//    behind you) while transparent cells are small (16 units — one building
//    footprint) so alpha blending stays locally correct.
//  - A globally-merged mesh defeats frustum culling entirely: its bounding
//    sphere covers the whole level, so the GPU runs the vertex shader on
//    every vertex even when most are behind the camera. Splitting into
//    cells restores culling at the cost of a few more draw calls.
//
// Constraints:
//  - Material must be __shared — otherwise a unique material indicates the
//    mesh is intentionally distinct (one-off props, animated, etc.).
//  - Geometry must use only position/normal/uv attributes — anything else
//    (vertex colors, custom attribs) is left alone for safety.
//
// Colliders are unaffected: addCollider() captures a world-space Box3 at
// add time and the collision loop only reads col.box, never col.mesh.
// ---------------------------------------------------------------------------
// Cell sizes for spatial bucketing. Transparent uses a tighter grid so alpha
// sort stays local; opaque uses a larger grid just to restore frustum culling
// without exploding the draw-call count.
const TRANSPARENT_MERGE_CELL = 16;
const OPAQUE_MERGE_CELL = 48;

function mergeStaticByMaterial(rootGroup) {
  rootGroup.updateMatrixWorld(true);

  const buckets = new Map();
  const toRemove = [];
  const allowedAttrs = new Set(['position', 'normal', 'uv']);

  rootGroup.traverse((child) => {
    if (!child.isMesh) return;
    const mat = child.material;
    if (!mat || Array.isArray(mat)) return;
    if (!mat.__shared) return;
    const geo = child.geometry;
    if (!geo || !geo.attributes || !geo.attributes.position) return;
    for (const k in geo.attributes) {
      if (!allowedAttrs.has(k)) return;
    }

    // Bucket by (material, spatial cell). Opaque cells are large (just
    // enough to restore frustum culling); transparent cells are small so
    // alpha sorting stays local.
    const cell = mat.transparent ? TRANSPARENT_MERGE_CELL : OPAQUE_MERGE_CELL;
    const m = child.matrixWorld.elements;
    const cellX = Math.floor(m[12] / cell);
    const cellZ = Math.floor(m[14] / cell);
    const key = `${mat.uuid}|${cellX}|${cellZ}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { material: mat, items: [], castShadow: false, receiveShadow: false };
      buckets.set(key, bucket);
    }
    bucket.items.push({ geo, matrix: child.matrixWorld.clone() });
    if (child.castShadow) bucket.castShadow = true;
    if (child.receiveShadow) bucket.receiveShadow = true;
    toRemove.push(child);
  });

  const tmpV = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const tmpNormalMat = new THREE.Matrix3();

  for (const bucket of buckets.values()) {
    if (bucket.items.length < 2) continue;

    // Pre-compute total vertex count for typed array allocation
    let total = 0;
    let hasUV = true;
    for (const it of bucket.items) {
      let g = it.geo;
      if (g.index) g = g.toNonIndexed();
      total += g.getAttribute('position').count;
      if (!g.getAttribute('uv')) hasUV = false;
    }

    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = hasUV ? new Float32Array(total * 2) : null;
    let pIdx = 0;
    let uvIdx = 0;
    let hasNormals = true;

    for (const it of bucket.items) {
      let g = it.geo;
      if (g.index) g = g.toNonIndexed();
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      const uv = g.getAttribute('uv');
      if (!nrm) hasNormals = false;
      tmpNormalMat.getNormalMatrix(it.matrix);
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        tmpV.fromBufferAttribute(pos, i).applyMatrix4(it.matrix);
        positions[pIdx] = tmpV.x;
        positions[pIdx + 1] = tmpV.y;
        positions[pIdx + 2] = tmpV.z;
        if (nrm) {
          tmpN.fromBufferAttribute(nrm, i).applyMatrix3(tmpNormalMat).normalize();
          normals[pIdx] = tmpN.x;
          normals[pIdx + 1] = tmpN.y;
          normals[pIdx + 2] = tmpN.z;
        }
        pIdx += 3;
        if (uvs) {
          uvs[uvIdx] = uv.getX(i);
          uvs[uvIdx + 1] = uv.getY(i);
          uvIdx += 2;
        }
      }
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (hasNormals) {
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    }
    if (uvs) {
      merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    }

    // Compute a tight bounding sphere so the merged cell participates in
    // frustum culling. Without this the merged mesh would keep Three's
    // default bounding behavior and stay visible when off-screen.
    merged.computeBoundingSphere();
    merged.computeBoundingBox();

    const mergedMesh = new THREE.Mesh(merged, bucket.material);
    mergedMesh.castShadow = bucket.castShadow;
    mergedMesh.receiveShadow = bucket.receiveShadow;
    rootGroup.add(mergedMesh);
  }

  for (const m of toRemove) {
    if (m.parent) m.parent.remove(m);
  }
}

function makeBox(w, h, d, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeMaterial(color));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeTree(x, z, scale = 1) {
  const group = new THREE.Group();
  const trunkMat = makeMaterial(0x4a2d11);
  const trunkDark = makeMaterial(0x2e1a08);
  // Root flare at base
  const rootFlare = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32 * scale, 0.4 * scale, 0.3 * scale, 8),
    trunkDark
  );
  rootFlare.position.y = 0.15 * scale;
  group.add(rootFlare);
  // Exposed root nubs
  for (let ri = 0; ri < 4; ri++) {
    const rAng = (ri / 4) * Math.PI * 2;
    const root = new THREE.Mesh(
      new THREE.ConeGeometry(0.08 * scale, 0.25 * scale, 4),
      trunkDark
    );
    root.position.set(
      Math.cos(rAng) * 0.35 * scale,
      0.1 * scale,
      Math.sin(rAng) * 0.35 * scale
    );
    root.rotation.z = Math.cos(rAng) * 1.2;
    root.rotation.x = Math.sin(rAng) * 1.2;
    group.add(root);
  }
  // Main trunk - tapered
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, 2.5 * scale, 8),
    trunkMat
  );
  trunk.position.y = 1.25 * scale;
  group.add(trunk);
  // Bark rings (darker bands)
  for (let ri = 0; ri < 3; ri++) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.18 * scale - ri * 0.02, 0.025 * scale, 4, 8),
      trunkDark
    );
    ring.position.y = (0.6 + ri * 0.7) * scale;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }
  // Knot/burl detail
  const knot = new THREE.Mesh(
    new THREE.SphereGeometry(0.08 * scale, 5, 4),
    trunkDark
  );
  knot.position.set(0.14 * scale, 1.4 * scale, 0.08 * scale);
  group.add(knot);
  // Branches
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025 * scale, 0.06 * scale, 0.9 * scale, 5),
      trunkMat
    );
    branch.position.set(
      Math.cos(angle) * 0.3 * scale,
      (1.5 + i * 0.35) * scale,
      Math.sin(angle) * 0.3 * scale
    );
    branch.rotation.z = Math.cos(angle) * 0.8;
    branch.rotation.x = Math.sin(angle) * 0.8;
    group.add(branch);
    // Twig off branch
    const twig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012 * scale, 0.025 * scale, 0.4 * scale, 4),
      trunkMat
    );
    twig.position.set(
      Math.cos(angle) * 0.6 * scale,
      (1.8 + i * 0.35) * scale,
      Math.sin(angle) * 0.6 * scale
    );
    twig.rotation.z = Math.cos(angle) * 1.1;
    twig.rotation.x = Math.sin(angle) * 1.1;
    group.add(twig);
  }
  // Multiple foliage clusters - more varied hues
  const foliageMat1 = makeMaterial(0x1a7028);
  const foliageMat2 = makeMaterial(0x0e5519);
  const foliageMat3 = makeMaterial(0x2a8836);
  const foliageMat4 = makeMaterial(0x155c1f);
  const mainCanopy = new THREE.Mesh(
    new THREE.SphereGeometry(1.05 * scale, 9, 9), foliageMat1
  );
  mainCanopy.position.y = 2.8 * scale;
  group.add(mainCanopy);
  const cluster1 = new THREE.Mesh(
    new THREE.SphereGeometry(0.72 * scale, 7, 7), foliageMat2
  );
  cluster1.position.set(-0.55 * scale, 2.5 * scale, 0.35 * scale);
  group.add(cluster1);
  const cluster2 = new THREE.Mesh(
    new THREE.SphereGeometry(0.68 * scale, 7, 7), foliageMat3
  );
  cluster2.position.set(0.45 * scale, 2.6 * scale, -0.45 * scale);
  group.add(cluster2);
  const cluster3 = new THREE.Mesh(
    new THREE.SphereGeometry(0.6 * scale, 7, 7), foliageMat4
  );
  cluster3.position.set(-0.3 * scale, 3.0 * scale, -0.55 * scale);
  group.add(cluster3);
  const cluster4 = new THREE.Mesh(
    new THREE.SphereGeometry(0.55 * scale, 7, 7), foliageMat1
  );
  cluster4.position.set(0.55 * scale, 3.05 * scale, 0.25 * scale);
  group.add(cluster4);
  const top = new THREE.Mesh(
    new THREE.SphereGeometry(0.52 * scale, 6, 6), foliageMat3
  );
  top.position.set(0.08 * scale, 3.4 * scale, 0.1 * scale);
  group.add(top);
  // Highlight tips (lighter rim touches on canopy)
  for (let hi = 0; hi < 3; hi++) {
    const hAng = (hi / 3) * Math.PI * 2;
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.22 * scale, 5, 5),
      foliageMat3
    );
    tip.position.set(
      Math.cos(hAng) * 0.85 * scale,
      3.1 * scale,
      Math.sin(hAng) * 0.85 * scale
    );
    group.add(tip);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeStreetLight(x, z) {
  const group = new THREE.Group();
  const poleMat = makeMaterial(0x3a3a42);
  const boltMat = makeMaterial(0x222228);
  // Base plate
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.24, 0.32, 8),
    makeMaterial(0x2e2e36)
  );
  base.position.y = 0.16;
  group.add(base);
  // Base bolts
  for (let bi = 0; bi < 4; bi++) {
    const bAng = (bi / 4) * Math.PI * 2 + Math.PI / 4;
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.06, 6),
      boltMat
    );
    bolt.position.set(
      Math.cos(bAng) * 0.18, 0.33, Math.sin(bAng) * 0.18
    );
    group.add(bolt);
  }
  // Access panel on lower pole
  const accessPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.3, 0.02),
    boltMat
  );
  accessPanel.position.set(0, 0.9, 0.07);
  group.add(accessPanel);
  // Pole - tapered
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.06, 5, 8),
    poleMat
  );
  pole.position.y = 2.8;
  group.add(pole);
  // Decorative collar
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8),
    boltMat
  );
  collar.position.y = 2.3;
  group.add(collar);
  // Curved arm
  const arm = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.025, 6, 8, Math.PI / 2),
    poleMat
  );
  arm.position.set(0.6, 5.0, 0);
  arm.rotation.z = Math.PI;
  arm.rotation.y = Math.PI / 2;
  group.add(arm);
  // Hanger between arm and fixture
  const hanger = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.18, 4),
    poleMat
  );
  hanger.position.set(1.2, 4.92, 0);
  group.add(hanger);
  // Lantern fixture
  const fixture = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.25, 8),
    makeMaterial(0x555560)
  );
  fixture.position.set(1.2, 4.7, 0);
  group.add(fixture);
  // Glass envelope
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 6),
    new THREE.MeshPhongMaterial({
      color: 0xffeecc, transparent: true, opacity: 0.35,
      shininess: 140, emissive: 0x553311,
    })
  );
  glass.position.set(1.2, 4.52, 0);
  group.add(glass);
  // Bulb — HDR boost for bloom halo
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    sharedLightMat(0xffe6a0, 4.0)
  );
  bulb.position.set(1.2, 4.55, 0);
  group.add(bulb);
  // Glow halo sprite (additive billboard)
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 12),
    new THREE.MeshBasicMaterial({
      color: 0xffdd88, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide,
    })
  );
  halo.position.set(1.2, 4.55, 0);
  group.add(halo);
  const light = new THREE.PointLight(0xffdd88, 2.0, 25);
  light.position.set(1.2, 4.5, 0);
  group.add(light);
  // Volumetric light cone — visible beam of light falling from the fixture
  const coneH = 4.4;
  const cone = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 2.2, coneH, 12, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffdd88, transparent: true, opacity: 0.045,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    })
  );
  cone.position.set(1.2, 4.5 - coneH / 2, 0);
  group.add(cone);
  // Inner brighter core cone
  const coneInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 1.0, coneH, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffeebb, transparent: true, opacity: 0.03,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    })
  );
  coneInner.position.set(1.2, 4.5 - coneH / 2, 0);
  group.add(coneInner);
  // Ground light pool — bright circle on the ground
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(2.0, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffdd88, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(1.2, 0.02, 0);
  group.add(pool);
  group.position.set(x, 0, z);
  return group;
}

function makeNeonSign(x, y, z, rotY, color, width, height) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.9,
    toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  mat.color.multiplyScalar(2.5);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  group.add(sign);
  const glowMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.15,
    toneMapped: false, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  glowMat.color.multiplyScalar(1.5);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.4, height * 1.6), glowMat);
  glow.position.z = -0.05;
  group.add(glow);
  // Frame outline
  const frameMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.04, 0.04), frameMat);
  top.position.y = height / 2;
  group.add(top);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.04, 0.04), frameMat);
  bot.position.y = -height / 2;
  group.add(bot);
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  group.userData._neonMat = mat;
  group.userData._neonGlowMat = glowMat;
  group.userData._neonPhase = Math.random() * Math.PI * 2;
  group.userData._neonSpeed = 0.5 + Math.random() * 2;
  group.userData._neonFlickerChance = 0.002 + Math.random() * 0.005;
  return group;
}

function makeCar(x, z, color, rotation = 0) {
  const group = new THREE.Group();
  const bodyMat = sharedPhongMatEx(color, { shininess: 90, specular: 0x666666 });
  const trimMat = makeMaterial(0x1a1a1a, 0x050505);
  const chromeMat = sharedPhongMatEx(0xcccccc, { shininess: 120, specular: 0xffffff });
  // Lower body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 4), bodyMat);
  body.position.y = 0.55;
  group.add(body);
  // Hood crease (slightly raised on front)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 1.4), bodyMat);
  hood.position.set(0, 0.92, 1.15);
  group.add(hood);
  // Trunk lid crease
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 1.0), bodyMat);
  trunk.position.set(0, 0.92, -1.45);
  group.add(trunk);
  // Cabin/roof
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 2.0), bodyMat);
  cabin.position.set(0, 1.15, -0.3);
  group.add(cabin);
  // Roof top (darker)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.03, 1.85), trimMat);
  roof.position.set(0, 1.47, -0.3);
  group.add(roof);
  // Windshield
  const glassMat = sharedPhongMatEx(0x2a3a55, {
    transparent: true, opacity: 0.72, shininess: 160, specular: 0xaaccff,
  });
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.6), glassMat);
  windshield.position.set(0, 1.1, 0.65);
  windshield.rotation.x = -0.3;
  group.add(windshield);
  // Wiper blades
  for (const wx of [-0.35, 0.35]) {
    const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.55), trimMat);
    wiper.position.set(wx, 0.96, 0.78);
    wiper.rotation.x = 0.2;
    group.add(wiper);
  }
  // Rear window
  const rearWin = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), glassMat);
  rearWin.position.set(0, 1.1, -1.35);
  rearWin.rotation.x = 0.3;
  rearWin.rotation.y = Math.PI;
  group.add(rearWin);
  // Side windows (door glass)
  for (const sx of [-0.76, 0.76]) {
    const sideWin = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.42), glassMat);
    sideWin.position.set(sx, 1.18, -0.3);
    sideWin.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(sideWin);
    // B-pillar divider
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.06), trimMat);
    pillar.position.set(sx * 1.01, 1.18, -0.3);
    group.add(pillar);
  }
  // Door seam lines
  for (const sx of [-0.91, 0.91]) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.45, 0.02), trimMat);
    seam.position.set(sx, 0.58, -0.3);
    group.add(seam);
    // Door handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.18), chromeMat);
    handle.position.set(sx, 0.78, -0.35);
    group.add(handle);
  }
  // Rocker panel (side skirt)
  for (const sx of [-0.92, 0.92]) {
    const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 3.6), trimMat);
    rocker.position.set(sx, 0.22, 0);
    group.add(rocker);
  }
  // Side mirrors
  for (const sx of [-1.0, 1.0]) {
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.18), bodyMat);
    mirror.position.set(sx, 1.05, 0.5);
    group.add(mirror);
    const mirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.1, 0.08),
      sharedPhongMatEx(0xaaccee, { shininess: 160, specular: 0xffffff })
    );
    mirrorGlass.position.set(sx * 1.08, 1.05, 0.5);
    mirrorGlass.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(mirrorGlass);
  }
  // Wheels with tire sidewall + chrome rim + spokes
  const tireMat = makeMaterial(0x0a0a0a);
  const rimMat = sharedPhongMatEx(0xaaaaaa, { shininess: 150, specular: 0xffffff });
  const wheelPos = [[-0.9,0.32,1.2],[0.9,0.32,1.2],[-0.9,0.32,-1.2],[0.9,0.32,-1.2]];
  for (const [wx,wy,wz] of wheelPos) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(wx, wy, wz);
    group.add(tire);
    // Rim disc
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.24, 10), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, wy, wz);
    group.add(rim);
    // Hub cap
    const hub = new THREE.Mesh(new THREE.CircleGeometry(0.08, 8), chromeMat);
    hub.position.set(wx > 0 ? wx+0.13 : wx-0.13, wy, wz);
    hub.rotation.y = wx > 0 ? Math.PI/2 : -Math.PI/2;
    group.add(hub);
    // Wheel arch (fender flare)
    const arch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.8), trimMat);
    arch.position.set(wx * 1.02, 0.6, wz);
    group.add(arch);
  }
  // Headlights with housing
  for (const side of [-0.6, 0.6]) {
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.04), trimMat);
    housing.position.set(side, 0.65, 1.99);
    group.add(housing);
    const hl = new THREE.Mesh(
      new THREE.CircleGeometry(0.12, 10),
      sharedLightMat(0xfff4c0, 4.5)
    );
    hl.position.set(side, 0.65, 2.02);
    group.add(hl);
  }
  // Front grille
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.04), trimMat);
  grille.position.set(0, 0.5, 2.01);
  group.add(grille);
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.015, 0.02), chromeMat);
    bar.position.set(0, 0.42 + i * 0.04, 2.03);
    group.add(bar);
  }
  // Taillights with housing
  for (const side of [-0.6, 0.6]) {
    const tlHousing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.04), trimMat);
    tlHousing.position.set(side, 0.65, -1.99);
    group.add(tlHousing);
    const tl = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 8),
      sharedLightMat(0xff2200, 3.5)
    );
    tl.position.set(side, 0.65, -2.02);
    tl.rotation.y = Math.PI;
    group.add(tl);
  }
  // Reverse light (center)
  const reverseLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.06, 0.02),
    sharedLightMat(0xffffee, 3.5)
  );
  reverseLight.position.set(0, 0.58, -2.02);
  group.add(reverseLight);
  // License plates
  const plateMat = new THREE.MeshBasicMaterial({ color: 0xe8e8d8 });
  const frontPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.02), plateMat);
  frontPlate.position.set(0, 0.34, 2.02);
  group.add(frontPlate);
  const rearPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.02), plateMat);
  rearPlate.position.set(0, 0.34, -2.02);
  group.add(rearPlate);
  // Bumpers
  const bumperMat = makeMaterial(0x222222);
  const fb = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.14, 0.18), bumperMat);
  fb.position.set(0, 0.26, 2.0);
  group.add(fb);
  const rb = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.14, 0.18), bumperMat);
  rb.position.set(0, 0.26, -2.0);
  group.add(rb);
  // Exhaust pipe
  const exhaust = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.15, 6),
    chromeMat
  );
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.set(0.55, 0.22, -2.05);
  group.add(exhaust);
  // Antenna
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4),
    trimMat
  );
  antenna.position.set(-0.65, 1.7, -1.1);
  antenna.rotation.z = 0.1;
  group.add(antenna);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeBench(x, z) {
  const group = new THREE.Group();
  const woodMat = makeMaterial(0x664422);
  const metalMat = makeMaterial(0x444444);
  // Seat
  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.5), woodMat);
  seat.position.y = 0.5;
  group.add(seat);
  // Seat slats
  for (let i = 0; i < 4; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.08), woodMat);
    slat.position.set(0, 0.52, -0.18 + i * 0.12);
    group.add(slat);
  }
  // Backrest
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.06), woodMat);
  back.position.set(0, 0.85, -0.25);
  back.rotation.x = -0.15;
  group.add(back);
  // Legs (metal)
  for (const sx of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.4), metalMat);
    leg.position.set(sx, 0.25, 0);
    group.add(leg);
    // Armrest support
    const armSupport = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), metalMat);
    armSupport.position.set(sx, 0.7, -0.22);
    group.add(armSupport);
    // Armrest
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.4), metalMat);
    arm.position.set(sx, 0.9, -0.05);
    group.add(arm);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeTrafficLight(x, z) {
  const group = new THREE.Group();
  const poleMat = makeMaterial(0x2e2e34);
  const housingMat = makeMaterial(0x181820);
  // Base plate
  const poleBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 0.3, 8),
    makeMaterial(0x222228)
  );
  poleBase.position.y = 0.15;
  group.add(poleBase);
  // Base bolts
  for (let bi = 0; bi < 4; bi++) {
    const bAng = (bi / 4) * Math.PI * 2 + Math.PI / 4;
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.06, 5),
      makeMaterial(0x111118)
    );
    bolt.position.set(Math.cos(bAng) * 0.17, 0.32, Math.sin(bAng) * 0.17);
    group.add(bolt);
  }
  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 5.5, 8), poleMat
  );
  pole.position.y = 2.75;
  group.add(pole);
  // Horizontal arm
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 3, 8), poleMat
  );
  arm.position.set(1.5, 5.3, 0);
  arm.rotation.z = Math.PI / 2;
  group.add(arm);
  // Arm bracket (corner brace)
  const brace = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.5, 0.5),
    poleMat
  );
  brace.position.set(0.08, 5.05, 0);
  brace.rotation.x = Math.PI / 4;
  group.add(brace);
  // Yellow backplate (high-visibility)
  const backplate = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 1.1, 0.03),
    makeMaterial(0x181820)
  );
  backplate.position.set(2.5, 5.3, -0.14);
  group.add(backplate);
  // Yellow backplate border
  const backBorder = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 1.13, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xffdd33 })
  );
  backBorder.position.set(2.5, 5.3, -0.145);
  group.add(backBorder);
  // Signal housing
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.9, 0.25), housingMat
  );
  housing.position.set(2.5, 5.3, 0);
  group.add(housing);
  // Visor hoods over each light
  for (let i = 0; i < 3; i++) {
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.12, 8, 1, true, 0, Math.PI),
      housingMat
    );
    hood.rotation.x = Math.PI / 2;
    hood.rotation.y = Math.PI;
    hood.position.set(2.5, 5.55 - i * 0.25, 0.18);
    group.add(hood);
  }
  // Top cap
  const topCap = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.04, 0.3),
    housingMat
  );
  topCap.position.set(2.5, 5.78, 0);
  group.add(topCap);
  // Lights (red, yellow, green) with glow — active red bulb is HDR-boosted
  // so it blooms hard through the UnrealBloomPass threshold; inactive lenses
  // stay dim (low opacity, no HDR) to read as unlit.
  const lightColors = [0xff2222, 0xffbb00, 0x22ff55];
  for (let i = 0; i < 3; i++) {
    // Lens
    const bulb = new THREE.Mesh(
      new THREE.CircleGeometry(0.09, 12),
      i === 0
        ? sharedLightMat(lightColors[i], 4.0, 1.0, false)
        : sharedBasicMat(lightColors[i], 0.28, true)
    );
    bulb.position.set(2.5, 5.55 - i * 0.25, 0.13);
    group.add(bulb);
  }
  // Walk signal on pole
  const walkBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.3, 0.18), housingMat
  );
  walkBox.position.set(0, 3.5, 0.11);
  group.add(walkBox);
  // Walk signal visor
  const walkVisor = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.03, 0.08), housingMat
  );
  walkVisor.position.set(0, 3.67, 0.16);
  group.add(walkVisor);
  const walkLight = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 8),
    new THREE.MeshBasicMaterial({ color: 0xff6622 })
  );
  walkLight.position.set(0, 3.5, 0.2);
  group.add(walkLight);
  // Pedestrian button
  const pedButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.22, 0.08),
    makeMaterial(0x555560)
  );
  pedButton.position.set(0, 1.3, 0.1);
  group.add(pedButton);
  const btn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.02, 6),
    makeMaterial(0xaaaaaa)
  );
  btn.position.set(0, 1.35, 0.17);
  btn.rotation.x = Math.PI / 2;
  group.add(btn);
  group.position.set(x, 0, z);
  return group;
}

function makeFireHydrant(x, z) {
  const group = new THREE.Group();
  const hydrantMat = new THREE.MeshPhongMaterial({
    color: 0xcc2200, shininess: 60, specular: 0x442211,
  });
  const boltMat = makeMaterial(0xbb9911);
  // Base plate
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.05, 10),
    makeMaterial(0x666666)
  );
  base.position.y = 0.025;
  group.add(base);
  // Base flange (lower wider)
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.2, 0.08, 10),
    hydrantMat
  );
  flange.position.y = 0.09;
  group.add(flange);
  // Flange bolts
  for (let bi = 0; bi < 6; bi++) {
    const ang = (bi / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.04, 5),
      boltMat
    );
    bolt.position.set(Math.cos(ang) * 0.17, 0.12, Math.sin(ang) * 0.17);
    group.add(bolt);
  }
  // Body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.15, 0.5, 10), hydrantMat
  );
  body.position.y = 0.4;
  group.add(body);
  // Top cap ring
  const topRing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.13, 0.05, 10), hydrantMat
  );
  topRing.position.y = 0.67;
  group.add(topRing);
  // Bonnet (dome)
  const bonnet = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    hydrantMat
  );
  bonnet.position.y = 0.7;
  group.add(bonnet);
  // Pentagon operating nut on top
  const opNut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.05, 5),
    boltMat
  );
  opNut.position.y = 0.85;
  group.add(opNut);
  // Side nozzles
  for (const side of [-1, 1]) {
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), hydrantMat
    );
    nozzle.rotation.z = Math.PI / 2;
    nozzle.position.set(side * 0.17, 0.45, 0);
    group.add(nozzle);
    // Nozzle flange
    const nFlange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8), hydrantMat
    );
    nFlange.rotation.z = Math.PI / 2;
    nFlange.position.set(side * 0.25, 0.45, 0);
    group.add(nFlange);
    // Brass nozzle cap
    const nozzleCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.04, 5),
      boltMat
    );
    nozzleCap.rotation.z = Math.PI / 2;
    nozzleCap.position.set(side * 0.28, 0.45, 0);
    group.add(nozzleCap);
    // Retaining chain (suggested with small links)
    for (let li = 0; li < 3; li++) {
      const link = new THREE.Mesh(
        new THREE.TorusGeometry(0.01, 0.004, 4, 6),
        makeMaterial(0x555555)
      );
      link.position.set(side * (0.18 + li * 0.02), 0.36 - li * 0.02, 0.02);
      link.rotation.x = Math.PI / 2;
      group.add(link);
    }
  }
  group.position.set(x, 0, z);
  return group;
}

function makeTrashCan(x, z) {
  const group = new THREE.Group();
  const canMat = makeMaterial(0x336633);
  // Body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.22, 0.9, 8), canMat);
  body.position.y = 0.45;
  group.add(body);
  // Rim
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.02, 4, 8), canMat);
  rim.position.y = 0.9;
  group.add(rim);
  // Lid (dome)
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 4, 0, Math.PI * 2, 0, Math.PI / 3),
    makeMaterial(0x338833));
  lid.position.y = 0.92;
  group.add(lid);
  // Opening slot
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.06), makeMaterial(0x111111));
  slot.position.set(0, 0.95, 0.15);
  group.add(slot);
  group.position.set(x, 0, z);
  return group;
}

function makeNewsBox(x, z) {
  const group = new THREE.Group();
  const boxMat = makeMaterial(0x2244aa);
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), boxMat);
  body.position.y = 0.45;
  group.add(body);
  // Coin slot panel
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15),
    makeMaterial(0x888888));
  panel.position.set(0, 0.65, 0.201);
  group.add(panel);
  // Window
  const window = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.25),
    new THREE.MeshPhongMaterial({ color: 0x334466, transparent: true, opacity: 0.6 }));
  window.position.set(0, 0.35, 0.201);
  group.add(window);
  // Legs
  for (const [lx, lz] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), makeMaterial(0x222222));
    leg.position.set(lx, 0.05, lz);
    group.add(leg);
  }
  group.position.set(x, 0, z);
  return group;
}

function makePlanter(x, z) {
  const group = new THREE.Group();
  // Concrete planter box
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.3, 0.5, 8),
    makeMaterial(0x777777)
  );
  pot.position.y = 0.25;
  group.add(pot);
  // Soil
  const soil = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 8),
    makeMaterial(0x3a2a1a)
  );
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.5;
  group.add(soil);
  // Small bush
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 6, 6),
    makeMaterial(0x2a6622)
  );
  bush.position.y = 0.8;
  group.add(bush);
  // Some flowers
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const flower = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 4, 4),
      new THREE.MeshBasicMaterial({ color: [0xff4488, 0xffaa22, 0xff66aa, 0xffdd00][i] })
    );
    flower.position.set(Math.cos(angle) * 0.25, 0.9, Math.sin(angle) * 0.25);
    group.add(flower);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeBusStop(x, z, rotation = 0) {
  const group = new THREE.Group();
  const metalMat = makeMaterial(0x555555);
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x446688, transparent: true, opacity: 0.3, shininess: 100 });
  // Poles
  for (const px of [-1.2, 1.2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3, 6), metalMat);
    pole.position.set(px, 1.5, 0);
    group.add(pole);
  }
  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 1.5), metalMat);
  roof.position.set(0, 3, 0);
  group.add(roof);
  // Roof overhang curve
  const overhang = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.3), metalMat);
  overhang.position.set(0, 2.96, -0.75);
  group.add(overhang);
  // Glass back panel
  const backPanel = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.5), glassMat);
  backPanel.position.set(0, 1.5, 0.7);
  group.add(backPanel);
  // Glass side panels
  for (const sx of [-1.2, 1.2]) {
    const sidePanel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.5), glassMat);
    sidePanel.position.set(sx, 1.5, 0);
    sidePanel.rotation.y = Math.PI / 2;
    group.add(sidePanel);
  }
  // Bench inside
  const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.35), metalMat);
  benchSeat.position.set(0, 0.55, 0.3);
  group.add(benchSeat);
  // Ad panel frame
  const adFrame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 0.05), makeMaterial(0x333333));
  adFrame.position.set(0, 1.8, 0.68);
  group.add(adFrame);
  // Ad content (colored poster)
  const adPoster = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0),
    new THREE.MeshBasicMaterial({ color: 0x2244aa }));
  adPoster.position.set(0, 1.8, 0.65);
  group.add(adPoster);
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeDumpster(x, z, rotation = 0) {
  const group = new THREE.Group();
  const dumpMat = makeMaterial(0x226622);
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.3), dumpMat);
  body.position.y = 0.6;
  group.add(body);
  // Rim
  const rim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 1.4), makeMaterial(0x113311));
  rim.position.y = 1.22;
  group.add(rim);
  // Lid (slightly open)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.06, 1.35), makeMaterial(0x1a5511));
  lid.position.set(0, 1.25, -0.5);
  lid.rotation.x = -0.25;
  group.add(lid);
  // Wheels
  for (const [wx, wz] of [[-0.8, -0.6], [0.8, -0.6]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 8), makeMaterial(0x111111));
    wheel.position.set(wx, 0.15, wz);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
  }
  // Side handles
  for (const side of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), makeMaterial(0x333333));
    handle.position.set(side * 1.03, 0.9, 0);
    group.add(handle);
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

function makeUtilityPole(x, z) {
  const group = new THREE.Group();
  const woodMat = makeMaterial(0x5a4020);
  // Main pole
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), woodMat);
  pole.position.y = 4.5;
  group.add(pole);
  // Cross arm
  const crossArm = new THREE.Mesh(new THREE.BoxGeometry(3, 0.12, 0.12), woodMat);
  crossArm.position.y = 8.2;
  group.add(crossArm);
  // Insulators
  for (const ix of [-1.2, -0.4, 0.4, 1.2]) {
    const insulator = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.15, 6),
      makeMaterial(0x666688));
    insulator.position.set(ix, 8.35, 0);
    group.add(insulator);
  }
  // Transformer
  const transformer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8),
    makeMaterial(0x555555));
  transformer.position.set(0.2, 6.5, 0);
  group.add(transformer);
  // Guy wire anchors (visual only)
  for (const side of [-1, 1]) {
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 5, 3),
      makeMaterial(0x333333)
    );
    wire.position.set(side * 0.8, 5.5, 0);
    wire.rotation.z = side * 0.6;
    group.add(wire);
  }
  group.position.set(x, 0, z);
  return group;
}

function makeFountain(x, z, scale = 1) {
  const group = new THREE.Group();
  const stoneMat = makeMaterial(0x999999);
  // Base pool
  const pool = new THREE.Mesh(
    new THREE.CylinderGeometry(3 * scale, 3.2 * scale, 0.5 * scale, 16),
    stoneMat
  );
  pool.position.y = 0.25 * scale;
  group.add(pool);
  // Water surface
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(2.8 * scale, 16),
    new THREE.MeshPhongMaterial({ color: 0x2266aa, transparent: true, opacity: 0.6, shininess: 100 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.45 * scale;
  group.add(water);
  // Center column
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3 * scale, 0.4 * scale, 2 * scale, 8),
    stoneMat
  );
  column.position.y = 1.5 * scale;
  group.add(column);
  // Top bowl
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(1 * scale, 0.6 * scale, 0.3 * scale, 12),
    stoneMat
  );
  bowl.position.y = 2.5 * scale;
  group.add(bowl);
  // Water jets (glowing cylinders)
  const jetMat = new THREE.MeshBasicMaterial({ color: 0x88bbff, transparent: true, opacity: 0.3 });
  // Center jet
  const centerJet = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.02, 1.5 * scale, 4), jetMat);
  centerJet.position.y = 3.5 * scale;
  group.add(centerJet);
  // Side jets
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const jet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.01, 0.8 * scale, 4),
      jetMat
    );
    jet.position.set(
      Math.cos(angle) * 0.7 * scale,
      3 * scale,
      Math.sin(angle) * 0.7 * scale
    );
    jet.rotation.x = Math.sin(angle) * 0.3;
    jet.rotation.z = -Math.cos(angle) * 0.3;
    group.add(jet);
  }
  // Light
  const fLight = new THREE.PointLight(0x4488ff, 1.0, 10);
  fLight.position.y = 0.5 * scale;
  group.add(fLight);
  group.position.set(x, 0, z);
  return group;
}

function makeAnimalStatue(x, z, type = 'lion') {
  const group = new THREE.Group();
  const bronzeMat = makeMaterial(0x8a7340);
  // Pedestal
  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1), makeMaterial(0x777777));
  pedestal.position.y = 0.3;
  group.add(pedestal);
  // Simplified animal shape based on type
  if (type === 'lion') {
    // Body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.2), bronzeMat);
    body.position.set(0, 0.95, 0);
    group.add(body);
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), bronzeMat);
    head.position.set(0, 1.15, 0.6);
    group.add(head);
    // Mane
    const mane = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), bronzeMat);
    mane.position.set(0, 1.2, 0.5);
    mane.scale.set(1.2, 1, 0.8);
    group.add(mane);
    // Legs
    for (const [lx, lz] of [[-0.2, 0.4], [0.2, 0.4], [-0.2, -0.4], [0.2, -0.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), bronzeMat);
      leg.position.set(lx, 0.7, lz);
      group.add(leg);
    }
    // Tail
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.01, 0.6, 4), bronzeMat);
    tail.position.set(0, 1.1, -0.7);
    tail.rotation.x = 0.4;
    group.add(tail);
  } else if (type === 'bear') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 8), bronzeMat);
    body.position.set(0, 1.2, 0);
    body.scale.set(0.8, 1, 0.7);
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), bronzeMat);
    head.position.set(0, 1.7, 0.2);
    group.add(head);
    // Ears
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4, 4), bronzeMat);
      ear.position.set(side * 0.18, 1.9, 0.15);
      group.add(ear);
    }
    // Snout
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.15), bronzeMat);
    snout.position.set(0, 1.6, 0.4);
    group.add(snout);
    // Arms raised
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.6, 6), bronzeMat);
      arm.position.set(side * 0.35, 1.5, 0.15);
      arm.rotation.z = side * -0.5;
      group.add(arm);
    }
  } else {
    // Generic quadruped
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.0), bronzeMat);
    body.position.set(0, 0.9, 0);
    group.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.3), bronzeMat);
    head.position.set(0, 1.05, 0.55);
    group.add(head);
    for (const [lx, lz] of [[-0.15, 0.3], [0.15, 0.3], [-0.15, -0.3], [0.15, -0.3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.1), bronzeMat);
      leg.position.set(lx, 0.68, lz);
      group.add(leg);
    }
  }
  // Nameplate
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), makeMaterial(0x444444));
  plate.position.set(0, 0.3, 0.51);
  group.add(plate);
  group.position.set(x, 0, z);
  return group;
}

function makePlayground(x, z) {
  const group = new THREE.Group();
  const metalMat = makeMaterial(0xcc4444);
  const blueMat = makeMaterial(0x2244cc);
  const yellowMat = makeMaterial(0xcccc22);
  // Rubber surface
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), makeMaterial(0x884444));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.01;
  group.add(surface);
  // Swing set
  const swingGroup = new THREE.Group();
  // A-frame
  for (const side of [-1, 1]) {
    const legA = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 6), metalMat);
    legA.position.set(side * 2, 1.75, -0.3);
    legA.rotation.z = side * -0.15;
    swingGroup.add(legA);
    const legB = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.5, 6), metalMat);
    legB.position.set(side * 2, 1.75, 0.3);
    legB.rotation.z = side * -0.15;
    swingGroup.add(legB);
  }
  // Top bar
  const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), metalMat);
  topBar.rotation.z = Math.PI / 2;
  topBar.position.y = 3.3;
  swingGroup.add(topBar);
  // Swing seats
  for (const sx of [-0.8, 0.8]) {
    // Chains
    for (const cz of [-0.15, 0.15]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 2.2, 3), makeMaterial(0x888888));
      chain.position.set(sx, 2.2, cz);
      swingGroup.add(chain);
    }
    // Seat
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.2), makeMaterial(0x111111));
    seat.position.set(sx, 1.1, 0);
    swingGroup.add(seat);
  }
  swingGroup.position.set(-2, 0, 0);
  group.add(swingGroup);
  // Slide
  const slideGroup = new THREE.Group();
  // Platform
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.5), blueMat);
  platform.position.set(0, 2, 0);
  slideGroup.add(platform);
  // Ladder
  for (let i = 0; i < 5; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.04), yellowMat);
    rung.position.set(0, 0.4 + i * 0.4, -0.7);
    slideGroup.add(rung);
  }
  // Ladder sides
  for (const lx of [-0.3, 0.3]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.1, 0.04), yellowMat);
    rail.position.set(lx, 1, -0.7);
    slideGroup.add(rail);
  }
  // Slide surface
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 2.8), makeMaterial(0xdddd22));
  slide.position.set(0, 1.0, 1.6);
  slide.rotation.x = 0.35;
  slideGroup.add(slide);
  // Slide sides
  for (const lx of [-0.36, 0.36]) {
    const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 2.8), makeMaterial(0xcc2222));
    sideRail.position.set(lx, 1.1, 1.6);
    sideRail.rotation.x = 0.35;
    slideGroup.add(sideRail);
  }
  // Support legs
  for (const [px, pz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const supportLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2, 6), blueMat);
    supportLeg.position.set(px, 1, pz);
    slideGroup.add(supportLeg);
  }
  slideGroup.position.set(2.5, 0, 0);
  group.add(slideGroup);
  group.position.set(x, 0, z);
  return group;
}

function makeRock(x, z, scale = 1) {
  const group = new THREE.Group();
  const rockMat = makeMaterial(0x666655);
  const mainRock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.5 * scale, 0),
    rockMat
  );
  mainRock.scale.set(1, 0.6, 1.2);
  mainRock.position.y = 0.2 * scale;
  mainRock.rotation.y = Math.random() * Math.PI;
  group.add(mainRock);
  if (scale > 0.8) {
    const small = new THREE.Mesh(new THREE.DodecahedronGeometry(0.25 * scale, 0), rockMat);
    small.position.set(0.4 * scale, 0.1, 0.3 * scale);
    small.rotation.set(Math.random(), Math.random(), 0);
    group.add(small);
  }
  group.position.set(x, 0, z);
  return group;
}

function addGround(group, size, color = 0x333333) {
  // Main ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 2, size * 2, 1, 1),
    makeMaterial(color, 0x111111)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Procedural ground detail grid lines (subtle)
  const gridSize = size * 2;
  const gridStep = 4;
  const gridMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 });
  for (let i = -size; i <= size; i += gridStep) {
    const hLine = new THREE.Mesh(new THREE.PlaneGeometry(gridSize, 0.03), gridMat);
    hLine.rotation.x = -Math.PI / 2;
    hLine.position.set(0, 0.005, i);
    group.add(hLine);
    const vLine = new THREE.Mesh(new THREE.PlaneGeometry(0.03, gridSize), gridMat);
    vLine.rotation.x = -Math.PI / 2;
    vLine.position.set(i, 0.005, 0);
    group.add(vLine);
  }

  // Ground surface variation - stains, cracks, worn patches
  const stainMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.12 });
  const crackMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.15 });
  const wetMat = new THREE.MeshBasicMaterial({ color: 0x222233, transparent: true, opacity: 0.08 });

  // Scattered dark stains
  for (let i = 0; i < 25; i++) {
    const sx = (Math.random() - 0.5) * size * 1.6;
    const sz = (Math.random() - 0.5) * size * 1.6;
    const ss = 1 + Math.random() * 3;
    const stain = new THREE.Mesh(new THREE.CircleGeometry(ss, 6), stainMat);
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(sx, 0.006, sz);
    stain.scale.set(1 + Math.random() * 0.5, 1, 1 + Math.random() * 0.5);
    stain.rotation.z = Math.random() * Math.PI;
    group.add(stain);
  }

  // Crack lines
  for (let i = 0; i < 15; i++) {
    const cx = (Math.random() - 0.5) * size * 1.4;
    const cz = (Math.random() - 0.5) * size * 1.4;
    const cLen = 2 + Math.random() * 6;
    const cAngle = Math.random() * Math.PI;
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(cLen, 0.04), crackMat);
    crack.rotation.x = -Math.PI / 2;
    crack.rotation.z = cAngle;
    crack.position.set(cx, 0.007, cz);
    group.add(crack);
    // Branch crack
    if (Math.random() > 0.5) {
      const branch = new THREE.Mesh(new THREE.PlaneGeometry(cLen * 0.5, 0.03), crackMat);
      branch.rotation.x = -Math.PI / 2;
      branch.rotation.z = cAngle + 0.5 + Math.random() * 0.5;
      branch.position.set(cx + Math.cos(cAngle) * cLen * 0.3, 0.007, cz + Math.sin(cAngle) * cLen * 0.3);
      group.add(branch);
    }
  }

  // Wet/reflective puddle patches — high shininess for specular highlights
  const puddleMat = new THREE.MeshPhongMaterial({
    color: 0x111122, emissive: 0x050510, transparent: true, opacity: 0.45,
    shininess: 200, specular: 0x667788, reflectivity: 1,
  });
  puddleMat.__shared = true;
  const puddleGlowMat = new THREE.MeshBasicMaterial({
    color: 0x223344, transparent: true, opacity: 0.06,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  puddleGlowMat.__shared = true;
  for (let i = 0; i < 12; i++) {
    const px = (Math.random() - 0.5) * size * 1.2;
    const pz = (Math.random() - 0.5) * size * 1.2;
    const ps = 1.5 + Math.random() * 3;
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(ps, 10), puddleMat);
    puddle.rotation.x = -Math.PI / 2;
    puddle.position.set(px, 0.009, pz);
    puddle.scale.set(1 + Math.random() * 0.8, 1, 1 + Math.random() * 0.3);
    group.add(puddle);
    // Subtle glow reflection in puddle
    const glow = new THREE.Mesh(new THREE.CircleGeometry(ps * 0.6, 8), puddleGlowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(px, 0.01, pz);
    group.add(glow);
  }
}

function addSky(scene) {
  // Twilight invasion sky - vertical gradient via vertex colors
  const skyGeo = new THREE.SphereGeometry(500, 16, 16);
  const skyColors = [];
  const posAttr = skyGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const x = posAttr.getX(i);
    const z = posAttr.getZ(i);
    const t = (y / 500 + 1) * 0.5; // 0 at bottom, 1 at top
    // Base gradient: dark purple-brown at horizon -> deep blue-black at zenith
    let r = 0.04 + (1 - t) * 0.06;
    let g = 0.03 + (1 - t) * 0.02;
    let b = 0.12 + t * 0.06;
    // Add subtle color variation based on direction (warmer toward UFO, cooler away)
    const dirAngle = Math.atan2(x, z);
    r += Math.max(0, Math.sin(dirAngle + 0.5)) * 0.02 * t;
    b += Math.max(0, Math.cos(dirAngle)) * 0.03 * t;
    skyColors.push(r, g, b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  const skyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  scene.add(sky);

  // Horizon glow (subtle warm band)
  const horizonGeo = new THREE.CylinderGeometry(495, 495, 30, 16, 1, true);
  const horizonMat = new THREE.MeshBasicMaterial({
    color: 0x1a0a22,
    transparent: true,
    opacity: 0.3,
    side: THREE.BackSide,
  });
  const horizon = new THREE.Mesh(horizonGeo, horizonMat);
  horizon.position.y = -5;
  scene.add(horizon);

  // Secondary horizon glow (reddish-orange distant city light)
  const cityGlowGeo = new THREE.CylinderGeometry(490, 490, 15, 16, 1, true);
  const cityGlowMat = new THREE.MeshBasicMaterial({
    color: 0x221108,
    transparent: true,
    opacity: 0.25,
    side: THREE.BackSide,
  });
  const cityGlow = new THREE.Mesh(cityGlowGeo, cityGlowMat);
  cityGlow.position.y = 5;
  scene.add(cityGlow);

  // Stars - varied sizes and brightness with color tints
  const starGeo = new THREE.BufferGeometry();
  const starVerts = [];
  const starColors2 = [];
  for (let i = 0; i < 3000; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const sr = 490;
    starVerts.push(
      sr * Math.sin(phi) * Math.cos(theta),
      sr * Math.sin(phi) * Math.sin(theta),
      sr * Math.cos(phi)
    );
    // Subtle color tints: warm white, cool blue-white, pale yellow
    const tint = Math.random();
    if (tint < 0.15) { starColors2.push(1.0, 0.85, 0.7); }       // warm
    else if (tint < 0.3) { starColors2.push(0.75, 0.85, 1.0); }   // cool blue
    else if (tint < 0.4) { starColors2.push(1.0, 1.0, 0.8); }     // pale yellow
    else { starColors2.push(1.0, 1.0, 1.0); }                      // white
  }
  // Per-star random phase for twinkling
  const starPhases = new Float32Array(3000);
  const starSpeeds = new Float32Array(3000);
  for (let i = 0; i < 3000; i++) {
    starPhases[i] = Math.random() * Math.PI * 2;
    starSpeeds[i] = 0.5 + Math.random() * 2.0;
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  starGeo.setAttribute('color', new THREE.Float32BufferAttribute(starColors2, 3));
  starGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(starPhases, 1));
  starGeo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(starSpeeds, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec3 color;
      attribute float aPhase;
      attribute float aSpeed;
      uniform float uTime;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        float twinkle = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase);
        vAlpha = 0.8 * twinkle;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.4 + 0.4 * twinkle) * (300.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = 1.0 - smoothstep(0.15, 0.5, d);
        gl_FragColor = vec4(vColor, vAlpha * soft);
      }
    `,
  });
  starMat.__shared = true;
  const starPoints = new THREE.Points(starGeo, starMat);
  scene.add(starPoints);
  // Bright stars (fewer, larger) — also twinkle
  const brightStarGeo = new THREE.BufferGeometry();
  const brightVerts = [];
  const brightPhases = [];
  const brightSpeeds = [];
  for (let i = 0; i < 200; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const sr = 488;
    brightVerts.push(
      sr * Math.sin(phi) * Math.cos(theta),
      sr * Math.sin(phi) * Math.sin(theta),
      sr * Math.cos(phi)
    );
    brightPhases.push(Math.random() * Math.PI * 2);
    brightSpeeds.push(0.3 + Math.random() * 1.5);
  }
  brightStarGeo.setAttribute('position', new THREE.Float32BufferAttribute(brightVerts, 3));
  brightStarGeo.setAttribute('aPhase', new THREE.Float32BufferAttribute(brightPhases, 1));
  brightStarGeo.setAttribute('aSpeed', new THREE.Float32BufferAttribute(brightSpeeds, 1));
  const brightStarMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xeeeeff) } },
    vertexShader: /* glsl */`
      attribute float aPhase;
      attribute float aSpeed;
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = uColor;
        float twinkle = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
        vAlpha = 0.9 * twinkle;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.8 + 0.6 * twinkle) * (300.0 / max(1.0, -mv.z));
      }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float soft = 1.0 - smoothstep(0.1, 0.5, d);
        float spike = max(0.0, 1.0 - abs(c.x) * 12.0) * 0.3 + max(0.0, 1.0 - abs(c.y) * 12.0) * 0.3;
        gl_FragColor = vec4(vColor, vAlpha * (soft + spike));
      }
    `,
  });
  brightStarMat.__shared = true;
  const brightStarPoints = new THREE.Points(brightStarGeo, brightStarMat);
  scene.add(brightStarPoints);

  // Nebula patches (soft colored cloud patches in the sky)
  const nebulaData = [
    { x: 150, y: 300, z: -200, color: 0x220044, scale: 80, opacity: 0.06 },
    { x: -200, y: 350, z: -100, color: 0x001133, scale: 100, opacity: 0.05 },
    { x: 100, y: 280, z: 200, color: 0x110022, scale: 70, opacity: 0.04 },
    { x: -100, y: 320, z: -250, color: 0x002244, scale: 90, opacity: 0.05 },
    { x: 250, y: 350, z: 50, color: 0x180030, scale: 60, opacity: 0.04 },
  ];
  for (const nd of nebulaData) {
    const nebula = new THREE.Mesh(
      new THREE.SphereGeometry(nd.scale, 8, 6),
      new THREE.MeshBasicMaterial({ color: nd.color, transparent: true, opacity: nd.opacity })
    );
    nebula.position.set(nd.x, nd.y, nd.z);
    nebula.scale.set(1.5, 0.6, 1.2);
    scene.add(nebula);
    // Secondary softer halo
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(nd.scale * 1.4, 6, 4),
      new THREE.MeshBasicMaterial({ color: nd.color, transparent: true, opacity: nd.opacity * 0.4 })
    );
    halo.position.copy(nebula.position);
    halo.scale.set(2, 0.8, 1.5);
    scene.add(halo);
  }

  // Aurora-like streaks (elongated glowing bands)
  for (let i = 0; i < 4; i++) {
    const auroraGeo = new THREE.PlaneGeometry(120 + Math.random() * 80, 8 + Math.random() * 6);
    const auroraMat = new THREE.MeshBasicMaterial({
      color: i < 2 ? 0x00ff66 : 0x4400ff,
      transparent: true,
      opacity: 0.015 + Math.random() * 0.01,
      side: THREE.DoubleSide,
    });
    const aurora = new THREE.Mesh(auroraGeo, auroraMat);
    aurora.position.set(
      (Math.random() - 0.5) * 300,
      200 + Math.random() * 150,
      -150 + Math.random() * 100
    );
    aurora.rotation.set(
      0.3 + Math.random() * 0.3,
      Math.random() * Math.PI,
      Math.random() * 0.3
    );
    scene.add(aurora);
  }

  // Moon
  const moonGroup = new THREE.Group();
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(15, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xddddbb })
  );
  moonGroup.add(moon);
  // Moon glow (multi-layered)
  const moonGlow = new THREE.Mesh(
    new THREE.SphereGeometry(20, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xddddaa, transparent: true, opacity: 0.08 })
  );
  moonGroup.add(moonGlow);
  const moonGlow2 = new THREE.Mesh(
    new THREE.SphereGeometry(28, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xccccaa, transparent: true, opacity: 0.03 })
  );
  moonGroup.add(moonGlow2);
  // Craters
  for (let i = 0; i < 8; i++) {
    const crater = new THREE.Mesh(
      new THREE.CircleGeometry(1.5 + Math.random() * 2, 8),
      new THREE.MeshBasicMaterial({ color: 0xbbbb99, transparent: true, opacity: 0.3 })
    );
    const angle1 = Math.random() * Math.PI * 0.5 - 0.2;
    const angle2 = Math.random() * Math.PI * 0.5 - 0.2;
    crater.position.set(
      Math.sin(angle1) * 14.5,
      Math.cos(angle1) * Math.sin(angle2) * 14.5,
      Math.cos(angle1) * Math.cos(angle2) * 14.5
    );
    crater.lookAt(0, 0, 0);
    moonGroup.add(crater);
  }
  // Moon maria (dark patches)
  for (let i = 0; i < 3; i++) {
    const maria = new THREE.Mesh(
      new THREE.CircleGeometry(4 + Math.random() * 3, 8),
      new THREE.MeshBasicMaterial({ color: 0x999977, transparent: true, opacity: 0.15 })
    );
    const ma1 = 0.2 + Math.random() * 0.4;
    const ma2 = -0.3 + Math.random() * 0.6;
    maria.position.set(Math.sin(ma1) * 14, Math.cos(ma1) * Math.sin(ma2) * 14, Math.cos(ma1) * Math.cos(ma2) * 14);
    maria.lookAt(0, 0, 0);
    moonGroup.add(maria);
  }
  moonGroup.position.set(200, 250, -300);
  scene.add(moonGroup);
  // Moonlight
  const moonLight = new THREE.DirectionalLight(0xbbbbdd, 0.15);
  moonLight.position.set(200, 250, -300);
  scene.add(moonLight);

  // Wispy clouds (semi-transparent volumes)
  for (let i = 0; i < 15; i++) {
    const cloudGroup = new THREE.Group();
    const cloudCount = 3 + Math.floor(Math.random() * 5);
    for (let j = 0; j < cloudCount; j++) {
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(8 + Math.random() * 12, 6, 4),
        new THREE.MeshBasicMaterial({
          color: i < 5 ? 0x1a1a33 : 0x222244,
          transparent: true,
          opacity: 0.08 + Math.random() * 0.08,
        })
      );
      cloud.scale.set(1.5 + Math.random(), 0.3 + Math.random() * 0.2, 1 + Math.random() * 0.5);
      cloud.position.set(
        (Math.random() - 0.5) * 25,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 15
      );
      cloudGroup.add(cloud);
    }
    cloudGroup.position.set(
      (Math.random() - 0.5) * 600,
      50 + Math.random() * 80,
      (Math.random() - 0.5) * 600
    );
    scene.add(cloudGroup);
  }

  // UFO mothership - enhanced with more detail
  const ufoGroup = new THREE.Group();
  // Main hull
  const ufoBody = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 12, 2, 24),
    new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x223344, shininess: 60 })
  );
  ufoGroup.add(ufoBody);
  // Hull panel lines (concentric rings)
  for (const rr of [9, 10.5]) {
    const panelRing = new THREE.Mesh(
      new THREE.TorusGeometry(rr, 0.06, 4, 24),
      new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233 })
    );
    panelRing.rotation.x = Math.PI / 2;
    panelRing.position.y = -0.5;
    ufoGroup.add(panelRing);
  }
  // Bottom plate
  const ufoBottom = new THREE.Mesh(
    new THREE.CylinderGeometry(11.5, 9, 0.5, 24),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233, shininess: 50 })
  );
  ufoBottom.position.y = -1.2;
  ufoGroup.add(ufoBottom);
  // Top hull
  const ufoTop = new THREE.Mesh(
    new THREE.SphereGeometry(5, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x334455, shininess: 80 })
  );
  ufoTop.position.y = 1;
  ufoGroup.add(ufoTop);
  // Dome glass
  const ufoDome = new THREE.Mesh(
    new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x66ff99, emissive: 0x225533, transparent: true, opacity: 0.3, shininess: 120 })
  );
  ufoDome.position.y = 1;
  ufoGroup.add(ufoDome);
  // Dome inner glow
  const domeGlow = new THREE.Mesh(
    new THREE.SphereGeometry(2.5, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.12 })
  );
  domeGlow.position.y = 1.2;
  ufoGroup.add(domeGlow);
  // Main ring detail
  const ufoRing = new THREE.Mesh(
    new THREE.TorusGeometry(10, 0.15, 6, 24),
    new THREE.MeshPhongMaterial({ color: 0x667788, emissive: 0x334455 })
  );
  ufoRing.rotation.x = Math.PI / 2;
  ufoRing.position.y = -0.5;
  ufoGroup.add(ufoRing);
  // Secondary outer ring
  const ufoRing2 = new THREE.Mesh(
    new THREE.TorusGeometry(11.8, 0.08, 4, 24),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.25 })
  );
  ufoRing2.rotation.x = Math.PI / 2;
  ufoRing2.position.y = -1.0;
  ufoGroup.add(ufoRing2);
  // Engine nacelles (4 under-hull protrusions)
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const nacelle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1.2, 1.0, 8),
      new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x112233 })
    );
    nacelle.position.set(Math.cos(angle) * 8, -1.5, Math.sin(angle) * 8);
    ufoGroup.add(nacelle);
    // Engine glow
    const engineGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 0.3, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.5 })
    );
    engineGlow.position.set(Math.cos(angle) * 8, -2.1, Math.sin(angle) * 8);
    ufoGroup.add(engineGlow);
    // Engine exhaust cone
    const exhaust = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 3, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.06 })
    );
    exhaust.position.set(Math.cos(angle) * 8, -3.5, Math.sin(angle) * 8);
    exhaust.rotation.x = Math.PI;
    ufoGroup.add(exhaust);
  }
  // Under-hull scanner array
  const scanner = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2, 0.4, 12),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233 })
  );
  scanner.position.y = -1.6;
  ufoGroup.add(scanner);
  const scannerLens = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 12),
    new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.4 })
  );
  scannerLens.position.y = -1.81;
  scannerLens.rotation.x = Math.PI / 2;
  ufoGroup.add(scannerLens);
  // Lights under UFO
  const ufoLight = new THREE.PointLight(0x00ff88, 3, 150);
  ufoLight.position.y = -2;
  ufoGroup.add(ufoLight);
  // Secondary warm light for color contrast
  const ufoLight2 = new THREE.PointLight(0x00aaff, 1, 80);
  ufoLight2.position.y = -3;
  ufoGroup.add(ufoLight2);
  // Tractor beam cone
  const beamGeo = new THREE.CylinderGeometry(1, 15, 80, 12, 1, true);
  const beamMeshMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.04, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMeshMat);
  beam.position.y = -42;
  ufoGroup.add(beam);
  // Inner beam (brighter core)
  const innerBeamGeo = new THREE.CylinderGeometry(0.5, 5, 80, 8, 1, true);
  const innerBeamMat = new THREE.MeshBasicMaterial({ color: 0x88ffbb, transparent: true, opacity: 0.025, side: THREE.DoubleSide });
  const innerBeam = new THREE.Mesh(innerBeamGeo, innerBeamMat);
  innerBeam.position.y = -42;
  ufoGroup.add(innerBeam);
  // Beam ground glow ring
  const beamGroundGlow = new THREE.Mesh(
    new THREE.RingGeometry(8, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.04, side: THREE.DoubleSide })
  );
  beamGroundGlow.rotation.x = -Math.PI / 2;
  beamGroundGlow.position.y = -79;
  ufoGroup.add(beamGroundGlow);
  // Running lights (alternating green/cyan with glow halos)
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const lightColor = i % 2 === 0 ? 0x00ff88 : 0x00ffcc;
    const rl = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: lightColor })
    );
    rl.position.set(Math.cos(angle) * 10.5, -1, Math.sin(angle) * 10.5);
    ufoGroup.add(rl);
    // Light halo
    if (i % 4 === 0) {
      const rlHalo = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 4, 4),
        new THREE.MeshBasicMaterial({ color: lightColor, transparent: true, opacity: 0.15 })
      );
      rlHalo.position.copy(rl.position);
      ufoGroup.add(rlHalo);
    }
  }
  // Top antenna/sensor array
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 3, 4),
    new THREE.MeshPhongMaterial({ color: 0x667788 })
  );
  antenna.position.y = 4;
  ufoGroup.add(antenna);
  const antennaTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff0044, transparent: true, opacity: 0.8 })
  );
  antennaTip.position.y = 5.5;
  ufoGroup.add(antennaTip);
  // Window ports with glow backing
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const port = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 8),
      new THREE.MeshBasicMaterial({ color: 0x88ffbb, transparent: true, opacity: 0.5 })
    );
    port.position.set(Math.cos(angle) * 9, 0, Math.sin(angle) * 9);
    port.rotation.y = -angle + Math.PI / 2;
    ufoGroup.add(port);
    // Port frame
    const frame = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.05, 4, 8),
      new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x223344 })
    );
    frame.position.copy(port.position);
    frame.rotation.y = port.rotation.y;
    ufoGroup.add(frame);
  }
  ufoGroup.userData._beamMat = beamMeshMat;
  ufoGroup.userData._innerBeamMat = innerBeamMat;
  ufoGroup.userData._beamGroundGlowMat = beamGroundGlow.material;
  ufoGroup.position.set(0, 80, -30);
  scene.add(ufoGroup);

  // Atmospheric light pillars (subtle vertical glow from UFO)
  for (let i = 0; i < 3; i++) {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 2, 40, 6, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.012, side: THREE.DoubleSide })
    );
    pillar.position.set((i - 1) * 12, 40, -30);
    scene.add(pillar);
  }

  // Enhanced fog with better density
  scene.fog = new THREE.FogExp2(0x0e0e2a, 0.0035);

  return { ufo: ufoGroup, starMats: [starMat, brightStarMat] };
}

function addCollider(colliders, mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  colliders.push({ box, mesh });
}

// ========== LEVEL 1: DOWNTOWN CHICAGO ==========
function buildDowntownChicago(scene) {
  const group = new THREE.Group();
  const colliders = [];

  addGround(group, 100, 0x2a2a2a);
  const { ufo, starMats } = addSky(scene);

  // Downtown twilight: dense blue-violet haze
  scene.fog = new THREE.FogExp2(0x0c0c28, 0.0042);
  scene.background = new THREE.Color(0x0a0a22);

  // Ambient - bright enough to see the city
  scene.add(new THREE.AmbientLight(0x556688, 0.55));
  const dirLight = new THREE.DirectionalLight(0xbbccff, 1.25);
  dirLight.position.set(15, 40, 15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.left = -70;
  dirLight.shadow.camera.right = 70;
  dirLight.shadow.camera.top = 70;
  dirLight.shadow.camera.bottom = -70;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 140;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.04;
  dirLight.shadow.radius = 4;
  scene.add(dirLight);
  // Sky/ground gradient fill
  const fillLight = new THREE.HemisphereLight(0x6688cc, 0x1a1a33, 0.9);
  scene.add(fillLight);
  // Subtle green rim light from UFO direction (backlight)
  const rimLight = new THREE.DirectionalLight(0x22ffaa, 0.35);
  rimLight.position.set(0, 60, -80);
  scene.add(rimLight);
  // Warm accent light to add color contrast
  const accentLight = new THREE.DirectionalLight(0xff6622, 0.15);
  accentLight.position.set(-60, 30, 40);
  scene.add(accentLight);

  const sidewalkMat = makeMaterial(0x888888);
  const curbMat = makeMaterial(0x999999);
  const roadMat = makeMaterial(0x1e1e1e);

  // =============================================
  // === MICHIGAN AVENUE (north-south, z-axis) ===
  // =============================================
  // Road split into south / north segments around the river gap (z ≈ ±8)
  const roadHalfLen = 92;
  const roadGapEdge = 8;
  for (const zSign of [-1, 1]) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(14, roadHalfLen), roadMat);
    seg.rotation.x = -Math.PI / 2;
    seg.position.set(0, 0.02, zSign * (roadGapEdge + roadHalfLen / 2));
    group.add(seg);
  }

  // Center line (dashed yellow) — skip the river zone
  for (let z = -95; z < 95; z += 6) {
    if (z > -9 && z < 9) continue;
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 3),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.03, z);
    group.add(line);
  }
  // Lane markings (white dashed) — skip the river zone
  for (const lx of [-3.5, 3.5]) {
    for (let z = -95; z < 95; z += 8) {
      if (z > -9 && z < 9) continue;
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 4),
        new THREE.MeshBasicMaterial({ color: 0xaaaaaa })
      );
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(lx, 0.03, z);
      group.add(dash);
    }
  }

  // === SIDEWALKS along Michigan Ave (split around river) ===
  for (const side of [-1, 1]) {
    for (const zSign of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(4, roadHalfLen), sidewalkMat);
      sw.rotation.x = -Math.PI / 2;
      sw.position.set(side * 9, 0.04, zSign * (roadGapEdge + roadHalfLen / 2));
      group.add(sw);
      const innerCurb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, roadHalfLen), curbMat);
      innerCurb.position.set(side * 7, 0.075, zSign * (roadGapEdge + roadHalfLen / 2));
      group.add(innerCurb);
      const outerCurb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, roadHalfLen), curbMat);
      outerCurb.position.set(side * 11, 0.075, zSign * (roadGapEdge + roadHalfLen / 2));
      group.add(outerCurb);
    }
  }

  // === CROSS STREET at z = -35 ===
  const crossRoad1 = new THREE.Mesh(new THREE.PlaneGeometry(200, 10), roadMat);
  crossRoad1.rotation.x = -Math.PI / 2;
  crossRoad1.position.set(0, 0.025, -35);
  group.add(crossRoad1);
  // Cross street center line
  for (let x = -90; x < 90; x += 6) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    cl.rotation.x = -Math.PI / 2;
    cl.position.set(x, 0.035, -35);
    group.add(cl);
  }

  // === CROSS STREET at z = 35 ===
  const crossRoad2 = new THREE.Mesh(new THREE.PlaneGeometry(200, 10), roadMat);
  crossRoad2.rotation.x = -Math.PI / 2;
  crossRoad2.position.set(0, 0.025, 35);
  group.add(crossRoad2);
  for (let x = -90; x < 90; x += 6) {
    const cl = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 0.2),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    cl.rotation.x = -Math.PI / 2;
    cl.position.set(x, 0.035, 35);
    group.add(cl);
  }

  // === CROSSWALKS at intersections ===
  for (const zInt of [-35, 35]) {
    // Crosswalks across Michigan Ave (north & south side of intersection)
    for (const zSide of [-6, 6]) {
      for (let i = 0; i < 8; i++) {
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(1.2, 0.4),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(-5.5 + i * 1.6, 0.035, zInt + zSide);
        group.add(stripe);
      }
    }
    // Crosswalks across cross street (east & west side)
    for (const xSide of [-8, 8]) {
      for (let i = 0; i < 6; i++) {
        const stripe = new THREE.Mesh(
          new THREE.PlaneGeometry(0.4, 1.2),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        stripe.rotation.x = -Math.PI / 2;
        stripe.position.set(xSide, 0.035, zInt - 3.5 + i * 1.4);
        group.add(stripe);
      }
    }
  }

  // ========================================
  // === CHICAGO RIVER (east-west at z=0) ===
  // ========================================
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 12),
    new THREE.MeshPhongMaterial({ color: 0x0d3d5c, transparent: true, opacity: 0.8, emissive: 0x001122 })
  );
  river.rotation.x = -Math.PI / 2;
  river.position.set(0, 0.01, 0);
  group.add(river);

  // Riverwalk (stone embankment along both banks)
  // Split into west / east segments so they don't pass through the bridge
  const rwSegLen = 90;
  const rwGapEdge = 10;
  for (const zSide of [-1, 1]) {
    const bankZ = zSide * 6.5;
    for (const xSign of [-1, 1]) {
      const cx = xSign * (rwGapEdge + rwSegLen / 2);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(rwSegLen, 1.5, 0.6),
        makeMaterial(0x555555)
      );
      wall.position.set(cx, 0.75, bankZ);
      group.add(wall);
      const railing = new THREE.Mesh(
        new THREE.BoxGeometry(rwSegLen, 0.1, 0.08),
        makeMaterial(0x333333)
      );
      railing.position.set(cx, 1.55, bankZ);
      group.add(railing);
      const walkway = new THREE.Mesh(
        new THREE.PlaneGeometry(rwSegLen, 2),
        makeMaterial(0x776655)
      );
      walkway.rotation.x = -Math.PI / 2;
      walkway.position.set(cx, 0.05, bankZ + zSide * 1.3);
      group.add(walkway);
    }
    // Railing posts — skip bridge zone
    for (let x = -90; x < 90; x += 4) {
      if (x > -rwGapEdge && x < rwGapEdge) continue;
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.5, 0.06),
        makeMaterial(0x333333)
      );
      post.position.set(x, 1.3, bankZ);
      group.add(post);
    }
  }

  // === MICHIGAN AVE BRIDGE over the river ===
  // Bridge deck — thin slab so it doesn't block player movement (player
  // checkY is 0.85, so deck max y + playerRadius must stay below that).
  const bridgeDeck = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.25, 16),
    makeMaterial(0x555555)
  );
  bridgeDeck.position.set(0, 0.1, 0);
  group.add(bridgeDeck);
  // Bridge road surface
  const bridgeRoad = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 14),
    roadMat
  );
  bridgeRoad.rotation.x = -Math.PI / 2;
  bridgeRoad.position.set(0, 0.23, 0);
  group.add(bridgeRoad);
  // Bridge lane markings
  for (let z = -6; z <= 6; z += 6) {
    const bl = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 3),
      new THREE.MeshBasicMaterial({ color: 0xffff00 })
    );
    bl.rotation.x = -Math.PI / 2;
    bl.position.set(0, 0.24, z);
    group.add(bl);
  }
  // Bridge railings (these ARE colliders so the player can't walk off the sides)
  for (const xSide of [-8, 8]) {
    const bridgeRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 1.2, 16),
      makeMaterial(0x444444)
    );
    bridgeRail.position.set(xSide, 0.85, 0);
    group.add(bridgeRail);
    addCollider(colliders, bridgeRail);
    for (let z = -7; z <= 7; z += 3.5) {
      const bPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 1.5, 0.2),
        makeMaterial(0x555555)
      );
      bPost.position.set(xSide, 1.0, z);
      group.add(bPost);
    }
  }
  // Bridge support arches (visible below the deck)
  for (const zOff of [-3, 3]) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(2.5, 0.3, 6, 12, Math.PI),
      makeMaterial(0x444444)
    );
    arch.position.set(0, -0.5, zOff);
    arch.rotation.y = Math.PI / 2;
    group.add(arch);
  }

  // ============================================
  // === MILLENNIUM PARK (east of Michigan Ave) ==
  // ============================================
  // Park ground (east side, z = 15 to 55)
  const parkGround = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 35),
    makeMaterial(0x3a6633)
  );
  parkGround.rotation.x = -Math.PI / 2;
  parkGround.position.set(32, 0.03, 20);
  group.add(parkGround);

  // Bean plaza (paved area within the park)
  const beanPlaza = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 22),
    makeMaterial(0x999999)
  );
  beanPlaza.rotation.x = -Math.PI / 2;
  beanPlaza.position.set(30, 0.04, 20);
  group.add(beanPlaza);
  // Plaza border tiles
  const borderMat = makeMaterial(0x777777);
  for (const side of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(side[0] !== 0 ? 0.5 : 22, side[1] !== 0 ? 0.5 : 22),
      borderMat
    );
    border.rotation.x = -Math.PI / 2;
    border.position.set(30 + side[0] * 11.25, 0.045, 20 + side[1] * 11.25);
    group.add(border);
  }

  // === THE BEAN (Cloud Gate) - now in Millennium Park ===
  const bean = new THREE.Mesh(
    new THREE.SphereGeometry(3, 14, 14),
    new THREE.MeshPhongMaterial({
      color: 0xbbbbdd,
      emissive: 0x222233,
      shininess: 120,
    })
  );
  bean.scale.set(1.5, 0.8, 1);
  bean.position.set(30, 2.4, 20);
  group.add(bean);
  addCollider(colliders, bean);
  // Bean reflection on ground
  const beanReflect = new THREE.Mesh(
    new THREE.CircleGeometry(4, 16),
    new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.3 })
  );
  beanReflect.rotation.x = -Math.PI / 2;
  beanReflect.position.set(30, 0.045, 20);
  group.add(beanReflect);

  // Park benches around the Bean
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const bx = 30 + Math.cos(angle) * 9;
    const bz = 20 + Math.sin(angle) * 9;
    const bench = makeBench(bx, bz);
    bench.rotation.y = angle + Math.PI;
    group.add(bench);
  }

  // Park trees
  const parkTreePositions = [
    [16, 12], [16, 28], [44, 12], [44, 28],
    [20, 6], [40, 6], [20, 34], [40, 34],
    [14, 20], [46, 20],
  ];
  for (const [tx, tz] of parkTreePositions) {
    group.add(makeTree(tx, tz, 0.8 + Math.random() * 0.4));
  }

  // Park path from sidewalk to Bean
  const parkPath = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 20),
    makeMaterial(0x887766)
  );
  parkPath.rotation.x = -Math.PI / 2;
  parkPath.position.set(20, 0.04, 20);
  group.add(parkPath);

  // Park lamp posts
  for (const [lx, lz] of [[20, 10], [20, 30], [40, 10], [40, 30]]) {
    group.add(makeStreetLight(lx, lz));
  }

  // ================================================
  // === WILLIS TOWER (Sears Tower) - west side ===
  // ================================================
  const willis = makeBox(8, 45, 8, 0x222222, -30, 0, -55);
  group.add(willis);
  addCollider(colliders, willis);
  // Setback tiers (Willis has stepped profile)
  const willisT2 = makeBox(6, 8, 6, 0x222222, -30, 45, -55);
  group.add(willisT2);
  const willisT3 = makeBox(4, 6, 4, 0x222222, -30, 53, -55);
  group.add(willisT3);
  // Antennas
  const ant1 = makeBox(0.2, 12, 0.2, 0x444444, -30, 59, -55);
  group.add(ant1);
  const ant2 = makeBox(0.2, 10, 0.2, 0x444444, -28, 59, -55);
  group.add(ant2);
  // Antenna tip lights
  for (const [ax, ah] of [[-30, 65], [-28, 64]]) {
    const tipLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 6, 6),
      sharedBasicMat(0xff0000)
    );
    tipLight.position.set(ax, ah, -55);
    group.add(tipLight);
  }
  // Window lights
  for (let y = 2; y < 44; y += 3) {
    for (let side = 0; side < 4; side++) {
      if (Math.random() > 0.35) {
        // Quantize opacity to 0.1 bins so sharedBasicMat can dedupe all
        // these windows into at most ~7 materials (pre-merge) or 1 per
        // spatial cell after the transparent merge pass.
        const _binOpacity = Math.round((0.4 + Math.random() * 0.6) * 10) / 10;
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(0.8, 1.2),
          sharedBasicMat(0xffdd66, _binOpacity, true)
        );
        const angle = side * Math.PI / 2;
        const offset = 4.01;
        win.position.set(
          -30 + Math.sin(angle) * offset + (Math.random() - 0.5) * 3,
          y,
          -55 + Math.cos(angle) * offset + (Math.random() - 0.5) * 3
        );
        win.rotation.y = angle;
        group.add(win);
      }
    }
  }

  // ====================================
  // === TRUMP TOWER - east of river ===
  // ====================================
  const trump = makeBox(6, 38, 6, 0x888899, 30, 0, -15);
  group.add(trump);
  addCollider(colliders, trump);
  // Glass facade
  const trumpGlass = makeBox(6.1, 38, 6.1, 0x4466aa, 30, 0, -15);
  trumpGlass.material.transparent = true;
  trumpGlass.material.opacity = 0.15;
  group.add(trumpGlass);
  // Spire
  const spire = makeBox(0.4, 8, 0.4, 0x999999, 30, 38, -15);
  group.add(spire);

  // =========================================
  // === MICHIGAN AVE BUILDINGS (both sides) ==
  // =========================================
  // West side buildings (x < -11)
  const westBldgData = [
    { x: -20, z: -70, w: 7, d: 6, h: 18 },
    { x: -22, z: -55, w: 8, d: 7, h: 28 },
    { x: -18, z: -20, w: 6, d: 6, h: 15 },
    { x: -22, z: -10, w: 8, d: 5, h: 22 },
    { x: -20, z: 15, w: 7, d: 6, h: 20 },
    { x: -22, z: 30, w: 8, d: 7, h: 25 },
    { x: -18, z: 50, w: 6, d: 5, h: 14 },
    { x: -22, z: 65, w: 8, d: 6, h: 30 },
  ];
  // East side buildings (x > 11) — skip where park is (z 5 to 38)
  const eastBldgData = [
    { x: 20, z: -70, w: 7, d: 6, h: 20 },
    { x: 22, z: -55, w: 8, d: 7, h: 32 },
    { x: 18, z: -20, w: 6, d: 5, h: 16 },
    { x: 20, z: 50, w: 7, d: 6, h: 22 },
    { x: 22, z: 65, w: 8, d: 7, h: 26 },
  ];

  function addBuilding(bd, facingSide) {
    const colors = [0x333344, 0x3a3a4a, 0x2e2e3e, 0x404050, 0x353545, 0x2a2a3a, 0x383848];
    const bldgColor = colors[Math.floor(Math.random() * colors.length)];
    const bldg = makeBox(bd.w, bd.h, bd.d, bldgColor, bd.x, 0, bd.z);
    group.add(bldg);
    addCollider(colliders, bldg);

    // Facade horizontal band (floor dividers)
    const bandMat = makeMaterial(0x2a2a3a, 0x111122);
    for (let y = 3; y < bd.h; y += 3) {
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(bd.d * 0.95, 0.12),
        bandMat
      );
      band.position.set(bd.x + facingSide * (bd.w / 2 + 0.02), y - 0.3, bd.z);
      band.rotation.y = facingSide > 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(band);
    }

    // Window grid with varied colors and glow.
    // Lit windows are HDR-boosted so a dense facade blooms into a convincing
    // glowing-skyscraper silhouette through the bloom pass. Unlit windows
    // stay as plain basic materials (no bloom, reads as dark glass).
    const winColors = [
      { color: 0xffdd44, opacity: 0.9, lit: true,  intensity: 2.8 }, // warm yellow
      { color: 0xffc833, opacity: 0.85, lit: true, intensity: 2.5 }, // golden
      { color: 0xeebb55, opacity: 0.8, lit: true,  intensity: 2.2 }, // amber
      { color: 0x88aacc, opacity: 0.7, lit: true,  intensity: 2.0 }, // cool blue TV glow
      { color: 0x222244, opacity: 0.3, lit: false, intensity: 1.0 }, // dark unlit
      { color: 0x181830, opacity: 0.2, lit: false, intensity: 1.0 }, // very dark
    ];
    const winFrameMat = sharedBasicMat(0x1a1a2a, 0.4, true);
    for (let y = 2; y < bd.h; y += 3) {
      for (let wOff = -bd.d / 3; wOff <= bd.d / 3; wOff += bd.d / 3) {
        if (Math.random() > 0.2) {
          const wc = winColors[Math.floor(Math.random() * winColors.length)];
          const winMat = wc.lit
            ? sharedLightMat(wc.color, wc.intensity, wc.opacity, true)
            : sharedBasicMat(wc.color, wc.opacity, true);
          const win = new THREE.Mesh(
            _SHARED_WINDOW_GEO,
            winMat
          );
          win.position.set(
            bd.x + facingSide * (bd.w / 2 + 0.01),
            y,
            bd.z + wOff
          );
          win.rotation.y = facingSide > 0 ? -Math.PI / 2 : Math.PI / 2;
          group.add(win);
          // Window frame (subtle darker border)
          const frame = new THREE.Mesh(
            _SHARED_WINDOW_FRAME_GEO,
            winFrameMat
          );
          frame.position.set(
            bd.x + facingSide * (bd.w / 2 + 0.005),
            y,
            bd.z + wOff
          );
          frame.rotation.y = win.rotation.y;
          group.add(frame);
        }
      }
    }

    // Ground-floor entrance door (on facing side, mid of building)
    const doorFrame = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.4),
      makeMaterial(0x1a1a24, 0x080810)
    );
    doorFrame.position.set(
      bd.x + facingSide * (bd.w / 2 + 0.01),
      1.2,
      bd.z
    );
    doorFrame.rotation.y = facingSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(doorFrame);
    const doorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 2.0),
      sharedBasicMat(0xffcc66, 0.65, true)
    );
    doorGlass.position.set(
      bd.x + facingSide * (bd.w / 2 + 0.015),
      1.15,
      bd.z
    );
    doorGlass.rotation.y = doorFrame.rotation.y;
    group.add(doorGlass);
    // Awning over entrance
    const entranceAwning = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.08, 2.2),
      makeMaterial(0x222233)
    );
    entranceAwning.position.set(
      bd.x + facingSide * (bd.w / 2 + 0.3),
      2.6, bd.z
    );
    group.add(entranceAwning);

    // Drainage pipe running down facade corner
    const drainPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, bd.h, 6),
      makeMaterial(0x1a1a22)
    );
    drainPipe.position.set(
      bd.x + facingSide * (bd.w / 2 + 0.1),
      bd.h / 2,
      bd.z + (bd.d / 2 - 0.3)
    );
    group.add(drainPipe);
    // Drainage brackets
    for (let by = 2; by < bd.h; by += 4) {
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.06, 0.06),
        makeMaterial(0x222233)
      );
      bracket.position.set(
        bd.x + facingSide * (bd.w / 2 + 0.14),
        by,
        bd.z + (bd.d / 2 - 0.3)
      );
      group.add(bracket);
    }

    // Occasional window AC unit (~15% of lit windows)
    for (let y = 5; y < bd.h - 2; y += 3) {
      if (Math.random() < 0.15) {
        const wacOff = (Math.random() - 0.5) * (bd.d * 0.5);
        const wac = new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.4, 0.3),
          makeMaterial(0x555566)
        );
        wac.position.set(
          bd.x + facingSide * (bd.w / 2 + 0.15),
          y - 0.4,
          bd.z + wacOff
        );
        group.add(wac);
        // Vent grille
        const vent = new THREE.Mesh(
          new THREE.PlaneGeometry(0.4, 0.3),
          makeMaterial(0x222233)
        );
        vent.position.set(
          bd.x + facingSide * (bd.w / 2 + 0.31),
          y - 0.4,
          bd.z + wacOff
        );
        vent.rotation.y = facingSide > 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(vent);
      }
    }

    // Fire escape on mid-rise buildings (~40% chance)
    if (bd.h > 12 && bd.h < 28 && Math.random() < 0.4) {
      const feColor = 0x1a1a1a;
      const feMat = makeMaterial(feColor);
      const feX = bd.x + facingSide * (bd.w / 2 + 0.12);
      // Vertical rails
      for (const feZ of [bd.z - 0.9, bd.z + 0.9]) {
        const rail = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, bd.h - 3, 4),
          feMat
        );
        rail.position.set(feX, (bd.h - 3) / 2 + 2, feZ);
        group.add(rail);
      }
      // Landings every 3 units
      for (let fy = 4; fy < bd.h - 1; fy += 3) {
        const landing = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.04, 2.0),
          feMat
        );
        landing.position.set(feX + facingSide * 0.4, fy, bd.z);
        group.add(landing);
        // Landing floor grate
        const grate = new THREE.Mesh(
          new THREE.BoxGeometry(0.8, 0.04, 2.0),
          feMat
        );
        grate.position.set(feX + facingSide * 0.5, fy - 0.02, bd.z);
        group.add(grate);
        // Railing verticals
        for (let gi = -1; gi <= 1; gi++) {
          const railPost = new THREE.Mesh(
            new THREE.BoxGeometry(0.03, 0.4, 0.03),
            feMat
          );
          railPost.position.set(feX + facingSide * 0.9, fy + 0.2, bd.z + gi * 0.9);
          group.add(railPost);
        }
      }
    }

    // Rooftop details
    if (bd.h > 15) {
      // Rooftop edge parapet (first so AC units sit on top)
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(bd.w + 0.2, 0.4, bd.d + 0.2),
        makeMaterial(0x2e2e3e, 0x111122)
      );
      parapet.position.set(bd.x, bd.h + 0.2, bd.z);
      group.add(parapet);
      // Main HVAC unit
      const acMat = makeMaterial(0x505060);
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.8), acMat);
      ac.position.set(bd.x + 1, bd.h + 0.9, bd.z);
      group.add(ac);
      // HVAC grille top
      const acGrille = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 0.08, 8),
        makeMaterial(0x333344)
      );
      acGrille.position.set(bd.x + 1, bd.h + 1.45, bd.z);
      group.add(acGrille);
      // Smaller AC
      const ac2 = new THREE.Mesh(
        new THREE.BoxGeometry(1.0, 0.8, 1.0), acMat
      );
      ac2.position.set(bd.x - 1.5, bd.h + 0.8, bd.z + 1);
      group.add(ac2);
      // Vent stack
      const ventStack = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 1.4, 6),
        makeMaterial(0x404050)
      );
      ventStack.position.set(bd.x - 2, bd.h + 1.1, bd.z - 1.2);
      group.add(ventStack);
      const ventCap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.2, 0.1, 6),
        makeMaterial(0x333344)
      );
      ventCap.position.set(bd.x - 2, bd.h + 1.85, bd.z - 1.2);
      group.add(ventCap);
      // Rooftop access door hatch
      const hatch = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.6, 0.8),
        makeMaterial(0x2a2a34)
      );
      hatch.position.set(bd.x + 2, bd.h + 0.7, bd.z + 2);
      group.add(hatch);
    }
    if (bd.h > 20 && Math.random() < 0.5) {
      // Water tower (classic Chicago rooftop)
      const towerWood = makeMaterial(0x443322);
      const towerLegs = makeMaterial(0x222228);
      // Legs
      for (const [lx, lz] of [[-0.9,-0.9],[0.9,-0.9],[-0.9,0.9],[0.9,0.9]]) {
        const leg = new THREE.Mesh(
          new THREE.BoxGeometry(0.12, 2.4, 0.12),
          towerLegs
        );
        leg.position.set(bd.x - 1.5 + lx, bd.h + 1.6, bd.z - 2 + lz);
        group.add(leg);
      }
      // Tank body
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.1, 1.8, 10),
        towerWood
      );
      tank.position.set(bd.x - 1.5, bd.h + 3.6, bd.z - 2);
      group.add(tank);
      // Tank bands
      for (const by of [bd.h + 2.9, bd.h + 4.3]) {
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(1.12, 0.04, 4, 12),
          towerLegs
        );
        band.position.set(bd.x - 1.5, by, bd.z - 2);
        band.rotation.x = Math.PI / 2;
        group.add(band);
      }
      // Conical roof
      const tankRoof = new THREE.Mesh(
        new THREE.ConeGeometry(1.15, 0.7, 10),
        makeMaterial(0x332211)
      );
      tankRoof.position.set(bd.x - 1.5, bd.h + 4.85, bd.z - 2);
      group.add(tankRoof);
    }
    if (bd.h > 30) {
      // Antenna/spire on tall buildings
      const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 4, 4),
        makeMaterial(0x888888)
      );
      spire.position.set(bd.x, bd.h + 2, bd.z);
      group.add(spire);
      // Guy wires for spire (4 diagonal)
      const wireMat = makeMaterial(0x555555);
      for (let gi = 0; gi < 4; gi++) {
        const ang = (gi / 4) * Math.PI * 2;
        const wire = new THREE.Mesh(
          new THREE.CylinderGeometry(0.01, 0.01, 2.2, 3),
          wireMat
        );
        wire.position.set(
          bd.x + Math.cos(ang) * 0.6,
          bd.h + 1.5,
          bd.z + Math.sin(ang) * 0.6
        );
        wire.rotation.z = Math.cos(ang) * 0.5;
        wire.rotation.x = Math.sin(ang) * 0.5;
        group.add(wire);
      }
      // Aircraft warning light
      const warnLight = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 6, 6),
        sharedBasicMat(0xff0000, 0.9, true)
      );
      warnLight.position.set(bd.x, bd.h + 4, bd.z);
      group.add(warnLight);
      // Satellite dish
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.5),
        makeMaterial(0xcccccc)
      );
      dish.position.set(bd.x + 1.8, bd.h + 1.2, bd.z - 1.8);
      dish.rotation.x = -0.6;
      group.add(dish);
      const dishArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4),
        makeMaterial(0x333344)
      );
      dishArm.position.set(bd.x + 1.8, bd.h + 0.9, bd.z - 1.8);
      group.add(dishArm);
    }
  }

  for (const bd of westBldgData) addBuilding(bd, 1);
  for (const bd of eastBldgData) addBuilding(bd, -1);

  // === STREET LIGHTS along Michigan Ave ===
  for (let z = -80; z < 80; z += 15) {
    // Skip river zone (-7 to 7)
    if (z > -8 && z < 8) continue;
    group.add(makeStreetLight(8, z));
    group.add(makeStreetLight(-8, z));
  }

  // === NEON SIGNS on building faces ===
  const neonColors = [0xff0066, 0x00ffcc, 0xff6600, 0x00aaff, 0xff00ff, 0xffcc00, 0x00ff66];
  const neonSigns = [];
  const neonPlacements = [
    { x: -16.49, y: 6, z: -70, ry: Math.PI / 2, w: 3, h: 0.6 },
    { x: -18.49, y: 8, z: -20, ry: Math.PI / 2, w: 2.5, h: 0.5 },
    { x: -16.49, y: 7, z: 15, ry: Math.PI / 2, w: 3.5, h: 0.7 },
    { x: -18.49, y: 10, z: 30, ry: Math.PI / 2, w: 2.8, h: 0.5 },
    { x: -14.49, y: 5, z: 50, ry: Math.PI / 2, w: 2, h: 0.5 },
    { x: 16.49, y: 7, z: -60, ry: -Math.PI / 2, w: 3, h: 0.6 },
    { x: 18.49, y: 9, z: -30, ry: -Math.PI / 2, w: 2.5, h: 0.5 },
    { x: 16.49, y: 6, z: 20, ry: -Math.PI / 2, w: 3.2, h: 0.6 },
    { x: 18.49, y: 8, z: 55, ry: -Math.PI / 2, w: 2.5, h: 0.5 },
    { x: 20.49, y: 11, z: 70, ry: -Math.PI / 2, w: 3, h: 0.7 },
  ];
  for (let i = 0; i < neonPlacements.length; i++) {
    const np = neonPlacements[i];
    const ns = makeNeonSign(np.x, np.y, np.z, np.ry, neonColors[i % neonColors.length], np.w, np.h);
    group.add(ns);
    neonSigns.push(ns);
  }

  // === TRAFFIC LIGHTS at intersections ===
  for (const zInt of [-35, 35]) {
    for (const xSide of [-7.5, 7.5]) {
      const tl = makeTrafficLight(xSide, zInt);
      group.add(tl);
    }
  }

  // === FIRE HYDRANTS along sidewalks ===
  for (const [fx, fz] of [[-8, -50], [8, -50], [-8, -15], [8, -15], [-8, 45], [8, 45], [-8, 60], [8, 60]]) {
    group.add(makeFireHydrant(fx, fz));
  }

  // === NEWSPAPER BOXES / TRASH CANS on sidewalks ===
  for (let z = -70; z < 70; z += 20) {
    if (z > -8 && z < 8) continue;
    // West sidewalk trash can
    group.add(makeTrashCan(-9.5, z));
    // East sidewalk newspaper box
    group.add(makeNewsBox(9.5, z + 5));
  }

  // === PLANTERS on sidewalks ===
  for (let z = -65; z < 70; z += 25) {
    if (z > -10 && z < 10) continue;
    group.add(makePlanter(-8.5, z));
    group.add(makePlanter(8.5, z));
  }

  // === PARKED CARS (along curbs, not in road center) ===
  const carColors = [0xcc0000, 0x0044cc, 0x333333, 0xffffff, 0xcccc00, 0x228822, 0x666666];
  // West side parked cars (in the parking lane area near curb)
  for (let i = 0; i < 6; i++) {
    const cz = -65 + i * 22;
    if (cz > -8 && cz < 8) continue; // skip river
    if (cz > 28 && cz < 42) continue; // skip cross street
    const car = makeCar(-5.5, cz, carColors[Math.floor(Math.random() * carColors.length)], 0);
    group.add(car);
    addCollider(colliders, car);
  }
  // East side parked cars
  for (let i = 0; i < 5; i++) {
    const cz = -55 + i * 22;
    if (cz > -8 && cz < 8) continue;
    if (cz > 28 && cz < 42) continue;
    const car = makeCar(5.5, cz, carColors[Math.floor(Math.random() * carColors.length)], 0);
    group.add(car);
    addCollider(colliders, car);
  }

  // === BUS STOPS ===
  group.add(makeBusStop(-9, -55, Math.PI / 2));
  group.add(makeBusStop(9, 55, -Math.PI / 2));

  // === CONSTRUCTION ZONE (west side near bridge) ===
  // Barriers
  const barrierMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
  const barrierStripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let bz = -28; bz < -18; bz += 2.5) {
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.3), barrierMat);
    barrier.position.set(-10, 0.4, bz);
    group.add(barrier);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.15, 0.31), barrierStripeMat);
    stripe.position.set(-10, 0.5, bz);
    group.add(stripe);
  }
  // Traffic cones
  for (let ci = 0; ci < 5; ci++) {
    const coneGroup = new THREE.Group();
    const coneBase = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.3), barrierMat);
    coneBase.position.y = 0.02;
    coneGroup.add(coneBase);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 6), barrierMat);
    cone.position.y = 0.3;
    coneGroup.add(cone);
    const coneStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.08, 6), barrierStripeMat);
    coneStripe.position.y = 0.25;
    coneGroup.add(coneStripe);
    coneGroup.position.set(-6.5 + ci * 0.8, 0, -23);
    group.add(coneGroup);
  }
  // Scaffolding (on the nearby building)
  for (let sy = 0; sy < 12; sy += 3) {
    const scaffPlatform = new THREE.Mesh(new THREE.BoxGeometry(2, 0.08, 4), makeMaterial(0x555555));
    scaffPlatform.position.set(-15, sy + 3, -23);
    group.add(scaffPlatform);
    for (const [spx, spz] of [[-16, -25], [-14, -25], [-16, -21], [-14, -21]]) {
      const scaffPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 4), makeMaterial(0x555555));
      scaffPole.position.set(spx, sy + 1.5, spz);
      group.add(scaffPole);
    }
  }

  // === STORE AWNINGS on ground-floor west buildings ===
  for (const bd of westBldgData) {
    if (Math.random() > 0.5) continue;
    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(bd.d * 0.6, 0.06, 2),
      makeMaterial([0xcc3333, 0x338833, 0x333388, 0xcc8833][Math.floor(Math.random() * 4)])
    );
    awning.position.set(bd.x + bd.w / 2 + 1, 3.5, bd.z);
    group.add(awning);
  }

  // === DUMPSTERS in alleys ===
  group.add(makeDumpster(-14, -65, 0));
  group.add(makeDumpster(-14, 55, Math.PI));

  // === ADDITIONAL BUILDINGS further back ===
  // Deep west block
  for (let z = -80; z < 80; z += 16) {
    const h = 12 + Math.random() * 20;
    const bldg = makeBox(6, h, 6, 0x3a3a4a, -38 - Math.random() * 8, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
  }
  // Deep east block (behind park area)
  for (let z = -80; z < -5; z += 16) {
    const h = 12 + Math.random() * 20;
    const bldg = makeBox(6, h, 6, 0x3a3a4a, 42 + Math.random() * 8, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
  }
  for (let z = 45; z < 80; z += 16) {
    const h = 12 + Math.random() * 20;
    const bldg = makeBox(6, h, 6, 0x3a3a4a, 42 + Math.random() * 8, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
  }

  scene.add(group);
  freezeStaticGroup(group);
  return { group, colliders, ufo, starMats, neonSigns, spawnPoints: generateSpawnPoints(80) };
}

// ========== LEVEL 2: LINCOLN PARK ZOO ==========
function buildLincolnParkZoo(scene) {
  const group = new THREE.Group();
  const colliders = [];

  addGround(group, 100, 0x1a3311);
  const { ufo, starMats } = addSky(scene);

  // Zoo at dusk: warm green haze
  scene.fog = new THREE.FogExp2(0x0d1a12, 0.0038);
  scene.background = new THREE.Color(0x0a1408);

  scene.add(new THREE.AmbientLight(0x4a5a3a, 0.5));
  const dirLight = new THREE.DirectionalLight(0xccffbb, 1.3);
  dirLight.position.set(-15, 35, 15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.left = -70;
  dirLight.shadow.camera.right = 70;
  dirLight.shadow.camera.top = 70;
  dirLight.shadow.camera.bottom = -70;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 120;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.04;
  dirLight.shadow.radius = 4;
  scene.add(dirLight);
  // Sky/ground gradient fill (foliage greens)
  const fillLight = new THREE.HemisphereLight(0x88bb66, 0x1a2211, 0.9);
  scene.add(fillLight);
  // Eerie green UFO backlight
  const rimLight = new THREE.DirectionalLight(0x33ff88, 0.4);
  rimLight.position.set(0, 60, -80);
  scene.add(rimLight);
  // Warm sunset accent
  const accentLight = new THREE.DirectionalLight(0xffaa44, 0.18);
  accentLight.position.set(60, 20, 30);
  scene.add(accentLight);

  // === Zoo Entrance Gate ===
  const gateLeft = makeBox(1, 6, 1, 0x885533, -5, 0, 50);
  const gateRight = makeBox(1, 6, 1, 0x885533, 5, 0, 50);
  const gateTop = makeBox(12, 1.5, 1.5, 0x885533, 0, 6, 50);
  group.add(gateLeft, gateRight, gateTop);
  addCollider(colliders, gateLeft);
  addCollider(colliders, gateRight);
  // Gate sign — HDR neon
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 1.2),
    sharedLightMat(0x228833, 2.5)
  );
  sign.position.set(0, 7.5, 50);
  group.add(sign);

  // === Paths (lighter ground strips) ===
  const pathMat = makeMaterial(0x998866);
  const mainPath = new THREE.Mesh(new THREE.PlaneGeometry(4, 100), pathMat);
  mainPath.rotation.x = -Math.PI / 2;
  mainPath.position.set(0, 0.02, 0);
  group.add(mainPath);
  const crossPath = new THREE.Mesh(new THREE.PlaneGeometry(80, 4), pathMat);
  crossPath.rotation.x = -Math.PI / 2;
  crossPath.position.set(0, 0.02, 0);
  group.add(crossPath);

  // === Animal Enclosures ===
  function makeEnclosure(x, z, w, d, label) {
    const fenceH = 1.5;
    const fenceMat = makeMaterial(0x886644);
    // Four fence sides
    const sides = [
      makeBox(w, fenceH, 0.1, 0x886644, x, 0, z - d/2),
      makeBox(w, fenceH, 0.1, 0x886644, x, 0, z + d/2),
      makeBox(0.1, fenceH, d, 0x886644, x - w/2, 0, z),
      makeBox(0.1, fenceH, d, 0x886644, x + w/2, 0, z),
    ];
    sides.forEach(s => { group.add(s); addCollider(colliders, s); });
    // Ground inside
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.2, d - 0.2),
      makeMaterial(0x2a4422)
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.01, z);
    group.add(floor);
    // Sign post
    const post = makeBox(0.8, 1.2, 0.1, 0x445522, x - w/2 + 0.5, 0, z - d/2 - 0.3);
    group.add(post);
  }

  makeEnclosure(-20, 15, 14, 12, 'Lions');
  makeEnclosure(20, 15, 14, 12, 'Primates');
  makeEnclosure(-20, -20, 14, 12, 'Reptiles');
  makeEnclosure(20, -20, 14, 12, 'Birds');
  makeEnclosure(-20, -50, 14, 12, 'Elephants');
  makeEnclosure(20, -50, 14, 12, 'Penguins');

  // === Pond with details ===
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(8, 24),
    new THREE.MeshPhongMaterial({ color: 0x114466, transparent: true, opacity: 0.7, shininess: 80 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(40, 0.03, 30);
  group.add(pond);
  // Pond edge stones
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const rock = makeRock(
      40 + Math.cos(angle) * 8.3,
      30 + Math.sin(angle) * 8.3,
      0.3 + Math.random() * 0.3
    );
    group.add(rock);
  }
  // Lily pads
  for (let i = 0; i < 6; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 4;
    const lilyPad = new THREE.Mesh(
      new THREE.CircleGeometry(0.3 + Math.random() * 0.2, 8, 0, Math.PI * 1.8),
      makeMaterial(0x116622)
    );
    lilyPad.rotation.x = -Math.PI / 2;
    lilyPad.rotation.z = Math.random() * Math.PI;
    lilyPad.position.set(40 + Math.cos(angle) * r, 0.04, 30 + Math.sin(angle) * r);
    group.add(lilyPad);
  }
  // Wooden bridge across pond
  const bridgeDeck = new THREE.Mesh(new THREE.BoxGeometry(2, 0.15, 8), makeMaterial(0x664422));
  bridgeDeck.position.set(40, 0.3, 30);
  group.add(bridgeDeck);
  for (const side of [-1, 1]) {
    const railing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 8), makeMaterial(0x553311));
    railing.position.set(40 + side * 1, 0.65, 30);
    group.add(railing);
    for (let z = -3; z <= 3; z += 2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.8, 0.08), makeMaterial(0x553311));
      post.position.set(40 + side * 1, 0.5, 30 + z);
      group.add(post);
    }
  }

  // === Animal statues in enclosures ===
  group.add(makeAnimalStatue(-20, 15, 'lion'));
  group.add(makeAnimalStatue(20, 15, 'bear'));
  group.add(makeAnimalStatue(-20, -20, 'generic'));
  group.add(makeAnimalStatue(20, -20, 'generic'));
  group.add(makeAnimalStatue(-20, -50, 'generic'));
  group.add(makeAnimalStatue(20, -50, 'bear'));

  // === Central Fountain ===
  group.add(makeFountain(0, 0, 1));

  // === Playground ===
  group.add(makePlayground(40, -20));

  // === Nature Museum Building ===
  const museum = makeBox(20, 8, 12, 0x887766, -40, 0, -40);
  group.add(museum);
  addCollider(colliders, museum);
  // Museum entrance with columns
  const museumDoor = makeBox(3, 5, 0.5, 0x443322, -40, 0, -33.5);
  group.add(museumDoor);
  // Entrance columns
  for (const mx of [-42, -38]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 6, 8), makeMaterial(0x998877));
    col.position.set(mx, 3, -33.5);
    group.add(col);
  }
  // Museum roof
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(14, 4, 4),
    makeMaterial(0x554433)
  );
  roof.position.set(-40, 10, -40);
  roof.rotation.y = Math.PI / 4;
  group.add(roof);
  // Museum windows
  for (let mx = -47; mx < -33; mx += 3) {
    const mWin = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2),
      sharedBasicMat(0xffdd66, 0.4, true));
    mWin.position.set(mx, 4, -33.9);
    group.add(mWin);
  }

  // === Information kiosks along paths ===
  for (const [kx, kz] of [[4, 20], [-4, -10], [4, -40]]) {
    const kiosk = new THREE.Group();
    const kioskPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 6), makeMaterial(0x556633));
    kioskPost.position.y = 0.9;
    kiosk.add(kioskPost);
    const kioskSign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.04), makeMaterial(0x446633));
    kioskSign.position.y = 1.6;
    kiosk.add(kioskSign);
    const kioskMap = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7),
      sharedBasicMat(0x88aa66));
    kioskMap.position.set(0, 1.6, 0.025);
    kiosk.add(kioskMap);
    kiosk.position.set(kx, 0, kz);
    group.add(kiosk);
  }

  // === Flower beds ===
  for (const [fx, fz] of [[8, 35], [-8, 35], [8, -5], [-8, -5], [0, -30]]) {
    const bed = new THREE.Group();
    const bedBorder = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.1, 4, 8),
      makeMaterial(0x665533)
    );
    bedBorder.rotation.x = -Math.PI / 2;
    bedBorder.position.y = 0.1;
    bed.add(bedBorder);
    const bedSoil = new THREE.Mesh(new THREE.CircleGeometry(1.2, 8), makeMaterial(0x3a2a1a));
    bedSoil.rotation.x = -Math.PI / 2;
    bedSoil.position.y = 0.02;
    bed.add(bedSoil);
    // Flowers in rows
    const flowerColors = [0xff4488, 0xffaa22, 0xff66cc, 0xffdd00, 0xee3366, 0xff8844];
    for (let fi = 0; fi < 12; fi++) {
      const fAngle = (fi / 12) * Math.PI * 2;
      const fr = 0.4 + Math.random() * 0.6;
      const flower = new THREE.Mesh(new THREE.SphereGeometry(0.06, 4, 4),
        sharedBasicMat(flowerColors[Math.floor(Math.random() * flowerColors.length)]));
      flower.position.set(Math.cos(fAngle) * fr, 0.15, Math.sin(fAngle) * fr);
      bed.add(flower);
      // Stem
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 3), makeMaterial(0x226622));
      stem.position.set(Math.cos(fAngle) * fr, 0.08, Math.sin(fAngle) * fr);
      bed.add(stem);
    }
    bed.position.set(fx, 0, fz);
    group.add(bed);
  }

  // === Scattered rocks and boulders ===
  for (let i = 0; i < 15; i++) {
    const rx = (Math.random() - 0.5) * 100;
    const rz = (Math.random() - 0.5) * 100;
    if (Math.abs(rx) < 3 || Math.abs(rz) < 3) continue;
    group.add(makeRock(rx, rz, 0.5 + Math.random() * 0.8));
  }

  // === Trees everywhere ===
  for (let i = 0; i < 50; i++) {
    const x = (Math.random() - 0.5) * 160;
    const z = (Math.random() - 0.5) * 160;
    // Don't place on paths, enclosures, pond, or playground
    if (Math.abs(x) < 3 || (Math.abs(z) < 3 && Math.abs(x) < 40)) continue;
    if (Math.abs(x - 40) < 10 && Math.abs(z - 30) < 10) continue;
    if (Math.abs(x - 40) < 8 && Math.abs(z + 20) < 6) continue;
    const tree = makeTree(x, z, 0.8 + Math.random() * 0.6);
    group.add(tree);
  }

  // Benches along paths (now proper benches)
  for (let z = -40; z < 40; z += 12) {
    const b = makeBench(3, z);
    b.rotation.y = -Math.PI / 2;
    group.add(b);
    if (z % 24 === 0) {
      const b2 = makeBench(-3, z);
      b2.rotation.y = Math.PI / 2;
      group.add(b2);
    }
  }

  // Trash cans along paths
  for (const [tx, tz] of [[3.5, 5], [-3.5, -15], [3.5, 30], [-3.5, -35]]) {
    group.add(makeTrashCan(tx, tz));
  }

  // Lamp posts
  for (let z = -40; z < 50; z += 12) {
    group.add(makeStreetLight(2.5, z));
    group.add(makeStreetLight(-2.5, z));
  }

  scene.add(group);
  freezeStaticGroup(group);
  return { group, colliders, ufo, starMats, spawnPoints: generateSpawnPoints(70) };
}

// ========== LEVEL 3: RAVENSWOOD ==========
function buildRavenswood(scene) {
  const group = new THREE.Group();
  const colliders = [];

  addGround(group, 100, 0x2a2a2a);
  const { ufo, starMats } = addSky(scene);

  // Ravenswood at night: cool urban blue haze
  scene.fog = new THREE.FogExp2(0x0a0e1c, 0.0045);
  scene.background = new THREE.Color(0x080a18);

  scene.add(new THREE.AmbientLight(0x3a4a55, 0.5));
  const dirLight = new THREE.DirectionalLight(0xccccff, 1.15);
  dirLight.position.set(10, 38, -15);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.left = -70;
  dirLight.shadow.camera.right = 70;
  dirLight.shadow.camera.top = 70;
  dirLight.shadow.camera.bottom = -70;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 130;
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.04;
  dirLight.shadow.radius = 4;
  scene.add(dirLight);
  // Moonlit sky/ground gradient
  const fillLight = new THREE.HemisphereLight(0x5577aa, 0x151520, 0.85);
  scene.add(fillLight);
  // Alien green UFO backlight
  const rimLight = new THREE.DirectionalLight(0x22ffaa, 0.4);
  rimLight.position.set(0, 60, -80);
  scene.add(rimLight);
  // Street lamp warm accent
  const accentLight = new THREE.DirectionalLight(0xffaa55, 0.15);
  accentLight.position.set(-30, 20, 60);
  scene.add(accentLight);

  // === CTA Brown Line Elevated Tracks ===
  // Support pillars with cross bracing
  for (let z = -80; z < 80; z += 8) {
    const pillar = makeBox(0.6, 6, 0.6, 0x555555, 0, 0, z);
    group.add(pillar);
    addCollider(colliders, pillar);
    // Cross braces between pillars
    if (z < 72) {
      const brace = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 8),
        makeMaterial(0x444444)
      );
      brace.position.set(0, 4, z + 4);
      brace.rotation.x = 0.15;
      group.add(brace);
    }
  }
  // Track bed
  const trackBed = makeBox(5, 0.5, 170, 0x444444, 0, 6, 0);
  group.add(trackBed);
  // Rails
  const rail1 = makeBox(0.1, 0.15, 170, 0x888888, -1.2, 6.3, 0);
  const rail2 = makeBox(0.1, 0.15, 170, 0x888888, 1.2, 6.3, 0);
  group.add(rail1, rail2);
  // Railroad ties
  for (let z = -84; z < 84; z += 1) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.15), makeMaterial(0x3a3a3a));
    tie.position.set(0, 6.2, z);
    group.add(tie);
  }

  // === Ravenswood Station - enhanced ===
  const stationPlatform = makeBox(8, 0.3, 15, 0x666666, 0, 6.2, 0);
  group.add(stationPlatform);
  // Platform edge stripe
  const platStripe = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 15),
    new THREE.MeshBasicMaterial({ color: 0xffff00 }));
  platStripe.rotation.x = -Math.PI / 2;
  platStripe.position.set(-3.8, 6.36, 0);
  group.add(platStripe);
  // Station shelter - proper roof
  const shelterRoof = makeBox(7.5, 0.15, 5, 0x446666, 0, 9.5, -2);
  group.add(shelterRoof);
  // Shelter supports
  for (const [sx, sz] of [[-3.2, -4.2], [3.2, -4.2], [-3.2, 0.2], [3.2, 0.2]]) {
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 6), makeMaterial(0x446666));
    support.position.set(sx, 8, sz);
    group.add(support);
  }
  // Benches on platform
  for (const bz of [-3, 0, 3]) {
    const pBench = makeBench(2, 0);
    pBench.position.set(2, 6.35, bz);
    pBench.rotation.y = -Math.PI / 2;
    group.add(pBench);
  }
  // CTA sign
  const ctaSign = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 0.08), makeMaterial(0x224488));
  ctaSign.position.set(0, 9, 0);
  group.add(ctaSign);
  const ctaDot = new THREE.Mesh(new THREE.CircleGeometry(0.25, 12),
    sharedLightMat(0xff8822, 3.5));
  ctaDot.position.set(0, 9, 0.05);
  group.add(ctaDot);
  // Station stairs
  const stairs = makeBox(2, 6, 3, 0x555555, 5, 0, 0);
  group.add(stairs);
  addCollider(colliders, stairs);
  // Stair railing
  for (const side of [-1, 1]) {
    const stairRail = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.8, 3.5),
      makeMaterial(0x444444)
    );
    stairRail.position.set(5 + side * 1, 3.4, 0);
    stairRail.rotation.x = 0.35;
    group.add(stairRail);
  }

  // === Residential Buildings (both sides of tracks) ===
  function makeResidential(x, z, stories) {
    const h = stories * 3.5;
    const w = 6 + Math.random() * 4;
    const d = 8 + Math.random() * 4;
    const colors = [0x884433, 0x774422, 0x665544, 0x776655, 0x885544];
    const bldg = makeBox(w, h, d, colors[Math.floor(Math.random() * colors.length)], x, 0, z);
    group.add(bldg);
    addCollider(colliders, bldg);
    const facing = x > 0 ? -1 : 1;
    // Windows
    for (let y = 2; y < h; y += 3.5) {
      for (let wx = -w/3; wx <= w/3; wx += w/3) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1.5),
          new THREE.MeshBasicMaterial({
            color: Math.random() > 0.5 ? 0xffdd44 : 0x222244,
            transparent: true,
            opacity: 0.7
          })
        );
        win.position.set(x + facing * (w/2 + 0.01), y, z + wx);
        win.rotation.y = facing > 0 ? Math.PI / 2 : -Math.PI / 2;
        group.add(win);
      }
    }
    // Window sills
    for (let y = 2; y < h; y += 3.5) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, w * 0.8),
        makeMaterial(0x666655));
      sill.position.set(x + facing * (w/2 + 0.05), y - 0.05, z);
      group.add(sill);
    }
    // Fire escape (on every other building)
    if (Math.random() > 0.4 && stories >= 2) {
      const feX = x + facing * (w/2 + 0.8);
      for (let fy = 3.5; fy < h; fy += 3.5) {
        // Platform
        const fePlatform = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 2), makeMaterial(0x333333));
        fePlatform.position.set(feX, fy, z);
        group.add(fePlatform);
        // Railing
        const feRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 2), makeMaterial(0x333333));
        feRail.position.set(feX + facing * 0.73, fy + 0.4, z);
        group.add(feRail);
        const feRailFront = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.04), makeMaterial(0x333333));
        feRailFront.position.set(feX, fy + 0.8, z - 1);
        group.add(feRailFront);
        // Ladder between floors
        if (fy > 3.5) {
          const feLadder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.5, 0.04), makeMaterial(0x333333));
          feLadder.position.set(feX + facing * 0.3, fy - 1.75, z + 0.5);
          group.add(feLadder);
          // Ladder rungs
          for (let rl = 0; rl < 5; rl++) {
            const rung = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), makeMaterial(0x444444));
            rung.position.set(feX + facing * 0.3, fy - 3 + rl * 0.7, z + 0.5);
            group.add(rung);
          }
        }
      }
      // Drop ladder to ground (retracted)
      const dropLadder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.04), makeMaterial(0x333333));
      dropLadder.position.set(feX + facing * 0.3, 2.5, z + 0.5);
      group.add(dropLadder);
    }
    // Stoop/stairs with railing
    const stoopX = x + (x > 0 ? -w/2 - 0.5 : w/2 + 0.5);
    const stoop = makeBox(2, 0.8, 1.5, 0x777777, stoopX, 0, z);
    group.add(stoop);
    for (const side of [-0.9, 0.9]) {
      const stoopRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1, 0.04), makeMaterial(0x333333));
      stoopRail.position.set(stoopX + side, 1.3, z - 0.7);
      group.add(stoopRail);
    }
    // Roof cornice
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.2, d + 0.3), makeMaterial(0x555544));
    cornice.position.set(x, h + 0.1, z);
    group.add(cornice);
  }

  // Houses along both sides
  for (let z = -70; z < 70; z += 14) {
    makeResidential(-18 - Math.random() * 5, z + Math.random() * 4, 2 + Math.floor(Math.random() * 2));
    makeResidential(18 + Math.random() * 5, z + Math.random() * 4, 2 + Math.floor(Math.random() * 2));
  }

  // === Storefronts along one side - enhanced ===
  const storeNames = [0x2244aa, 0xaa2244, 0x22aa44, 0xaa8822, 0x4422aa, 0x228888];
  for (let si = 0; si < 7; si++) {
    const z = -30 + si * 10;
    const store = makeBox(5, 4, 6, 0x776655, -12, 0, z);
    group.add(store);
    addCollider(colliders, store);
    // Awning
    const awningColor = [0xcc3333, 0x33cc33, 0x3333cc, 0xcccc33, 0xcc6633, 0x33cccc, 0x9933cc];
    const awning = makeBox(5.5, 0.1, 2, awningColor[si], -12, 3.5, z - 3.5);
    group.add(awning);
    // Awning valance
    const valance = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.3),
      sharedBasicMat(awningColor[si], 0.8, true));
    valance.position.set(-12, 3.3, z - 4.5);
    group.add(valance);
    // Storefront window
    const sfWindow = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.5),
      new THREE.MeshPhongMaterial({ color: 0x334466, transparent: true, opacity: 0.4, shininess: 100 }));
    sfWindow.position.set(-9.49, 2, z);
    sfWindow.rotation.y = Math.PI / 2;
    group.add(sfWindow);
    // Store sign — HDR neon, blooms through the bloom pass
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 3),
      sharedLightMat(storeNames[si % storeNames.length], 2.5));
    signBoard.position.set(-9.4, 3.8, z);
    group.add(signBoard);
    // Store light
    const storeLight = new THREE.PointLight(0xffaa44, 0.5, 8);
    storeLight.position.set(-12, 3, z - 4);
    group.add(storeLight);
    // Door
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.5), makeMaterial(0x443322));
    door.position.set(-9.49, 1.5, z - 2);
    door.rotation.y = Math.PI / 2;
    group.add(door);
  }

  // === Water Tower - enhanced ===
  const towerBase = makeBox(2, 12, 2, 0x777777, 35, 0, -20);
  group.add(towerBase);
  addCollider(colliders, towerBase);
  // Cross bracing on tower
  for (let ty = 2; ty < 10; ty += 4) {
    const brace1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4, 0.06), makeMaterial(0x666666));
    brace1.position.set(35 - 0.8, ty + 2, -20);
    brace1.rotation.z = 0.4;
    group.add(brace1);
    const brace2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4, 0.06), makeMaterial(0x666666));
    brace2.position.set(35 + 0.8, ty + 2, -20);
    brace2.rotation.z = -0.4;
    group.add(brace2);
  }
  const tank = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 4, 12),
    makeMaterial(0x666666)
  );
  tank.position.set(35, 14, -20);
  group.add(tank);
  // Tank bands
  for (const by of [12.5, 14, 15.5]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.04, 4, 12),
      makeMaterial(0x555555));
    band.rotation.x = Math.PI / 2;
    band.position.set(35, by, -20);
    group.add(band);
  }
  const tankRoof = new THREE.Mesh(
    new THREE.ConeGeometry(3, 2, 12),
    makeMaterial(0x555555)
  );
  tankRoof.position.set(35, 17, -20);
  group.add(tankRoof);

  // === Church / community building ===
  const church = makeBox(8, 10, 12, 0x887766, -35, 0, -40);
  group.add(church);
  addCollider(colliders, church);
  // Steeple
  const steeple = makeBox(3, 6, 3, 0x887766, -35, 10, -40);
  group.add(steeple);
  const steepleRoof = new THREE.Mesh(
    new THREE.ConeGeometry(2.5, 5, 4),
    makeMaterial(0x555555)
  );
  steepleRoof.position.set(-35, 18.5, -40);
  steepleRoof.rotation.y = Math.PI / 4;
  group.add(steepleRoof);
  // Cross on top
  const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.1), makeMaterial(0xddddcc));
  crossV.position.set(-35, 21.8, -40);
  group.add(crossV);
  const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.1), makeMaterial(0xddddcc));
  crossH.position.set(-35, 22.2, -40);
  group.add(crossH);
  // Church windows (arched - approximated)
  for (let cz = -45; cz <= -35; cz += 3) {
    const cWin = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.5),
      sharedBasicMat(0xddaa44, 0.5, true));
    cWin.position.set(-31, 5, cz);
    cWin.rotation.y = -Math.PI / 2;
    group.add(cWin);
  }
  // Church entrance
  const churchDoor = new THREE.Mesh(new THREE.PlaneGeometry(2, 3.5), makeMaterial(0x553322));
  churchDoor.position.set(-35, 2, -33.9);
  group.add(churchDoor);

  // === Utility poles along east road ===
  for (let z = -60; z < 60; z += 20) {
    group.add(makeUtilityPole(12, z));
  }

  // === Dumpsters in alleys ===
  group.add(makeDumpster(-15, -55, Math.PI / 2));
  group.add(makeDumpster(15, 25, -Math.PI / 2));
  group.add(makeDumpster(-15, 40, Math.PI / 2));

  // === Chain link fence sections (around a vacant lot) ===
  const fenceMat = new THREE.MeshPhongMaterial({ color: 0x888888, transparent: true, opacity: 0.3, side: THREE.DoubleSide });
  const fencePost = makeMaterial(0x555555);
  // Vacant lot at east side
  for (let fz = 55; fz < 75; fz += 3) {
    const fencePanel = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), fenceMat);
    fencePanel.position.set(14, 1, fz);
    fencePanel.rotation.y = Math.PI / 2;
    group.add(fencePanel);
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), fencePost);
    fp.position.set(14, 1.1, fz - 1.5);
    group.add(fp);
  }

  // === Tree-lined streets ===
  for (let z = -70; z < 70; z += 10) {
    group.add(makeTree(-10, z, 0.7 + Math.random() * 0.4));
    group.add(makeTree(10, z, 0.7 + Math.random() * 0.4));
  }
  // Some backyard trees
  for (let i = 0; i < 12; i++) {
    const tx = (Math.random() > 0.5 ? -1 : 1) * (25 + Math.random() * 15);
    const tz = (Math.random() - 0.5) * 140;
    group.add(makeTree(tx, tz, 0.6 + Math.random() * 0.5));
  }

  // === Sidewalks with curbs ===
  const sidewalkMat = makeMaterial(0x888888);
  const curbMat = makeMaterial(0x999999);
  for (const sx of [-8, 8]) {
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(3, 170), sidewalkMat);
    sw.rotation.x = -Math.PI / 2;
    sw.position.set(sx, 0.015, 0);
    group.add(sw);
    // Curbs
    const innerCurb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 170), curbMat);
    innerCurb.position.set(sx + (sx > 0 ? -1.5 : 1.5), 0.06, 0);
    group.add(innerCurb);
  }

  // === Roads ===
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), makeMaterial(0x1a1a1a));
  road.rotation.x = -Math.PI / 2;
  road.position.set(-5, 0.01, 0);
  group.add(road);
  const road2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 170), makeMaterial(0x1a1a1a));
  road2.rotation.x = -Math.PI / 2;
  road2.position.set(5, 0.01, 0);
  group.add(road2);
  // Road markings
  for (const rx of [-5, 5]) {
    for (let rz = -80; rz < 80; rz += 6) {
      const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3),
        new THREE.MeshBasicMaterial({ color: 0xffff00 }));
      centerLine.rotation.x = -Math.PI / 2;
      centerLine.position.set(rx, 0.02, rz);
      group.add(centerLine);
    }
  }

  // Street lights
  for (let z = -60; z < 60; z += 15) {
    group.add(makeStreetLight(-7, z));
    group.add(makeStreetLight(7, z));
  }

  // Neon signs on storefronts
  const rvNeonColors = [0xff3366, 0x00ffaa, 0xff8800, 0x6600ff, 0x00ccff];
  const neonSigns = [];
  for (let si = 0; si < 5; si++) {
    const z = -20 + si * 10;
    const ns = makeNeonSign(-9.4, 4.5, z, Math.PI / 2, rvNeonColors[si], 2.5, 0.5);
    group.add(ns);
    neonSigns.push(ns);
  }

  // Trash cans and fire hydrants
  for (let z = -50; z < 50; z += 25) {
    group.add(makeTrashCan(-9, z));
    group.add(makeFireHydrant(9, z + 10));
  }

  // Parked cars with detail
  const carColors = [0xcc0000, 0x333333, 0x0044aa, 0xeeeeee, 0x444400, 0x666666, 0x882222];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -7.5 : 7.5;
    const car = makeCar(
      side, -55 + i * 16,
      carColors[Math.floor(Math.random() * carColors.length)],
      0
    );
    group.add(car);
    addCollider(colliders, car);
  }

  scene.add(group);
  freezeStaticGroup(group);
  return { group, colliders, ufo, starMats, neonSigns, spawnPoints: generateSpawnPoints(75) };
}

function generateSpawnPoints(radius) {
  const points = [];
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * Math.PI * 2;
    const r = radius * (0.6 + Math.random() * 0.4);
    points.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
  }
  return points;
}
