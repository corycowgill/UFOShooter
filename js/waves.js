// waves.js - Wave spawning system
import { Alien } from './aliens.js';

const WAVE_THEMES = [
  null,
  { name: 'SWARM RUSH', mix: { swarmer: 0.55, stalker: 0.25, grunt: 0.2 } },
  { name: 'HEAVY ASSAULT', mix: { bloater: 0.35, grunt: 0.35, spitter: 0.3 } },
  { name: 'AIR STRIKE', mix: { drone: 0.5, spitter: 0.25, grunt: 0.25 } },
  { name: 'SHADOW HUNT', mix: { stalker: 0.45, swarmer: 0.3, spitter: 0.25 } },
  { name: 'ACID RAIN', mix: { spitter: 0.45, drone: 0.3, bloater: 0.25 } },
];

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
    this.waveTheme = null;
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

    // Pick theme — themed waves appear from wave 3 onward, ~40% chance
    this.waveTheme = null;
    if (w >= 3 && Math.random() < 0.4) {
      const pool = w >= 7 ? WAVE_THEMES.slice(1) : WAVE_THEMES.slice(1, 3);
      this.waveTheme = pool[Math.floor(Math.random() * pool.length)];
    }

    if (this.waveTheme) {
      const mix = this.waveTheme.mix;
      const types = Object.keys(mix);
      let remaining = maxEnemies;
      for (let t = 0; t < types.length; t++) {
        const count = t === types.length - 1
          ? remaining
          : Math.ceil(maxEnemies * mix[types[t]]);
        for (let i = 0; i < Math.min(count, remaining); i++) {
          queue.push({ type: types[t], elite: false });
        }
        remaining -= Math.min(count, remaining);
      }
    } else if (w <= 3) {
      const grunts = Math.ceil(maxEnemies * 0.55);
      const swarmers = Math.ceil(maxEnemies * 0.3);
      const stalkers = maxEnemies - grunts - swarmers;
      for (let i = 0; i < grunts; i++) queue.push({ type: 'grunt', elite: false });
      for (let i = 0; i < swarmers; i++) queue.push({ type: 'swarmer', elite: false });
      for (let i = 0; i < Math.max(0, stalkers); i++) queue.push({ type: 'stalker', elite: false });
    } else if (w <= 6) {
      const grunts = Math.ceil(maxEnemies * 0.25);
      const swarmers = Math.ceil(maxEnemies * 0.2);
      const bloaters = Math.ceil(maxEnemies * 0.15);
      const stalkers = Math.ceil(maxEnemies * 0.2);
      const spitters = maxEnemies - grunts - swarmers - bloaters - stalkers;
      for (let i = 0; i < grunts; i++) queue.push({ type: 'grunt', elite: false });
      for (let i = 0; i < swarmers; i++) queue.push({ type: 'swarmer', elite: false });
      for (let i = 0; i < bloaters; i++) queue.push({ type: 'bloater', elite: false });
      for (let i = 0; i < stalkers; i++) queue.push({ type: 'stalker', elite: false });
      for (let i = 0; i < Math.max(0, spitters); i++) queue.push({ type: 'spitter', elite: false });
    } else {
      const grunts = Math.ceil(maxEnemies * 0.18);
      const swarmers = Math.ceil(maxEnemies * 0.15);
      const bloaters = Math.ceil(maxEnemies * 0.15);
      const stalkers = Math.ceil(maxEnemies * 0.17);
      const spitters = Math.ceil(maxEnemies * 0.15);
      const drones = maxEnemies - grunts - swarmers - bloaters - stalkers - spitters;
      for (let i = 0; i < grunts; i++) queue.push({ type: 'grunt', elite: false });
      for (let i = 0; i < swarmers; i++) queue.push({ type: 'swarmer', elite: false });
      for (let i = 0; i < bloaters; i++) queue.push({ type: 'bloater', elite: false });
      for (let i = 0; i < stalkers; i++) queue.push({ type: 'stalker', elite: false });
      for (let i = 0; i < spitters; i++) queue.push({ type: 'spitter', elite: false });
      for (let i = 0; i < Math.max(0, drones); i++) queue.push({ type: 'drone', elite: false });
    }

    // Elite enemies — every 3rd wave starting at wave 3
    if (w >= 3 && w % 3 === 0) {
      let eliteCount = Math.min(3, Math.floor(w / 3));
      for (let i = queue.length - 1; i >= 0 && eliteCount > 0; i--) {
        queue[i].elite = true;
        eliteCount--;
      }
    }

    // Boss wave — every 5th wave starting at wave 5
    if (w >= 5 && w % 5 === 0) {
      queue.push({ type: 'boss', elite: false, isBoss: true });
    }

    // Scale stats with wave — non-linear curve for late-game challenge
    this.hpMultiplier = 1 + Math.pow(w - 1, 1.15) * 0.08;
    this.speedMultiplier = 1 + (w - 1) * 0.04;
    this.damageMultiplier = 1 + Math.pow(w - 1, 1.1) * 0.05;

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
        const entry = this.spawnQueue.shift();
        this._spawnEnemy(entry, playerPos);
        this.spawnTimer = 0.5;
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
      this.stateTimer = 3;
    }

    // Wait between waves
    if (this.state === 'complete') {
      this.stateTimer -= delta;
      if (this.stateTimer <= 0) {
        this.state = 'waiting';
      }
    }
  }

  _spawnEnemy(entry, playerPos) {
    const type = typeof entry === 'string' ? entry : entry.type;
    const isElite = typeof entry === 'object' && entry.elite;

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
    const spawnPos = bestPoint.clone().add(new THREE.Vector3(
      (Math.random() - 0.5) * 10,
      0,
      (Math.random() - 0.5) * 10
    ));

    const isBoss = typeof entry === 'object' && entry.isBoss;
    const enemy = new Alien(type, spawnPos, this.scene, this.particles, this.audio);
    if (this.vfx) enemy._vfx = this.vfx;
    enemy.hp = Math.floor(enemy.hp * this.hpMultiplier);
    enemy.maxHp = enemy.hp;
    enemy.data = Object.assign({}, enemy.data, {
      speed: enemy.data.speed * this.speedMultiplier,
      damage: Math.floor(enemy.data.damage * this.damageMultiplier),
    });

    if (isBoss) {
      enemy.isBoss = true;
      enemy._addBossAura();
    } else if (isElite) {
      enemy.hp = Math.floor(enemy.hp * 2.5);
      enemy.maxHp = enemy.hp;
      enemy.data.damage = Math.floor(enemy.data.damage * 1.5);
      enemy.data.scoreValue *= 3;
      enemy.isElite = true;
      enemy.mesh.scale.multiplyScalar(1.25);
      enemy._addEliteAura();
    }

    this.enemies.push(enemy);

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
