// main.js - Entry point, game loop, ties all systems together
import { FPSControls } from './controls.js';
import { AudioManager } from './audio.js';
import { ParticleSystem } from './particles.js';
import { WeaponManager } from './weapons.js';
import { WaveManager } from './waves.js';
import { Player } from './player.js';
import { HUD } from './hud.js';
import { HelpGuide } from './help.js';
import { LEVELS } from './levels.js';
import { ALIEN_TYPES } from './aliens.js';

// ===== GAME STATE =====
const GameState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
};

let state = GameState.MENU;
let scene, camera, renderer;
let controls, audio, particles, weapons, waveManager, player, hud, helpGuide;
let currentLevelIndex = 0;
let currentLevelData = null;
let selectedStartLevel = 0;
let clock;
let menuScene, menuCamera, menuRenderer, menuUfo;

// ===== INITIALIZATION =====
function init() {
  // Main renderer
  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 1.7, 0);

  // Clock
  clock = new THREE.Clock();

  // Audio
  audio = new AudioManager();

  // HUD
  hud = new HUD();

  // Help guide
  helpGuide = new HelpGuide();
  helpGuide.init();

  // Setup menu
  initMenu();

  // Event listeners
  setupEventListeners();

  // Hide loading
  document.getElementById('loading').style.display = 'none';

  // Start loop
  animate();
}

function initMenu() {
  const menuCanvas = document.getElementById('menu-canvas');
  menuRenderer = new THREE.WebGLRenderer({ canvas: menuCanvas, alpha: true, antialias: true });
  menuRenderer.setSize(window.innerWidth, window.innerHeight);
  menuRenderer.setClearColor(0x000000, 0);

  menuScene = new THREE.Scene();
  menuScene.fog = new THREE.FogExp2(0x0a0a2e, 0.01);
  menuCamera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
  menuCamera.position.set(0, 5, 20);
  menuCamera.lookAt(0, 3, 0);

  // Stars
  const starGeo = new THREE.BufferGeometry();
  const starVerts = [];
  for (let i = 0; i < 2000; i++) {
    starVerts.push(
      (Math.random() - 0.5) * 400,
      (Math.random() - 0.5) * 400,
      (Math.random() - 0.5) * 400
    );
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5 });
  menuScene.add(new THREE.Points(starGeo, starMat));

  // UFO
  menuUfo = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 5, 1, 16),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233 })
  );
  menuUfo.add(body);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x223344 })
  );
  dome.position.y = 0.5;
  menuUfo.add(dome);
  // Lights
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x00ff88 })
    );
    light.position.set(Math.cos(angle) * 4.5, -0.5, Math.sin(angle) * 4.5);
    menuUfo.add(light);
  }
  const beamLight = new THREE.PointLight(0x00ff88, 2, 30);
  beamLight.position.y = -1;
  menuUfo.add(beamLight);
  menuUfo.position.set(0, 8, -5);
  menuScene.add(menuUfo);

  // Lighting
  menuScene.add(new THREE.AmbientLight(0x223344, 0.5));
  const dirLight = new THREE.DirectionalLight(0x6688ff, 0.5);
  dirLight.position.set(5, 10, 5);
  menuScene.add(dirLight);

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshPhongMaterial({ color: 0x111122 })
  );
  ground.rotation.x = -Math.PI / 2;
  menuScene.add(ground);
}

function startGameAtLevel(levelIdx) {
  selectedStartLevel = levelIdx;
  startGame();
}

