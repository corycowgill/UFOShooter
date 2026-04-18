// waves.js - Wave spawning system
import { Alien } from './aliens.js';

export class WaveManager {
  constructor(scene, particles, audio) {
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.wave = 0;
    this.enemies = [];
    this.state = 'waiting'; // waiting, spawning, active, complete
    this.stateTimer = 0;
    this.spawnPoints = [];
    this.spawnQueue = [];
    this.spawnTimer = 0;
  }

  setSpawnPoints(points) {
    this.spawnPoints = points;
  }

  startWave() {
    this.wave++;
    this.state = 'spawning';
    this.spawnQueue = this._generateWaveComposition();
    this.spawnTimer = 0;
  }

  _generateWaveComposition() {
    const queue = [];
    const w = this.wave;
    const baseCount = 3 + w * 2;
    const maxEnemies = Math.min(baseCount, 30);

    if (w <= 3) {
      // Early waves: grunts, swarmers, first stalkers
      const grunts = Math.ceil(maxEnemies * 0.55);
      const swarmers = Math.ceil(maxEnemies * 0.3);
      const stalkers = maxEnemies - grunts - swarmers;
      for (let i = 0; i < grunts; i++) queue.push('grunt');
      for (let i = 0; i < swarmers; i++) queue.push('swarmer');
      for (let i = 0; i < Math.max(0, stalkers); i++) queue.push('stalker');
    } else if (w <= 6) {
      // Mid waves: introduce bloaters and spitters
      const grunts = Math.ceil(maxEnemies * 0.25);
      const swarmers = Math.ceil(maxEnemies * 0.2);
      const bloaters = Math.ceil(maxEnemies * 0.15);
      const stalkers = Math.ceil(maxEnemies * 0.2);
      const spitters = maxEnemies - grunts - swarmers - bloaters - stalkers;
      for (let i = 0; i < grunts; i++) queue.push('grunt');
      for (let i = 0; i < swarmers; i++) queue.push('swarmer');
      for (let i = 0; i < bloaters; i++) queue.push('bloater');
      for (let i = 0; i < stalkers; i++) queue.push('stalker');
      for (let i = 0; i < Math.max(0, spitters); i++) queue.push('spitter');
    } else {
      // Late waves: full mix with drones
      const grunts = Math.ceil(maxEnemies * 0.18);
      const swarmers = Math.ceil(maxEnemies * 0.15);
      const bloaters = Math.ceil(maxEnemies * 0.15);
      const stalkers = Math.ceil(maxEnemies * 0.17);
      const spitters = Math.ceil(maxEnemies * 0.15);
      const drones = maxEnemies - grunts - swarmers - bloaters - stalkers - spitters;
      for (let i = 0; i < grunts; i++) queue.push('grunt');
      for (let i = 0; i < swarmers; i++) queue.push('swarmer');
      for (let i = 0; i < bloaters; i++) queue.push('bloater');
      for (let i = 0; i < stalkers; i++) queue.push('stalker');
      for (let i = 0; i < spitters; i++) queue.push('spitter');
      for (let i = 0; i < Math.max(0, drones); i++) queue.push('drone');
    }

    // Scale stats with wave — HP, speed, and damage all increase so
    // late waves present genuine pressure, not just HP sponges.
    this.hpMultiplier = 1 + (w - 1) * 0.1;
    this.speedMultiplier = 1 + (w - 1) * 0.04;
    this.damageMultiplier = 1 + (w - 1) * 0.06;

    // Shuffle
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    return queue;
  }

  update(delta, playerPos) {
    // Spawn enemies from queue
    if (this.state === 'spawning') {
      this.spawnTimer -= delta;
      if (this.spawnTimer <= 0 && this.spawnQueue.length > 0) {
        const type = this.spawnQueue.shift();
        this._spawnEnemy(type, playerPos);
        this.spawnTimer = 0.5; // Spawn every 0.5 seconds
      }
      if (this.spawnQueue.length === 0) {
        this.state = 'active';
      }
    }

    // Update all enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const shouldRemove = enemy.update(delta, playerPos);
      if (shouldRemove) {
        enemy.cleanup();
        this.enemies.splice(i, 1);
      }
    }

    // Check if wave complete
    if (this.state === 'active' && this.getAliveCount() === 0) {
      this.state = 'complete';
      this.stateTimer = 3; // 3 second break
    }

    // Wait between waves
    if (this.state === 'complete') {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) {
        this.state = 'waiting';
      }
    }
  }

  _spawnEnemy(type, playerPos) {
    // Pick a spawn point away from player
    let bestPoint = this.spawnPoints[0];
    let bestDist = 0;
    for (const p of this.spawnPoints) {
      const d = p.distanceTo(playerPos);
      if (d > bestDist && d > 20) {
        bestDist = d;
        bestPoint = p;
      }
    }
    // Add some randomness
    const spawnPos = bestPoint.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      0,
      (Math.random() - 0.5) * 10
    ));

    const enemy = new Alien(type, spawnPos, this.scene, this.particles, this.audio);
    enemy.hp = Math.floor(enemy.hp * this.hpMultiplier);
    enemy.maxHp = enemy.hp;
    enemy.data = Object.assign({}, enemy.data, {
      speed: enemy.data.speed * this.speedMultiplier,
      damage: Math.floor(enemy.data.damage * this.damageMultiplier),
    });
    this.enemies.push(enemy);

    // Spawn teleport effect
    if (this.vfx) {
      this.vfx.createSpawnEffect(spawnPos.clone());
    }
  }

  getAliveCount() {
    return this.enemies.filter(e => !e.dead).length;
  }

  getTotalCount() {
    return this.enemies.length;
  }

  cleanup() {
    this.enemies.forEach(e => e.cleanup());
    this.enemies = [];
    this.spawnQueue = [];
  }

  shouldChangeLevelAfterWave() {
    return this.wave > 0 && this.wave % 5 === 0;
  }
}
