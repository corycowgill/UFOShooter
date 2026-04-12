// main.js - Entry point, game loop, ties all systems together
import { FPSControls } from './controls.js';
import { AudioManager } from './audio.js';
import { ParticleSystem } from './particles.js';
import { WeaponManager } from './weapons.js';
import { WaveManager } from './waves.js';
import { Player } from './player.js';
import { HUD } from './hud.js';
import { HelpGuide } from './help.js';
import { VFXManager } from './vfx.js';
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
let controls, audio, particles, weapons, waveManager, player, hud, helpGuide, vfx;
let currentLevelIndex = 0;
let currentLevelData = null;
let selectedStartLevel = 0;
let clock;
let menuScene, menuCamera, menuRenderer, menuUfo;

// ===== INITIALIZATION =====
function init() {
  // Main renderer - enhanced quality
  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

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

  // UFO - detailed
  menuUfo = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 5, 1, 24),
    new THREE.MeshPhongMaterial({ color: 0x334455, emissive: 0x112233, shininess: 60 })
  );
  menuUfo.add(body);
  // Bottom plate
  const bottom = new THREE.Mesh(
    new THREE.CylinderGeometry(4.8, 3.5, 0.3, 24),
    new THREE.MeshPhongMaterial({ color: 0x2a3a4a, emissive: 0x0a1520 })
  );
  bottom.position.y = -0.65;
  menuUfo.add(bottom);
  // Dome - glass-like
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x556677, emissive: 0x223344, transparent: true, opacity: 0.7, shininess: 100 })
  );
  dome.position.y = 0.5;
  menuUfo.add(dome);
  // Dome inner glow
  const domeInner = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.15 })
  );
  domeInner.position.y = 0.5;
  menuUfo.add(domeInner);
  // Window row around middle
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.2),
      new THREE.MeshBasicMaterial({ color: 0x88ffbb, transparent: true, opacity: 0.6, side: THREE.DoubleSide })
    );
    win.position.set(Math.cos(angle) * 4.2, 0, Math.sin(angle) * 4.2);
    win.rotation.y = -angle + Math.PI / 2;
    menuUfo.add(win);
  }
  // Running lights ring
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const rlight = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 6),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0x00ff88 : 0x00ffcc })
    );
    rlight.position.set(Math.cos(angle) * 4.5, -0.5, Math.sin(angle) * 4.5);
    menuUfo.add(rlight);
  }
  // Antenna on top
  const menuAntenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4),
    new THREE.MeshPhongMaterial({ color: 0x888888 })
  );
  menuAntenna.position.y = 2.5;
  menuUfo.add(menuAntenna);
  const menuAntTip = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xff4444 })
  );
  menuAntTip.position.y = 2.95;
  menuUfo.add(menuAntTip);
  // Tractor beam light
  const beamLight = new THREE.PointLight(0x00ff88, 3, 30);
  beamLight.position.y = -1;
  menuUfo.add(beamLight);
  // Decorative ring
  const detailRing = new THREE.Mesh(
    new THREE.TorusGeometry(3.8, 0.04, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.3 })
  );
  detailRing.rotation.x = Math.PI / 2;
  detailRing.position.y = -0.2;
  menuUfo.add(detailRing);
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

const weaponOrder = ['laserRifle', 'laserSword', 'sniperRifle'];
let currentWeaponIdx = 0;
let gamepadFireHoldTimer = 0;

