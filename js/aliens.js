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
    // Humanoid alien - tall with big head
    // Body
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.25, 1.2, 6),
      new THREE.MeshPhongMaterial({ color: data.color })
    );
    body.position.y = 1.0;
    group.add(body);

    // Head - large elongated
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 8, 8),
      new THREE.MeshPhongMaterial({ color: 0x00ff55 })
    );
    head.scale.set(1, 1.3, 0.9);
    head.position.y = 2.0;
    group.add(head);

    // Eyes - large black
    const eyeGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const eyeMat = new THREE.MeshPhongMaterial({ color: 0x000000, emissive: 0x003300 });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.15, 2.05, 0.25);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.15, 2.05, 0.25);
    group.add(rightEye);

    // Arms
    const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.8, 6);
    const armMat = new THREE.MeshPhongMaterial({ color: data.color });
    const leftArm = new THREE.Mesh(armGeo, armMat);
    leftArm.position.set(-0.45, 1.2, 0);
    leftArm.rotation.z = 0.3;
    group.add(leftArm);
    const rightArm = new THREE.Mesh(armGeo, armMat);
    rightArm.position.set(0.45, 1.0, 0.2);
    rightArm.rotation.z = -0.3;
    rightArm.rotation.x = -0.5;
    group.add(rightArm);

    // Blaster in right hand
    const blaster = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.3),
      new THREE.MeshPhongMaterial({ color: 0x444444 })
    );
    blaster.position.set(0.5, 0.65, 0.35);
    group.add(blaster);

    // Legs
    const legGeo = new THREE.CylinderGeometry(0.08, 0.07, 0.7, 6);
    const legMat = new THREE.MeshPhongMaterial({ color: 0x008833 });
    const leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.15, 0.35, 0);
    group.add(leftLeg);
    const rightLeg = new THREE.Mesh(legGeo, legMat);
    rightLeg.position.set(0.15, 0.35, 0);
    group.add(rightLeg);

  } else if (type === 'swarmer') {
    // Small, spiky, insect-like
    // Body - small sphere
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshPhongMaterial({ color: data.color })
    );
    body.position.y = 0.5;
    body.scale.set(1, 0.7, 1.2);
    group.add(body);

    // Head
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshPhongMaterial({ color: 0xbb44ff })
    );
    head.position.set(0, 0.65, 0.25);
    group.add(head);

    // Glowing eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    const le = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
    le.position.set(-0.1, 0.7, 0.4);
    group.add(le);
    const re = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat);
    re.position.set(0.1, 0.7, 0.4);
    group.add(re);

    // Spikes/claws
    const spikeMat = new THREE.MeshPhongMaterial({ color: 0xff00ff });
    for (let i = 0; i < 4; i++) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.25, 4),
        spikeMat
      );
      const angle = (i / 4) * Math.PI * 2;
      spike.position.set(Math.cos(angle) * 0.35, 0.5, Math.sin(angle) * 0.35);
      spike.rotation.z = Math.cos(angle) * 0.5;
      spike.rotation.x = Math.sin(angle) * 0.5;
      group.add(spike);
    }

    // Legs (4 insect legs)
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4),
        new THREE.MeshPhongMaterial({ color: 0x7700aa })
      );
      const side = i < 2 ? -1 : 1;
      const pos = i % 2 === 0 ? 0.1 : -0.1;
      leg.position.set(side * 0.3, 0.15, pos);
      leg.rotation.z = side * 0.8;
      group.add(leg);
    }

    // Front claws
    const clawGeo = new THREE.ConeGeometry(0.03, 0.2, 4);
    const clawMat = new THREE.MeshPhongMaterial({ color: 0xff44ff });
    const lc = new THREE.Mesh(clawGeo, clawMat);
    lc.position.set(-0.2, 0.4, 0.35);
    lc.rotation.x = -1;
    group.add(lc);
    const rc = new THREE.Mesh(clawGeo, clawMat);
    rc.position.set(0.2, 0.4, 0.35);
    rc.rotation.x = -1;
    group.add(rc);

  } else if (type === 'bloater') {
    // Large bloated sphere with pulsing glow
    // Main body - big sphere
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 12, 12),
      new THREE.MeshPhongMaterial({
        color: data.color,
        emissive: 0x440000,
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.9,
      })
    );
    body.position.y = 1.0;
    group.add(body);

    // Inner glow
    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 10, 10),
      new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 0.3,
      })
    );
    inner.position.y = 1.0;
    group.add(inner);

    // Small head on top
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshPhongMaterial({ color: 0xcc2200 })
    );
    head.position.y = 2.0;
    group.add(head);

    // Tiny angry eyes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const le = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
    le.position.set(-0.1, 2.05, 0.2);
    group.add(le);
    const re = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), eyeMat);
    re.position.set(0.1, 2.05, 0.2);
    group.add(re);

    // Stubby legs
    const legGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.4, 6);
    const legMat = new THREE.MeshPhongMaterial({ color: 0xaa1100 });
    const ll = new THREE.Mesh(legGeo, legMat);
    ll.position.set(-0.4, 0.2, 0);
    group.add(ll);
    const rl = new THREE.Mesh(legGeo, legMat);
    rl.position.set(0.4, 0.2, 0);
    group.add(rl);

    // Pustules / bumps
    for (let i = 0; i < 6; i++) {
      const bump = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 6, 6),
        new THREE.MeshPhongMaterial({ color: 0xff4400, emissive: 0x441100 })
      );
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.6 + 0.2;
      bump.position.set(
        Math.sin(phi) * Math.cos(theta) * 0.85,
        1.0 + Math.cos(phi) * 0.85,
        Math.sin(phi) * Math.sin(theta) * 0.85
      );
      group.add(bump);
    }

    // Point light inside
    const glow = new THREE.PointLight(0xff4400, 1, 5);
    glow.position.y = 1.0;
    group.add(glow);
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

      // Check hit player
      const distToPlayer = bolt.mesh.position.distanceTo(playerPos);
      if (distToPlayer < 1.0) {
        this.scene.remove(bolt.mesh);
        this.projectiles.splice(i, 1);
        return; // Will be handled by game loop checking projectile hits
      }
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

  checkPlayerCollision(playerPos) {
    if (this.dead) return null;
    const dist = this.mesh.position.distanceTo(playerPos);

    // Swarmer melee attack
    if (this.type === 'swarmer' && dist < this.data.attackRange) {
      this.attackCooldown -= 0.016; // Approximate
      if (this.attackCooldown <= 0) {
        this.attackCooldown = this.data.attackRate;
        this.audio.playAlienGrowl();
        return { damage: this.data.damage, type: 'melee' };
      }
    }

    // Bloater explosion
    if (this.type === 'bloater' && dist < this.data.attackRange) {
      this.die();
      return { damage: this.data.damage, type: 'explosion', radius: this.data.explosionRadius };
    }

    // Check projectile hits
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const bolt = this.projectiles[i];
      if (bolt.mesh.position.distanceTo(playerPos) < 1.0) {
        this.scene.remove(bolt.mesh);
        this.projectiles.splice(i, 1);
        return { damage: bolt.damage, type: 'projectile' };
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
