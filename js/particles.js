// particles.js - Enhanced laser beams, explosions, muzzle flashes, sword slashes

// Additive glow material: transparent + additive blending for bright HDR-feel
// highlights on lasers, bolts, sparks, muzzle flashes. Depth-write off so they
// stack correctly.
function glowMat(color, opacity = 1.0) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

// ---------------------------------------------------------------------------
// Shared PointLight pool.
//
// Three.js bakes NUM_POINT_LIGHTS as a #define into every MeshPhongMaterial
// shader. Adding or removing a PointLight at runtime changes that macro and
// forces Three to recompile every affected material — hundreds of cars,
// buildings, props, and alien meshes. Each compile stalls the main thread
// for 50–200ms, producing the visible "jitter" when firing rockets or
// triggering explosions.
//
// The fix: pre-allocate a fixed pool of PointLights at scene setup and never
// add/remove more. Effects "borrow" a slot — we reposition it, set color and
// intensity, and schedule decay. NUM_POINT_LIGHTS is constant → zero runtime
// recompiles.
// ---------------------------------------------------------------------------
const _poolSlots = [];
const POOL_SIZE = 6;

export function initLightPool(scene) {
  // Remove any lights from a previous scene/level
  for (const slot of _poolSlots) {
    if (slot.light.parent) slot.light.parent.remove(slot.light);
  }
  _poolSlots.length = 0;
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 10);
    light.visible = false;
    scene.add(light);
    _poolSlots.push({
      light,
      life: 0,
      maxLife: 0,
      baseIntensity: 0,
      inUse: false,
    });
  }
}

export function borrowLight(position, color, intensity, distance, duration) {
  if (_poolSlots.length === 0) return null;
  // Prefer an idle slot; otherwise steal the slot with the least life left.
  let slot = null;
  for (let i = 0; i < _poolSlots.length; i++) {
    if (!_poolSlots[i].inUse) { slot = _poolSlots[i]; break; }
  }
  if (!slot) {
    let minLife = Infinity;
    for (let i = 0; i < _poolSlots.length; i++) {
      if (_poolSlots[i].life < minLife) {
        minLife = _poolSlots[i].life;
        slot = _poolSlots[i];
      }
    }
  }
  const light = slot.light;
  light.color.setHex(color);
  light.distance = distance;
  light.intensity = intensity;
  light.position.copy(position);
  light.visible = true;
  slot.life = duration;
  slot.maxLife = duration;
  slot.baseIntensity = intensity;
  slot.inUse = true;
  return light;
}

export function updateLightPool(delta) {
  for (let i = 0; i < _poolSlots.length; i++) {
    const slot = _poolSlots[i];
    if (!slot.inUse) continue;
    slot.life -= delta;
    if (slot.life <= 0) {
      slot.light.intensity = 0;
      slot.light.visible = false;
      slot.inUse = false;
    } else {
      const t = slot.life / slot.maxLife;
      slot.light.intensity = slot.baseIntensity * t;
    }
  }
}

