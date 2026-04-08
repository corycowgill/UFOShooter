// aliens.js - Three alien types with procedural models and AI
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
};

export function createAlienModel(type) {
  const data = ALIEN_TYPES[type];
  const group = new THREE.Group();

  if (type === 'grunt') {
    // === GRUNT: Tall humanoid alien soldier ===
    // Torso - segmented armor
    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.28, 1.0, 8),
      new THREE.MeshPhongMaterial({ color: 0x009933, emissive: 0x003311, shininess: 40 })
    );
    torso.position.y = 1.1;
    group.add(torso);
    // Chest armor plate
    const chestPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.15),
      new THREE.MeshPhongMaterial({ color: 0x336633, emissive: 0x002200, shininess: 80 })
    );
    chestPlate.position.set(0, 1.3, 0.2);
    group.add(chestPlate);
    // Shoulder pads
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshPhongMaterial({ color: 0x336633, emissive: 0x002200 })
      );
      pad.scale.set(1.2, 0.7, 1);
      pad.position.set(side * 0.42, 1.55, 0);
      group.add(pad);
    }

    // Head - large elongated cranium
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 12),
      new THREE.MeshPhongMaterial({ color: 0x00ee55, emissive: 0x004422 })
    );
    head.scale.set(1, 1.4, 0.95);
    head.position.y = 2.05;
    group.add(head);
    // Cranium ridge
    const ridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.3, 0.5),
      new THREE.MeshPhongMaterial({ color: 0x007733, emissive: 0x003311 })
    );
    ridge.position.set(0, 2.3, -0.05);
    group.add(ridge);

    // Eyes - large almond-shaped, glowing
    const eyeGeo = new THREE.SphereGeometry(0.1, 10, 10);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.scale.set(1.3, 0.7, 0.5);
      eye.position.set(side * 0.16, 2.08, 0.28);
      group.add(eye);
    }
    // Mouth slit
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.03, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x003300 })
    );
    mouth.position.set(0, 1.88, 0.32);
    group.add(mouth);

    // Arms with elbow joints
    const armMat = new THREE.MeshPhongMaterial({ color: data.color, emissive: 0x002211 });
    for (const side of [-1, 1]) {
      // Upper arm
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 6), armMat);
      upper.position.set(side * 0.48, 1.35, 0);
      upper.rotation.z = side * 0.3;
      group.add(upper);
      // Lower arm
      const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 6), armMat);
      lower.position.set(side * 0.55, 0.95, side === 1 ? 0.2 : 0);
      lower.rotation.z = side * 0.2;
      lower.rotation.x = side === 1 ? -0.6 : 0;
      group.add(lower);
      // 3-fingered hand
      for (let f = -1; f <= 1; f++) {
        const finger = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.01, 0.12, 4),
          armMat
        );
        finger.position.set(side * 0.58 + f * 0.02, 0.68, side === 1 ? 0.32 : f * 0.03);
        group.add(finger);
      }
    }

    // Blaster in right hand - more detailed
    const blasterBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.07, 0.35),
      new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 60 })
    );
    blasterBody.position.set(0.58, 0.68, 0.38);
    group.add(blasterBody);
    const blasterTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.1, 6),
      new THREE.MeshBasicMaterial({ color: 0x00ff44 })
    );
    blasterTip.rotation.x = Math.PI / 2;
    blasterTip.position.set(0.58, 0.68, 0.57);
    group.add(blasterTip);

    // Legs
    const legMat = new THREE.MeshPhongMaterial({ color: 0x008833, emissive: 0x002211 });
    for (const side of [-1, 1]) {
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.45, 6), legMat);
      thigh.position.set(side * 0.15, 0.55, 0);
      group.add(thigh);
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.4, 6), legMat);
      shin.position.set(side * 0.15, 0.2, 0);
      group.add(shin);
      // Boot
      const boot = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.08, 0.18),
        new THREE.MeshPhongMaterial({ color: 0x333333 })
      );
      boot.position.set(side * 0.15, 0.04, 0.03);
      group.add(boot);
    }

    // Belt
    const belt = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.03, 6, 12),
      new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 60 })
    );
    belt.position.y = 0.7;
    belt.rotation.x = Math.PI / 2;
    group.add(belt);

  } else if (type === 'swarmer') {
    // === SWARMER: Fast insectoid alien ===
    // Abdomen
    const abdomen = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 10),
      new THREE.MeshPhongMaterial({ color: 0x7700cc, emissive: 0x220044 })
    );
    abdomen.scale.set(0.9, 0.6, 1.3);
    abdomen.position.set(0, 0.4, -0.15);
    group.add(abdomen);

    // Thorax
    const thorax = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 10),
      new THREE.MeshPhongMaterial({ color: data.color, emissive: 0x330066 })
    );
    thorax.scale.set(1, 0.7, 1.1);
    thorax.position.set(0, 0.48, 0.15);
    group.add(thorax);

    // Head - angular
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      new THREE.MeshPhongMaterial({ color: 0xbb44ff, emissive: 0x330066 })
    );
    head.scale.set(1, 0.9, 1.1);
    head.position.set(0, 0.58, 0.35);
    group.add(head);

    // Mandibles
    for (const side of [-1, 1]) {
      const mandible = new THREE.Mesh(
        new THREE.ConeGeometry(0.02, 0.15, 4),
        new THREE.MeshPhongMaterial({ color: 0xff44ff, emissive: 0x440044 })
      );
      mandible.position.set(side * 0.08, 0.52, 0.48);
      mandible.rotation.x = -0.8;
      mandible.rotation.z = side * 0.3;
      group.add(mandible);
    }

    // Glowing compound eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), eyeMat);
      eye.scale.set(0.8, 1, 0.6);
      eye.position.set(side * 0.12, 0.63, 0.42);
      group.add(eye);
    }

    // Dorsal spines
    const spineMat = new THREE.MeshPhongMaterial({ color: 0xff00ff, emissive: 0x660066 });
    for (let i = 0; i < 5; i++) {
      const spine = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.2 + i * 0.03, 4), spineMat);
      spine.position.set(0, 0.55 + i * 0.01, -0.1 + i * 0.08);
      spine.rotation.x = -0.3;
      group.add(spine);
    }

    // 6 insect legs (3 per side)
    const legMat = new THREE.MeshPhongMaterial({ color: 0x7700aa, emissive: 0x220044 });
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const idx = i % 3;
      const legUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.015, 0.35, 4), legMat);
      const zOff = -0.1 + idx * 0.15;
      legUpper.position.set(side * 0.25, 0.35, zOff);
      legUpper.rotation.z = side * 1.0;
      group.add(legUpper);
      const legLower = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.01, 0.25, 4), legMat);
      legLower.position.set(side * 0.42, 0.12, zOff);
      legLower.rotation.z = side * 0.3;
      group.add(legLower);
    }

    // Front attack claws - large and prominent
    const clawMat = new THREE.MeshPhongMaterial({ color: 0xff44ff, emissive: 0x660044 });
    for (const side of [-1, 1]) {
      const clawArm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.25, 4), clawMat);
      clawArm.position.set(side * 0.18, 0.45, 0.4);
      clawArm.rotation.x = -0.7;
      clawArm.rotation.z = side * 0.2;
      group.add(clawArm);
      const clawTip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.18, 4), clawMat);
      clawTip.position.set(side * 0.2, 0.35, 0.55);
      clawTip.rotation.x = -1.2;
      group.add(clawTip);
    }

    // Glowing energy along spine
    const spineGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xcc00ff, transparent: true, opacity: 0.5 })
    );
    spineGlow.position.set(0, 0.55, 0.05);
    group.add(spineGlow);

  } else if (type === 'bloater') {
    // === BLOATER: Massive volatile alien ===
    // Main body - large pulsating sphere
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 16, 16),
      new THREE.MeshPhongMaterial({
        color: 0xcc2200,
        emissive: 0x661100,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.85,
        shininess: 30,
      })
    );
    body.position.y = 1.1;
    group.add(body);

    // Inner plasma core
    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xff8800,
        transparent: true,
        opacity: 0.4,
      })
    );
    inner.position.y = 1.1;
    group.add(inner);

    // Veins on surface (glowing lines)
    const veinMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.6 });
    for (let i = 0; i < 8; i++) {
      const vein = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.02, 4, 12), veinMat);
      vein.position.y = 1.1;
      vein.rotation.x = Math.random() * Math.PI;
      vein.rotation.y = Math.random() * Math.PI;
      group.add(vein);
    }

    // Small angry head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 10),
      new THREE.MeshPhongMaterial({ color: 0xdd3300, emissive: 0x441100 })
    );
    head.scale.set(1, 0.85, 0.9);
    head.position.y = 2.15;
    group.add(head);

    // Glowing angry eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat);
      eye.position.set(side * 0.12, 2.18, 0.22);
      group.add(eye);
    }
    // Angry brow ridges
    for (const side of [-1, 1]) {
      const brow = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.04, 0.08),
        new THREE.MeshPhongMaterial({ color: 0x881100 })
      );
      brow.position.set(side * 0.1, 2.28, 0.2);
      brow.rotation.z = side * -0.3;
      group.add(brow);
    }

    // Stubby arms
    const armMat = new THREE.MeshPhongMaterial({ color: 0xaa1100, emissive: 0x330000 });
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.4, 6), armMat);
      arm.position.set(side * 0.8, 1.0, 0.3);
      arm.rotation.z = side * 0.8;
      group.add(arm);
    }

    // Stubby legs
    const legMat = new THREE.MeshPhongMaterial({ color: 0xaa1100, emissive: 0x330000 });
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.5, 6), legMat);
      leg.position.set(side * 0.45, 0.25, 0);
      group.add(leg);
      // Foot
      const foot = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.08, 0.25),
        new THREE.MeshPhongMaterial({ color: 0x771100 })
      );
      foot.position.set(side * 0.45, 0.04, 0.05);
      group.add(foot);
    }

    // Pustules / boils - larger, more prominent
    const pustuleMat = new THREE.MeshPhongMaterial({ color: 0xff6600, emissive: 0x663300 });
    for (let i = 0; i < 10; i++) {
      const size = 0.08 + Math.random() * 0.14;
      const bump = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 8), pustuleMat);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.7 + 0.15;
      bump.position.set(
        Math.sin(phi) * Math.cos(theta) * 0.92,
        1.1 + Math.cos(phi) * 0.92,
        Math.sin(phi) * Math.sin(theta) * 0.92
      );
      group.add(bump);
    }

    // Point light inside - brighter
    const glow = new THREE.PointLight(0xff4400, 2.5, 8);
    glow.position.y = 1.1;
    group.add(glow);

    // Warning glow ring at base
    const warnRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.05, 6, 16),
      new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.4 })
    );
    warnRing.position.y = 0.05;
    warnRing.rotation.x = Math.PI / 2;
    group.add(warnRing);
  }

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
  }

  update(delta, playerPos) {
    if (this.dead) {
      this.deathTimer -= delta;
      // Sink and fade
      this.mesh.position.y -= delta * 2;
      this.mesh.traverse(child => {
        if (child.material && child.material.transparent !== undefined) {
          child.material.transparent = true;
          child.material.opacity = Math.max(0, this.deathTimer / 1.0);
        }
      });
      return this.deathTimer <= 0; // true = remove
    }

    this.pulseTime += delta;

    // Face player
    const toPlayer = new THREE.Vector3().subVectors(playerPos, this.mesh.position);
    toPlayer.y = 0;
    const dist = toPlayer.length();
    toPlayer.normalize();

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
    }

    // Update projectiles
    this._updateProjectiles(delta, playerPos);
  }

  _gruntBehavior(delta, dist, toPlayer, playerPos) {
    // Move toward player but stop at attack range
    const preferredDist = 15 + Math.sin(this.pulseTime * 0.5) * 5;
    if (dist > preferredDist + 2) {
      this.mesh.position.add(toPlayer.clone().multiplyScalar(this.data.speed * delta));
    } else if (dist < preferredDist - 2) {
      this.mesh.position.add(toPlayer.clone().multiplyScalar(-this.data.speed * 0.5 * delta));
    }
    // Strafe slightly
    const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x);
    this.mesh.position.add(strafe.multiplyScalar(Math.sin(this.pulseTime * 2) * 2 * delta));

    // Shoot
    this.attackCooldown -= delta;
    if (this.attackCooldown <= 0 && dist < this.data.attackRange) {
      this.attackCooldown = this.data.attackRate;
      this._shootAtPlayer(playerPos);
    }
  }

  _swarmerBehavior(delta, dist, toPlayer) {
    // Rush directly at player, zigzag slightly
    const zigzag = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x)
      .multiplyScalar(Math.sin(this.pulseTime * 8) * 3 * delta);
    this.mesh.position.add(toPlayer.clone().multiplyScalar(this.data.speed * delta));
    this.mesh.position.add(zigzag);
    // Bob up and down
    this.mesh.children[0].position.y = 0.5 + Math.sin(this.pulseTime * 10) * 0.05;
  }

  _bloaterBehavior(delta, dist, toPlayer) {
    // Slow approach
    this.mesh.position.add(toPlayer.clone().multiplyScalar(this.data.speed * delta));

    // Pulse glow
    const pulseMat = this.mesh.children[1]; // inner glow sphere
    if (pulseMat && pulseMat.material) {
      pulseMat.material.opacity = 0.2 + Math.sin(this.pulseTime * 3) * 0.15;
    }
    // Scale pulse
    const scale = 1 + Math.sin(this.pulseTime * 2) * 0.05;
    this.mesh.children[0].scale.set(scale, scale, scale);
  }

  _shootAtPlayer(playerPos) {
    this.audio.playAlienShoot();
    const from = this.mesh.position.clone();
    from.y += 1.2;
    const bolt = this.particles.createAlienBolt(from, playerPos.clone());
    this.projectiles.push(bolt);
  }

  _updateProjectiles(delta, playerPos) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bolt = this.projectiles[i];
      bolt.mesh.position.add(bolt.direction.clone().multiplyScalar(bolt.speed * delta));
      bolt.life -= delta;

      if (bolt.life <= 0) {
        this.scene.remove(bolt.mesh);
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

    // Flash white briefly
    this.mesh.traverse(child => {
      if (child.material && child.material.emissive) {
        child.material.emissive.set(0xffffff);
        setTimeout(() => {
          if (child.material) child.material.emissive.set(child.material._originalEmissive || 0x000000);
        }, 100);
      }
    });

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

    // Clean up projectiles
    this.projectiles.forEach(p => this.scene.remove(p.mesh));
    this.projectiles = [];

    // Bloater explodes on death
    if (this.type === 'bloater') {
      this.particles.createExplosion(this.mesh.position.clone(), 0xff4400, 5, 0.8);
      this.audio.playExplosion();
      this.deathTimer = 0.1; // Remove quickly since we show explosion
    }
  }

  checkPlayerCollision(playerPos, delta) {
    if (this.dead) return null;
    const dist = this.mesh.position.distanceTo(playerPos);

    // Swarmer melee attack
    if (this.type === 'swarmer' && dist < this.data.attackRange) {
      this.meleeCooldown = (this.meleeCooldown || 0) - (delta || 0.016);
      if (this.meleeCooldown <= 0) {
        this.meleeCooldown = this.data.attackRate;
        this.audio.playAlienGrowl();
        return { damage: this.data.damage, type: 'melee' };
      }
    }

    // Bloater explosion
    if (this.type === 'bloater' && dist < this.data.attackRange) {
      this.die();
      return { damage: this.data.damage, type: 'explosion', radius: this.data.explosionRadius };
    }

    // Check projectile hits (this is the authoritative check)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bolt = this.projectiles[i];
      const boltDist = bolt.mesh.position.distanceTo(playerPos);
      if (boltDist < 1.5) {
        const dmg = bolt.damage;
        this.scene.remove(bolt.mesh);
        this.projectiles.splice(i, 1);
        return { damage: dmg, type: 'projectile' };
      }
    }

    return null;
  }

  cleanup() {
    this.projectiles.forEach(p => this.scene.remove(p.mesh));
    this.scene.remove(this.mesh);
  }

  getBoundingSphere() {
    const r = this.type === 'bloater' ? 1.2 : this.type === 'grunt' ? 0.6 : 0.4;
    return { center: this.mesh.position.clone(), radius: r };
  }
}
