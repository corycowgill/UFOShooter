// particles.js - Enhanced laser beams, explosions, muzzle flashes, sword slashes
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

    // Core beam - bright white center
    const coreGeo = new THREE.CylinderGeometry(width, width, len, 8);
    coreGeo.rotateX(Math.PI / 2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    core.position.copy(mid);
    core.lookAt(to);

    // Inner glow layer
    const innerGeo = new THREE.CylinderGeometry(width * 2.5, width * 2.5, len, 8);
    innerGeo.rotateX(Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
    });
    core.add(new THREE.Mesh(innerGeo, innerMat));

    // Outer glow layer
    const outerGeo = new THREE.CylinderGeometry(width * 5, width * 5, len, 8);
    outerGeo.rotateX(Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15,
    });
    core.add(new THREE.Mesh(outerGeo, outerMat));

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
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
    );
    group.add(flash);

    // Spark rays that fly outward
    const sparks = [];
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, 0.12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
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

  createAlienBolt(from, to, speed = 30) {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();

    // Elongated bolt with glow layers and trail
    const boltGroup = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x66ff66 })
    );
    core.scale.set(1, 1, 2);
    boltGroup.add(core);

    // Inner glow
    const innerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.5 })
    );
    innerGlow.scale.set(1, 1, 1.5);
    boltGroup.add(innerGlow);

    // Outer glow
    const outerGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.15 })
    );
    boltGroup.add(outerGlow);

    // Trail particles
    for (let i = 1; i <= 3; i++) {
      const trail = new THREE.Mesh(
        new THREE.SphereGeometry(0.05 / i, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.4 / i })
      );
      trail.position.z = -i * 0.15;
      boltGroup.add(trail);
    }

    boltGroup.position.copy(from);
    boltGroup.lookAt(to);

    this.scene.add(boltGroup);
    return { mesh: boltGroup, direction: dir, speed, life: 3, damage: 8 };
  }

  createExplosion(position, color = 0xff4400, size = 3, duration = 0.5) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Central flash - bright icosahedron
    const flashGeo = new THREE.IcosahedronGeometry(size * 0.5, 1);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    group.add(flash);

    // Inner fireball
    const fireGeo = new THREE.SphereGeometry(size * 0.4, 12, 12);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.8 });
    const fireball = new THREE.Mesh(fireGeo, fireMat);
    fireball.scale.set(0.3, 0.3, 0.3);
    group.add(fireball);

    // Expanding shockwave ring
    const ringGeo = new THREE.TorusGeometry(size * 0.3, 0.08, 6, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.7 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.set(0.1, 0.1, 0.1);
    group.add(ring);

    // Expanding wireframe sphere
    const sphereGeo = new THREE.SphereGeometry(size, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.4, wireframe: true });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.scale.set(0.1, 0.1, 0.1);
    group.add(sphere);

    // Fire particles (rise up and shrink)
    const fireParticles = [];
    for (let i = 0; i < 12; i++) {
      const pGeo = new THREE.SphereGeometry(0.15 + Math.random() * 0.15, 6, 6);
      const pMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? 0xff6600 : 0xff2200,
        transparent: true, opacity: 1
      });
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
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 })
    );
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = 0.15;
    group.add(cone);

    // Flash sphere
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })
    );
    group.add(sphere);

    // Star flare planes (cross pattern)
    for (let i = 0; i < 3; i++) {
      const flare = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.05),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
      );
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
    const mainMat = new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.9 });
    group.add(new THREE.Mesh(mainGeo, mainMat));

    // Inner arc - white core
    const innerGeo = new THREE.TorusGeometry(1.2, 0.015, 4, 20, Math.PI);
    const innerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
    group.add(new THREE.Mesh(innerGeo, innerMat));

    // Trailing glow arcs
    for (let i = 1; i <= 2; i++) {
      const trailGeo = new THREE.TorusGeometry(1.2, 0.04 + i * 0.04, 4, 16, Math.PI);
      const trailMat = new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: 0.4 / i
      });
      const trail = new THREE.Mesh(trailGeo, trailMat);
      trail.rotation.z = i * 0.08;
      group.add(trail);
    }

    // Sparkle particles along the arc
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI;
      const sparkle = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.03, 0.03),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
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
      b.mesh.traverse(child => {
        if (child.material && child.material.transparent) {
          child.material.opacity *= alpha;
        }
      });
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
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
        const s = 1 + progress;
        imp.flash.scale.set(s, s, s);
      }
      for (const spark of imp.sparks) {
        if (spark.velocity) {
          spark.position.add(spark.velocity.clone().multiplyScalar(delta));
          spark.velocity.y -= 15 * delta;
        }
        spark.material.opacity = Math.max(0, 1 - progress);
      }

      if (imp.life <= 0) {
        this.scene.remove(imp.group);
        this.impacts.splice(i, 1);
      }
    }

    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= delta;
      const progress = 1 - e.life / e.maxLife;

      // Flash fades fast
      e.flash.material.opacity = Math.max(0, 1 - progress * 3);
      const flashS = 1 + progress * 0.5;
      e.flash.scale.set(flashS, flashS, flashS);

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
        for (const p of e.fireParticles) {
          p.position.add(p.velocity.clone().multiplyScalar(delta));
          p.velocity.y -= 3 * delta;
          p.material.opacity = Math.max(0, 1 - progress * 1.5);
          const ps = Math.max(0.1, 1 - progress);
          p.scale.set(ps, ps, ps);
        }
      }

      // Smoke particles rise slowly and expand
      if (e.smokeParticles) {
        for (const sm of e.smokeParticles) {
          sm.position.add(sm.velocity.clone().multiplyScalar(delta * 0.5));
          sm.velocity.y -= 1 * delta;
          sm.material.opacity = Math.max(0, 0.6 * (1 - progress * 0.8));
          const grow = 1 + progress * sm.growRate;
          sm.scale.set(grow, grow, grow);
        }
      }

      // Debris particles fall with gravity and spin
      for (const p of e.particles) {
        p.position.add(p.velocity.clone().multiplyScalar(delta));
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
        this.explosions.splice(i, 1);
      }
    }

    // Update muzzle flashes
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const m = this.muzzleFlashes[i];
      m.life -= delta;
      if (m.life <= 0) {
        if (m.group) this.scene.remove(m.group);
        else if (m.light) this.scene.remove(m.light);
        this.muzzleFlashes.splice(i, 1);
      }
    }
  }

  cleanup() {
    this.beams.forEach(b => this.scene.remove(b.mesh));
    this.explosions.forEach(e => this.scene.remove(e.group));
    this.muzzleFlashes.forEach(m => {
      if (m.group) this.scene.remove(m.group);
      else if (m.light) this.scene.remove(m.light);
    });
    this.impacts.forEach(imp => this.scene.remove(imp.group));
    this.beams = [];
    this.explosions = [];
    this.muzzleFlashes = [];
    this.impacts = [];
  }
}