// Recursively dispose all geometries and materials in a subtree. Essential to
// prevent GPU buffer leaks: Three.js does NOT auto-free GPU resources when a
// mesh is removed from the scene — you must dispose() explicitly. Without this
// the game leaks VBOs/textures on every shot, causing frame rate to degrade.
export function disposeTree(obj) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.geometry && !child.geometry.__shared) {
      child.geometry.dispose();
    }
    const mat = child.material;
    if (mat) {
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m && !m.__shared) m.dispose();
        }
      } else if (!mat.__shared) {
        mat.dispose();
      }
    }
  });
}

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.beams = [];
    this.explosions = [];
    this.muzzleFlashes = [];
    this.impacts = [];
  }

  createLaserBeam(from, to, color = 0xff0000, duration = 0.1, width = 0.03) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();

    // Core beam - bright white center (additive)
    const coreGeo = new THREE.CylinderGeometry(width, width, len, 8);
    coreGeo.rotateX(Math.PI / 2);
    const core = new THREE.Mesh(coreGeo, glowMat(0xffffff, 1.0));
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    core.position.copy(mid);
    core.lookAt(to);

    // Inner glow layer
    const innerGeo = new THREE.CylinderGeometry(width * 2.5, width * 2.5, len, 8);
    innerGeo.rotateX(Math.PI / 2);
    core.add(new THREE.Mesh(innerGeo, glowMat(color, 0.7)));

    // Outer glow layer
    const outerGeo = new THREE.CylinderGeometry(width * 5, width * 5, len, 8);
    outerGeo.rotateX(Math.PI / 2);
    core.add(new THREE.Mesh(outerGeo, glowMat(color, 0.22)));

    this.scene.add(core);
    this.beams.push({ mesh: core, life: duration, maxLife: duration });

    // Impact sparkle at hit point
    this._createImpactSparks(to, color, duration * 2.5);

    return core;
  }

  _createImpactSparks(position, color, duration) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Central flash
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      glowMat(0xffffff, 1)
    );
    group.add(flash);

    // Spark rays that fly outward
    const sparks = [];
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, 0.12),
        glowMat(color, 0.95)
      );
      spark.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      spark.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6,
        (Math.random() - 0.5) * 8
      );
      group.add(spark);
      sparks.push(spark);
    }

    this.scene.add(group);
    this.impacts.push({ group, flash, sparks, life: duration, maxLife: duration });
  }

  createAlienBolt(from, to, speed = 30, alienType = 'grunt') {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const boltGroup = new THREE.Group();

    // Different bolt styles per alien type
    if (alienType === 'spitter') {
      // Acid glob - larger, dripping, yellow-green
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 8),
        glowMat(0xccff33, 1)
      );
      core.scale.set(0.8, 1, 1.5);
      boltGroup.add(core);
      const innerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 8, 8),
        glowMat(0x88cc00, 0.6)
      );
      boltGroup.add(innerGlow);
      const outerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 6, 6),
        glowMat(0x66aa00, 0.2)
      );
      boltGroup.add(outerGlow);
      // Dripping acid trail
      for (let i = 1; i <= 5; i++) {
        const drip = new THREE.Mesh(
          new THREE.SphereGeometry(0.04 + (0.08 / i), 4, 4),
          glowMat(0xaaff00, 0.7 / i)
        );
        drip.position.set((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, -i * 0.2);
        boltGroup.add(drip);
      }
    } else if (alienType === 'drone') {
      // Rapid energy pulse - small, fast, blue-white
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 6),
        glowMat(0xddeeff, 1)
      );
      core.scale.set(1, 1, 3);
      boltGroup.add(core);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 6, 6),
        glowMat(0x4488ff, 0.5)
      );
      glow.scale.set(1, 1, 2);
      boltGroup.add(glow);
      // Electric crackle lines
      for (let i = 0; i < 3; i++) {
        const crackle = new THREE.Mesh(
          new THREE.BoxGeometry(0.015, 0.015, 0.25),
          glowMat(0x88ccff, 0.8)
        );
        crackle.rotation.set(Math.random() * 0.5, 0, Math.random() * Math.PI);
        boltGroup.add(crackle);
      }
    } else {
      // Standard green energy bolt (grunt)
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        glowMat(0xaaffaa, 1)
      );
      core.scale.set(1, 1, 2);
      boltGroup.add(core);
      const innerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 8, 8),
        glowMat(0x00ff00, 0.6)
      );
      innerGlow.scale.set(1, 1, 1.5);
      boltGroup.add(innerGlow);
      const outerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 6, 6),
        glowMat(0x00ff00, 0.2)
      );
      boltGroup.add(outerGlow);
      // Trail particles
      for (let i = 1; i <= 3; i++) {
        const trail = new THREE.Mesh(
          new THREE.SphereGeometry(0.05 / i, 4, 4),
          glowMat(0x00ff00, 0.5 / i)
        );
        trail.position.z = -i * 0.15;
        boltGroup.add(trail);
      }
    }

    boltGroup.position.copy(from);
    boltGroup.lookAt(to);

    this.scene.add(boltGroup);
    const dmg = alienType === 'spitter' ? 20 : (alienType === 'drone' ? 10 : 8);
    return { mesh: boltGroup, direction: dir, speed, life: 3, damage: dmg, alienType };
  }

  // Sniper tracer - slow-fading bright beam with traveling bolt
  createSniperTracer(from, to, color = 0x8800ff) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();

    // Bright core beam
    const coreGeo = new THREE.CylinderGeometry(0.015, 0.015, len, 8);
    coreGeo.rotateX(Math.PI / 2);
    const core = new THREE.Mesh(coreGeo, glowMat(0xffffff, 1));
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    core.position.copy(mid);
    core.lookAt(to);

    // Inner glow
    const innerGeo = new THREE.CylinderGeometry(0.04, 0.04, len, 8);
    innerGeo.rotateX(Math.PI / 2);
    core.add(new THREE.Mesh(innerGeo, glowMat(color, 0.8)));

    // Wide outer glow
    const outerGeo = new THREE.CylinderGeometry(0.1, 0.1, len, 8);
    outerGeo.rotateX(Math.PI / 2);
    core.add(new THREE.Mesh(outerGeo, glowMat(color, 0.18)));

    // Traveling bolt along beam path
    const bolt = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      glowMat(0xffffff, 1)
    );
    bolt.scale.set(1, 1, 4);
    const boltGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 6, 6),
      glowMat(color, 0.6)
    );
    bolt.add(boltGlow);
    bolt.position.copy(from);
    bolt.lookAt(to);

    // Point light on bolt
    const boltLight = new THREE.PointLight(color, 3, 8);
    bolt.add(boltLight);

    this.scene.add(core);
    this.scene.add(bolt);

    this.beams.push({
      mesh: core, life: 0.4, maxLife: 0.4,
      bolt, boltLight, boltFrom: from.clone(), boltTo: to.clone(), boltProgress: 0
    });

    // Impact sparks at hit point
    this._createImpactSparks(to, color, 0.5);
  }

  // Weapon-specific impact effects
  createWeaponImpact(position, weaponType) {
    if (weaponType === 'sniperRifle') {
      this._createSniperImpact(position);
    } else if (weaponType === 'laserSword') {
      this._createSwordImpact(position);
    }
    // laserRifle uses default _createImpactSparks from createLaserBeam
  }

  _createSniperImpact(position) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Large purple flash
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xddaaff, transparent: true, opacity: 1 })
    );
    group.add(flash);

    // Electric arcs radiating outward
    const sparks = [];
    for (let i = 0; i < 8; i++) {
      const arc = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, 0.3 + Math.random() * 0.3),
        new THREE.MeshBasicMaterial({ color: 0xaa66ff, transparent: true, opacity: 0.9 })
      );
      arc.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      arc.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        Math.random() * 4 + 1,
        (Math.random() - 0.5) * 6
      );
      group.add(arc);
      sparks.push(arc);
    }

    // Purple energy ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.03, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.8 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const light = new THREE.PointLight(0x8800ff, 4, 6);
    group.add(light);

    this.scene.add(group);
    this.impacts.push({ group, flash, sparks, ring, light, life: 0.4, maxLife: 0.4, type: 'sniper' });
  }

  _createSwordImpact(position) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Blue energy burst
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 1 })
    );
    group.add(flash);

    // Energy slash lines
    const sparks = [];
    for (let i = 0; i < 5; i++) {
      const slash = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.5 + Math.random() * 0.3, 0.01),
        new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.8 })
      );
      slash.rotation.z = (Math.random() - 0.5) * 1.5;
      slash.velocity = new THREE.Vector3(0, 0, 0);
      group.add(slash);
      sparks.push(slash);
    }

    // Blue sparkle particles
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.03),
        new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.9 })
      );
      spark.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 5,
        Math.random() * 3,
        (Math.random() - 0.5) * 5
      );
      group.add(spark);
      sparks.push(spark);
    }

    const light = new THREE.PointLight(0x0088ff, 5, 6);
    group.add(light);

    this.scene.add(group);
    this.impacts.push({ group, flash, sparks, light, life: 0.3, maxLife: 0.3, type: 'sword' });
  }

  createMegaExplosion(position, size = 7) {
    // Spectacular plasma-rocket detonation: huge flash, multiple shockwaves,
    // plasma core, debris, sparks, and trailing fire.
    const group = new THREE.Group();
    group.position.copy(position);

    const accent = 0x00ffee;
    const hot = 0xffffff;
    const glow = 0x88ffff;

    // === Core flash - very bright white icosahedron ===
    const flashGeo = new THREE.IcosahedronGeometry(size * 0.6, 1);
    const flashMat = new THREE.MeshBasicMaterial({ color: hot, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    group.add(flash);

    // Secondary core - cyan plasma fireball
    const coreGeo = new THREE.SphereGeometry(size * 0.5, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.scale.set(0.2, 0.2, 0.2);
    group.add(core);

    // Outer halo - expands wider
    const haloGeo = new THREE.SphereGeometry(size * 0.9, 14, 14);
    const haloMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.5 });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.scale.set(0.15, 0.15, 0.15);
    group.add(halo);

    // === Multi-layered shockwave rings ===
    const rings = [];
    for (let r = 0; r < 3; r++) {
      const ringGeo = new THREE.TorusGeometry(size * 0.35, 0.12 - r * 0.03, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: r === 0 ? hot : (r === 1 ? accent : glow),
        transparent: true, opacity: 0.85 - r * 0.15,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.scale.set(0.05, 0.05, 0.05);
      ring.userData.delay = r * 0.05;
      group.add(ring);
      rings.push(ring);
    }

    // Vertical shockwave ring (perpendicular)
    const vRingGeo = new THREE.TorusGeometry(size * 0.4, 0.08, 6, 24);
    const vRingMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6 });
    const vRing = new THREE.Mesh(vRingGeo, vRingMat);
    vRing.scale.set(0.05, 0.05, 0.05);
    group.add(vRing);
    rings.push(vRing);

    // Expanding wireframe shell
    const shellGeo = new THREE.IcosahedronGeometry(size, 2);
    const shellMat = new THREE.MeshBasicMaterial({
      color: accent, transparent: true, opacity: 0.5, wireframe: true,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.scale.set(0.1, 0.1, 0.1);
    group.add(shell);

    // Outer electrified wireframe sphere (larger, slower)
    const outerShellGeo = new THREE.SphereGeometry(size * 1.2, 14, 10);
    const outerShellMat = new THREE.MeshBasicMaterial({
      color: glow, transparent: true, opacity: 0.25, wireframe: true,
    });
    const outerShell = new THREE.Mesh(outerShellGeo, outerShellMat);
    outerShell.scale.set(0.1, 0.1, 0.1);
    group.add(outerShell);

    // === Plasma fire particles (cyan-white, many) ===
    const fireParticles = [];
    for (let i = 0; i < 30; i++) {
      const pGeo = new THREE.SphereGeometry(0.2 + Math.random() * 0.25, 6, 6);
      const pMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.4 ? accent : hot,
        transparent: true, opacity: 1,
      });
      const p = new THREE.Mesh(pGeo, pMat);
      const ang = Math.random() * Math.PI * 2;
      const speed = size * (2 + Math.random() * 3);
      p.velocity = new THREE.Vector3(
        Math.cos(ang) * speed,
        Math.random() * size * 4 + 1,
        Math.sin(ang) * speed,
      );
      group.add(p);
      fireParticles.push(p);
    }

    // === Spark streaks (fast, bright, falling) ===
    const sparks = [];
    for (let i = 0; i < 40; i++) {
      const sparkGeo = new THREE.BoxGeometry(0.04, 0.04, 0.25);
      const sparkMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? hot : accent,
        transparent: true, opacity: 1,
      });
      const spark = new THREE.Mesh(sparkGeo, sparkMat);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const spd = size * (4 + Math.random() * 4);
      spark.velocity = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * spd,
        Math.cos(phi) * spd + 2,
        Math.sin(phi) * Math.sin(theta) * spd,
      );
      // Orient spark along its velocity
      spark.lookAt(spark.velocity);
      group.add(spark);
      sparks.push(spark);
    }

    // === Thick dark smoke (rises) ===
    const smokeParticles = [];
    for (let i = 0; i < 18; i++) {
      const sGeo = new THREE.SphereGeometry(0.3, 8, 8);
      const sMat = new THREE.MeshBasicMaterial({
        color: 0x1a1a1a, transparent: true, opacity: 0.75,
      });
      const s = new THREE.Mesh(sGeo, sMat);
      s.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * size * 2,
        Math.random() * size * 3 + 2,
        (Math.random() - 0.5) * size * 2,
      );
      s.growRate = 2 + Math.random() * 3;
      group.add(s);
      smokeParticles.push(s);
    }

    // === Debris chunks ===
    const particles = [];
    const debrisShapes = [
      () => new THREE.BoxGeometry(0.18, 0.18, 0.18),
      () => new THREE.TetrahedronGeometry(0.15),
      () => new THREE.BoxGeometry(0.25, 0.08, 0.08),
      () => new THREE.OctahedronGeometry(0.12),
    ];
    for (let i = 0; i < 25; i++) {
      const pGeo = debrisShapes[Math.floor(Math.random() * debrisShapes.length)]();
      const pMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? accent : 0xffaa00,
        transparent: true, opacity: 1,
      });
      const p = new THREE.Mesh(pGeo, pMat);
      p.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * size * 6,
        Math.random() * size * 5,
        (Math.random() - 0.5) * size * 6,
      );
      p.rotSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
        (Math.random() - 0.5) * 15,
      );
      group.add(p);
      particles.push(p);
    }

    // === Ground scorch decal (larger) ===
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(size * 1.3, 20),
      new THREE.MeshBasicMaterial({ color: 0x050510, transparent: true, opacity: 0.7 })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = -position.y + 0.03;
    group.add(scorch);
    // Scorch glow ring inside the burn mark
    const scorchGlow = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.4, size * 1.2, 20),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35 })
    );
    scorchGlow.rotation.x = -Math.PI / 2;
    scorchGlow.position.y = -position.y + 0.035;
    group.add(scorchGlow);

    // === Bright point light ===
    const light = new THREE.PointLight(accent, 18, size * 10);
    group.add(light);
    // Secondary hot core light
    const hotLight = new THREE.PointLight(hot, 12, size * 6);
    group.add(hotLight);

    this.scene.add(group);
    this.explosions.push({
      group, flash, fireball: core, halo, ring: rings[0], rings, vRing,
      sphere: shell, outerShell,
      fireParticles, smokeParticles, particles, sparks, scorch, scorchGlow,
      light, hotLight,
      life: 1.4, maxLife: 1.4, size,
      isMega: true,
    });
  }

  createExplosion(position, color = 0xff4400, size = 3, duration = 0.5) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Central flash - bright icosahedron
    const flashGeo = new THREE.IcosahedronGeometry(size * 0.5, 1);
    const flash = new THREE.Mesh(flashGeo, glowMat(0xffffcc, 1));
    group.add(flash);

    // Inner fireball
    const fireGeo = new THREE.SphereGeometry(size * 0.4, 12, 12);
    const fireball = new THREE.Mesh(fireGeo, glowMat(0xff8800, 1));
    fireball.scale.set(0.3, 0.3, 0.3);
    group.add(fireball);

    // Expanding shockwave ring
    const ringGeo = new THREE.TorusGeometry(size * 0.3, 0.08, 6, 24);
    const ring = new THREE.Mesh(ringGeo, glowMat(0xffaa44, 0.9));
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(0.1, 0.1, 0.1);
    group.add(ring);

    // Expanding wireframe sphere
    const sphereGeo = new THREE.SphereGeometry(size, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5, wireframe: true,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.scale.set(0.1, 0.1, 0.1);
    group.add(sphere);

    // Fire particles (rise up and shrink)
    const fireParticles = [];
    for (let i = 0; i < 12; i++) {
      const pGeo = new THREE.SphereGeometry(0.15 + Math.random() * 0.15, 6, 6);
      const pMat = glowMat(Math.random() > 0.5 ? 0xff6600 : 0xff2200, 1);
      const p = new THREE.Mesh(pGeo, pMat);
      p.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * size * 3,
        Math.random() * size * 4 + 2,
        (Math.random() - 0.5) * size * 3
      );
      group.add(p);
      fireParticles.push(p);
    }

    // Smoke particles (dark, expand slowly, rise)
    const smokeParticles = [];
    for (let i = 0; i < 8; i++) {
      const sGeo = new THREE.SphereGeometry(0.2, 6, 6);
      const sMat = new THREE.MeshBasicMaterial({
        color: 0x222222, transparent: true, opacity: 0.6
      });
      const s = new THREE.Mesh(sGeo, sMat);
      s.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * size * 1.5,
        Math.random() * size * 2 + 1,
        (Math.random() - 0.5) * size * 1.5
      );
      s.growRate = 1 + Math.random() * 2;
      group.add(s);
      smokeParticles.push(s);
    }

    // Debris particles (angular chunks with spin)
    const particles = [];
    const debrisShapes = [
      () => new THREE.BoxGeometry(0.1, 0.1, 0.1),
      () => new THREE.TetrahedronGeometry(0.08),
      () => new THREE.BoxGeometry(0.15, 0.05, 0.05),
    ];
    for (let i = 0; i < 15; i++) {
      const pGeo = debrisShapes[Math.floor(Math.random() * debrisShapes.length)]();
      const pMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? color : 0xffff00,
        transparent: true, opacity: 1
      });
      const p = new THREE.Mesh(pGeo, pMat);
      p.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * size * 5,
        Math.random() * size * 4,
        (Math.random() - 0.5) * size * 5
      );
      p.rotSpeed = new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10);
      group.add(p);
      particles.push(p);
    }

    // Ground scorch decal
    const scorch = new THREE.Mesh(
      new THREE.CircleGeometry(size * 0.8, 16),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.5 })
    );
    scorch.rotation.x = -Math.PI / 2;
    scorch.position.y = -position.y + 0.02;
    group.add(scorch);

    // Bright light
    const light = new THREE.PointLight(color, 8, size * 8);
    group.add(light);

    this.scene.add(group);
    this.explosions.push({
      group, flash, fireball, ring, sphere, fireParticles, smokeParticles, particles, scorch, light,
      life: duration, maxLife: duration, size
    });
  }

  createMuzzleFlash(position, direction, color = 0xff0000) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Flash cone
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 6),
      glowMat(0xffffff, 1.0)
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = 0.15;
    group.add(cone);

    // Flash sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      glowMat(color, 0.9)
    );
    group.add(sphere);

    // Star flare planes (cross pattern)
    for (let i = 0; i < 3; i++) {
      const flare = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.05),
        glowMat(color, 0.75)
      );
      flare.material.side = THREE.DoubleSide;
      flare.rotation.z = (i / 3) * Math.PI;
      group.add(flare);
    }

    // Orient to face direction
    const target = position.clone().add(direction);
    group.lookAt(target);

    // Point light
    const light = new THREE.PointLight(color, 5, 8);
    group.add(light);

    this.scene.add(group);
    this.muzzleFlashes.push({ group, life: 0.06 });
  }

  createSwordSlash(camera, color = 0x0088ff) {
    const group = new THREE.Group();

    // Main arc - bright edge
    const mainGeo = new THREE.TorusGeometry(1.2, 0.04, 4, 20, Math.PI);
    group.add(new THREE.Mesh(mainGeo, glowMat(0xaaddff, 1.0)));

    // Inner arc - white core
    const innerGeo = new THREE.TorusGeometry(1.2, 0.015, 4, 20, Math.PI);
    group.add(new THREE.Mesh(innerGeo, glowMat(0xffffff, 1.0)));

    // Trailing glow arcs
    for (let i = 1; i <= 2; i++) {
      const trailGeo = new THREE.TorusGeometry(1.2, 0.04 + i * 0.04, 4, 16, Math.PI);
      const trail = new THREE.Mesh(trailGeo, glowMat(color, 0.5 / i));
      trail.rotation.z = i * 0.08;
      group.add(trail);
    }

    // Sparkle particles along the arc
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI;
      const sparkle = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.03),
        glowMat(0xffffff, 1.0)
      );
      sparkle.position.set(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, 0);
      group.add(sparkle);
    }

    const pos = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    pos.add(dir.multiplyScalar(1.5));
    pos.y -= 0.3;
    group.position.copy(pos);
    group.quaternion.copy(camera.quaternion);
    this.scene.add(group);
    this.beams.push({ mesh: group, life: 0.2, maxLife: 0.2 });
  }

  update(delta) {
    // Update beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= delta;
      const alpha = Math.max(0, b.life / b.maxLife);
      if (b.mesh.material) {
        b.mesh.material.opacity = alpha;
      }
      // Update child materials directly via children array (no traverse)
      const children = b.mesh.children;
      for (let ci = 0, clen = children.length; ci < clen; ci++) {
        const child = children[ci];
        if (child.material && child.material.transparent) {
          child.material.opacity = alpha;
        }
      }

      // Sniper tracer bolt animation
      if (b.bolt) {
        b.boltProgress = Math.min(1, b.boltProgress + delta * 8);
        b.bolt.position.lerpVectors(b.boltFrom, b.boltTo, b.boltProgress);
        if (b.boltLight) b.boltLight.intensity = Math.max(0, 3 * (1 - b.boltProgress));
        const boltAlpha = Math.max(0, 1 - b.boltProgress);
        const boltChildren = b.bolt.children;
        for (let bi = 0, blen = boltChildren.length; bi < blen; bi++) {
          const bc = boltChildren[bi];
          if (bc.material && bc.material.transparent) {
            bc.material.opacity = boltAlpha;
          }
        }
        if (b.bolt.material && b.bolt.material.transparent) {
          b.bolt.material.opacity = boltAlpha;
        }
        if (b.boltProgress >= 1 || b.life <= 0) {
          this.scene.remove(b.bolt);
          disposeTree(b.bolt);
          b.bolt = null;
        }
      }

      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        disposeTree(b.mesh);
        if (b.bolt) {
          this.scene.remove(b.bolt);
          disposeTree(b.bolt);
        }
        this.beams.splice(i, 1);
      }
    }

    // Update impacts
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const imp = this.impacts[i];
      imp.life -= delta;
      const progress = 1 - imp.life / imp.maxLife;

      if (imp.flash) {
        imp.flash.material.opacity = Math.max(0, 1 - progress * 3);
        const s = 1 + progress * (imp.type === 'sniper' ? 2 : 1);
        imp.flash.scale.set(s, s, s);
      }
      for (let si = 0, slen = imp.sparks.length; si < slen; si++) {
        const spark = imp.sparks[si];
        if (spark.velocity && (spark.velocity.x || spark.velocity.y || spark.velocity.z)) {
          spark.position.x += spark.velocity.x * delta;
          spark.position.y += spark.velocity.y * delta;
          spark.position.z += spark.velocity.z * delta;
          spark.velocity.y -= 15 * delta;
        }
        spark.material.opacity = Math.max(0, 1 - progress);
      }
      // Sniper impact ring expansion
      if (imp.ring) {
        const rs = 1 + progress * 4;
        imp.ring.scale.set(rs, rs, rs);
        imp.ring.material.opacity = Math.max(0, 0.8 * (1 - progress));
      }
      // Impact light fade
      if (imp.light) {
        imp.light.intensity = Math.max(0, (imp.light.intensity || 4) * (1 - progress));
      }

      if (imp.life <= 0) {
        this.scene.remove(imp.group);
        disposeTree(imp.group);
        this.impacts.splice(i, 1);
      }
    }

    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= delta;
      const progress = 1 - e.life / e.maxLife;

      // Flash fades fast - slower fade for mega explosions
      const flashFade = e.isMega ? 2.2 : 3;
      e.flash.material.opacity = Math.max(0, 1 - progress * flashFade);
      const flashS = e.isMega ? (0.5 + progress * 2.5) : (1 + progress * 0.5);
      e.flash.scale.set(flashS, flashS, flashS);

      // Mega halo expansion
      if (e.halo) {
        const haloS = 0.15 + progress * 3;
        e.halo.scale.set(haloS, haloS, haloS);
        e.halo.material.opacity = Math.max(0, 0.5 * (1 - progress * 1.8));
      }
      // Extra shockwave rings
      if (e.rings) {
        for (let ri = 0; ri < e.rings.length; ri++) {
          const r = e.rings[ri];
          const pr = Math.max(0, (progress - (r.userData.delay || 0)) * 1.5);
          const rs = 0.05 + pr * 5;
          if (ri < 3) {
            r.scale.set(rs, rs, rs * 0.2);
          } else {
            r.scale.set(rs, rs, rs);
            r.rotation.y += delta * 2;
          }
          r.material.opacity = Math.max(0, (r.material.userData?.base ?? 0.85) * (1 - pr));
          if (!r.material.userData.base) r.material.userData.base = r.material.opacity / Math.max(0.01, (1 - pr));
        }
      }
      // Outer wireframe shell
      if (e.outerShell) {
        const os = 0.1 + progress * 2.5;
        e.outerShell.scale.set(os, os, os);
        e.outerShell.material.opacity = Math.max(0, 0.25 * (1 - progress));
        e.outerShell.rotation.x += delta * 0.5;
        e.outerShell.rotation.y += delta * 0.7;
      }
      // Scorch glow ring
      if (e.scorchGlow) {
        e.scorchGlow.material.opacity = Math.min(0.35, progress * 1.5) * (1 - Math.max(0, progress - 0.7) * 3);
      }
      // Sparks
      if (e.sparks) {
        for (let si = 0; si < e.sparks.length; si++) {
          const sp = e.sparks[si];
          sp.position.x += sp.velocity.x * delta;
          sp.position.y += sp.velocity.y * delta;
          sp.position.z += sp.velocity.z * delta;
          sp.velocity.y -= 20 * delta;
          sp.lookAt(
            sp.position.x + sp.velocity.x,
            sp.position.y + sp.velocity.y,
            sp.position.z + sp.velocity.z
          );
          sp.material.opacity = Math.max(0, 1 - progress * 1.5);
        }
      }
      // Hot core light
      if (e.hotLight) {
        e.hotLight.intensity = Math.max(0, 12 * (1 - progress * 2));
      }

      // Fireball expands then fades
      if (e.fireball) {
        const fbS = 0.3 + progress * 2;
        e.fireball.scale.set(fbS, fbS, fbS);
        e.fireball.material.opacity = Math.max(0, 0.8 * (1 - progress * 1.5));
      }

      // Shockwave ring expands fast
      if (e.ring) {
        const rs = progress * 4;
        e.ring.scale.set(rs, rs, rs * 0.3);
        e.ring.material.opacity = Math.max(0, 0.7 * (1 - progress));
      }

      // Wireframe sphere expands
      const s = progress * 2;
      e.sphere.scale.set(s, s, s);
      e.sphere.material.opacity = Math.max(0, 0.4 * (1 - progress));

      // Light fades
      e.light.intensity = Math.max(0, 8 * (1 - progress));

      // Fire particles rise and shrink
      if (e.fireParticles) {
        for (let fi = 0, flen = e.fireParticles.length; fi < flen; fi++) {
          const p = e.fireParticles[fi];
          p.position.x += p.velocity.x * delta;
          p.position.y += p.velocity.y * delta;
          p.position.z += p.velocity.z * delta;
          p.velocity.y -= 3 * delta;
          p.material.opacity = Math.max(0, 1 - progress * 1.5);
          const ps = Math.max(0.1, 1 - progress);
          p.scale.set(ps, ps, ps);
        }
      }

      // Smoke particles rise slowly and expand
      if (e.smokeParticles) {
        const halfDelta = delta * 0.5;
        for (let si = 0, slen = e.smokeParticles.length; si < slen; si++) {
          const sm = e.smokeParticles[si];
          sm.position.x += sm.velocity.x * halfDelta;
          sm.position.y += sm.velocity.y * halfDelta;
          sm.position.z += sm.velocity.z * halfDelta;
          sm.velocity.y -= 1 * delta;
          sm.material.opacity = Math.max(0, 0.6 * (1 - progress * 0.8));
          const grow = 1 + progress * sm.growRate;
          sm.scale.set(grow, grow, grow);
        }
      }

      // Debris particles fall with gravity and spin
      for (let di = 0, dlen = e.particles.length; di < dlen; di++) {
        const p = e.particles[di];
        p.position.x += p.velocity.x * delta;
        p.position.y += p.velocity.y * delta;
        p.position.z += p.velocity.z * delta;
        p.velocity.y -= 12 * delta;
        p.material.opacity = Math.max(0, 1 - progress);
        if (p.rotSpeed) {
          p.rotation.x += p.rotSpeed.x * delta;
          p.rotation.y += p.rotSpeed.y * delta;
          p.rotation.z += p.rotSpeed.z * delta;
        }
      }

      // Scorch fades in then out
      if (e.scorch) {
        e.scorch.material.opacity = Math.min(0.5, progress * 2) * (1 - Math.max(0, progress - 0.8) * 5);
      }

      if (e.life <= 0) {
        this.scene.remove(e.group);
        disposeTree(e.group);
        this.explosions.splice(i, 1);
      }
    }

    // Update muzzle flashes
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const m = this.muzzleFlashes[i];
      m.life -= delta;
      if (m.life <= 0) {
        if (m.group) {
          this.scene.remove(m.group);
          disposeTree(m.group);
        } else if (m.light) {
          this.scene.remove(m.light);
        }
        this.muzzleFlashes.splice(i, 1);
      }
    }
  }

  cleanup() {
    this.beams.forEach(b => {
      this.scene.remove(b.mesh);
      disposeTree(b.mesh);
      if (b.bolt) {
        this.scene.remove(b.bolt);
        disposeTree(b.bolt);
      }
    });
    this.explosions.forEach(e => {
      this.scene.remove(e.group);
      disposeTree(e.group);
    });
    this.muzzleFlashes.forEach(m => {
      if (m.group) {
        this.scene.remove(m.group);
        disposeTree(m.group);
      } else if (m.light) {
        this.scene.remove(m.light);
      }
    });
    this.impacts.forEach(imp => {
      this.scene.remove(imp.group);
      disposeTree(imp.group);
    });
    this.beams = [];
    this.explosions = [];
    this.muzzleFlashes = [];
    this.impacts = [];
  }
}