function _setupGamepadCallbacks() {
  if (!controls) return;

  // RT = fire (single press)
  controls.onGamepadFire = () => {
    if (state !== GameState.PLAYING || helpGuide.isOpen) return;
    fireWeapon();
  };

  // RT held = auto-fire for laser rifle
  controls.onGamepadFireHold = () => {
    if (state !== GameState.PLAYING || helpGuide.isOpen) return;
    // Throttle to weapon fire rate via cooldown (handled in weapons.js)
    fireWeapon();
  };

  // LT = zoom (sniper)
  controls.onGamepadZoom = () => {
    if (state !== GameState.PLAYING || helpGuide.isOpen) return;
    weapons.toggleZoom();
  };

  // DPad Left/Up/Right = weapon 1/2/3
  controls.onGamepadWeapon1 = () => {
    if (state !== GameState.PLAYING) return;
    weapons.switchWeapon('laserRifle');
    currentWeaponIdx = 0;
  };
  controls.onGamepadWeapon2 = () => {
    if (state !== GameState.PLAYING) return;
    weapons.switchWeapon('laserSword');
    currentWeaponIdx = 1;
  };
  controls.onGamepadWeapon3 = () => {
    if (state !== GameState.PLAYING) return;
    weapons.switchWeapon('sniperRifle');
    currentWeaponIdx = 2;
  };

  // Y = cycle weapon
  controls.onGamepadCycleWeapon = () => {
    if (state !== GameState.PLAYING) return;
    currentWeaponIdx = (currentWeaponIdx + 1) % weaponOrder.length;
    weapons.switchWeapon(weaponOrder[currentWeaponIdx]);
  };

  // Back/Select = help
  controls.onGamepadHelp = () => {
    if (state === GameState.PLAYING) {
      helpGuide.toggle();
      if (helpGuide.isOpen) controls.unlock();
    }
  };

  // Start = start game / pause
  controls.onGamepadStart = () => {
    if (state === GameState.MENU) {
      startGame();
    } else if (state === GameState.GAME_OVER) {
      startGame();
    } else if (state === GameState.PLAYING && !controls.isLocked && !helpGuide.isOpen) {
      controls.lock();
    }
  };

  // B = close help / back
  controls.onGamepadBack = () => {
    if (helpGuide.isOpen) {
      helpGuide.close();
    }
  };
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
  document.getElementById('scanlines').style.display = 'block';

  // Create scene
  scene = new THREE.Scene();

  // Controls
  controls = new FPSControls(camera, renderer.domElement);
  _setupGamepadCallbacks();

  // Particles
  particles = new ParticleSystem(scene);

  // VFX
  vfx = new VFXManager(camera, scene);

  // Weapons
  weapons = new WeaponManager(camera, scene, particles, audio);

  // Player
  player = new Player();

  // Wave manager
  waveManager = new WaveManager(scene, particles, audio);
  waveManager.vfx = vfx;

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
    if (vfx) { vfx.scene = scene; vfx.cleanup(); }
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

  // Initialize environment particles based on level
  if (vfx) {
    const envType = currentLevelIndex === 0 ? 'dust' : (currentLevelIndex === 2 ? 'embers' : 'dust');
    vfx.initEnvironmentParticles(envType);
  }

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
  document.getElementById('scanlines').style.display = 'none';
  audio.stopMusic();
  if (waveManager) waveManager.cleanup();
  if (particles) particles.cleanup();
  if (vfx) vfx.cleanup();
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
  const enemyPos = hit.enemy.mesh.position;
  const alienData = ALIEN_TYPES[hit.enemy.type];

  // Hit marker and damage number
  if (vfx) {
    vfx.showHitMarker(killed);
    _dmgNumPos.set(enemyPos.x, enemyPos.y + 1.5, enemyPos.z);
    vfx.showDamageNumber(_dmgNumPos, hit.damage, killed);
    // Weapon-specific screen shake
    const weaponKey = hit.weaponKey || 'laserRifle';
    if (weaponKey === 'sniperRifle') {
      vfx.shake(0.06, 0.12);
    } else if (weaponKey === 'laserSword') {
      vfx.shake(0.04, 0.08);
    } else {
      vfx.shake(0.02, 0.05);
    }
  }

  if (killed) {
    player.addKill();
    player.addScore(alienData.scoreValue);

    // Kill feed entry
    if (vfx) {
      const weaponData = weapons.getWeaponData();
      vfx.addKillFeedEntry(alienData.name, weaponData.name);
      // Death dissolve effect
      vfx.createDeathEffect(enemyPos, alienData.color || 0x00ff00, 1);
    }

    // Bloater explosion chain damage
    if (hit.enemy.type === 'bloater') {
      const pos = enemyPos;
      const radius = ALIEN_TYPES.bloater.explosionRadius;
      // Bigger screen shake for explosion
      if (vfx) vfx.shake(0.15, 0.3);

      // Damage nearby enemies
      const radiusSq = radius * radius;
      for (const other of waveManager.enemies) {
        if (other === hit.enemy || other.dead) continue;
        const distSq = other.mesh.position.distanceToSquared(pos);
        if (distSq < radiusSq) {
          const dist = Math.sqrt(distSq);
          const dmg = ALIEN_TYPES.bloater.damage * (1 - dist / radius);
          const chainKill = other.takeDamage(dmg);
          if (chainKill) {
            player.addKill();
            player.addScore(ALIEN_TYPES[other.type].scoreValue);
            if (vfx) {
              vfx.addKillFeedEntry(ALIEN_TYPES[other.type].name, 'EXPLOSION');
              vfx.createDeathEffect(other.mesh.position, ALIEN_TYPES[other.type].color || 0x00ff00, 1);
            }
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
// Reusable vectors for animate() loop - avoid per-frame allocations
const _minimapDir = new THREE.Vector3();
const _dmgNumPos = new THREE.Vector3();

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
  if (vfx) vfx.update(delta, player.hp / player.maxHp);

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
      if (vfx) vfx.shake(0.08, 0.15);
      if (result.type === 'explosion') {
        particles.createExplosion(enemy.mesh.position, 0xff4400, 5, 0.8);
        if (vfx) vfx.shake(0.2, 0.4);
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
  camera.getWorldDirection(_minimapDir);
  hud.drawMinimap(camera.position, _minimapDir, waveManager.enemies);

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
  document.getElementById('scanlines').style.display = 'none';

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
