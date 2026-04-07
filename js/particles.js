// particles.js - Laser beams, explosions, muzzle flashes
export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.beams = [];
    this.explosions = [];
    this.muzzleFlashes = [];
  }

  createLaserBeam(from, to, color = 0xff0000, duration = 0.1, width = 0.03) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(width, width, len, 4);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.9,
    });
    const beam = new THREE.Mesh(geo, mat);
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    beam.position.copy(mid);
    beam.lookAt(to);

    // Glow
    const glowGeo = new THREE.CylinderGeometry(width * 3, width * 3, len, 4);
    glowGeo.rotateX(Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.2,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    beam.add(glow);

    this.scene.add(beam);
    this.beams.push({ mesh: beam, life: duration, maxLife: duration });
    return beam;
  }

  createAlienBolt(from, to, speed = 30) {
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    const geo = new THREE.SphereGeometry(0.1, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const bolt = new THREE.Mesh(geo, mat);
    bolt.position.copy(from);

    // Glow
    const glowGeo = new THREE.SphereGeometry(0.25, 6, 6);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3 });
    bolt.add(new THREE.Mesh(glowGeo, glowMat));

    this.scene.add(bolt);
    return { mesh: bolt, direction: dir, speed, life: 3, damage: 8 };
  }

  createExplosion(position, color = 0xff4400, size = 3, duration = 0.5) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Central flash
    const flashGeo = new THREE.SphereGeometry(size * 0.5, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 1 });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    group.add(flash);

    // Expanding sphere
    const sphereGeo = new THREE.SphereGeometry(size, 12, 12);
    const sphereMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.6, wireframe: true });
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.scale.set(0.1, 0.1, 0.1);
    group.add(sphere);

    // Debris particles
    const particleCount = 20;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      const pGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
      const pMat = new THREE.MeshBasicMaterial({
        color: Math.random() > 0.5 ? color : 0xffff00,
        transparent: true,
        opacity: 1
      });
      const p = new THREE.Mesh(pGeo, pMat);
      p.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * size * 4,
        Math.random() * size * 3,
        (Math.random() - 0.5) * size * 4
      );
      group.add(p);
      particles.push(p);
    }

    // Light
    const light = new THREE.PointLight(color, 5, size * 5);
    group.add(light);

    this.scene.add(group);
    this.explosions.push({
      group, flash, sphere, particles, light,
      life: duration, maxLife: duration, size
    });
  }

  createMuzzleFlash(position, direction, color = 0xff0000) {
    const light = new THREE.PointLight(color, 3, 5);
    light.position.copy(position);
    this.scene.add(light);
    this.muzzleFlashes.push({ light, life: 0.05 });
  }

  createSwordSlash(camera, color = 0x0088ff) {
    const geo = new THREE.TorusGeometry(1.2, 0.03, 4, 16, Math.PI);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 });
    const slash = new THREE.Mesh(geo, mat);
    const pos = camera.position.clone();
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    pos.add(dir.multiplyScalar(1.5));
    pos.y -= 0.3;
    slash.position.copy(pos);
    slash.quaternion.copy(camera.quaternion);
    this.scene.add(slash);
    this.beams.push({ mesh: slash, life: 0.2, maxLife: 0.2 });
  }

  update(delta) {
    // Update beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= delta;
      if (b.mesh.material) {
        b.mesh.material.opacity = Math.max(0, b.life / b.maxLife);
      }
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry?.dispose();
        b.mesh.material?.dispose();
        this.beams.splice(i, 1);
      }
    }

    // Update explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life -= delta;
      const progress = 1 - e.life / e.maxLife;

      // Expand sphere
      const s = progress * 2;
      e.sphere.scale.set(s, s, s);
      e.sphere.material.opacity = Math.max(0, 0.6 * (1 - progress));
      e.flash.material.opacity = Math.max(0, 1 - progress * 2);
      e.light.intensity = Math.max(0, 5 * (1 - progress));

      // Move particles
      for (const p of e.particles) {
        p.position.add(p.velocity.clone().multiplyScalar(delta));
        p.velocity.y -= 10 * delta;
        p.material.opacity = Math.max(0, 1 - progress);
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
        this.scene.remove(m.light);
        this.muzzleFlashes.splice(i, 1);
      }
    }
  }

  cleanup() {
    this.beams.forEach(b => this.scene.remove(b.mesh));
    this.explosions.forEach(e => this.scene.remove(e.group));
    this.muzzleFlashes.forEach(m => this.scene.remove(m.light));
    this.beams = [];
    this.explosions = [];
    this.muzzleFlashes = [];
  }
}
