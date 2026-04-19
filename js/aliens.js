// aliens.js - Three alien types with procedural models and AI
import { disposeTree, spawnParticle } from './particles.js';

// ---------------------------------------------------------------------------
// Geometry cache for alien model construction.
//
// Every spawn used to rebuild ~50 fresh BufferGeometry instances per alien —
// the grunt model alone allocates 40+ cylinders/boxes/spheres/torii. Wave
// spawns of 20+ aliens triggered ~1000 geometry allocations and their
// associated vertex-buffer uploads in a single frame, producing visible
// spawn-wave hitches.
//
// cGeom() memoizes each unique (constructor, args) tuple. Geometries are
// flagged __shared so disposeTree() skips them across level transitions,
// and the cache persists for the session.
// ---------------------------------------------------------------------------

// Per-type procedural animation parameters. The animation system reads
// horizontal speed off frame-to-frame position deltas and synthesizes a
// walk-cycle bob, forward/lateral lean toward velocity, idle breathing
// scale pulse, attack recoil, and hit flinch — all without restructuring
// the static alien meshes (which were authored as one flat group). Each
// type's silhouette and movement style gets its own parameter set.
const ANIM_PARAMS = {
  // walkRate    = walk-cycle speed multiplier (radians per (m/s * sec))
  // bobAmp      = vertical bob amplitude (world units)
  // leanFactor  = how strongly the body tilts into velocity (rad per m/s)
  // breatheAmp  = idle breathing scale amplitude (fraction)
  // breatheRate = idle breathing oscillation rate (rad/sec)
  grunt:   { walkRate: 4.0, bobAmp: 0.07, leanFactor: 0.05, breatheAmp: 0.012, breatheRate: 1.6 },
  swarmer: { walkRate: 5.0, bobAmp: 0.05, leanFactor: 0.06, breatheAmp: 0.008, breatheRate: 4.0 },
  bloater: { walkRate: 2.5, bobAmp: 0.14, leanFactor: 0.03, breatheAmp: 0.045, breatheRate: 1.2 },
  stalker: { walkRate: 3.5, bobAmp: 0.04, leanFactor: 0.06, breatheAmp: 0.010, breatheRate: 2.4 },
  spitter: { walkRate: 3.0, bobAmp: 0.08, leanFactor: 0.04, breatheAmp: 0.020, breatheRate: 1.8 },
  drone:   { walkRate: 0,   bobAmp: 0,    leanFactor: 0.04, breatheAmp: 0,     breatheRate: 0   },
};

const _alienGeomCache = new Map();
function cGeom(Ctor, ...args) {
  // Key on constructor name + stringified args. All geometry constructors we
  // wrap take only numeric/primitive args, so JSON is cheap and stable.
  const key = Ctor.name + '|' + args.join(',');
  let g = _alienGeomCache.get(key);
  if (!g) {
    g = new Ctor(...args);
    g.__shared = true;
    _alienGeomCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// HDR glow material factory for alien eyes / insignia / glowing accents.
//
// Previously every alien-model build used a local `glowMat` arrow factory
// duplicated verbatim across 6 type-builder functions. This single helper
// replaces all of them so the six copies collapse into one definition,
// and — more importantly — produces toneMapped:false materials whose color
// is multiplied past [0,1] into real HDR range. The UnrealBloomPass picks
// these up via its luminance threshold so alien eyes, insignia, veins, and
// accent glows now punch with a visible halo through the bloom pipeline.
//
// NOTE: materials are NOT cached. Several ambient and state effects mutate
// material.opacity per-alien at runtime (bloater pulse, drone exhaust,
// stalker cloak, spitter drip, swarmer trail). Sharing would bleed those
// opacity animations across every instance of that alien type. The small
// per-spawn alloc cost is the correct tradeoff for per-instance animation
// correctness.
// ---------------------------------------------------------------------------
function aGlow(color, opacity = 0.7, intensity = 2.5) {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    toneMapped: false,
  });
  if (intensity !== 1.0) m.color.multiplyScalar(intensity);
  return m;
}

export const ALIEN_TYPES = {
  grunt: {
    name: 'Grunt Alien',
    hp: 50,
    speed: 4,
    damage: 8,
    attackRange: 30,
    attackRate: 1.5,
    scoreValue: 100,
    color: 0x00cc44,
    description: 'Standard alien soldier armed with an energy blaster. Medium speed and toughness. Keeps distance and fires green energy bolts.',
    behavior: 'ranged',
  },
  swarmer: {
    name: 'Swarmer',
    hp: 25,
    speed: 10,
    damage: 15,
    attackRange: 2,
    attackRate: 0.5,
    scoreValue: 75,
    color: 0x9900ff,
    description: 'Small, fast alien that attacks with razor-sharp claws. Low health but extremely fast. Rushes the player in packs.',
    behavior: 'melee',
  },
  bloater: {
    name: 'Bloater',
    hp: 100,
    speed: 2,
    damage: 40,
    attackRange: 4,
    attackRate: 999, // Explodes instead of attacking repeatedly
    scoreValue: 200,
    color: 0xff2200,
    explosionRadius: 8,
    description: 'Large, slow alien filled with volatile plasma. Approaches the player and detonates, dealing massive area damage. Can also explode on death.',
    behavior: 'explosive',
  },
  stalker: {
    name: 'Stalker',
    hp: 40,
    speed: 9,
    damage: 25,
    attackRange: 2.5,
    attackRate: 0.8,
    scoreValue: 150,
    color: 0x008888,
    description: 'Semi-invisible predator that stalks from the shadows. Partially cloaked until it strikes with devastating claws.',
    behavior: 'stealth',
  },
  spitter: {
    name: 'Acid Spitter',
    hp: 60,
    speed: 3,
    damage: 20,
    attackRange: 50,
    attackRate: 2.5,
    scoreValue: 175,
    color: 0x88cc00,
    description: 'Hunched reptilian alien with toxic acid glands. Stays at extreme range and fires high-damage acid projectiles.',
    behavior: 'sniper',
  },
  drone: {
    name: 'Hover Drone',
    hp: 30,
    speed: 7,
    damage: 10,
    attackRange: 35,
    attackRate: 0.8,
    scoreValue: 125,
    color: 0x4488ff,
    flyHeight: 6,
    description: 'Floating alien drone that attacks from above. Fast and evasive, raining energy bolts from the sky.',
    behavior: 'aerial',
  },
};

// Fresnel rim-light shader patch: injects an edge glow into MeshPhongMaterial
// so alien silhouettes visibly glow against dark scenes.
function applyRimLight(material, rimColorHex, rimIntensity = 0.9, rimPower = 2.2) {
  const rimColor = new THREE.Color(rimColorHex);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimIntensity = { value: rimIntensity };
    shader.uniforms.rimPower = { value: rimPower };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 rimColor;
         uniform float rimIntensity;
         uniform float rimPower;`
      )
      .replace(
        '#include <output_fragment>',
        `float rimDot = 1.0 - max(0.0, dot(normalize(vViewPosition), normal));
         float rim = pow(rimDot, rimPower) * rimIntensity;
         outgoingLight += rimColor * rim;
         #include <output_fragment>`
      );
  };
  material.customProgramCacheKey = () =>
    'rim_' + rimColor.getHexString() + '_' + rimIntensity.toFixed(2) + '_' + rimPower.toFixed(2);
  material.needsUpdate = true;
}

// Walk a group and rim-light every phong material found.
function rimLightGroup(group, rimColorHex, intensity = 0.9, power = 2.2) {
  const patched = new WeakSet();
  group.traverse(child => {
    const mat = child.material;
    if (!mat) return;
    if (Array.isArray(mat)) {
      mat.forEach(m => {
        if (m && m.isMeshPhongMaterial && !patched.has(m)) {
          applyRimLight(m, rimColorHex, intensity, power);
          patched.add(m);
        }
      });
    } else if (mat.isMeshPhongMaterial && !patched.has(mat)) {
      applyRimLight(mat, rimColorHex, intensity, power);
      patched.add(mat);
    }
  });
}