function setupEventListeners() {
  // Start button
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-help').addEventListener('click', () => helpGuide.open());
  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.getElementById('btn-menu').addEventListener('click', returnToMenu);

  // Level select
  document.getElementById('btn-select-level').addEventListener('click', () => {
    document.getElementById('level-select').style.display = 'flex';
  });
  document.getElementById('btn-back-menu').addEventListener('click', () => {
    document.getElementById('level-select').style.display = 'none';
  });
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('level-select').style.display = 'none';
      startGameAtLevel(parseInt(btn.dataset.level));
    });
  });

  // Pointer lock
  document.getElementById('gameCanvas').addEventListener('click', () => {
    if (state === GameState.PLAYING && !helpGuide.isOpen) {
      controls.lock();
    }
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (state === GameState.PLAYING) {
      switch (e.code) {
        case 'Digit1': weapons.switchWeapon('laserRifle'); break;
        case 'Digit2': weapons.switchWeapon('laserSword'); break;
        case 'Digit3': weapons.switchWeapon('sniperRifle'); break;
        case 'KeyH':
        case 'Tab':
          e.preventDefault();
          helpGuide.toggle();
          if (helpGuide.isOpen) {
            controls.unlock();
          }
          break;
      }
    }
    if (e.code === 'Escape' && helpGuide.isOpen) {
      helpGuide.close();
    }
  });

  // Mouse
  document.addEventListener('mousedown', (e) => {
    if (state !== GameState.PLAYING || !controls.isLocked || helpGuide.isOpen) return;
    if (e.button === 0) {
      // Left click - fire
      fireWeapon();
    } else if (e.button === 2) {
      // Right click - zoom (sniper)
      weapons.toggleZoom();
    }
  });

  // Prevent context menu
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Resize
  window.addEventListener('resize', () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    if (menuRenderer) {
      menuRenderer.setSize(w, h);
      menuCamera.aspect = w / h;
      menuCamera.updateProjectionMatrix();
    }
  });
}

function startGame() {
  // Init audio on user interaction
  if (!audio.ctx) audio.init();
  audio.resume();

  // Reset state
  state = GameState.PLAYING;
  currentLevelIndex = selectedStartLevel;

  // Hide menus
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('game-over').style.display = 'none';

  // Show game UI
  document.getElementById('hud').style.display = 'block';
  document.getElementById('crosshair').style.display = 'block';
  document.getElementById('weapon-model').style.display = 'block';

  // Create scene
  scene = new THREE.Scene();

  // Controls
  controls = new FPSControls(camera, renderer.domElement);

  // Particles
  particles = new ParticleSystem(scene);

  // Weapons
  weapons = new WeaponManager(camera, scene, particles, audio);

  // Player
  player = new Player();

  // Wave manager
  waveManager = new WaveManager(scene, particles, audio);

  // Load selected level
  loadLevel(currentLevelIndex);

  // Start music
  audio.startMusic();

  // Lock pointer
  controls.lock();
}

function loadLevel(index) {
  // Clean up previous level
  if (currentLevelData) {
    scene.remove(currentLevelData.group);
    // Remove fog and lights from scene
    scene.fog = null;
    // Remove all non-essential objects
    const toRemove = [];
    scene.traverse(child => {
      if (child !== camera && child.type !== 'Scene') {
        toRemove.push(child);
      }
    });
    // Actually just rebuild the scene
    scene = new THREE.Scene();
    controls.camera = camera;
    particles.scene = scene;
    particles.cleanup();
    waveManager.scene = scene;
    waveManager.cleanup();
    weapons.scene = scene;
  }

  currentLevelIndex = index % LEVELS.length;
  const level = LEVELS[currentLevelIndex];
  currentLevelData = level.builder(scene);
  waveManager.setSpawnPoints(currentLevelData.spawnPoints);

  // Reset player position
  camera.position.set(0, 1.7, 30);

  // Show level announcement
  hud.showWaveAnnouncement(waveManager.wave + 1, level.name, true);
}

function returnToMenu() {
  state = GameState.MENU;
  selectedStartLevel = 0;
  document.getElementById('main-menu').style.display = 'flex';
  document.getElementById('game-over').style.display = 'none';
  document.getElementById('level-select').style.display = 'none';
  document.getElementById('hud').style.display = 'none';
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('weapon-model').style.display = 'none';
  audio.stopMusic();
  if (waveManager) waveManager.cleanup();
  if (particles) particles.cleanup();
}

function fireWeapon() {
  const result = weapons.fire(waveManager.enemies);
  if (!result) return;

  // Handle hits
  if (Array.isArray(result)) {
    // Melee hits multiple
    for (const hit of result) {
      if (hit.hit) {
        processHit(hit);
      }
    }
  } else if (result.hit) {
    processHit(result);
  }
}

