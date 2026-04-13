// vfx.js - Screen-space visual effects: shake, hit markers, damage numbers,
//          kill feed, low-health vignette, alien death/spawn VFX, environment particles

import { disposeTree, borrowLight, spawnParticle } from './particles.js';

export class VFXManager {
  constructor(camera, scene) {
    this.camera = camera;
    this.scene = scene;

    // Screen shake
    this.shakeIntensity = 0;
    this.shakeDuration = 0;
    this.shakeTimer = 0;
    this.cameraBasePos = new THREE.Vector3();

    // Hit markers
    this.hitMarkerTimer = 0;
    this.hitMarkerKill = false;

    // Damage numbers
    this.damageNumbers = [];

    // Kill feed
    this.killFeed = [];

    // Low health
    this.lowHealthPulse = 0;

    // Environment particles
    this.envParticles = null;
    this.envParticleType = 'dust'; // dust, embers

    // Alien death effects
    this.deathEffects = [];

    // Spawn effects
    this.spawnEffects = [];

    this._buildDOM();
  }

  _buildDOM() {
    // Hit marker overlay (CSS cross that appears on hit)
    let hm = document.getElementById('hit-marker');
    if (!hm) {
      hm = document.createElement('div');
      hm.id = 'hit-marker';
      document.body.appendChild(hm);
    }
    this.hitMarkerEl = hm;

    // Damage number container
    let dnc = document.getElementById('damage-numbers');
    if (!dnc) {
      dnc = document.createElement('div');
      dnc.id = 'damage-numbers';
      document.body.appendChild(dnc);
    }
    this.damageNumberContainer = dnc;

    // Kill feed container
    let kf = document.getElementById('kill-feed');
    if (!kf) {
      kf = document.createElement('div');
      kf.id = 'kill-feed';
      document.body.appendChild(kf);
    }
    this.killFeedEl = kf;

    // Low health vignette
    let lhv = document.getElementById('low-health-vignette');
    if (!lhv) {
      lhv = document.createElement('div');
      lhv.id = 'low-health-vignette';
      document.body.appendChild(lhv);
    }
    this.lowHealthVignetteEl = lhv;
  }

  // ========================
  // SCREEN SHAKE
  // ========================
  shake(intensity, duration) {
    // Don't override a stronger shake
    if (intensity > this.shakeIntensity) {
      this.shakeIntensity = intensity;
      this.shakeDuration = duration;
      this.shakeTimer = duration;
    }
  }

  _updateShake(delta) {
    if (this.shakeTimer > 0) {
      this.shakeTimer -= delta;
      const progress = this.shakeTimer / this.shakeDuration;
      const amplitude = this.shakeIntensity * progress;

      // Apply random offset to camera
      this.camera.position.x += (Math.random() - 0.5) * amplitude;
      this.camera.position.y += (Math.random() - 0.5) * amplitude * 0.5;

      if (this.shakeTimer <= 0) {
        this.shakeIntensity = 0;
      }
    }
  }

  // ========================
  // HIT MARKERS
  // ========================
  showHitMarker(isKill = false) {
    this.hitMarkerTimer = 0.2;
    this.hitMarkerKill = isKill;
    this.hitMarkerEl.className = isKill ? 'active kill' : 'active';
  }

  _updateHitMarker(delta) {
    if (this.hitMarkerTimer > 0) {
      this.hitMarkerTimer -= delta;
      if (this.hitMarkerTimer <= 0) {
        this.hitMarkerEl.className = '';
      }
    }
  }

  // ========================
  // DAMAGE NUMBERS
  // ========================
  showDamageNumber(worldPos, damage, isKill = false) {
    // Project world position to screen
    const el = document.createElement('div');
    el.className = 'dmg-num' + (isKill ? ' kill' : '');
    el.textContent = isKill ? `${Math.round(damage)} KILL` : Math.round(damage);
    this.damageNumberContainer.appendChild(el);

    this.damageNumbers.push({
      el,
      worldPos: worldPos.clone(),
      life: 1.0,
      offsetY: 0,
      velocity: -80 - Math.random() * 40, // pixels per second upward
    });
  }