export function createAlienModel(type) {
  const data = ALIEN_TYPES[type];
  const group = new THREE.Group();

  if (type === 'grunt') {
    // === GRUNT: Tall humanoid alien soldier ===
    const skinMat = new THREE.MeshPhongMaterial({ color: 0x00cc44, emissive: 0x003311, shininess: 25 });
    const armorMat = new THREE.MeshPhongMaterial({ color: 0x336633, emissive: 0x002200, shininess: 80 });
    const darkArmorMat = new THREE.MeshPhongMaterial({ color: 0x1a331a, emissive: 0x001100, shininess: 90 });
    const metalMat = new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 60 });
    const darkMetal = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 70 });

    // Torso - segmented armor
    const torso = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.32, 0.28, 1.0, 8),
      new THREE.MeshPhongMaterial({ color: 0x009933, emissive: 0x003311, shininess: 40 })
    );
    torso.position.y = 1.1;
    group.add(torso);

    // Chest armor plate - layered
    const chestPlate = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.5, 0.5, 0.15),
      armorMat
    );
    chestPlate.position.set(0, 1.3, 0.2);
    group.add(chestPlate);
    // Chest plate center ridge
    const chestRidge = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.06, 0.45, 0.04),
      darkArmorMat
    );
    chestRidge.position.set(0, 1.3, 0.28);
    group.add(chestRidge);
    // Chest armor rivets
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const rivet = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.012, 4, 4),
          metalMat
        );
        rivet.position.set(side * 0.18, 1.15 + i * 0.15, 0.28);
        group.add(rivet);
      }
    }
    // Back armor plate
    const backPlate = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.44, 0.44, 0.1),
      armorMat
    );
    backPlate.position.set(0, 1.3, -0.2);
    group.add(backPlate);
    // Torso armor seam lines
    for (let i = 0; i < 4; i++) {
      const seam = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.52, 0.008, 0.42),
        new THREE.MeshPhongMaterial({ color: 0x224422, shininess: 30 })
      );
      seam.position.set(0, 0.75 + i * 0.22, 0);
      group.add(seam);
    }

    // Shoulder pads - more angular with edge detail
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.14, 8, 8),
        armorMat
      );
      pad.scale.set(1.2, 0.7, 1);
      pad.position.set(side * 0.42, 1.55, 0);
      group.add(pad);
      // Shoulder pad edge trim
      const padEdge = new THREE.Mesh(
        cGeom(THREE.TorusGeometry, 0.13, 0.012, 4, 10, Math.PI),
        darkArmorMat
      );
      padEdge.position.set(side * 0.42, 1.55, 0);
      padEdge.rotation.x = Math.PI / 2;
      padEdge.rotation.z = side * -Math.PI / 2;
      group.add(padEdge);
      // Shoulder insignia (glowing dot)
      const insignia = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.04, 8),
        aGlow(0x00ff44, 0.6)
      );
      insignia.position.set(side * 0.52, 1.56, 0.08);
      insignia.rotation.y = side * Math.PI / 3;
      group.add(insignia);
    }

    // Neck
    const neck = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.12, 0.15, 0.2, 8),
      skinMat
    );
    neck.position.y = 1.72;
    group.add(neck);
    // Neck tendons
    for (const side of [-1, 1]) {
      const tendon = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.015, 0.02, 0.22, 4),
        new THREE.MeshPhongMaterial({ color: 0x009930, emissive: 0x003310 })
      );
      tendon.position.set(side * 0.08, 1.72, 0.04);
      group.add(tendon);
    }

    // Head - large elongated cranium with more detail
    const head = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.35, 12, 12),
      new THREE.MeshPhongMaterial({ color: 0x00ee55, emissive: 0x004422 })
    );
    head.scale.set(1, 1.4, 0.95);
    head.position.y = 2.05;
    group.add(head);
    // Cranium ridge - multiple
    const ridge = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.06, 0.3, 0.5),
      new THREE.MeshPhongMaterial({ color: 0x007733, emissive: 0x003311 })
    );
    ridge.position.set(0, 2.3, -0.05);
    group.add(ridge);
    // Secondary ridges
    for (const side of [-1, 1]) {
      const sideRidge = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.04, 0.18, 0.35),
        new THREE.MeshPhongMaterial({ color: 0x007733, emissive: 0x003311 })
      );
      sideRidge.position.set(side * 0.15, 2.22, -0.08);
      group.add(sideRidge);
    }
    // Brow ridge
    const browRidge = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.42, 0.04, 0.08),
      new THREE.MeshPhongMaterial({ color: 0x00aa44, emissive: 0x003311 })
    );
    browRidge.position.set(0, 2.15, 0.26);
    group.add(browRidge);
    // Cheekbones
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.06, 6, 6),
        new THREE.MeshPhongMaterial({ color: 0x00dd44, emissive: 0x004422 })
      );
      cheek.scale.set(1.3, 0.7, 0.8);
      cheek.position.set(side * 0.2, 1.98, 0.22);
      group.add(cheek);
    }
    // Ear fins
    for (const side of [-1, 1]) {
      const earFin = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.03, 0.18, 0.12),
        new THREE.MeshPhongMaterial({ color: 0x00bb44, emissive: 0x003311 })
      );
      earFin.position.set(side * 0.32, 2.05, -0.05);
      earFin.rotation.z = side * 0.2;
      group.add(earFin);
    }

    // Eyes - large almond-shaped, glowing with pupils
    for (const side of [-1, 1]) {
      // Eye socket recess
      const socket = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.11, 8, 8),
        new THREE.MeshPhongMaterial({ color: 0x005522, emissive: 0x001100 })
      );
      socket.scale.set(1.3, 0.7, 0.3);
      socket.position.set(side * 0.16, 2.08, 0.27);
      group.add(socket);
      // Eye
      const eye = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.1, 10, 10),
        aGlow(0x00ff00, 1.0)
      );
      eye.scale.set(1.3, 0.7, 0.5);
      eye.position.set(side * 0.16, 2.08, 0.28);
      group.add(eye);
      // Pupil slit
      const pupil = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.015, 0.08, 0.01),
        new THREE.MeshBasicMaterial({ color: 0x003300 })
      );
      pupil.position.set(side * 0.16, 2.08, 0.34);
      group.add(pupil);
    }
    // Nostrils
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.02, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x004400 })
      );
      nostril.position.set(side * 0.04, 1.94, 0.33);
      group.add(nostril);
    }
    // Mouth slit with lip detail
    const mouth = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.15, 0.03, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x003300 })
    );
    mouth.position.set(0, 1.88, 0.32);
    group.add(mouth);
    // Chin
    const chin = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.06, 6, 6),
      new THREE.MeshPhongMaterial({ color: 0x00dd44, emissive: 0x004422 })
    );
    chin.scale.set(1.2, 0.6, 0.8);
    chin.position.set(0, 1.82, 0.28);
    group.add(chin);

    // Arms with elbow joints and wrist guards
    const armMat = new THREE.MeshPhongMaterial({ color: data.color, emissive: 0x002211 });
    for (const side of [-1, 1]) {
      // Upper arm
      const upper = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.07, 0.06, 0.5, 6), armMat);
      upper.position.set(side * 0.48, 1.35, 0);
      upper.rotation.z = side * 0.3;
      group.add(upper);
      // Elbow joint
      const elbow = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.055, 6, 6),
        armMat
      );
      elbow.position.set(side * 0.52, 1.1, 0.05);
      group.add(elbow);
      // Lower arm
      const lower = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.06, 0.05, 0.5, 6), armMat);
      lower.position.set(side * 0.55, 0.95, side === 1 ? 0.2 : 0);
      lower.rotation.z = side * 0.2;
      lower.rotation.x = side === 1 ? -0.6 : 0;
      group.add(lower);
      // Wrist guard
      const wristGuard = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.065, 0.058, 0.1, 6),
        darkArmorMat
      );
      wristGuard.position.set(side * 0.56, 0.78, side === 1 ? 0.25 : 0);
      wristGuard.rotation.z = side * 0.2;
      group.add(wristGuard);
      // 3-fingered hand with knuckle detail
      for (let f = -1; f <= 1; f++) {
        const knuckle = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.018, 4, 4),
          armMat
        );
        knuckle.position.set(side * 0.58 + f * 0.02, 0.72, side === 1 ? 0.3 : f * 0.03);
        group.add(knuckle);
        const finger = new THREE.Mesh(
          cGeom(THREE.CylinderGeometry, 0.015, 0.01, 0.12, 4),
          armMat
        );
        finger.position.set(side * 0.58 + f * 0.02, 0.68, side === 1 ? 0.32 : f * 0.03);
        group.add(finger);
      }
    }

    // Blaster in right hand - highly detailed
    const blasterBody = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.08, 0.07, 0.35),
      metalMat
    );
    blasterBody.position.set(0.58, 0.68, 0.38);
    group.add(blasterBody);
    // Blaster barrel
    const blasterBarrel = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.02, 0.025, 0.15, 8),
      darkMetal
    );
    blasterBarrel.rotation.x = Math.PI / 2;
    blasterBarrel.position.set(0.58, 0.7, 0.52);
    group.add(blasterBarrel);
    // Blaster tip glow
    const blasterTip = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.022, 8, 8),
      aGlow(0x00ff44, 0.9)
    );
    blasterTip.position.set(0.58, 0.7, 0.6);
    group.add(blasterTip);
    const blasterHalo = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.045, 6, 6),
      aGlow(0x00ff44, 0.15)
    );
    blasterTip.add(blasterHalo);
    // Blaster grip
    const blasterGrip = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.04, 0.08, 0.05),
      new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 10 })
    );
    blasterGrip.position.set(0.58, 0.62, 0.42);
    group.add(blasterGrip);
    // Blaster energy coil
    const blasterCoil = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.03, 0.005, 4, 8),
      aGlow(0x00ff44, 0.5)
    );
    blasterCoil.position.set(0.58, 0.68, 0.48);
    group.add(blasterCoil);
    // Blaster scope
    const blasterScope = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.015, 0.015, 0.08, 6),
      darkMetal
    );
    blasterScope.rotation.x = Math.PI / 2;
    blasterScope.position.set(0.58, 0.74, 0.4);
    group.add(blasterScope);

    // Legs with knee pads
    const legMat = new THREE.MeshPhongMaterial({ color: 0x008833, emissive: 0x002211 });
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.09, 0.07, 0.45, 6), legMat);
      thigh.position.set(side * 0.15, 0.55, 0);
      group.add(thigh);
      // Knee pad
      const kneePad = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.06, 6, 6),
        darkArmorMat
      );
      kneePad.scale.set(1, 0.6, 1.2);
      kneePad.position.set(side * 0.15, 0.35, 0.06);
      group.add(kneePad);
      const shin = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.07, 0.06, 0.4, 6), legMat);
      shin.position.set(side * 0.15, 0.2, 0);
      group.add(shin);
      // Shin guard
      const shinGuard = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.06, 0.25, 0.04),
        darkArmorMat
      );
      shinGuard.position.set(side * 0.15, 0.2, 0.05);
      group.add(shinGuard);
      // Boot - detailed
      const boot = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.1, 0.08, 0.18),
        darkMetal
      );
      boot.position.set(side * 0.15, 0.04, 0.03);
      group.add(boot);
      // Boot sole
      const sole = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.11, 0.02, 0.2),
        new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 10 })
      );
      sole.position.set(side * 0.15, 0.01, 0.03);
      group.add(sole);
    }

    // Belt with pouches
    const belt = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.28, 0.03, 6, 12),
      new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 60 })
    );
    belt.position.y = 0.7;
    belt.rotation.x = Math.PI / 2;
    group.add(belt);
    // Belt buckle
    const buckle = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.06, 0.06, 0.03),
      metalMat
    );
    buckle.position.set(0, 0.7, 0.28);
    group.add(buckle);
    const buckleGlow = new THREE.Mesh(
      cGeom(THREE.CircleGeometry, 0.02, 6),
      aGlow(0x00ff44, 0.7)
    );
    buckleGlow.position.set(0, 0.7, 0.3);
    group.add(buckleGlow);
    // Belt pouches
    for (const side of [-1, 1]) {
      const pouch = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.06, 0.07, 0.04),
        darkMetal
      );
      pouch.position.set(side * 0.22, 0.68, 0.2);
      group.add(pouch);
      const pouchFlap = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.065, 0.02, 0.045),
        metalMat
      );
      pouchFlap.position.set(side * 0.22, 0.72, 0.2);
      group.add(pouchFlap);
    }

    // Back equipment - ammo pack
    const backpack = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.2, 0.25, 0.1),
      darkMetal
    );
    backpack.position.set(0, 1.05, -0.28);
    group.add(backpack);
    // Pack antenna
    const packAntenna = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.006, 0.006, 0.25, 4),
      metalMat
    );
    packAntenna.position.set(0.06, 1.3, -0.3);
    group.add(packAntenna);
    const antennaTip = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.012, 4, 4),
      aGlow(0x00ff44, 0.8)
    );
    antennaTip.position.set(0.06, 1.43, -0.3);
    group.add(antennaTip);
    // Pack energy cells (glowing tubes)
    for (let i = 0; i < 3; i++) {
      const cell = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.018, 0.018, 0.12, 6),
        aGlow(0x00ff44, 0.4)
      );
      cell.position.set(-0.05 + i * 0.05, 1.02, -0.34);
      group.add(cell);
    }

    // === NEW DETAILS: breathing apparatus, gauntlets, knee armor, greaves ===
    // Breathing hoses from backpack to chest/mask
    for (const side of [-1, 1]) {
      const hoseSegs = 6;
      for (let s = 0; s < hoseSegs; s++) {
        const t = s / hoseSegs;
        const seg = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.018, 4, 4),
          darkMetal
        );
        seg.position.set(
          side * (0.12 + Math.sin(t * Math.PI) * 0.08),
          1.0 + t * 0.55 - Math.sin(t * Math.PI) * 0.05,
          -0.24 + t * 0.5
        );
        group.add(seg);
      }
      // Hose connector at chest
      const hoseConn = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.022, 0.028, 0.04, 6),
        metalMat
      );
      hoseConn.position.set(side * 0.2, 1.55, 0.24);
      hoseConn.rotation.x = Math.PI / 2;
      group.add(hoseConn);
      const hoseGlow = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.012, 6),
        aGlow(0x00ffaa, 0.8)
      );
      hoseGlow.position.set(side * 0.2, 1.55, 0.26);
      group.add(hoseGlow);
    }

    // Forearm gauntlets with holographic display
    for (const side of [-1, 1]) {
      const gauntlet = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.075, 0.07, 0.22, 8),
        darkArmorMat
      );
      gauntlet.position.set(side * 0.5, 1.0, 0.05);
      gauntlet.rotation.z = side * 0.1;
      group.add(gauntlet);
      // Gauntlet plating ridges
      for (let r = 0; r < 3; r++) {
        const ridge = new THREE.Mesh(
          cGeom(THREE.TorusGeometry, 0.076, 0.008, 4, 10),
          metalMat
        );
        ridge.position.set(side * 0.5, 0.92 + r * 0.08, 0.05);
        ridge.rotation.x = Math.PI / 2;
        group.add(ridge);
      }
      // Holographic forearm display (outer side)
      const holoScreen = new THREE.Mesh(
        cGeom(THREE.PlaneGeometry, 0.09, 0.05),
        aGlow(0x00ff66, 0.6)
      );
      holoScreen.position.set(side * 0.58, 1.02, 0.05);
      holoScreen.rotation.y = side * Math.PI / 2;
      group.add(holoScreen);
      // Display data lines
      for (let d = 0; d < 3; d++) {
        const dataLine = new THREE.Mesh(
          cGeom(THREE.PlaneGeometry, 0.06, 0.004),
          aGlow(0x88ffaa, 0.9)
        );
        dataLine.position.set(side * 0.585, 1.03 - d * 0.012, 0.05);
        dataLine.rotation.y = side * Math.PI / 2;
        group.add(dataLine);
      }
    }

    // Knee armor plates
    for (const side of [-1, 1]) {
      const kneePad = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.1, 6, 6),
        armorMat
      );
      kneePad.scale.set(1, 0.7, 0.8);
      kneePad.position.set(side * 0.16, 0.45, 0.05);
      group.add(kneePad);
      // Knee bolt
      const kneeBolt = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.02, 5, 5),
        metalMat
      );
      kneeBolt.position.set(side * 0.16, 0.45, 0.13);
      group.add(kneeBolt);
      // Kneecap glow dot
      const kneeGlow = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.008, 6),
        aGlow(0x00ff44, 0.7)
      );
      kneeGlow.position.set(side * 0.16, 0.45, 0.15);
      group.add(kneeGlow);
    }

    // Boot greaves and spikes
    for (const side of [-1, 1]) {
      const greave = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.09, 0.12, 0.18, 6),
        darkArmorMat
      );
      greave.position.set(side * 0.16, 0.12, 0.02);
      group.add(greave);
      // Toe cap
      const toeCap = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.1, 6, 6),
        metalMat
      );
      toeCap.scale.set(0.9, 0.6, 1.2);
      toeCap.position.set(side * 0.16, 0.08, 0.15);
      group.add(toeCap);
      // Spikes on toe cap
      for (let t = 0; t < 2; t++) {
        const spike = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.014, 0.04, 4),
          metalMat
        );
        spike.position.set(side * 0.16 + (t - 0.5) * 0.05, 0.1, 0.22);
        spike.rotation.x = Math.PI / 2;
        group.add(spike);
      }
    }

    // Glowing power core on back (between shoulder blades)
    const powerCore = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.04, 0.04, 0.08, 6),
      darkMetal
    );
    powerCore.position.set(0, 1.35, -0.29);
    powerCore.rotation.x = Math.PI / 2;
    group.add(powerCore);
    const powerCoreGlow = new THREE.Mesh(
      cGeom(THREE.CircleGeometry, 0.03, 8),
      aGlow(0x00ffaa, 0.85)
    );
    powerCoreGlow.position.set(0, 1.35, -0.34);
    group.add(powerCoreGlow);

  } else if (type === 'swarmer') {
    // === SWARMER: Fast insectoid alien ===
    const chitin = new THREE.MeshPhongMaterial({ color: 0x7700cc, emissive: 0x220044, shininess: 60 });
    const darkChitin = new THREE.MeshPhongMaterial({ color: 0x440077, emissive: 0x110022, shininess: 70 });
    const brightChitin = new THREE.MeshPhongMaterial({ color: 0xbb44ff, emissive: 0x330066, shininess: 50 });
    const clawMat = new THREE.MeshPhongMaterial({ color: 0xff44ff, emissive: 0x660044, shininess: 80 });

    // Abdomen - segmented
    const abdomen = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.28, 10, 10),
      chitin
    );
    abdomen.scale.set(0.9, 0.6, 1.3);
    abdomen.position.set(0, 0.4, -0.15);
    group.add(abdomen);
    // Abdomen segments
    for (let i = 0; i < 4; i++) {
      const segment = new THREE.Mesh(
        cGeom(THREE.TorusGeometry, 0.25, 0.01, 4, 10),
        darkChitin
      );
      segment.position.set(0, 0.4, -0.32 + i * 0.1);
      segment.rotation.x = Math.PI / 2;
      segment.scale.set(0.9, 1.3, 1);
      group.add(segment);
    }
    // Abdomen tip - stinger
    const stinger = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.04, 0.2, 6),
      clawMat
    );
    stinger.position.set(0, 0.38, -0.4);
    stinger.rotation.x = Math.PI / 2 + 0.3;
    group.add(stinger);
    const stingerGlow = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.025, 4, 4),
      aGlow(0xff00ff, 0.6)
    );
    stingerGlow.position.set(0, 0.4, -0.5);
    group.add(stingerGlow);

    // Thorax - more detailed
    const thorax = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.22, 10, 10),
      new THREE.MeshPhongMaterial({ color: data.color, emissive: 0x330066, shininess: 55 })
    );
    thorax.scale.set(1, 0.7, 1.1);
    thorax.position.set(0, 0.48, 0.15);
    group.add(thorax);
    // Thorax-abdomen connection (petiole)
    const petiole = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.06, 0.08, 0.12, 6),
      darkChitin
    );
    petiole.position.set(0, 0.44, 0.0);
    petiole.rotation.x = Math.PI / 4;
    group.add(petiole);
    // Thorax shell plates
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.15, 0.03, 0.2),
        darkChitin
      );
      plate.position.set(side * 0.1, 0.52, 0.1);
      plate.rotation.z = side * 0.4;
      group.add(plate);
    }

    // Head - angular with more features
    const head = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.18, 10, 10),
      brightChitin
    );
    head.scale.set(1, 0.9, 1.1);
    head.position.set(0, 0.58, 0.35);
    group.add(head);
    // Head crest
    const headCrest = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.05, 0.12, 4),
      clawMat
    );
    headCrest.position.set(0, 0.7, 0.32);
    headCrest.rotation.x = -0.3;
    group.add(headCrest);

    // Antennae
    for (const side of [-1, 1]) {
      const antennaBase = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.01, 0.015, 0.2, 4),
        brightChitin
      );
      antennaBase.position.set(side * 0.08, 0.7, 0.38);
      antennaBase.rotation.x = -0.6;
      antennaBase.rotation.z = side * 0.3;
      group.add(antennaBase);
      const antennaTip = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.005, 0.01, 0.15, 4),
        chitin
      );
      antennaTip.position.set(side * 0.12, 0.82, 0.45);
      antennaTip.rotation.x = -0.4;
      antennaTip.rotation.z = side * 0.5;
      group.add(antennaTip);
      // Antenna tip glow
      const antennaGlow = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.01, 4, 4),
        aGlow(0xff00ff, 0.8)
      );
      antennaGlow.position.set(side * 0.15, 0.9, 0.48);
      group.add(antennaGlow);
    }

    // Mandibles - more detailed with inner teeth
    for (const side of [-1, 1]) {
      const mandibleBase = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.03, 0.04, 0.06),
        darkChitin
      );
      mandibleBase.position.set(side * 0.06, 0.52, 0.42);
      group.add(mandibleBase);
      const mandible = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.02, 0.15, 4),
        clawMat
      );
      mandible.position.set(side * 0.08, 0.52, 0.48);
      mandible.rotation.x = -0.8;
      mandible.rotation.z = side * 0.3;
      group.add(mandible);
      // Inner mandible tooth
      const tooth = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.008, 0.06, 3),
        new THREE.MeshPhongMaterial({ color: 0xffaaff, shininess: 100 })
      );
      tooth.position.set(side * 0.05, 0.49, 0.5);
      tooth.rotation.x = -1.0;
      tooth.rotation.z = side * 0.15;
      group.add(tooth);
    }

    // Compound eyes - faceted appearance
    for (const side of [-1, 1]) {
      const eyeBase = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.07, 8, 8),
        aGlow(0xff00ff, 0.9)
      );
      eyeBase.scale.set(0.8, 1, 0.6);
      eyeBase.position.set(side * 0.12, 0.63, 0.42);
      group.add(eyeBase);
      // Facets
      for (let j = 0; j < 5; j++) {
        const facet = new THREE.Mesh(
          cGeom(THREE.CircleGeometry, 0.012, 6),
          aGlow(0xcc00cc, 0.4)
        );
        const fa = (j / 5) * Math.PI;
        facet.position.set(
          side * 0.12 + Math.cos(fa) * 0.03 * side,
          0.63 + Math.sin(fa) * 0.03,
          0.46
        );
        group.add(facet);
      }
    }

    // Dorsal spines - more varied
    const spineMat = new THREE.MeshPhongMaterial({ color: 0xff00ff, emissive: 0x660066, shininess: 70 });
    for (let i = 0; i < 7; i++) {
      const spine = new THREE.Mesh(
        new THREE.ConeGeometry(0.02 + (i % 2) * 0.01, 0.15 + i * 0.025, 4),
        spineMat
      );
      spine.position.set((i % 2 - 0.5) * 0.04, 0.53 + i * 0.008, -0.15 + i * 0.07);
      spine.rotation.x = -0.3;
      group.add(spine);
    }

    // Wing stubs (vestigial) with membrane
    for (const side of [-1, 1]) {
      const wingBase = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.15, 0.005, 0.12),
        new THREE.MeshPhongMaterial({ color: 0x9944dd, emissive: 0x330066, shininess: 90 })
      );
      wingBase.position.set(side * 0.2, 0.52, 0.0);
      wingBase.rotation.z = side * 0.5;
      group.add(wingBase);
      // Wing membrane
      const membrane = new THREE.Mesh(
        cGeom(THREE.PlaneGeometry, 0.12, 0.1),
        new THREE.MeshBasicMaterial({
          color: 0xbb66ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide
        })
      );
      membrane.position.set(side * 0.22, 0.52, 0.0);
      membrane.rotation.z = side * 0.5;
      group.add(membrane);
      // Wing veins
      const vein = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.12, 0.002, 0.003),
        brightChitin
      );
      vein.position.set(side * 0.21, 0.525, 0.0);
      vein.rotation.z = side * 0.5;
      group.add(vein);
    }

    // 6 insect legs (3 per side) - with joints
    const legMat = new THREE.MeshPhongMaterial({ color: 0x7700aa, emissive: 0x220044, shininess: 50 });
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const idx = i % 3;
      const zOff = -0.1 + idx * 0.15;
      // Coxa (hip)
      const coxa = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.022, 4, 4),
        darkChitin
      );
      coxa.position.set(side * 0.2, 0.4, zOff);
      group.add(coxa);
      // Femur (upper)
      const legUpper = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.018, 0.015, 0.35, 4), legMat);
      legUpper.position.set(side * 0.25, 0.35, zOff);
      legUpper.rotation.z = side * 1.0;
      group.add(legUpper);
      // Knee joint
      const knee = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.016, 4, 4),
        darkChitin
      );
      knee.position.set(side * 0.38, 0.2, zOff);
      group.add(knee);
      // Tibia (lower)
      const legLower = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.015, 0.01, 0.25, 4), legMat);
      legLower.position.set(side * 0.42, 0.12, zOff);
      legLower.rotation.z = side * 0.3;
      group.add(legLower);
      // Tarsus (foot)
      const tarsus = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.015, 0.06, 3),
        clawMat
      );
      tarsus.position.set(side * 0.46, 0.02, zOff);
      tarsus.rotation.x = Math.PI;
      group.add(tarsus);
    }

    // Front attack claws - larger with serrated edges
    for (const side of [-1, 1]) {
      const clawShoulder = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.03, 6, 6),
        darkChitin
      );
      clawShoulder.position.set(side * 0.15, 0.52, 0.35);
      group.add(clawShoulder);
      const clawArm = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.025, 0.02, 0.25, 4), clawMat);
      clawArm.position.set(side * 0.18, 0.45, 0.4);
      clawArm.rotation.x = -0.7;
      clawArm.rotation.z = side * 0.2;
      group.add(clawArm);
      // Main claw blade
      const clawTip = new THREE.Mesh(cGeom(THREE.ConeGeometry, 0.03, 0.2, 4), clawMat);
      clawTip.position.set(side * 0.2, 0.35, 0.55);
      clawTip.rotation.x = -1.2;
      group.add(clawTip);
      // Serrations on claw
      for (let s = 0; s < 3; s++) {
        const serration = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.008, 0.04, 3),
          clawMat
        );
        serration.position.set(
          side * 0.2 + side * 0.015,
          0.38 - s * 0.03,
          0.53 + s * 0.02
        );
        serration.rotation.x = -1.0;
        serration.rotation.z = side * 0.3;
        group.add(serration);
      }
    }

    // Ventral markings (belly pattern)
    for (let i = 0; i < 3; i++) {
      const marking = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.04 - i * 0.008, 6),
        aGlow(0xcc00ff, 0.3)
      );
      marking.position.set(0, 0.35, 0.05 + i * 0.1);
      marking.rotation.x = -Math.PI / 2;
      group.add(marking);
    }

    // Glowing energy along spine
    const spineGlow = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.04, 0.04, 0.4),
      aGlow(0xcc00ff, 0.5)
    );
    spineGlow.position.set(0, 0.55, 0.05);
    group.add(spineGlow);

    // === NEW DETAILS: wing membranes, mandibles, antennae, egg sac ===
    // Translucent wing membranes from back
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(
        cGeom(THREE.PlaneGeometry, 0.35, 0.22),
        new THREE.MeshBasicMaterial({
          color: 0xaa33ff, transparent: true, opacity: 0.35,
          side: THREE.DoubleSide
        })
      );
      wing.position.set(side * 0.15, 0.6, -0.15);
      wing.rotation.y = side * -0.6;
      wing.rotation.z = side * -0.3;
      group.add(wing);
      // Wing ribs (chitin spines)
      for (let r = 0; r < 4; r++) {
        const rib = new THREE.Mesh(
          cGeom(THREE.CylinderGeometry, 0.005, 0.005, 0.2, 3),
          clawMat
        );
        rib.position.set(side * (0.18 + r * 0.06), 0.6, -0.15 - r * 0.02);
        rib.rotation.z = side * -0.8;
        group.add(rib);
      }
    }

    // Mandibles/pincers (forward-facing, around mouth area)
    for (const side of [-1, 1]) {
      const mandible = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.018, 0.006, 0.12, 5),
        clawMat
      );
      mandible.position.set(side * 0.08, 0.72, 0.24);
      mandible.rotation.x = 1.3;
      mandible.rotation.z = side * 0.4;
      group.add(mandible);
      // Mandible tooth
      const tooth = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.008, 0.025, 4),
        clawMat
      );
      tooth.position.set(side * 0.06, 0.67, 0.3);
      tooth.rotation.x = 1.8;
      group.add(tooth);
    }

    // Antennae with pulsing tips
    for (const side of [-1, 1]) {
      const antenna = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.008, 0.004, 0.25, 4),
        clawMat
      );
      antenna.position.set(side * 0.08, 0.95, 0.1);
      antenna.rotation.z = side * -0.3;
      antenna.rotation.x = -0.2;
      group.add(antenna);
      const antennaTip = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.018, 5, 5),
        aGlow(0xff44ff, 0.85)
      );
      antennaTip.position.set(side * 0.15, 1.06, 0.07);
      group.add(antennaTip);
    }

    // Pulsating egg sac on underside of abdomen
    const eggSac = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.12, 8, 6),
      new THREE.MeshPhongMaterial({
        color: 0x662288, emissive: 0x330044,
        transparent: true, opacity: 0.75, shininess: 60
      })
    );
    eggSac.scale.set(1, 0.7, 1.3);
    eggSac.position.set(0, 0.32, -0.08);
    group.add(eggSac);
    // Egg sac glow embryos
    for (let e = 0; e < 4; e++) {
      const embryo = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.02, 4, 4),
        aGlow(0xff66ff, 0.7)
      );
      const ang = (e / 4) * Math.PI * 2;
      embryo.position.set(Math.cos(ang) * 0.05, 0.32, -0.08 + Math.sin(ang) * 0.06);
      group.add(embryo);
    }

    // Additional compound eye cluster (side eyes)
    for (const side of [-1, 1]) {
      for (let e = 0; e < 3; e++) {
        const smallEye = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.015, 5, 5),
          aGlow(0xff00ff, 0.9)
        );
        smallEye.position.set(
          side * (0.1 + e * 0.015),
          0.82 + e * 0.01,
          0.12 - e * 0.03
        );
        group.add(smallEye);
      }
    }

  } else if (type === 'bloater') {
    // === BLOATER: Massive volatile alien ===
    const fleshMat = new THREE.MeshPhongMaterial({ color: 0xaa1100, emissive: 0x330000, shininess: 20 });
    const darkFlesh = new THREE.MeshPhongMaterial({ color: 0x771100, emissive: 0x220000, shininess: 15 });

    // Main body - large pulsating sphere
    const body = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.95, 16, 16),
      new THREE.MeshPhongMaterial({
        color: 0xcc2200, emissive: 0x661100, emissiveIntensity: 0.8,
        transparent: true, opacity: 0.85, shininess: 30,
      })
    );
    body.position.y = 1.1;
    group.add(body);

    // Inner plasma core
    const inner = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.65, 12, 12),
      aGlow(0xff8800, 0.4)
    );
    inner.position.y = 1.1;
    group.add(inner);

    // Secondary inner core (hotter)
    const innerHot = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.35, 8, 8),
      aGlow(0xffcc44, 0.3)
    );
    innerHot.position.y = 1.1;
    group.add(innerHot);

    // Veins on surface (glowing lines) - more varied
    const veinMat = aGlow(0xff6600, 0.6);
    for (let i = 0; i < 12; i++) {
      const vein = new THREE.Mesh(
        new THREE.TorusGeometry(0.85 + Math.random() * 0.15, 0.015 + Math.random() * 0.01, 4, 12),
        veinMat
      );
      vein.position.y = 1.1;
      vein.rotation.x = Math.random() * Math.PI;
      vein.rotation.y = Math.random() * Math.PI;
      group.add(vein);
    }
    // Thick pulsing veins (branching)
    for (let i = 0; i < 4; i++) {
      const thickVein = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.02, 0.015, 0.8, 4),
        aGlow(0xff4400, 0.5)
      );
      const angle = (i / 4) * Math.PI * 2;
      thickVein.position.set(
        Math.cos(angle) * 0.5,
        1.1 + Math.sin(angle) * 0.3,
        Math.sin(angle) * 0.5
      );
      thickVein.rotation.set(Math.random() * 0.5, 0, angle);
      group.add(thickVein);
    }

    // Surface fissure cracks (dark lines)
    for (let i = 0; i < 6; i++) {
      const crack = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.3 + Math.random() * 0.2, 0.005),
        new THREE.MeshBasicMaterial({ color: 0x220000 })
      );
      const theta = Math.random() * Math.PI * 2;
      crack.position.set(
        Math.cos(theta) * 0.94,
        0.9 + Math.random() * 0.5,
        Math.sin(theta) * 0.94
      );
      crack.rotation.y = theta;
      crack.rotation.z = Math.random() * 0.3;
      group.add(crack);
    }

    // Neck folds - wrinkled connection to head
    for (let i = 0; i < 3; i++) {
      const fold = new THREE.Mesh(
        cGeom(THREE.TorusGeometry, 0.22 - i * 0.04, 0.03, 4, 8),
        fleshMat
      );
      fold.position.y = 1.95 + i * 0.06;
      fold.rotation.x = Math.PI / 2;
      group.add(fold);
    }

    // Small angry head - more detailed
    const head = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.28, 10, 10),
      new THREE.MeshPhongMaterial({ color: 0xdd3300, emissive: 0x441100 })
    );
    head.scale.set(1, 0.85, 0.9);
    head.position.y = 2.15;
    group.add(head);
    // Forehead bumps
    for (let i = 0; i < 3; i++) {
      const bump = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.04, 6, 6),
        darkFlesh
      );
      bump.position.set((i - 1) * 0.08, 2.3, 0.12);
      group.add(bump);
    }

    // Glowing angry eyes with sockets
    for (const side of [-1, 1]) {
      // Eye socket
      const socket = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.08, 6, 6),
        new THREE.MeshPhongMaterial({ color: 0x551100, emissive: 0x110000 })
      );
      socket.position.set(side * 0.12, 2.18, 0.2);
      group.add(socket);
      // Eye
      const eye = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.07, 8, 8),
        aGlow(0xffff00, 1.0)
      );
      eye.position.set(side * 0.12, 2.18, 0.22);
      group.add(eye);
      // Pupil
      const pupil = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.03, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xff2200 })
      );
      pupil.position.set(side * 0.12, 2.18, 0.27);
      group.add(pupil);
    }
    // Angry brow ridges - more prominent
    for (const side of [-1, 1]) {
      const brow = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.15, 0.05, 0.1),
        new THREE.MeshPhongMaterial({ color: 0x881100 })
      );
      brow.position.set(side * 0.1, 2.28, 0.2);
      brow.rotation.z = side * -0.3;
      group.add(brow);
    }
    // Open maw with teeth
    const maw = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.1, 8, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x440000 })
    );
    maw.position.set(0, 2.06, 0.2);
    maw.rotation.x = 0.3;
    group.add(maw);
    // Teeth
    for (let i = -2; i <= 2; i++) {
      const tooth = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.012, 0.05, 3),
        new THREE.MeshPhongMaterial({ color: 0xddcc88, shininess: 80 })
      );
      tooth.position.set(i * 0.035, 2.04, 0.27);
      tooth.rotation.x = Math.PI + 0.2;
      group.add(tooth);
    }
    // Drool strands
    for (let i = 0; i < 2; i++) {
      const drool = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.004, 0.002, 0.12, 4),
        aGlow(0xff8844, 0.4)
      );
      drool.position.set(-0.02 + i * 0.04, 1.98, 0.26);
      group.add(drool);
    }

    // Stubby arms with clawed hands
    const armMat = fleshMat;
    for (const side of [-1, 1]) {
      // Shoulder bump
      const shoulder = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.12, 6, 6),
        fleshMat
      );
      shoulder.position.set(side * 0.85, 1.25, 0.1);
      group.add(shoulder);
      const arm = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.1, 0.08, 0.4, 6), armMat);
      arm.position.set(side * 0.8, 1.0, 0.3);
      arm.rotation.z = side * 0.8;
      group.add(arm);
      // Fat hand
      const hand = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.08, 6, 6),
        fleshMat
      );
      hand.scale.set(1.2, 0.8, 1);
      hand.position.set(side * 0.72, 0.82, 0.4);
      group.add(hand);
      // Stubby claws
      for (let f = -1; f <= 1; f++) {
        const claw = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.015, 0.06, 3),
          new THREE.MeshPhongMaterial({ color: 0x442200, shininess: 60 })
        );
        claw.position.set(side * 0.72 + f * 0.03, 0.76, 0.45);
        claw.rotation.x = -0.5;
        group.add(claw);
      }
    }

    // Stubby legs - more detailed
    for (const side of [-1, 1]) {
      const legTop = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.16, 6, 6),
        fleshMat
      );
      legTop.position.set(side * 0.45, 0.45, 0);
      group.add(legTop);
      const leg = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.18, 0.14, 0.5, 6), fleshMat);
      leg.position.set(side * 0.45, 0.25, 0);
      group.add(leg);
      // Foot with toes
      const foot = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.22, 0.08, 0.28),
        darkFlesh
      );
      foot.position.set(side * 0.45, 0.04, 0.05);
      group.add(foot);
      // Toenails
      for (let t = -1; t <= 1; t++) {
        const toenail = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.015, 0.04, 3),
          new THREE.MeshPhongMaterial({ color: 0x442200 })
        );
        toenail.position.set(side * 0.45 + t * 0.06, 0.02, 0.2);
        toenail.rotation.x = -Math.PI / 2;
        group.add(toenail);
      }
    }

    // Pustules / boils - more varied sizes and colors
    const pustuleColors = [0xff6600, 0xff8800, 0xffaa00, 0xff4400];
    for (let i = 0; i < 16; i++) {
      const size = 0.06 + Math.random() * 0.16;
      const color = pustuleColors[Math.floor(Math.random() * pustuleColors.length)];
      const bump = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, size, 8, 8),
        new THREE.MeshPhongMaterial({ color, emissive: 0x663300, shininess: 40 })
      );
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.7 + 0.15;
      bump.position.set(
        Math.sin(phi) * Math.cos(theta) * 0.92,
        1.1 + Math.cos(phi) * 0.92,
        Math.sin(phi) * Math.sin(theta) * 0.92
      );
      group.add(bump);
      // Pustule highlight (shiny wet look)
      if (size > 0.12) {
        const highlight = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, size * 0.4, 4, 4),
          aGlow(0xffddaa, 0.3)
        );
        highlight.position.copy(bump.position);
        highlight.position.y += size * 0.3;
        group.add(highlight);
      }
    }

    // Belly button / navel scar
    const navel = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.06, 6, 6),
      new THREE.MeshPhongMaterial({ color: 0x551100 })
    );
    navel.scale.set(1, 1, 0.3);
    navel.position.set(0, 0.8, 0.92);
    group.add(navel);

    // Point light inside - brighter
    const glow = new THREE.PointLight(0xff4400, 2.5, 8);
    glow.position.y = 1.1;
    group.add(glow);

    // Warning glow ring at base - double ring
    const warnRing = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 1.2, 0.05, 6, 16),
      aGlow(0xff2200, 0.4)
    );
    warnRing.position.y = 0.05;
    warnRing.rotation.x = Math.PI / 2;
    group.add(warnRing);
    const warnRing2 = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 1.0, 0.03, 6, 16),
      aGlow(0xff6600, 0.25)
    );
    warnRing2.position.y = 0.05;
    warnRing2.rotation.x = Math.PI / 2;
    group.add(warnRing2);

    // Hazard symbol on back (3 triangular shapes)
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const hazard = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.08, 0.15, 3),
        aGlow(0xffaa00, 0.4)
      );
      hazard.position.set(
        Math.cos(angle) * 0.25,
        1.5,
        -0.85 + Math.sin(angle) * 0.25
      );
      hazard.rotation.x = Math.PI / 2;
      hazard.rotation.z = angle;
      group.add(hazard);
    }

    // === NEW DETAILS: pustules, vein network, mouth/teeth, drip mucus ===
    // Large pulsing pustules across the body surface
    for (let p = 0; p < 12; p++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() * 0.6 + 0.2) * Math.PI;
      const rad = 1.1;
      const pustule = new THREE.Mesh(
        new THREE.SphereGeometry(0.07 + Math.random() * 0.05, 5, 5),
        new THREE.MeshPhongMaterial({
          color: 0xff6633, emissive: 0x441100,
          shininess: 60, transparent: true, opacity: 0.85
        })
      );
      pustule.position.set(
        Math.cos(theta) * Math.sin(phi) * rad,
        1.5 + Math.cos(phi) * rad,
        Math.sin(theta) * Math.sin(phi) * rad
      );
      pustule.scale.set(1, 0.6, 1);
      group.add(pustule);
      // Glowing core inside pustule
      const core = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.025, 4, 4),
        aGlow(0xffaa00, 0.9)
      );
      core.position.copy(pustule.position);
      group.add(core);
    }

    // Vein network - thin glowing tubes running across body
    for (let v = 0; v < 8; v++) {
      const startAngle = Math.random() * Math.PI * 2;
      for (let s = 0; s < 4; s++) {
        const vein = new THREE.Mesh(
          cGeom(THREE.CylinderGeometry, 0.012, 0.012, 0.2, 4),
          aGlow(0xff3300, 0.6)
        );
        const ang = startAngle + s * 0.15;
        const y = 1.0 + s * 0.25;
        vein.position.set(
          Math.cos(ang) * 1.05,
          y,
          Math.sin(ang) * 1.05
        );
        vein.rotation.x = Math.PI / 2;
        vein.rotation.z = ang + Math.PI / 2;
        group.add(vein);
      }
    }

    // Gaping maw - large mouth with inner glow
    const gapingMaw = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.25, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhongMaterial({
        color: 0x330000, emissive: 0x220000, side: THREE.DoubleSide
      })
    );
    gapingMaw.position.set(0, 1.5, 0.85);
    gapingMaw.rotation.x = Math.PI / 2;
    group.add(gapingMaw);
    // Mouth interior glow
    const mawGlow = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.18, 8, 6),
      aGlow(0xff4400, 0.7)
    );
    mawGlow.position.set(0, 1.5, 0.92);
    group.add(mawGlow);
    // Sharp teeth ringing the maw
    for (let t = 0; t < 10; t++) {
      const ang = (t / 10) * Math.PI * 2;
      const tooth = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.018, 0.07, 4),
        new THREE.MeshPhongMaterial({ color: 0xddccaa, shininess: 80 })
      );
      tooth.position.set(
        Math.cos(ang) * 0.22,
        1.5 + Math.sin(ang) * 0.22,
        0.82
      );
      tooth.rotation.x = Math.PI / 2;
      tooth.rotation.z = ang + Math.PI / 2;
      group.add(tooth);
    }

    // Drooling mucus strands from maw
    for (let d = 0; d < 5; d++) {
      const droolAng = (d / 5 - 0.5) * 0.8;
      const drool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.002, 0.15 + Math.random() * 0.1, 4),
        aGlow(0xff7722, 0.5)
      );
      drool.position.set(
        Math.sin(droolAng) * 0.1,
        1.38 - 0.08,
        0.88
      );
      group.add(drool);
    }

    // Spinal fin ridge from top to back
    for (let f = 0; f < 6; f++) {
      const fin = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.1 - f * 0.008, 0.15, 4),
        new THREE.MeshPhongMaterial({ color: 0x552200, emissive: 0x220800, shininess: 40 })
      );
      fin.position.set(0, 2.3 - f * 0.15, -0.2 - f * 0.12);
      fin.rotation.x = -0.3 - f * 0.1;
      fin.scale.set(1, 1, 0.3);
      group.add(fin);
    }

  } else if (type === 'stalker') {
    // === STALKER: Semi-invisible predator ===
    const stealthMat = (color, emissive = 0x000000) =>
      new THREE.MeshPhongMaterial({ color, emissive, transparent: true, opacity: 0.4, shininess: 80 });

    // Lean torso - muscular definition
    const torso = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.2, 0.18, 1.1, 8),
      stealthMat(0x006666, 0x003333)
    );
    torso.position.y = 1.3;
    group.add(torso);
    // Pectoral muscles
    for (const side of [-1, 1]) {
      const pec = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.1, 6, 6),
        stealthMat(0x007777, 0x003333)
      );
      pec.scale.set(1.2, 0.6, 0.8);
      pec.position.set(side * 0.1, 1.5, 0.12);
      group.add(pec);
    }
    // Abdominal ridges
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const ab = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.04, 4, 4),
          stealthMat(0x007070, 0x002828)
        );
        ab.scale.set(1.5, 0.7, 0.6);
        ab.position.set(side * 0.06, 1.1 + i * 0.12, 0.14);
        group.add(ab);
      }
    }

    // Ribcage detail - more ribs, visible through skin
    for (let i = 0; i < 6; i++) {
      const rib = new THREE.Mesh(
        cGeom(THREE.TorusGeometry, 0.18 + i * 0.005, 0.012, 4, 8, Math.PI),
        stealthMat(0x005555)
      );
      rib.position.set(0, 0.95 + i * 0.15, 0);
      rib.rotation.y = Math.PI / 2;
      group.add(rib);
    }

    // Spine vertebrae (visible through back)
    for (let i = 0; i < 8; i++) {
      const vert = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.02, 4, 4),
        stealthMat(0x005050)
      );
      vert.position.set(0, 0.9 + i * 0.15, -0.17);
      group.add(vert);
    }

    // Neck - elongated
    const neck = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.08, 0.1, 0.25, 6),
      stealthMat(0x007070, 0x003333)
    );
    neck.position.y = 1.92;
    group.add(neck);

    // Elongated head - smooth predator shape
    const head = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.25, 12, 12),
      stealthMat(0x00aaaa, 0x004444)
    );
    head.scale.set(0.8, 1.0, 1.5);
    head.position.set(0, 2.1, 0.1);
    group.add(head);
    // Head ridge lines
    for (let i = 0; i < 3; i++) {
      const hRidge = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.008, 0.06, 0.35),
        stealthMat(0x008888, 0x004444)
      );
      hRidge.position.set((i - 1) * 0.06, 2.22, 0.05);
      group.add(hRidge);
    }

    // Crest/crown - multiple fins
    const crest = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.1, 0.4, 4),
      stealthMat(0x00cccc, 0x004444)
    );
    crest.position.set(0, 2.4, -0.1);
    crest.rotation.x = 0.3;
    group.add(crest);
    // Side crests
    for (const side of [-1, 1]) {
      const sideCrest = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.05, 0.2, 3),
        stealthMat(0x00bbbb, 0x004444)
      );
      sideCrest.position.set(side * 0.12, 2.3, -0.05);
      sideCrest.rotation.x = 0.4;
      sideCrest.rotation.z = side * -0.3;
      group.add(sideCrest);
    }

    // Ear frills
    for (const side of [-1, 1]) {
      const frill = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.03, 0.12, 0.08),
        stealthMat(0x009999, 0x004444)
      );
      frill.position.set(side * 0.2, 2.1, 0.0);
      frill.rotation.z = side * 0.3;
      group.add(frill);
      // Frill membrane
      const membrane = new THREE.Mesh(
        cGeom(THREE.PlaneGeometry, 0.08, 0.1),
        new THREE.MeshBasicMaterial({
          color: 0x00ffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide
        })
      );
      membrane.position.set(side * 0.23, 2.1, 0.0);
      membrane.rotation.y = side * Math.PI / 3;
      group.add(membrane);
    }

    // Large reflective eyes - with inner detail
    for (const side of [-1, 1]) {
      // Eye socket
      const socket = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.09, 6, 6),
        stealthMat(0x003333)
      );
      socket.scale.set(1.5, 0.8, 0.3);
      socket.position.set(side * 0.12, 2.12, 0.28);
      group.add(socket);
      // Main eye
      const eye = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.08, 8, 8),
        aGlow(0x00ffff, 0.9)
      );
      eye.scale.set(1.5, 0.8, 0.5);
      eye.position.set(side * 0.12, 2.12, 0.3);
      group.add(eye);
      // Pupil (vertical slit)
      const pupil = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.008, 0.06, 0.01),
        aGlow(0x004444, 0.8)
      );
      pupil.position.set(side * 0.12, 2.12, 0.35);
      group.add(pupil);
    }
    // Nose slits
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.01, 0.02, 0.005),
        stealthMat(0x003030)
      );
      nostril.position.set(side * 0.03, 2.04, 0.35);
      group.add(nostril);
    }
    // Mouth - thin with small fangs
    const mouth = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.12, 0.012, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x003333, transparent: true, opacity: 0.5 })
    );
    mouth.position.set(0, 1.98, 0.32);
    group.add(mouth);
    // Fangs
    for (const side of [-1, 1]) {
      const fang = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.008, 0.06, 3),
        new THREE.MeshPhongMaterial({ color: 0xaaffff, transparent: true, opacity: 0.6, shininess: 100 })
      );
      fang.position.set(side * 0.04, 1.95, 0.33);
      fang.rotation.x = Math.PI;
      group.add(fang);
    }

    // Long arms with wrist blades and muscle detail
    const armMat = stealthMat(0x007777, 0x003333);
    for (const side of [-1, 1]) {
      // Shoulder muscle
      const shoulder = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.06, 6, 6),
        stealthMat(0x007777, 0x003333)
      );
      shoulder.scale.set(1.3, 0.8, 1);
      shoulder.position.set(side * 0.25, 1.7, 0);
      group.add(shoulder);
      // Upper arm
      const upper = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.05, 0.04, 0.6, 6), armMat);
      upper.position.set(side * 0.3, 1.5, 0);
      upper.rotation.z = side * 0.4;
      group.add(upper);
      // Elbow spike
      const elbowSpike = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.02, 0.08, 4),
        stealthMat(0x00bbbb, 0x005555)
      );
      elbowSpike.position.set(side * 0.38, 1.25, -0.05);
      elbowSpike.rotation.x = 0.5;
      group.add(elbowSpike);
      // Lower arm
      const lower = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.04, 0.035, 0.7, 6), armMat);
      lower.position.set(side * 0.45, 1.0, 0.1);
      lower.rotation.z = side * 0.2;
      group.add(lower);
      // Wrist blade
      const wristBlade = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.008, 0.02, 0.2),
        new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x008888, transparent: true, opacity: 0.5, shininess: 100 })
      );
      wristBlade.position.set(side * 0.48, 0.8, 0.0);
      group.add(wristBlade);
      // Curved claws (3 per hand) - longer
      for (let f = -1; f <= 1; f++) {
        const claw = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.015, 0.28, 4),
          new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x006666, transparent: true, opacity: 0.7, shininess: 90 })
        );
        claw.position.set(side * 0.5 + f * 0.025, 0.6, 0.15);
        claw.rotation.x = -0.5;
        group.add(claw);
      }
    }

    // Digitigrade legs (reverse-knee) - with muscle detail
    const legMat = stealthMat(0x006666, 0x002222);
    for (const side of [-1, 1]) {
      // Hip joint
      const hip = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.05, 6, 6),
        stealthMat(0x006060, 0x002020)
      );
      hip.position.set(side * 0.15, 0.9, -0.05);
      group.add(hip);
      const thigh = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.06, 0.045, 0.5, 6), legMat);
      thigh.position.set(side * 0.15, 0.8, -0.05);
      thigh.rotation.x = 0.3;
      group.add(thigh);
      // Thigh muscle
      const thighMuscle = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.04, 4, 4),
        stealthMat(0x006868, 0x002828)
      );
      thighMuscle.scale.set(1, 1.5, 0.8);
      thighMuscle.position.set(side * 0.15, 0.75, 0.02);
      group.add(thighMuscle);
      // Knee joint (prominent)
      const knee = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.04, 6, 6),
        stealthMat(0x005858)
      );
      knee.position.set(side * 0.15, 0.55, 0.05);
      group.add(knee);
      // Shin
      const shin = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.04, 0.03, 0.6, 6), legMat);
      shin.position.set(side * 0.15, 0.3, 0.1);
      shin.rotation.x = -0.4;
      group.add(shin);
      // Ankle
      const ankle = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.03, 4, 4),
        stealthMat(0x005050)
      );
      ankle.position.set(side * 0.15, 0.1, 0.15);
      group.add(ankle);
      // Foot with toes
      const talon = new THREE.Mesh(cGeom(THREE.ConeGeometry, 0.06, 0.15, 5), stealthMat(0x009999));
      talon.position.set(side * 0.15, 0.05, 0.15);
      talon.rotation.x = Math.PI;
      group.add(talon);
      // Toe claws
      for (let t = -1; t <= 1; t++) {
        const toeClaw = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.01, 0.06, 3),
          new THREE.MeshPhongMaterial({ color: 0x00cccc, transparent: true, opacity: 0.5, shininess: 90 })
        );
        toeClaw.position.set(side * 0.15 + t * 0.03, 0.01, 0.22);
        toeClaw.rotation.x = -Math.PI / 3;
        group.add(toeClaw);
      }
    }

    // Tail - segmented with blade tip
    for (let i = 0; i < 5; i++) {
      const segment = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.03 - i * 0.004, 0.035 - i * 0.004, 0.18, 6),
        stealthMat(0x007777)
      );
      segment.position.set(0, 0.85 - i * 0.06, -0.3 - i * 0.12);
      segment.rotation.x = 0.5 + i * 0.05;
      group.add(segment);
    }
    // Tail blade
    const tailBlade = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.025, 0.15, 4),
      new THREE.MeshPhongMaterial({ color: 0x00ffff, emissive: 0x008888, transparent: true, opacity: 0.5, shininess: 100 })
    );
    tailBlade.position.set(0, 0.58, -0.9);
    tailBlade.rotation.x = Math.PI / 2 + 0.5;
    group.add(tailBlade);

    // Back spines
    for (let i = 0; i < 5; i++) {
      const spine = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.015, 0.1 + i * 0.02, 4),
        stealthMat(0x00bbbb, 0x005555)
      );
      spine.position.set(0, 1.2 + i * 0.12, -0.17);
      spine.rotation.x = 0.3;
      group.add(spine);
    }

    // Energy shimmer along spine - multiple lines
    const shimmer = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.03, 0.8, 0.03),
      aGlow(0x00ffff, 0.3)
    );
    shimmer.position.set(0, 1.5, -0.15);
    group.add(shimmer);
    // Side energy lines
    for (const side of [-1, 1]) {
      const eLine = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.015, 0.5, 0.015),
        aGlow(0x00ffff, 0.15)
      );
      eLine.position.set(side * 0.12, 1.4, -0.12);
      group.add(eLine);
    }

    // Cloaking device on back
    const cloakDevice = new THREE.Mesh(
      cGeom(THREE.OctahedronGeometry, 0.06, 0),
      aGlow(0x00ffcc, 0.4)
    );
    cloakDevice.position.set(0, 1.6, -0.2);
    group.add(cloakDevice);
    const cloakHalo = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.08, 0.008, 4, 8),
      aGlow(0x00ffff, 0.2)
    );
    cloakHalo.position.set(0, 1.6, -0.2);
    group.add(cloakHalo);

    // === NEW DETAILS: wrist blades, scanner visor, dorsal spines, tail, field shimmer ===
    // Wrist blades (extending past forearms)
    for (const side of [-1, 1]) {
      const blade = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.025, 0.35, 4),
        new THREE.MeshPhongMaterial({ color: 0x223344, emissive: 0x001122, shininess: 100 })
      );
      blade.position.set(side * 0.45, 0.85, 0.3);
      blade.rotation.x = -Math.PI / 2;
      blade.scale.set(1, 1, 0.25);
      group.add(blade);
      // Blade energy edge
      const bladeEdge = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.004, 0.3, 0.012),
        aGlow(0x00ffff, 0.8)
      );
      bladeEdge.position.set(side * 0.45, 0.85, 0.42);
      bladeEdge.rotation.x = Math.PI / 2;
      group.add(bladeEdge);
      // Wrist housing
      const wrist = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.05, 0.045, 0.08, 6),
        new THREE.MeshPhongMaterial({ color: 0x334455, shininess: 70 })
      );
      wrist.position.set(side * 0.45, 0.85, 0.18);
      wrist.rotation.x = Math.PI / 2;
      group.add(wrist);
    }

    // Predator scanner visor - horizontal band across eyes
    const visor = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.28, 0.04, 0.08),
      new THREE.MeshPhongMaterial({ color: 0x112233, shininess: 90 })
    );
    visor.position.set(0, 1.72, 0.18);
    group.add(visor);
    // Visor glow bar
    const visorGlow = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.25, 0.012, 0.005),
      aGlow(0x00ffcc, 0.9)
    );
    visorGlow.position.set(0, 1.72, 0.22);
    group.add(visorGlow);
    // Scanner eye dots
    for (let e = 0; e < 5; e++) {
      const eyeDot = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.008, 6),
        aGlow(0xff0000, 0.85)
      );
      eyeDot.position.set(-0.1 + e * 0.05, 1.72, 0.225);
      group.add(eyeDot);
    }

    // Dorsal spines running down back
    for (let s = 0; s < 5; s++) {
      const spine = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.025, 0.1, 4),
        new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233, shininess: 80 })
      );
      spine.position.set(0, 1.55 - s * 0.18, -0.22);
      spine.rotation.x = 0.3;
      group.add(spine);
    }

    // Tail
    for (let t = 0; t < 6; t++) {
      const segment = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.055 - t * 0.006, 5, 5),
        new THREE.MeshPhongMaterial({ color: 0x2a3540, emissive: 0x0a1520, shininess: 60 })
      );
      segment.position.set(Math.sin(t * 0.5) * 0.08, 0.3, -0.25 - t * 0.15);
      group.add(segment);
    }
    // Tail blade tip
    const tailBladeTip = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.04, 0.15, 4),
      new THREE.MeshPhongMaterial({ color: 0x112233, shininess: 100 })
    );
    tailBladeTip.position.set(Math.sin(3) * 0.08, 0.3, -1.2);
    tailBladeTip.rotation.x = -Math.PI / 2;
    group.add(tailBladeTip);
    const tailBladeEdge = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.003, 0.12, 0.006),
      aGlow(0x00ffff, 0.6)
    );
    tailBladeEdge.position.set(Math.sin(3) * 0.08, 0.3, -1.25);
    tailBladeEdge.rotation.x = Math.PI / 2;
    group.add(tailBladeEdge);

    // Cloak field shimmer shell (outer translucent sphere)
    const cloakShell = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.85, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0x88ffff, transparent: true, opacity: 0.06,
        side: THREE.BackSide
      })
    );
    cloakShell.position.y = 0.95;
    cloakShell.scale.set(0.7, 1.2, 0.7);
    group.add(cloakShell);

  } else if (type === 'spitter') {
    // === SPITTER: Hunched reptilian acid alien ===
    const scaleMat = new THREE.MeshPhongMaterial({ color: 0x669900, emissive: 0x334400, shininess: 30 });
    const darkScale = new THREE.MeshPhongMaterial({ color: 0x446600, emissive: 0x223300, shininess: 25 });
    const bellyMat = new THREE.MeshPhongMaterial({ color: 0x88aa44, emissive: 0x445522, shininess: 15 });

    // Hunched body - with belly detail
    const body = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.4, 10, 10),
      scaleMat
    );
    body.scale.set(1, 0.8, 1.2);
    body.position.set(0, 1.0, -0.1);
    group.add(body);
    // Belly scales (lighter underbelly)
    const belly = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.35, 8, 8, 0, Math.PI * 2, Math.PI / 3, Math.PI / 3),
      bellyMat
    );
    belly.scale.set(0.9, 0.75, 1.1);
    belly.position.set(0, 0.85, 0.05);
    group.add(belly);
    // Scale pattern on belly
    for (let row = 0; row < 3; row++) {
      for (let col = -2; col <= 2; col++) {
        const s = new THREE.Mesh(
          cGeom(THREE.CircleGeometry, 0.025, 4),
          new THREE.MeshPhongMaterial({ color: 0x99bb55, emissive: 0x334411, shininess: 40 })
        );
        s.position.set(col * 0.055, 0.78 + row * 0.08, 0.35);
        s.rotation.y = 0.1;
        group.add(s);
      }
    }

    // Lower torso
    const lowerBody = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.3, 0.25, 0.5, 8),
      darkScale
    );
    lowerBody.position.y = 0.6;
    group.add(lowerBody);

    // Neck hood/frill (cobra-like)
    const neckBase = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.15, 0.2, 0.25, 8),
      scaleMat
    );
    neckBase.position.set(0, 1.4, 0.1);
    group.add(neckBase);
    // Hood flaps
    for (const side of [-1, 1]) {
      const hood = new THREE.Mesh(
        cGeom(THREE.PlaneGeometry, 0.25, 0.3),
        new THREE.MeshPhongMaterial({
          color: 0x88aa00, emissive: 0x445500,
          side: THREE.DoubleSide, shininess: 30
        })
      );
      hood.position.set(side * 0.18, 1.45, 0.12);
      hood.rotation.y = side * -0.6;
      hood.rotation.z = side * 0.2;
      group.add(hood);
      // Hood membrane pattern
      for (let i = 0; i < 3; i++) {
        const vein = new THREE.Mesh(
          cGeom(THREE.BoxGeometry, 0.005, 0.2, 0.003),
          aGlow(0xaaff00, 0.2)
        );
        vein.position.set(side * (0.15 + i * 0.03), 1.45, 0.13);
        vein.rotation.y = side * -0.6;
        group.add(vein);
      }
    }
    // Hood edge markings
    const hoodEdge = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.2, 0.01, 4, 10, Math.PI),
      new THREE.MeshPhongMaterial({ color: 0xaacc00, emissive: 0x556600 })
    );
    hoodEdge.position.set(0, 1.42, 0.15);
    hoodEdge.rotation.x = -Math.PI / 2;
    group.add(hoodEdge);

    // Head - wide jaw with more detail
    const head = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.3, 10, 10),
      new THREE.MeshPhongMaterial({ color: 0x88aa00, emissive: 0x334400 })
    );
    head.scale.set(1.1, 0.9, 1);
    head.position.set(0, 1.55, 0.2);
    group.add(head);
    // Head bumps/horns
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.03, 0.1, 4),
        darkScale
      );
      horn.position.set(side * 0.2, 1.7, 0.1);
      horn.rotation.z = side * -0.3;
      group.add(horn);
    }

    // Wide jaw/mandible with more detail
    const jaw = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.3, 0.1, 0.25),
      new THREE.MeshPhongMaterial({ color: 0x99bb00, emissive: 0x445500 })
    );
    jaw.position.set(0, 1.35, 0.35);
    group.add(jaw);
    // Jaw muscle bumps
    for (const side of [-1, 1]) {
      const jawMuscle = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.05, 6, 6),
        scaleMat
      );
      jawMuscle.position.set(side * 0.15, 1.42, 0.3);
      group.add(jawMuscle);
    }
    // Teeth - upper and lower rows
    for (let i = -2; i <= 2; i++) {
      // Upper teeth
      const uTooth = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.015, 0.08, 4),
        new THREE.MeshPhongMaterial({ color: 0xcccc66, shininess: 80 })
      );
      uTooth.position.set(i * 0.06, 1.32, 0.42);
      uTooth.rotation.x = Math.PI;
      group.add(uTooth);
      // Lower teeth (shorter)
      const lTooth = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.012, 0.05, 4),
        new THREE.MeshPhongMaterial({ color: 0xbbbb55, shininess: 70 })
      );
      lTooth.position.set(i * 0.06 + 0.03, 1.38, 0.42);
      group.add(lTooth);
    }
    // Tongue (forked, acid-colored)
    const tongue = new THREE.Mesh(
      cGeom(THREE.BoxGeometry, 0.02, 0.008, 0.15),
      aGlow(0xaaff00, 0.6)
    );
    tongue.position.set(0, 1.34, 0.48);
    group.add(tongue);
    // Tongue fork
    for (const side of [-1, 1]) {
      const fork = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.008, 0.006, 0.04),
        aGlow(0xaaff00, 0.5)
      );
      fork.position.set(side * 0.01, 1.34, 0.56);
      fork.rotation.y = side * 0.2;
      group.add(fork);
    }

    // Eyes - reptilian slits with brow ridges
    for (const side of [-1, 1]) {
      // Brow ridge
      const brow = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.1, 0.025, 0.04),
        darkScale
      );
      brow.position.set(side * 0.15, 1.66, 0.3);
      brow.rotation.z = side * 0.15;
      group.add(brow);
      // Eye
      const eye = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.06, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffff00 })
      );
      eye.scale.set(0.6, 1.2, 0.5);
      eye.position.set(side * 0.15, 1.6, 0.32);
      group.add(eye);
      // Pupil (vertical slit)
      const pupil = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.005, 0.06, 0.01),
        new THREE.MeshBasicMaterial({ color: 0x443300 })
      );
      pupil.position.set(side * 0.15, 1.6, 0.36);
      group.add(pupil);
    }
    // Nostril holes
    for (const side of [-1, 1]) {
      const nostril = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.015, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x334400 })
      );
      nostril.position.set(side * 0.05, 1.5, 0.38);
      group.add(nostril);
    }

    // Acid sacs on back - more detailed with tubes connecting them
    const sacMat = new THREE.MeshPhongMaterial({
      color: 0xaaee00, emissive: 0x668800,
      transparent: true, opacity: 0.7, shininess: 60,
    });
    const sacPositions = [[0, 1.35, -0.35], [-0.2, 1.15, -0.3], [0.2, 1.15, -0.3], [-0.1, 0.95, -0.28], [0.1, 0.95, -0.28]];
    for (const [sx, sy, sz] of sacPositions) {
      const sac = new THREE.Mesh(cGeom(THREE.SphereGeometry, 0.13, 8, 8), sacMat);
      sac.position.set(sx, sy, sz);
      group.add(sac);
      const sacInner = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.07, 6, 6),
        aGlow(0xccff00, 0.5)
      );
      sacInner.position.set(sx, sy, sz);
      group.add(sacInner);
    }
    // Tubes connecting sacs
    for (let i = 0; i < sacPositions.length - 1; i++) {
      const tube = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.01, 0.01, 0.15, 4),
        aGlow(0x88cc00, 0.3)
      );
      const [ax, ay, az] = sacPositions[i];
      const [bx, by, bz] = sacPositions[i + 1];
      tube.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      tube.rotation.z = Math.random() * 0.5;
      group.add(tube);
    }

    // Arms - shorter, hunched with wrist spurs
    const armMat = new THREE.MeshPhongMaterial({ color: 0x669900, emissive: 0x223300 });
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.06, 0.05, 0.45, 6), armMat);
      arm.position.set(side * 0.35, 0.95, 0.15);
      arm.rotation.z = side * 0.6;
      arm.rotation.x = -0.3;
      group.add(arm);
      // Elbow bump
      const elbow = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.04, 4, 4),
        darkScale
      );
      elbow.position.set(side * 0.4, 0.85, 0.12);
      group.add(elbow);
      // Wrist spur
      const wristSpur = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.015, 0.08, 4),
        darkScale
      );
      wristSpur.position.set(side * 0.44, 0.76, 0.1);
      wristSpur.rotation.x = 0.3;
      wristSpur.rotation.z = side * 0.5;
      group.add(wristSpur);
      // Clawed hand
      const hand = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.035, 6, 6),
        armMat
      );
      hand.position.set(side * 0.45, 0.72, 0.2);
      group.add(hand);
      for (let f = -1; f <= 1; f++) {
        const claw = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.012, 0.1, 4),
          new THREE.MeshPhongMaterial({ color: 0xaaaa33, shininess: 70 })
        );
        claw.position.set(side * 0.45 + f * 0.02, 0.7, 0.25);
        claw.rotation.x = -0.4;
        group.add(claw);
      }
    }

    // Thick legs - wide stance with scale detail
    const legMat = new THREE.MeshPhongMaterial({ color: 0x557700, emissive: 0x223300 });
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.1, 0.08, 0.4, 6), legMat);
      thigh.position.set(side * 0.2, 0.45, 0);
      group.add(thigh);
      const shin = new THREE.Mesh(cGeom(THREE.CylinderGeometry, 0.08, 0.07, 0.35, 6), legMat);
      shin.position.set(side * 0.2, 0.18, 0.05);
      group.add(shin);
      // Leg scale ridges
      for (let i = 0; i < 3; i++) {
        const scaleRidge = new THREE.Mesh(
          cGeom(THREE.BoxGeometry, 0.1, 0.008, 0.05),
          darkScale
        );
        scaleRidge.position.set(side * 0.2, 0.35 - i * 0.08, 0.08);
        group.add(scaleRidge);
      }
      // Foot with toe claws
      const foot = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.14, 0.06, 0.22),
        new THREE.MeshPhongMaterial({ color: 0x445500 })
      );
      foot.position.set(side * 0.2, 0.03, 0.06);
      group.add(foot);
      // Toe claws
      for (let t = -1; t <= 1; t++) {
        const toeClaw = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.012, 0.06, 3),
          new THREE.MeshPhongMaterial({ color: 0x887744, shininess: 60 })
        );
        toeClaw.position.set(side * 0.2 + t * 0.04, 0.01, 0.18);
        toeClaw.rotation.x = -Math.PI / 3;
        group.add(toeClaw);
      }
    }

    // Tail - thick with ridges
    for (let i = 0; i < 4; i++) {
      const tailSeg = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.08 - i * 0.015, 0.09 - i * 0.015, 0.2, 6),
        darkScale
      );
      tailSeg.position.set(0, 0.4 - i * 0.05, -0.25 - i * 0.15);
      tailSeg.rotation.x = 0.3 + i * 0.1;
      group.add(tailSeg);
    }
    // Tail tip
    const tailTip = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.03, 0.12, 6),
      scaleMat
    );
    tailTip.position.set(0, 0.2, -0.8);
    tailTip.rotation.x = Math.PI / 2 + 0.5;
    group.add(tailTip);

    // Dripping acid indicators (multiple)
    for (let i = 0; i < 3; i++) {
      const drip = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.008, 0.025, 0.12, 6),
        aGlow(0xaaff00, 0.6)
      );
      drip.position.set(-0.04 + i * 0.04, 1.22, 0.45 + i * 0.02);
      group.add(drip);
    }

    // Dorsal ridge (larger scale plates with varying sizes)
    for (let i = 0; i < 7; i++) {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.12 + (i % 2) * 0.04, 0.035 + (i % 3) * 0.01, 0.06),
        new THREE.MeshPhongMaterial({ color: 0x778800, emissive: 0x223300 })
      );
      plate.position.set(0, 0.85 + i * 0.1, -0.38);
      plate.rotation.x = 0.3;
      group.add(plate);
    }

    // Acid pool glow at base (environmental hazard)
    const acidPool = new THREE.Mesh(
      cGeom(THREE.CircleGeometry, 0.3, 10),
      aGlow(0xaaff00, 0.15)
    );
    acidPool.rotation.x = -Math.PI / 2;
    acidPool.position.y = 0.02;
    group.add(acidPool);

    // === NEW DETAILS: venom sacs, acid fangs, gill flaps, throat pouch, tongue ===
    // Venom sacs on shoulders/back - bulging translucent pods
    for (const side of [-1, 1]) {
      const sac = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.12, 8, 8),
        new THREE.MeshPhongMaterial({
          color: 0x88cc00, emissive: 0x334400,
          transparent: true, opacity: 0.7, shininess: 80
        })
      );
      sac.scale.set(1, 1.2, 0.8);
      sac.position.set(side * 0.28, 1.15, -0.1);
      group.add(sac);
      // Sac highlight/nucleus
      const sacCore = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.04, 5, 5),
        aGlow(0xccff44, 0.85)
      );
      sacCore.position.set(side * 0.28, 1.15, -0.05);
      group.add(sacCore);
      // Connector tube from sac to mouth
      for (let c = 0; c < 4; c++) {
        const tube = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.015, 4, 4),
          darkScale
        );
        const t = c / 4;
        tube.position.set(
          side * (0.28 - t * 0.22),
          1.15 - t * 0.3,
          -0.1 + t * 0.4
        );
        group.add(tube);
      }
    }

    // Large throat pouch (expandable sac)
    const throatPouch = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.17, 10, 8),
      new THREE.MeshPhongMaterial({
        color: 0x556600, emissive: 0x223300,
        shininess: 30, transparent: true, opacity: 0.85
      })
    );
    throatPouch.scale.set(1, 0.7, 1.2);
    throatPouch.position.set(0, 0.78, 0.2);
    group.add(throatPouch);
    // Pouch vein lines
    for (let v = 0; v < 6; v++) {
      const ang = (v / 6) * Math.PI - Math.PI / 2;
      const vein = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.004, 0.006, 0.25),
        aGlow(0xaaff00, 0.4)
      );
      vein.position.set(Math.sin(ang) * 0.14, 0.78, 0.25);
      vein.rotation.y = ang;
      group.add(vein);
    }

    // Acid fangs - protruding from mouth area
    for (let f = 0; f < 4; f++) {
      const ang = (f / 4 - 0.375) * 0.7;
      const fang = new THREE.Mesh(
        cGeom(THREE.ConeGeometry, 0.018, 0.08, 4),
        new THREE.MeshPhongMaterial({ color: 0xeeddaa, emissive: 0x221100, shininess: 80 })
      );
      fang.position.set(Math.sin(ang) * 0.1, 0.92, 0.32);
      fang.rotation.x = Math.PI;
      group.add(fang);
      // Acid drip at fang tip
      const drip = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.012, 4, 4),
        aGlow(0xaaff00, 0.7)
      );
      drip.position.set(Math.sin(ang) * 0.1, 0.84, 0.32);
      drip.scale.set(1, 1.6, 1);
      group.add(drip);
    }

    // Forked tongue extending out
    const forkedTongue = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.01, 0.008, 0.18, 4),
      new THREE.MeshPhongMaterial({ color: 0x882244, emissive: 0x220011, shininess: 60 })
    );
    forkedTongue.position.set(0, 0.9, 0.42);
    forkedTongue.rotation.x = Math.PI / 2;
    group.add(forkedTongue);
    for (const fs of [-1, 1]) {
      const forkBit = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.008, 0.003, 0.06, 4),
        new THREE.MeshPhongMaterial({ color: 0x882244, emissive: 0x220011 })
      );
      forkBit.position.set(fs * 0.015, 0.9, 0.52);
      forkBit.rotation.x = Math.PI / 2;
      forkBit.rotation.z = fs * 0.3;
      group.add(forkBit);
    }

    // Gill flaps on neck/sides
    for (const side of [-1, 1]) {
      for (let g = 0; g < 3; g++) {
        const gill = new THREE.Mesh(
          cGeom(THREE.BoxGeometry, 0.04, 0.01, 0.06),
          new THREE.MeshPhongMaterial({ color: 0x334400, emissive: 0x221100, shininess: 40 })
        );
        gill.position.set(side * 0.16, 0.88 - g * 0.035, 0.06);
        gill.rotation.z = side * 0.3;
        group.add(gill);
      }
    }

    // Ridge of acid-leaking pores along spine
    for (let p = 0; p < 5; p++) {
      const pore = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.015, 6),
        aGlow(0xccff44, 0.7)
      );
      pore.position.set(0, 0.8 + p * 0.15, -0.38);
      pore.rotation.y = Math.PI;
      group.add(pore);
    }

  } else if (type === 'drone') {
    // === DRONE: Floating alien drone ===
    const hullMat = new THREE.MeshPhongMaterial({ color: 0x335588, emissive: 0x112244, shininess: 70 });
    const darkHull = new THREE.MeshPhongMaterial({ color: 0x223355, emissive: 0x0a1122, shininess: 80 });
    const lightHull = new THREE.MeshPhongMaterial({ color: 0x4466aa, emissive: 0x223366, shininess: 80 });
    const metalMat = new THREE.MeshPhongMaterial({ color: 0x667788, shininess: 90 });

    // Central disc body - layered construction
    const disc = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.5, 0.6, 0.3, 12),
      hullMat
    );
    group.add(disc);
    // Bottom plate (darker)
    const bottomPlate = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.58, 0.55, 0.06, 12),
      darkHull
    );
    bottomPlate.position.y = -0.12;
    group.add(bottomPlate);
    // Top plate rim
    const topRim = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.52, 0.5, 0.04, 12),
      lightHull
    );
    topRim.position.y = 0.12;
    group.add(topRim);
    // Hull panel lines (engraved grooves)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const panelLine = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.005, 0.28, 0.003),
        new THREE.MeshBasicMaterial({ color: 0x112233 })
      );
      panelLine.position.set(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5);
      panelLine.rotation.y = -angle;
      group.add(panelLine);
    }
    // Hull seam ring
    const seamRing = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.55, 0.008, 4, 20),
      metalMat
    );
    seamRing.rotation.x = Math.PI / 2;
    group.add(seamRing);

    // Dome top - with inner detail
    const dome = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.35, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      lightHull
    );
    dome.position.y = 0.15;
    group.add(dome);
    // Dome glass overlay
    const domeGlass = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.33, 10, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhongMaterial({
        color: 0x6688bb, emissive: 0x223344,
        transparent: true, opacity: 0.3, shininess: 100
      })
    );
    domeGlass.position.y = 0.16;
    group.add(domeGlass);
    // Internal circuitry visible through dome
    const circuitBoard = new THREE.Mesh(
      cGeom(THREE.CircleGeometry, 0.2, 8),
      aGlow(0x4488ff, 0.2)
    );
    circuitBoard.position.y = 0.18;
    circuitBoard.rotation.x = -Math.PI / 2;
    group.add(circuitBoard);
    // Circuit traces
    for (let i = 0; i < 4; i++) {
      const trace = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.005, 0.001, 0.12),
        aGlow(0x44aaff, 0.3)
      );
      trace.position.y = 0.19;
      trace.rotation.y = (i / 4) * Math.PI;
      group.add(trace);
    }

    // Central eye - more detailed with scanning effect
    const eyeHousing = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.16, 0.18, 0.08, 10),
      darkHull
    );
    eyeHousing.rotation.x = Math.PI / 2;
    eyeHousing.position.set(0, 0.05, 0.42);
    group.add(eyeHousing);
    const eye = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.14, 10, 10),
      aGlow(0x44aaff, 0.9)
    );
    eye.scale.set(1, 0.7, 0.5);
    eye.position.set(0, 0.05, 0.45);
    group.add(eye);
    // Eye pupil/iris ring
    const iris = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.08, 0.015, 6, 12),
      aGlow(0x2266cc, 0.7)
    );
    iris.position.set(0, 0.05, 0.48);
    iris.rotation.x = Math.PI / 2;
    group.add(iris);
    // Eye center dot
    const eyeCenter = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.04, 6, 6),
      aGlow(0xffffff, 0.8)
    );
    eyeCenter.position.set(0, 0.05, 0.49);
    group.add(eyeCenter);
    // Eye ring
    const eyeRing = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.17, 0.02, 6, 12),
      new THREE.MeshPhongMaterial({ color: 0x6688cc, emissive: 0x334466, shininess: 90 })
    );
    eyeRing.position.set(0, 0.05, 0.42);
    eyeRing.rotation.x = Math.PI / 2;
    group.add(eyeRing);
    // Eye light
    const eyeLight = new THREE.PointLight(0x4488ff, 0.5, 4);
    eyeLight.position.set(0, 0.05, 0.5);
    group.add(eyeLight);

    // Secondary sensor eyes (smaller, flanking main eye)
    for (const side of [-1, 1]) {
      const secEye = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.04, 6, 6),
        aGlow(0x44aaff, 0.7)
      );
      secEye.position.set(side * 0.25, 0.05, 0.4);
      group.add(secEye);
      const secRing = new THREE.Mesh(
        cGeom(THREE.TorusGeometry, 0.05, 0.008, 4, 8),
        metalMat
      );
      secRing.position.set(side * 0.25, 0.05, 0.39);
      secRing.rotation.x = Math.PI / 2;
      group.add(secRing);
    }

    // Decorative orbit ring - double with gap
    const orbitRing = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.65, 0.015, 6, 24),
      aGlow(0x4488ff, 0.4)
    );
    orbitRing.rotation.x = Math.PI / 2;
    group.add(orbitRing);
    const orbitRing2 = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.7, 0.01, 6, 24),
      aGlow(0x4488ff, 0.2)
    );
    orbitRing2.rotation.x = Math.PI / 2;
    group.add(orbitRing2);

    // Weapon barrels (2 forward-facing)
    for (const side of [-1, 1]) {
      const weaponMount = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.05, 0.05, 0.06),
        darkHull
      );
      weaponMount.position.set(side * 0.35, -0.08, 0.35);
      group.add(weaponMount);
      const barrel = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.015, 0.02, 0.12, 6),
        metalMat
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(side * 0.35, -0.08, 0.42);
      group.add(barrel);
      const barrelTip = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.018, 6, 6),
        aGlow(0x44aaff, 0.6)
      );
      barrelTip.position.set(side * 0.35, -0.08, 0.48);
      group.add(barrelTip);
    }

    // 4 hover engines underneath - more detailed
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const engineGroup = new THREE.Group();
      // Engine nacelle
      const nacelle = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.06, 0.08, 0.06, 8),
        darkHull
      );
      nacelle.position.y = 0.03;
      engineGroup.add(nacelle);
      // Engine body
      const pod = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.08, 0.1, 0.15, 8),
        new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x112233, shininess: 60 })
      );
      engineGroup.add(pod);
      // Engine fins
      for (let f = 0; f < 4; f++) {
        const finAngle = (f / 4) * Math.PI * 2;
        const fin = new THREE.Mesh(
          cGeom(THREE.BoxGeometry, 0.005, 0.12, 0.04),
          metalMat
        );
        fin.position.set(Math.cos(finAngle) * 0.09, 0, Math.sin(finAngle) * 0.09);
        fin.rotation.y = -finAngle;
        engineGroup.add(fin);
      }
      // Engine glow
      const engineGlow = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.06, 0.09, 0.05, 8),
        aGlow(0x4488ff, 0.7)
      );
      engineGlow.position.y = -0.1;
      engineGroup.add(engineGlow);
      // Engine inner glow ring
      const innerRing = new THREE.Mesh(
        cGeom(THREE.TorusGeometry, 0.05, 0.008, 4, 8),
        aGlow(0xaaddff, 0.5)
      );
      innerRing.position.y = -0.1;
      innerRing.rotation.x = Math.PI / 2;
      engineGroup.add(innerRing);
      const eLight = new THREE.PointLight(0x4488ff, 0.3, 3);
      eLight.position.y = -0.15;
      engineGroup.add(eLight);
      // Engine strut (connecting to body)
      const strut = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.02, 0.04, 0.15),
        metalMat
      );
      strut.position.set(0, -0.02, -0.07);
      engineGroup.add(strut);
      engineGroup.position.set(Math.cos(angle) * 0.45, -0.2, Math.sin(angle) * 0.45);
      engineGroup.rotation.y = -angle;
      group.add(engineGroup);
    }

    // Antenna array on top (multiple)
    const antenna = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.008, 0.008, 0.25, 4),
      metalMat
    );
    antenna.position.y = 0.45;
    group.add(antenna);
    const antennaTip = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.025, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    );
    antennaTip.position.y = 0.58;
    group.add(antennaTip);
    // Side antennae
    for (const side of [-1, 1]) {
      const sideAnt = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.005, 0.005, 0.12, 4),
        metalMat
      );
      sideAnt.position.set(side * 0.08, 0.42, -0.05);
      sideAnt.rotation.z = side * 0.3;
      group.add(sideAnt);
      const sideAntTip = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.012, 4, 4),
        aGlow(0x44ff44, 0.8)
      );
      sideAntTip.position.set(side * 0.12, 0.48, -0.05);
      group.add(sideAntTip);
    }

    // Side armor panels - with detail markings
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const panel = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.15, 0.08, 0.04),
        new THREE.MeshPhongMaterial({ color: 0x556688, emissive: 0x112233, shininess: 60 })
      );
      panel.position.set(Math.cos(angle) * 0.55, 0, Math.sin(angle) * 0.55);
      panel.rotation.y = -angle;
      group.add(panel);
      // Panel accent stripe
      const stripe = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.1, 0.01, 0.005),
        aGlow(0x4488ff, 0.3)
      );
      stripe.position.set(Math.cos(angle) * 0.56, 0, Math.sin(angle) * 0.56);
      stripe.rotation.y = -angle;
      group.add(stripe);
    }

    // ID markings (alien text - small glowing symbols on hull)
    for (let i = 0; i < 3; i++) {
      const mark = new THREE.Mesh(
        new THREE.BoxGeometry(0.02 + Math.random() * 0.02, 0.015, 0.003),
        aGlow(0x88bbff, 0.3)
      );
      mark.position.set(-0.2 + i * 0.08, 0.08, 0.5);
      group.add(mark);
    }

    // Bottom sensor cluster - more elaborate
    const sensorMount = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.12, 0.1, 0.04, 8),
      darkHull
    );
    sensorMount.position.y = -0.17;
    group.add(sensorMount);
    const sensor = new THREE.Mesh(
      cGeom(THREE.ConeGeometry, 0.08, 0.15, 6),
      new THREE.MeshPhongMaterial({ color: 0x334466, emissive: 0x112244, shininess: 70 })
    );
    sensor.position.y = -0.25;
    sensor.rotation.x = Math.PI;
    group.add(sensor);
    const sensorGlow = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.04, 6, 6),
      aGlow(0x44aaff, 0.8)
    );
    sensorGlow.position.y = -0.32;
    group.add(sensorGlow);
    // Sensor ring
    const sensorRing = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.06, 0.006, 4, 8),
      aGlow(0x44aaff, 0.4)
    );
    sensorRing.position.y = -0.26;
    sensorRing.rotation.x = Math.PI / 2;
    group.add(sensorRing);
    // Scanning laser line
    const scanLaser = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.003, 0.003, 1.0, 4),
      aGlow(0xff4444, 0.3)
    );
    scanLaser.position.y = -0.8;
    group.add(scanLaser);

    // === NEW DETAILS: armor plating, weapon pods, antenna array, status lights, thruster vents ===
    // Armored top plating - layered hex panels
    for (let h = 0; h < 6; h++) {
      const ang = (h / 6) * Math.PI * 2;
      const panel = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.18, 0.04, 0.12),
        new THREE.MeshPhongMaterial({ color: 0x2a4466, emissive: 0x081022, shininess: 85 })
      );
      panel.position.set(Math.cos(ang) * 0.3, 0.12, Math.sin(ang) * 0.3);
      panel.rotation.y = ang;
      panel.rotation.x = 0.15;
      group.add(panel);
      // Panel rivets
      for (let rv = 0; rv < 2; rv++) {
        const rivet = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.01, 4, 4),
          new THREE.MeshPhongMaterial({ color: 0x88aacc, shininess: 90 })
        );
        rivet.position.set(
          Math.cos(ang) * 0.3 + Math.cos(ang + Math.PI / 2) * (rv * 0.05 - 0.025),
          0.14,
          Math.sin(ang) * 0.3 + Math.sin(ang + Math.PI / 2) * (rv * 0.05 - 0.025)
        );
        group.add(rivet);
      }
    }

    // Weapon pods - 3 forward-facing turrets on underside
    for (let w = 0; w < 3; w++) {
      const ang = (w / 3 - 0.5) * 0.8;
      const pod = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.04, 0.05, 0.08, 6),
        new THREE.MeshPhongMaterial({ color: 0x223344, emissive: 0x000811, shininess: 85 })
      );
      pod.position.set(Math.sin(ang) * 0.22, -0.1, Math.cos(ang) * 0.3);
      pod.rotation.x = Math.PI / 2;
      group.add(pod);
      // Pod barrel
      const barrel = new THREE.Mesh(
        cGeom(THREE.CylinderGeometry, 0.012, 0.014, 0.15, 5),
        new THREE.MeshPhongMaterial({ color: 0x111122, shininess: 95 })
      );
      barrel.position.set(Math.sin(ang) * 0.22, -0.1, Math.cos(ang) * 0.42);
      barrel.rotation.x = Math.PI / 2;
      group.add(barrel);
      // Muzzle glow
      const muzzle = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.012, 6),
        aGlow(0x66bbff, 0.8)
      );
      muzzle.position.set(Math.sin(ang) * 0.22, -0.1, Math.cos(ang) * 0.5);
      group.add(muzzle);
    }

    // Antenna array on top (radio mast + dish)
    const antennaBase = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.025, 0.035, 0.06, 6),
      new THREE.MeshPhongMaterial({ color: 0x334455, shininess: 80 })
    );
    antennaBase.position.y = 0.2;
    group.add(antennaBase);
    const antennaMast = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.005, 0.005, 0.25, 4),
      new THREE.MeshPhongMaterial({ color: 0xaabbcc, shininess: 90 })
    );
    antennaMast.position.y = 0.35;
    group.add(antennaMast);
    // Mast tip beacon
    const beacon = new THREE.Mesh(
      cGeom(THREE.SphereGeometry, 0.018, 5, 5),
      aGlow(0xff0000, 0.9)
    );
    beacon.position.y = 0.49;
    group.add(beacon);
    // Parabolic comms dish
    const dish = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.06, 0.03, 0.03, 8, 1, true),
      new THREE.MeshPhongMaterial({
        color: 0x99aacc, shininess: 100, side: THREE.DoubleSide
      })
    );
    dish.position.set(0.08, 0.28, 0.02);
    dish.rotation.x = -0.5;
    dish.rotation.z = 0.3;
    group.add(dish);
    // Dish receiver stub
    const dishStub = new THREE.Mesh(
      cGeom(THREE.CylinderGeometry, 0.005, 0.005, 0.04, 4),
      new THREE.MeshPhongMaterial({ color: 0x556677 })
    );
    dishStub.position.set(0.09, 0.3, 0.06);
    group.add(dishStub);

    // Status indicator light ring around equator
    for (let l = 0; l < 12; l++) {
      const ang = (l / 12) * Math.PI * 2;
      const light = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.012, 0.012, 0.012),
        aGlow(l % 3 === 0 ? 0xff4400 : (l % 3 === 1 ? 0x44aaff : 0x00ff88), 0.9)
      );
      light.position.set(Math.cos(ang) * 0.41, 0, Math.sin(ang) * 0.41);
      group.add(light);
    }

    // Side thruster vents (4 cardinal directions)
    for (let t = 0; t < 4; t++) {
      const ang = (t / 4) * Math.PI * 2 + Math.PI / 4;
      const vent = new THREE.Mesh(
        cGeom(THREE.BoxGeometry, 0.1, 0.06, 0.03),
        new THREE.MeshPhongMaterial({ color: 0x1a2233, emissive: 0x000811, shininess: 70 })
      );
      vent.position.set(Math.cos(ang) * 0.4, -0.05, Math.sin(ang) * 0.4);
      vent.rotation.y = ang + Math.PI / 2;
      group.add(vent);
      // Vent louvers
      for (let lv = 0; lv < 3; lv++) {
        const louver = new THREE.Mesh(
          cGeom(THREE.BoxGeometry, 0.09, 0.006, 0.008),
          new THREE.MeshPhongMaterial({ color: 0x334455 })
        );
        louver.position.set(
          Math.cos(ang) * 0.415,
          -0.065 + lv * 0.02,
          Math.sin(ang) * 0.415
        );
        louver.rotation.y = ang + Math.PI / 2;
        group.add(louver);
      }
      // Thruster glow inside vent
      const ventGlow = new THREE.Mesh(
        cGeom(THREE.CircleGeometry, 0.035, 6),
        aGlow(0x66aaff, 0.5)
      );
      ventGlow.position.set(Math.cos(ang) * 0.42, -0.05, Math.sin(ang) * 0.42);
      ventGlow.rotation.y = ang - Math.PI / 2;
      group.add(ventGlow);
    }

    // Central bottom energy vortex (additional glow layer)
    const bottomVortex = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.12, 0.015, 6, 12),
      aGlow(0x4488ff, 0.6)
    );
    bottomVortex.position.y = -0.22;
    bottomVortex.rotation.x = Math.PI / 2;
    group.add(bottomVortex);
    const bottomVortex2 = new THREE.Mesh(
      cGeom(THREE.TorusGeometry, 0.18, 0.008, 4, 16),
      aGlow(0x66aaff, 0.4)
    );
    bottomVortex2.position.y = -0.2;
    bottomVortex2.rotation.x = Math.PI / 2;
    group.add(bottomVortex2);
  }

  // Per-type rim light color: pulls from the alien's signature color, but
  // boosted toward saturated hues so silhouettes pop against dark levels.
  const rimColorMap = {
    grunt:   0x22ff66,
    swarmer: 0xbb44ff,
    bloater: 0xff6622,
    stalker: 0x00ffff,
    spitter: 0xaaff00,
    drone:   0x66bbff,
  };
  rimLightGroup(group, rimColorMap[type] || data.color, 1.0, 2.0);

  return group;
}