function processHit(hit) {
  const killed = hit.enemy.takeDamage(hit.damage);
  if (killed) {
    player.addKill();
    player.addScore(ALIEN_TYPES[hit.enemy.type].scoreValue);

    // Bloater explosion chain damage
    if (hit.enemy.type === 'bloater') {
      const pos = hit.enemy.mesh.position;
      const radius = ALIEN_TYPES.bloater.explosionRadius;
      // Damage nearby enemies
      for (const other of waveManager.enemies) {
        if (other === hit.enemy || other.dead) continue;
        const dist = other.mesh.position.distanceTo(pos);
        if (dist < radius) {
          const dmg = ALIEN_TYPES.bloater.damage * (1 - dist / radius);
          const chainKill = other.takeDamage(dmg);
          if (chainKill) {
            player.addKill();
            player.addScore(ALIEN_TYPES[other.type].scoreValue);
          }
        }
      }
      // Damage player if close
      const playerDist = camera.position.distanceTo(pos);
      if (playerDist < radius) {
        const dmg = ALIEN_TYPES.bloater.damage * (1 - playerDist / radius);
        player.takeDamage(dmg, audio);
      }
    }
  }
}

// ===== GAME LOOP =====
let lastWaveState = '';

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05); // Cap delta

  if (state === GameState.MENU) {
    updateMenu(delta);
    return;
  }

  if (state === GameState.GAME_OVER) return;
  if (state !== GameState.PLAYING) return;
  if (helpGuide.isOpen) return; // Pause while help is open

  // Update systems
  controls.update(delta, currentLevelData ? currentLevelData.colliders : []);
  player.update(delta);
  particles.update(delta);
  weapons.update(delta);
  hud.updateAnnouncement(delta);

  // Wave management
  const prevState = waveManager.state;
  waveManager.update(delta, camera.position);

  if (waveManager.state === 'complete' && prevState !== 'complete') {
    audio.playWaveComplete();
    hud.showWaveComplete(waveManager.wave);

    // Check level transition
    if (waveManager.shouldChangeLevelAfterWave()) {
      setTimeout(() => {
        loadLevel(currentLevelIndex + 1);
        waveManager.startWave();
        hud.showWaveAnnouncement(waveManager.wave, LEVELS[currentLevelIndex].name, true);
      }, 2500);
    }
  }

  if (waveManager.state === 'waiting' && prevState !== 'waiting') {
    // Auto-start next wave
    setTimeout(() => {
      if (state === GameState.PLAYING && waveManager.state === 'waiting') {
        waveManager.startWave();
        hud.showWaveAnnouncement(waveManager.wave, LEVELS[currentLevelIndex].name, false);
      }
    }, 500);
  }

  // Auto-start first wave
  if (waveManager.wave === 0 && waveManager.state === 'waiting') {
    waveManager.startWave();
    hud.showWaveAnnouncement(waveManager.wave, LEVELS[currentLevelIndex].name, false);
  }

  // Check enemy collisions with player
  for (const enemy of waveManager.enemies) {
    const result = enemy.checkPlayerCollision(camera.position, delta);
    if (result) {
      player.takeDamage(result.damage, audio);
      if (result.type === 'explosion') {
        particles.createExplosion(enemy.mesh.position.clone(), 0xff4400, 5, 0.8);
      }
    }
  }

  // Check player death
  if (player.dead) {
    gameOver();
    return;
  }

  // Rotate UFO mothership
  if (currentLevelData && currentLevelData.ufo) {
    currentLevelData.ufo.rotation.y += delta * 0.1;
  }

  // Update HUD
  hud.update(player, waveManager, weapons.getWeaponData(), LEVELS[currentLevelIndex].name);

  // Minimap
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  hud.drawMinimap(camera.position, dir, waveManager.enemies);

  // Render
  renderer.render(scene, camera);
}

function updateMenu(delta) {
  if (menuUfo) {
    menuUfo.rotation.y += delta * 0.3;
    menuUfo.position.y = 8 + Math.sin(performance.now() * 0.001) * 1.5;
  }
  if (menuRenderer && menuScene && menuCamera) {
    menuRenderer.render(menuScene, menuCamera);
  }
}

function gameOver() {
  state = GameState.GAME_OVER;
  controls.unlock();
  audio.stopMusic();

  document.getElementById('hud').style.display = 'none';
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('weapon-model').style.display = 'none';
  document.getElementById('scope-overlay').style.display = 'none';

  document.getElementById('game-over').style.display = 'flex';
  document.getElementById('go-waves').textContent = waveManager.wave;
  document.getElementById('go-kills').textContent = player.kills;
  document.getElementById('go-score').textContent = player.score;
}

// ===== START =====
// Module may load after DOMContentLoaded has already fired
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