  _updateDamageNumbers(delta) {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.life -= delta;
      dn.offsetY += dn.velocity * delta;

      // Project to screen
      const screenPos = dn.worldPos.clone().project(this.camera);
      const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight + dn.offsetY;

      // Only show if in front of camera
      if (screenPos.z < 1) {
        dn.el.style.left = x + 'px';
        dn.el.style.top = y + 'px';
        dn.el.style.opacity = Math.max(0, dn.life);
        dn.el.style.display = 'block';
      } else {
        dn.el.style.display = 'none';
      }

      if (dn.life <= 0) {
        dn.el.remove();
        this.damageNumbers.splice(i, 1);
      }
    }
  }

  // ========================
  // KILL FEED
  // ========================
  addKillFeedEntry(alienName, weaponName) {
    const el = document.createElement('div');
    el.className = 'kill-entry';
    el.innerHTML = `<span class="kf-weapon">${weaponName}</span> ▸ <span class="kf-alien">${alienName}</span>`;
    this.killFeedEl.appendChild(el);

    // Animate in
    requestAnimationFrame(() => el.classList.add('visible'));

    this.killFeed.push({ el, life: 3.0 });

    // Keep max 5 entries
    while (this.killFeed.length > 5) {
      this.killFeed[0].el.remove();
      this.killFeed.shift();
    }
  }

  _updateKillFeed(delta) {
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      const kf = this.killFeed[i];
      kf.life -= delta;
      if (kf.life < 0.5) {
        kf.el.style.opacity = Math.max(0, kf.life * 2);
      }
      if (kf.life <= 0) {
        kf.el.remove();
        this.killFeed.splice(i, 1);
      }
    }
  }

  // ========================
  // LOW HEALTH EFFECTS
  // ========================
  _updateLowHealth(delta, playerHpPct) {
    if (playerHpPct < 0.3) {
      this.lowHealthPulse += delta * (4 + (1 - playerHpPct / 0.3) * 4);
      const pulseAlpha = 0.15 + Math.sin(this.lowHealthPulse) * 0.1 * (1 - playerHpPct / 0.3);
      this.lowHealthVignetteEl.style.opacity = Math.max(0, pulseAlpha);
      this.lowHealthVignetteEl.style.display = 'block';
    } else {
      this.lowHealthPulse = 0;
      this.lowHealthVignetteEl.style.display = 'none';
    }
  }

  // ========================
  // ALIEN DEATH EFFECTS
  // ========================
  createDeathEffect(position, color, size = 1) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Dissolution particles — routed to the GPU point field (additive).
    // Previously allocated 16-24 mesh instances per death, each with its
    // own material. That was a real allocation spike on multi-kills.
    const pieceCount = 16 + Math.floor(Math.random() * 8);
    for (let i = 0; i < pieceCount; i++) {
      spawnParticle('additive', {
        position,
        velocity: {
          x: (Math.random() - 0.5) * 6,
          y: Math.random() * 5 + 1,
          z: (Math.random() - 0.5) * 6,
        },
        gravity: 8,
        life: 0.75,
        sizeStart: 0.28 * size,
        sizeEnd: 0.05 * size,
        color: Math.random() > 0.3 ? color : 0x00ff00,
        alpha: 1,
      });
    }

    // Energy release flash — structural, stays as a mesh.
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.5 * size, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 })
    );
    group.add(flash);

    // Expanding energy ring — structural.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3 * size, 0.04, 6, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Glowing orbs that float up — also routed to the additive point field.
    for (let i = 0; i < 5; i++) {
      spawnParticle('additive', {
        position,
        velocity: {
          x: (Math.random() - 0.5) * 1.5,
          y: 2 + Math.random() * 3,
          z: (Math.random() - 0.5) * 1.5,
        },
        gravity: 0,
        drag: 0.5,
        life: 0.8,
        sizeStart: 0.18,
        sizeEnd: 0.08,
        color: 0x88ffaa,
        alpha: 0.8,
      });
    }

    // Pooled point light (decay handled centrally — no shader recompile)
    borrowLight(position, color, 4, 8, 0.8);

    this.scene.add(group);
    this.deathEffects.push({
      group, flash, ring,
      life: 0.8, maxLife: 0.8
    });
  }

  _updateDeathEffects(delta) {
    for (let i = this.deathEffects.length - 1; i >= 0; i--) {
      const d = this.deathEffects[i];
      d.life -= delta;
      const progress = 1 - d.life / d.maxLife;

      // Flash fades fast
      d.flash.material.opacity = Math.max(0, 1 - progress * 4);
      const fScale = 1 + progress * 2;
      d.flash.scale.set(fScale, fScale, fScale);

      // Ring expands
      const rScale = 1 + progress * 5;
      d.ring.scale.set(rScale, rScale, rScale * 0.3);
      d.ring.material.opacity = Math.max(0, 0.8 * (1 - progress));

      // Pieces + orbs are driven by the GPU particle fields — no per-mesh
      // update here.

      if (d.life <= 0) {
        this.scene.remove(d.group);
        disposeTree(d.group);
        this.deathEffects.splice(i, 1);
      }
    }
  }

  // ========================
  // ALIEN SPAWN EFFECTS
  // ========================
  createSpawnEffect(position, color) {
    const group = new THREE.Group();
    group.position.copy(position);

    // Teleport beam (vertical column of light)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.5, 12, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
      })
    );
    beam.position.y = 6;
    group.add(beam);

    // Inner beam (brighter)
    const innerBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.2, 12, 8, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xaaffcc,
        transparent: true,
        opacity: 0.7,
      })
    );
    innerBeam.position.y = 6;
    group.add(innerBeam);

    // Ground ring
    const groundRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.8, 0.06, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.8 })
    );
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.y = 0.05;
    group.add(groundRing);

    // Sparkles routed to the additive point field. They lose the spiral
    // motion but gain zero-allocation spawn — 12 mesh allocs per enemy
    // spawn was a real hitch on wave starts.
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      spawnParticle('additive', {
        position: {
          x: position.x + Math.cos(angle) * 0.6,
          y: position.y + i * 0.3,
          z: position.z + Math.sin(angle) * 0.6,
        },
        velocity: {
          x: Math.cos(angle) * 0.3,
          y: 2 + Math.random() * 1.5,
          z: Math.sin(angle) * 0.3,
        },
        gravity: 0,
        life: 0.55,
        sizeStart: 0.15,
        sizeEnd: 0.02,
        color: 0x88ffcc,
        alpha: 0.9,
      });
    }

    // Pooled point light 1 unit above the spawn position
    borrowLight(
      { x: position.x, y: position.y + 1, z: position.z },
      0x00ff88, 3, 10, 0.6
    );

    this.scene.add(group);
    this.spawnEffects.push({
      group, beam, innerBeam, groundRing,
      life: 0.6, maxLife: 0.6
    });
  }

  _updateSpawnEffects(delta) {
    for (let i = this.spawnEffects.length - 1; i >= 0; i--) {
      const s = this.spawnEffects[i];
      s.life -= delta;
      const progress = 1 - s.life / s.maxLife;

      // Beam fades from top down
      s.beam.material.opacity = Math.max(0, 0.4 * (1 - progress));
      s.innerBeam.material.opacity = Math.max(0, 0.7 * (1 - progress));
      s.beam.scale.y = Math.max(0.1, 1 - progress);
      s.beam.position.y = 6 * (1 - progress * 0.5);

      // Ground ring expands and fades
      const rs = 1 + progress * 2;
      s.groundRing.scale.set(rs, rs, rs);
      s.groundRing.material.opacity = Math.max(0, 0.8 * (1 - progress));

      // Sparkles now live in the GPU point field — no per-mesh update.

      if (s.life <= 0) {
        this.scene.remove(s.group);
        disposeTree(s.group);
        this.spawnEffects.splice(i, 1);
      }
    }
  }

  // ========================
  // ENVIRONMENT PARTICLES
  // ========================
  initEnvironmentParticles(type = 'dust') {
    this.envParticleType = type;
    if (this.envParticles) {
      this.scene.remove(this.envParticles);
    }
    if (this._envParticles2) {
      this.scene.remove(this._envParticles2);
      this._envParticles2 = null;
    }

    // Primary particles - increased count
    const count = 350;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 80;
      positions[i * 3 + 1] = Math.random() * 18;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 80;

      if (type === 'embers') {
        velocities[i * 3] = (Math.random() - 0.5) * 0.4;
        velocities[i * 3 + 1] = 0.5 + Math.random() * 1.2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      } else {
        velocities[i * 3] = (Math.random() - 0.5) * 0.6;
        velocities[i * 3 + 1] = -0.1 + Math.random() * 0.2;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      }
    }

    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.userData.velocities = velocities;

    const color = type === 'embers' ? 0xff6622 : 0x888888;
    const size = type === 'embers' ? 0.15 : 0.08;
    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: type === 'embers' ? 0.6 : 0.3,
      blending: type === 'embers' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.envParticles = new THREE.Points(geo, mat);
    this.scene.add(this.envParticles);

    // Secondary particle layer - ash/debris floating (always present)
    const count2 = 120;
    const geo2 = new THREE.BufferGeometry();
    const pos2 = new Float32Array(count2 * 3);
    const vel2 = new Float32Array(count2 * 3);
    for (let i = 0; i < count2; i++) {
      pos2[i * 3] = (Math.random() - 0.5) * 70;
      pos2[i * 3 + 1] = 1 + Math.random() * 10;
      pos2[i * 3 + 2] = (Math.random() - 0.5) * 70;
      vel2[i * 3] = (Math.random() - 0.5) * 0.3;
      vel2[i * 3 + 1] = -0.05 + Math.random() * 0.15;
      vel2[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
    }
    geo2.setAttribute('position', new THREE.Float32BufferAttribute(pos2, 3));
    geo2.userData.velocities = vel2;
    const mat2 = new THREE.PointsMaterial({
      color: 0x555544,
      size: 0.12,
      transparent: true,
      opacity: 0.2,
    });
    this._envParticles2 = new THREE.Points(geo2, mat2);
    this.scene.add(this._envParticles2);
  }

  _updateEnvironmentParticles(delta) {
    if (!this.envParticles) return;

    const positions = this.envParticles.geometry.attributes.position.array;
    const velocities = this.envParticles.geometry.userData.velocities;
    const camPos = this.camera.position;

    for (let i = 0; i < positions.length / 3; i++) {
      const idx = i * 3;
      positions[idx] += velocities[idx] * delta;
      positions[idx + 1] += velocities[idx + 1] * delta;
      positions[idx + 2] += velocities[idx + 2] * delta;

      // Add subtle sine wave motion for dust
      if (this.envParticleType === 'dust') {
        positions[idx] += Math.sin(performance.now() * 0.001 + i) * 0.003;
      }

      // Respawn particles that go too far from camera
      const dx = positions[idx] - camPos.x;
      const dz = positions[idx + 2] - camPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 30 || positions[idx + 1] > 20 || positions[idx + 1] < 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = 5 + Math.random() * 25;
        positions[idx] = camPos.x + Math.cos(angle) * r;
        positions[idx + 1] = Math.random() * 12;
        positions[idx + 2] = camPos.z + Math.sin(angle) * r;
      }
    }

    this.envParticles.geometry.attributes.position.needsUpdate = true;

    // Update secondary ash/debris particles
    if (this._envParticles2) {
      const pos2 = this._envParticles2.geometry.attributes.position.array;
      const vel2 = this._envParticles2.geometry.userData.velocities;
      const time = performance.now() * 0.001;

      for (let i = 0; i < pos2.length / 3; i++) {
        const idx = i * 3;
        pos2[idx] += vel2[idx] * delta;
        pos2[idx + 1] += vel2[idx + 1] * delta;
        pos2[idx + 2] += vel2[idx + 2] * delta;

        // Gentle swaying drift
        pos2[idx] += Math.sin(time * 0.5 + i * 1.7) * 0.002;
        pos2[idx + 1] += Math.cos(time * 0.3 + i * 2.1) * 0.001;

        // Respawn if too far from camera or out of bounds
        const dx2 = pos2[idx] - camPos.x;
        const dz2 = pos2[idx + 2] - camPos.z;
        const dist2 = Math.sqrt(dx2 * dx2 + dz2 * dz2);

        if (dist2 > 35 || pos2[idx + 1] > 14 || pos2[idx + 1] < -0.5) {
          const angle2 = Math.random() * Math.PI * 2;
          const r2 = 4 + Math.random() * 28;
          pos2[idx] = camPos.x + Math.cos(angle2) * r2;
          pos2[idx + 1] = 0.5 + Math.random() * 10;
          pos2[idx + 2] = camPos.z + Math.sin(angle2) * r2;
        }
      }

      this._envParticles2.geometry.attributes.position.needsUpdate = true;
    }
  }

  // ========================
  // MAIN UPDATE
  // ========================
  update(delta, playerHpPct) {
    this._updateShake(delta);
    this._updateHitMarker(delta);
    this._updateDamageNumbers(delta);
    this._updateKillFeed(delta);
    this._updateLowHealth(delta, playerHpPct);
    this._updateDeathEffects(delta);
    this._updateSpawnEffects(delta);
    this._updateEnvironmentParticles(delta);
  }

  cleanup() {
    // Remove and dispose 3D effects
    for (const d of this.deathEffects) {
      this.scene.remove(d.group);
      disposeTree(d.group);
    }
    for (const s of this.spawnEffects) {
      this.scene.remove(s.group);
      disposeTree(s.group);
    }
    if (this.envParticles) {
      this.scene.remove(this.envParticles);
      disposeTree(this.envParticles);
    }
    if (this._envParticles2) {
      this.scene.remove(this._envParticles2);
      disposeTree(this._envParticles2);
    }
    this.deathEffects = [];
    this.spawnEffects = [];
    this.envParticles = null;
    this._envParticles2 = null;

    // Clear DOM elements
    for (const dn of this.damageNumbers) dn.el.remove();
    for (const kf of this.killFeed) kf.el.remove();
    this.damageNumbers = [];
    this.killFeed = [];
    this.hitMarkerTimer = 0;
    this.hitMarkerEl.className = '';
    this.lowHealthVignetteEl.style.display = 'none';
  }
}