export class Alien {
  constructor(type, position, scene, particles, audio) {
    this.type = type;
    this.data = { ...ALIEN_TYPES[type] };
    this.hp = this.data.hp;
    this.maxHp = this.data.hp;
    this.dead = false;
    this.deathTimer = 0;
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.attackCooldown = Math.random() * this.data.attackRate;
    this.mesh = createAlienModel(type);
    this.mesh.position.copy(position);
    scene.add(this.mesh);
    this.velocity = new THREE.Vector3();
    this.pulseTime = Math.random() * Math.PI * 2;
    this.projectiles = [];

    // Store original emissive colors for hit flash recovery + cache all materials
    this._originalEmissives = [];
    this._allMaterials = [];
    this.mesh.traverse(child => {
      if (child.material) {
        this._allMaterials.push(child.material);
        if (child.material.emissive) {
          this._originalEmissives.push({ mat: child.material, color: child.material.emissive.clone() });
        }
      }
    });

    // Reusable temp vector to avoid per-frame allocations
    this._tmpVec = new THREE.Vector3();

    // Ambient VFX state
    this.hitFlashTimer = 0;
    // (damage sparks now flow through the global particle field)
    this._ambientEffects = []; // per-type ambient particle meshes
    this._initAmbientVFX();

    // Procedural animation state. Tracks horizontal speed via frame deltas,
    // drives a walk-cycle bob + lean, idle breathing, attack recoil, and
    // damage flinch — all on top of whatever the behavior() function does
    // to the mesh transform.
    this._animLastX = position.x;
    this._animLastZ = position.z;
    this._walkPhase = Math.random() * Math.PI * 2;
    this._smoothSpeed = 0;          // low-pass filtered horizontal speed
    this._appliedBobY = 0;          // last frame's bob offset (subtracted next frame)
    this._appliedLeanX = 0;         // last frame's lean rot.x (cleared next frame)
    this._appliedLeanZ = 0;         // last frame's lean rot.z
    this._attackRecoil = 0;         // seconds of remaining recoil pose
    this._hitFlinch = 0;            // seconds of remaining damage-flinch pose
    this._hitPunch = 0;             // seconds of remaining hit scale-punch
    this._knockback = 0;            // knockback speed from incoming damage
  }

  _initAmbientVFX() {
    if (this.type === 'bloater') {
      // Plasma leak particles orbiting the bloater
      for (let i = 0; i < 6; i++) {
        const particle = new THREE.Mesh(
          new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.6 })
        );
        particle.userData.angle = (i / 6) * Math.PI * 2;
        particle.userData.radius = 0.8 + Math.random() * 0.3;
        particle.userData.speed = 1.5 + Math.random();
        particle.userData.yOffset = 0.5 + Math.random() * 1.0;
        this.mesh.add(particle);
        this._ambientEffects.push(particle);
      }
    } else if (this.type === 'drone') {
      // Engine exhaust glow cones under each engine
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const exhaust = new THREE.Mesh(
          cGeom(THREE.ConeGeometry, 0.06, 0.3, 6),
          new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.3 })
        );
        exhaust.position.set(Math.cos(angle) * 0.45, -0.4, Math.sin(angle) * 0.45);
        exhaust.rotation.x = Math.PI; // Point downward
        this.mesh.add(exhaust);
        this._ambientEffects.push(exhaust);
      }
    } else if (this.type === 'stalker') {
      // Shimmer distortion outline
      const outline = new THREE.Mesh(
        cGeom(THREE.SphereGeometry, 0.7, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0x00ffff, transparent: true, opacity: 0.0, wireframe: true
        })
      );
      outline.position.y = 0.8;
      this.mesh.add(outline);
      this._ambientEffects.push(outline);
    } else if (this.type === 'spitter') {
      // Acid drip particles from mouth area
      for (let i = 0; i < 3; i++) {
        const drip = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.025, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0xaaff00, transparent: true, opacity: 0.7 })
        );
        drip.position.set((Math.random() - 0.5) * 0.2, 1.3, 0.3);
        drip.userData.dripTimer = Math.random() * 2;
        drip.userData.baseY = 1.3;
        this.mesh.add(drip);
        this._ambientEffects.push(drip);
      }
    } else if (this.type === 'swarmer') {
      // Speed trail afterimages (small trailing particles)
      for (let i = 0; i < 4; i++) {
        const trail = new THREE.Mesh(
          cGeom(THREE.SphereGeometry, 0.06, 4, 4),
          new THREE.MeshBasicMaterial({ color: 0x9900ff, transparent: true, opacity: 0.0 })
        );
        trail.userData.trailIdx = i;
        this.mesh.add(trail);
        this._ambientEffects.push(trail);
      }
    }
  }

  update(delta, playerPos) {
    if (this.dead) {
      this.deathTimer -= delta;
      const fadeAlpha = Math.max(0, this.deathTimer / 1.0);
      const fallProgress = 1 - fadeAlpha; // 0 → 1 over death
      // Dramatic fall-over: rotate forward and roll slightly while sinking.
      // Drones spin and dive; ground aliens tip onto their face.
      if (this.type === 'drone') {
        this.mesh.rotation.x = fallProgress * 1.4;
        this.mesh.rotation.z = fallProgress * 0.6;
        this.mesh.position.y -= delta * 4 * fallProgress;
      } else {
        this.mesh.rotation.x = fallProgress * (Math.PI / 2);
        this.mesh.rotation.z = Math.sin(fallProgress * 3) * 0.15;
        this.mesh.position.y -= delta * 1.5;
      }
      // Fade — use cached materials (no traverse)
      for (let i = 0, len = this._allMaterials.length; i < len; i++) {
        const mat = this._allMaterials[i];
        mat.transparent = true;
        mat.opacity = fadeAlpha;
      }
      return this.deathTimer <= 0; // true = remove
    }

    this.pulseTime += delta;

    // Face player - reuse temp vector
    const toPlayer = this._tmpVec.subVectors(playerPos, this.mesh.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

    // Save direction before behaviors overwrite _tmpVec
    const tpx = toPlayer.x, tpz = toPlayer.z;

    // Rotate to face player
    const angle = Math.atan2(toPlayer.x, toPlayer.z);
    this.mesh.rotation.y = angle;

    // Behavior
    if (this.data.behavior === 'ranged') {
      this._gruntBehavior(delta, dist, toPlayer, playerPos);
    } else if (this.data.behavior === 'melee') {
      this._swarmerBehavior(delta, dist, toPlayer, playerPos);
    } else if (this.data.behavior === 'explosive') {
      this._bloaterBehavior(delta, dist, toPlayer, playerPos);
    } else if (this.data.behavior === 'stealth') {
      this._stalkerBehavior(delta, dist, toPlayer, playerPos);
    } else if (this.data.behavior === 'sniper') {
      this._spitterBehavior(delta, dist, toPlayer, playerPos);
    } else if (this.data.behavior === 'aerial') {
      this._droneBehavior(delta, dist, toPlayer, playerPos);
    }

    // Knockback — push away from player, decays exponentially
    if (this._knockback > 0) {
      const kb = this._knockback * delta * 8;
      this.mesh.position.x -= tpx * kb;
      this.mesh.position.z -= tpz * kb;
      this._knockback *= Math.pow(0.008, delta);
      if (this._knockback < 0.1) this._knockback = 0;
    }

    // Update projectiles
    this._updateProjectiles(delta, playerPos);

    // Update hit flash
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= delta;
      if (this.hitFlashTimer <= 0) {
        for (const entry of this._originalEmissives) {
          entry.mat.emissive.copy(entry.color);
        }
      }
    }

    // Update ambient VFX - skip for distant aliens (LOD optimization)
    if (dist < 50) {
      this._updateAmbientVFX(delta, dist);
    }

    // Health-based visual degradation - skip for distant aliens
    if (dist < 40) {
      this._updateDamageEffects(delta);
    }

    // Procedural skeletal-style animation: walk-bob, lean, breathing, recoil.
    // Skipped beyond ~60m where individual limb motion isn't perceptible.
    if (dist < 60) {
      this._updateAnimation(delta);
    }
  }

  _updateAnimation(delta) {
    const params = ANIM_PARAMS[this.type] || ANIM_PARAMS.grunt;
    const mesh = this.mesh;

    // Restore the previous frame's bob/lean offsets so we can compute fresh
    // ones from the behavior() output without drift.
    mesh.position.y -= this._appliedBobY;
    mesh.rotation.x -= this._appliedLeanX;
    mesh.rotation.z -= this._appliedLeanZ;

    // Horizontal speed from frame-to-frame XZ delta (the behavior step
    // already moved us this frame).
    const dx = mesh.position.x - this._animLastX;
    const dz = mesh.position.z - this._animLastZ;
    const horizSpeed = Math.sqrt(dx * dx + dz * dz) / Math.max(0.001, delta);
    this._animLastX = mesh.position.x;
    this._animLastZ = mesh.position.z;

    // Low-pass the speed so attack jitter doesn't make legs stutter.
    const blend = Math.min(1, delta * 6);
    this._smoothSpeed += (horizSpeed - this._smoothSpeed) * blend;

    // Walk-cycle phase advances proportionally to speed. Idle aliens still
    // tick the phase slowly so they don't freeze mid-stride.
    const phaseRate = this._smoothSpeed * params.walkRate + 0.6;
    this._walkPhase += phaseRate * delta;

    // |sin| gives a two-step bounce; gated by speed so stationary aliens
    // only get the small idle component, not full-stride bouncing.
    const motionFactor = Math.min(1, this._smoothSpeed / Math.max(0.5, this.data.speed * 0.7));
    let bob;
    if (this.type === 'drone') {
      // Aerial hover: smooth continuous sine, independent of movement speed.
      bob = Math.sin(this.pulseTime * 2.5) * 0.12;
    } else {
      bob = (Math.abs(Math.sin(this._walkPhase)) - 0.5) * params.bobAmp * motionFactor;
    }

    // Project velocity into mesh-local space so lean tilts forward in the
    // direction the alien is actually moving (not always toward the player).
    // mesh.rotation.y is the yaw set by the behavior() face-player code.
    const yaw = mesh.rotation.y;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const localFwd = (dx * sy + dz * cy) / Math.max(0.001, delta);
    const localRight = (dx * cy - dz * sy) / Math.max(0.001, delta);
    // Forward velocity → tilt top forward (positive rot.x)
    let leanX = localFwd * params.leanFactor;
    // Lateral velocity → roll (banking into a strafe)
    let leanZ = -localRight * params.leanFactor * 0.6;
    // Clamp so frame spikes don't snap the body into a pretzel.
    if (leanX > 0.4) leanX = 0.4; else if (leanX < -0.4) leanX = -0.4;
    if (leanZ > 0.3) leanZ = 0.3; else if (leanZ < -0.3) leanZ = -0.3;

    // Attack recoil: kicks the body backward briefly when firing.
    if (this._attackRecoil > 0) {
      this._attackRecoil = Math.max(0, this._attackRecoil - delta);
      const r = this._attackRecoil / 0.25;
      leanX -= r * 0.35;
    }
    // Damage flinch: snaps backward and sways when hit.
    if (this._hitFlinch > 0) {
      this._hitFlinch = Math.max(0, this._hitFlinch - delta);
      const f = this._hitFlinch / 0.2;
      leanX -= f * 0.25;
      leanZ += Math.sin(this._hitFlinch * 80) * f * 0.15;
    }

    // Idle breathing — subtle whole-mesh scale pulse, plus the brief
    // hit-punch enlargement that takeDamage() schedules. Combined into a
    // single setScalar so the existing scale state stays simple.
    if (this._hitPunch > 0) {
      this._hitPunch = Math.max(0, this._hitPunch - delta);
    }
    const breathe = params.breatheAmp * Math.sin(this.pulseTime * params.breatheRate);
    const punch = this._hitPunch > 0 ? 0.15 * (this._hitPunch / 0.08) : 0;
    mesh.scale.setScalar(1 + breathe + punch);

    // Apply the new frame's offsets and remember them for next frame's
    // restore step.
    mesh.position.y += bob;
    mesh.rotation.x += leanX;
    mesh.rotation.z += leanZ;
    this._appliedBobY = bob;
    this._appliedLeanX = leanX;
    this._appliedLeanZ = leanZ;
  }

  _updateAmbientVFX(delta, dist) {
    if (this.type === 'bloater') {
      // Orbiting plasma leak particles + enhanced pulsing
      for (const p of this._ambientEffects) {
        p.userData.angle += p.userData.speed * delta;
        p.position.set(
          Math.cos(p.userData.angle) * p.userData.radius,
          p.userData.yOffset + Math.sin(this.pulseTime * 3 + p.userData.angle) * 0.15,
          Math.sin(p.userData.angle) * p.userData.radius
        );
        p.material.opacity = 0.3 + Math.sin(this.pulseTime * 4 + p.userData.angle) * 0.3;
      }
    } else if (this.type === 'drone') {
      // Pulsing engine exhaust
      for (const ex of this._ambientEffects) {
        const pulseScale = 1 + Math.sin(this.pulseTime * 8) * 0.3;
        ex.scale.set(pulseScale, 1 + Math.sin(this.pulseTime * 6) * 0.5, pulseScale);
        ex.material.opacity = 0.2 + Math.sin(this.pulseTime * 10) * 0.15;
      }
    } else if (this.type === 'stalker') {
      // Shimmer outline pulses with cloak state
      const outline = this._ambientEffects[0];
      if (outline) {
        const shimmer = dist < 15 ? 0.12 + Math.sin(this.pulseTime * 12) * 0.08 : 0.03 + Math.sin(this.pulseTime * 6) * 0.03;
        outline.material.opacity = shimmer;
        outline.rotation.y += delta * 2;
      }
    } else if (this.type === 'spitter') {
      // Acid drip animation
      for (const drip of this._ambientEffects) {
        drip.userData.dripTimer += delta;
        const cycle = drip.userData.dripTimer % 1.5;
        if (cycle < 1.0) {
          drip.position.y = drip.userData.baseY - cycle * 0.4;
          drip.material.opacity = 0.7 * (1 - cycle);
          const s = 1 - cycle * 0.5;
          drip.scale.set(s, 1 + cycle, s);
        } else {
          drip.position.y = drip.userData.baseY;
          drip.material.opacity = 0;
        }
      }
    } else if (this.type === 'swarmer') {
      // Speed trail - trailing particles behind movement direction
      for (const trail of this._ambientEffects) {
        const idx = trail.userData.trailIdx;
        trail.position.set(0, 0.5, -0.2 - idx * 0.15);
        trail.material.opacity = Math.abs(Math.sin(this.pulseTime * 10)) * 0.4 / (idx + 1);
        const s = 0.8 - idx * 0.15;
        trail.scale.set(s, s, s);
      }
    }
  }

  _updateDamageEffects(delta) {
    const hpPct = this.hp / this.maxHp;

    // Spawn damage sparks when below 40% HP. Routed to the additive GPU
    // point field — previously allocated a unique mesh + material per
    // spark (~3 per damaged alien per second), which was a steady
    // background alloc rate during heavy combat.
    if (hpPct < 0.4 && !this.dead && Math.random() < delta * 3) {
      const basePos = this.mesh.position;
      spawnParticle('additive', {
        position: {
          x: basePos.x + (Math.random() - 0.5) * 0.6,
          y: basePos.y + 0.5 + Math.random() * 1.0,
          z: basePos.z + (Math.random() - 0.5) * 0.6,
        },
        velocity: {
          x: (Math.random() - 0.5) * 2,
          y: Math.random() * 3 + 1,
          z: (Math.random() - 0.5) * 2,
        },
        gravity: 5,
        life: 0.3 + Math.random() * 0.2,
        sizeStart: 0.18,
        sizeEnd: 0.04,
        color: hpPct < 0.2 ? 0xff4400 : 0xffaa00,
        alpha: 0.9,
      });
    }
  }

  _gruntBehavior(delta, dist, toPlayer, playerPos) {
    // Move toward player but stop at attack range
    const preferredDist = 15 + Math.sin(this.pulseTime * 0.5) * 5;
    if (dist > preferredDist + 2) {
      const spd = this.data.speed * delta;
      this.mesh.position.x += toPlayer.x * spd;
      this.mesh.position.z += toPlayer.z * spd;
    } else if (dist < preferredDist - 2) {
      const spd = -this.data.speed * 0.5 * delta;
      this.mesh.position.x += toPlayer.x * spd;
      this.mesh.position.z += toPlayer.z * spd;
    }
    // Strafe slightly
    const strafeMag = Math.sin(this.pulseTime * 2) * 2 * delta;
    this.mesh.position.x += -toPlayer.z * strafeMag;
    this.mesh.position.z += toPlayer.x * strafeMag;

    // Shoot
    this.attackCooldown -= delta;
    if (this.attackCooldown <= 0 && dist < this.data.attackRange) {
      this.attackCooldown = this.data.attackRate;
      this._shootAtPlayer(playerPos);
    }
  }

  _swarmerBehavior(delta, dist, toPlayer) {
    // Rush directly at player, zigzag slightly
    const moveSpd = this.data.speed * delta;
    const zigMag = Math.sin(this.pulseTime * 8) * 3 * delta;
    this.mesh.position.x += toPlayer.x * moveSpd + (-toPlayer.z) * zigMag;
    this.mesh.position.z += toPlayer.z * moveSpd + toPlayer.x * zigMag;
    // Bob up and down
    this.mesh.children[0].position.y = 0.5 + Math.sin(this.pulseTime * 10) * 0.05;
  }

  _bloaterBehavior(delta, dist, toPlayer) {
    // Slow approach
    const spd = this.data.speed * delta;
    this.mesh.position.x += toPlayer.x * spd;
    this.mesh.position.z += toPlayer.z * spd;

    // Pulse glow
    const pulseMat = this.mesh.children[1]; // inner glow sphere
    if (pulseMat && pulseMat.material) {
      pulseMat.material.opacity = 0.2 + Math.sin(this.pulseTime * 3) * 0.15;
    }
    // Scale pulse
    const scale = 1 + Math.sin(this.pulseTime * 2) * 0.05;
    this.mesh.children[0].scale.set(scale, scale, scale);
  }

  _stalkerBehavior(delta, dist, toPlayer, playerPos) {
    // Rush at player with zigzag, cloaked
    this._tmpVec.set(-toPlayer.z, 0, toPlayer.x)
      .multiplyScalar(Math.sin(this.pulseTime * 5) * 2 * delta);
    const moveSpeed = this.data.speed * delta;
    this.mesh.position.x += toPlayer.x * moveSpeed + this._tmpVec.x;
    this.mesh.position.z += toPlayer.z * moveSpeed + this._tmpVec.z;

    // Cloaking effect - use cached materials (no traverse)
    const cloakOpacity = dist < 8 ? 0.8 : dist < 20 ? 0.3 : 0.1;
    for (let i = 0, len = this._allMaterials.length; i < len; i++) {
      const mat = this._allMaterials[i];
      mat.transparent = true;
      mat.opacity = cloakOpacity;
    }
  }

  _spitterBehavior(delta, dist, toPlayer, playerPos) {
    // Stay far away, like a sniper
    const preferredDist = 35;
    if (dist > preferredDist + 5) {
      const spd = this.data.speed * delta;
      this.mesh.position.x += toPlayer.x * spd;
      this.mesh.position.z += toPlayer.z * spd;
    } else if (dist < preferredDist - 5) {
      const spd = -this.data.speed * delta;
      this.mesh.position.x += toPlayer.x * spd;
      this.mesh.position.z += toPlayer.z * spd;
    }
    // Slow strafe
    const strafeMag = Math.sin(this.pulseTime * 1.5) * 1.5 * delta;
    this.mesh.position.x += -toPlayer.z * strafeMag;
    this.mesh.position.z += toPlayer.x * strafeMag;

    // Shoot acid
    this.attackCooldown -= delta;
    if (this.attackCooldown <= 0 && dist < this.data.attackRange) {
      this.attackCooldown = this.data.attackRate;
      this._shootAtPlayer(playerPos);
    }
  }

  _droneBehavior(delta, dist, toPlayer, playerPos) {
    // Fly at fixed height
    const targetY = this.data.flyHeight || 6;
    this.mesh.position.y += (targetY - this.mesh.position.y) * 3 * delta;

    // Circle/strafe around player
    const strafeMag = Math.sin(this.pulseTime * 2) * 3 * delta;
    this.mesh.position.x += -toPlayer.z * strafeMag;
    this.mesh.position.z += toPlayer.x * strafeMag;

    // Approach to preferred range
    const preferredDist = 20;
    if (dist > preferredDist + 5) {
      const spd = this.data.speed * delta;
      this.mesh.position.x += toPlayer.x * spd;
      this.mesh.position.z += toPlayer.z * spd;
    } else if (dist < preferredDist - 5) {
      const spd = -this.data.speed * 0.5 * delta;
      this.mesh.position.x += toPlayer.x * spd;
      this.mesh.position.z += toPlayer.z * spd;
    }

    // Bob up and down
    this.mesh.position.y += Math.sin(this.pulseTime * 4) * 0.5 * delta;

    // Burst fire — 3 rapid shots with slight spread
    this.attackCooldown -= delta;
    if (this.attackCooldown <= 0 && dist < this.data.attackRange) {
      this.attackCooldown = this.data.attackRate;
      this._burstFire(playerPos, 3, 0.08);
    }
  }

  _burstFire(playerPos, count, interval) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        if (this.dead) return;
        this._shootAtPlayer(playerPos);
      }, i * interval * 1000);
    }
  }

  _shootAtPlayer(playerPos) {
    this.audio.playAlienShoot();
    const from = new THREE.Vector3().copy(this.mesh.position);
    from.y += this.type === 'drone' ? 0 : 1.2;
    const speed = this.type === 'spitter' ? 22 : (this.type === 'drone' ? 42 : 30);
    const bolt = this.particles.createAlienBolt(from, playerPos, speed, this.type);
    // Spitter acid lobs with gravity
    if (this.type === 'spitter') {
      bolt.gravity = 4;
      bolt.direction.y += 0.35;
      bolt.direction.normalize();
    }
    this.projectiles.push(bolt);
    this._attackRecoil = 0.25;
  }

  _updateProjectiles(delta, playerPos) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bolt = this.projectiles[i];
      // Gravity (spitter acid arc)
      if (bolt.gravity) {
        bolt.direction.y -= bolt.gravity * delta;
      }
      const bSpd = bolt.speed * delta;
      bolt.mesh.position.x += bolt.direction.x * bSpd;
      bolt.mesh.position.y += bolt.direction.y * bSpd;
      bolt.mesh.position.z += bolt.direction.z * bSpd;
      if (bolt.gravity) bolt.mesh.lookAt(
        bolt.mesh.position.x + bolt.direction.x,
        bolt.mesh.position.y + bolt.direction.y,
        bolt.mesh.position.z + bolt.direction.z
      );
      bolt.life -= delta;

      if (bolt.life <= 0) {
        this.scene.remove(bolt.mesh);
        disposeTree(bolt.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      // Do NOT check player hits here - let checkPlayerCollision handle it
    }
  }

  takeDamage(amount) {
    if (this.dead) return false;
    this.hp -= amount;
    this.audio.playAlienHit();

    // Flash white with proper recovery using stored emissive colors
    for (const entry of this._originalEmissives) {
      entry.mat.emissive.set(0xffffff);
    }
    this.hitFlashTimer = 0.1;

    // Hit punch + flinch — handled by _updateAnimation so it composes with
    // the breathing scale and lean state instead of fighting setTimeout.
    this._hitPunch = 0.08;
    this._hitFlinch = 0.2;

    // Knockback proportional to damage; heavier aliens resist more
    const mass = { bloater: 3, swarmer: 0.5, drone: 0.7, stalker: 0.8 }[this.type] || 1;
    this._knockback = Math.min(15, amount * 0.12 / mass);

    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.dead = true;
    this.deathTimer = 1.0;
    this.audio.playAlienDeath();

    // Clean up projectiles (dispose their GPU buffers)
    this.projectiles.forEach(p => {
      this.scene.remove(p.mesh);
      disposeTree(p.mesh);
    });
    this.projectiles = [];

    // Type-specific death behavior
    if (this.type === 'bloater') {
      this.particles.createExplosion(this.mesh.position, 0xff4400, 6, 1.0);
      this.audio.playExplosion();
      this.deathTimer = 0.1;
    } else if (this.type === 'swarmer') {
      this.deathTimer = 0.4;
    } else if (this.type === 'drone') {
      this.particles.createExplosion(this.mesh.position, 0x4488ff, 2, 0.4);
      this.deathTimer = 0.8;
    } else if (this.type === 'stalker') {
      for (let i = 0, len = this._allMaterials.length; i < len; i++) {
        this._allMaterials[i].opacity = 1;
      }
      this.deathTimer = 0.6;
    }
  }

  checkPlayerCollision(playerPos, delta) {
    if (this.dead) return null;
    // Use squared distance to avoid sqrt
    const distSq = this.mesh.position.distanceToSquared(playerPos);
    const attackRangeSq = this.data.attackRange * this.data.attackRange;

    // Swarmer/Stalker melee attack
    if ((this.type === 'swarmer' || this.type === 'stalker') && distSq < attackRangeSq) {
      this.meleeCooldown = (this.meleeCooldown || 0) - (delta || 0.016);
      if (this.meleeCooldown <= 0) {
        this.meleeCooldown = this.data.attackRate;
        this.audio.playAlienGrowl();
        return { damage: this.data.damage, type: 'melee' };
      }
    }

    // Bloater explosion
    if (this.type === 'bloater' && distSq < attackRangeSq) {
      this.die();
      return { damage: this.data.damage, type: 'explosion', radius: this.data.explosionRadius };
    }

    // Check projectile hits (this is the authoritative check)
    const hitRadiusSq = 1.5 * 1.5;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bolt = this.projectiles[i];
      if (bolt.mesh.position.distanceToSquared(playerPos) < hitRadiusSq) {
        const dmg = bolt.damage;
        this.scene.remove(bolt.mesh);
        disposeTree(bolt.mesh);
        this.projectiles.splice(i, 1);
        return { damage: dmg, type: 'projectile' };
      }
    }

    return null;
  }

  cleanup() {
    this.projectiles.forEach(p => {
      this.scene.remove(p.mesh);
      disposeTree(p.mesh);
    });
    this.projectiles = [];
    // Damage sparks live in the global particle field — nothing to dispose.
    this.scene.remove(this.mesh);
    disposeTree(this.mesh);
  }

  getBoundingSphere() {
    const sizes = { bloater: 1.2, grunt: 0.6, spitter: 0.7, drone: 0.5, stalker: 0.5, swarmer: 0.4 };
    const r = sizes[this.type] || 0.5;
    return { center: this.mesh.position.clone(), radius: r };
  }
}
