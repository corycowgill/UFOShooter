// main.js - Entry point, game loop, ties all systems together
import { FPSControls } from './controls.js';
import { AudioManager } from './audio.js';
import { ParticleSystem } from './particles.js';
import { WeaponManager } from './weapons.js';
import { WaveManager } from './waves.js';
import { Player, PERKS } from './player.js';
import { HUD } from './hud.js';
import { HelpGuide } from './help.js';
import { VFXManager } from './vfx.js';
import { LEVELS } from './levels.js';
import { ALIEN_TYPES } from './aliens.js';
import { disposeTree, initLightPool, initParticleFields, getActiveParticleCount, getActiveLightCount } from './particles.js';
import { PerfProfiler } from './perf.js';

const perf = new PerfProfiler();

// Dispose a rocket projectile mesh + its GPU buffers.
function _disposeProjectile(mesh) {
  disposeTree(mesh);
}

// ===== GAME STATE =====
const GameState = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
};

let state = GameState.MENU;
let scene, camera, renderer;
let composer, renderPass, bloomPass;
let controls, audio, particles, weapons, waveManager, player, hud, helpGuide, vfx;

// Cached DOM refs — populated once to avoid per-frame getElementById
let _domCache = {};
function _cacheDom() {
  _domCache = {
    crosshair: document.getElementById('crosshair'),
    speedLines: document.getElementById('speed-lines'),
    killStreak: document.getElementById('kill-streak'),
    healthBarContainer: document.getElementById('health-bar-container'),
    enemyCallout: document.getElementById('enemy-callout'),
    waveCountdown: document.getElementById('wave-countdown'),
    reloadBarContainer: document.getElementById('reload-bar-container'),
    reloadBar: document.getElementById('reload-bar'),
    bossHealth: document.getElementById('boss-health'),
    bossBarFill: document.getElementById('boss-bar-fill'),
    bossName: document.getElementById('boss-name'),
    damageFlash: document.getElementById('damage-flash'),
    dmgDirN: document.querySelector('.dmg-dir-n'),
    dmgDirS: document.querySelector('.dmg-dir-s'),
    dmgDirE: document.querySelector('.dmg-dir-e'),
    dmgDirW: document.querySelector('.dmg-dir-w'),
  };
}

// ---------------------------------------------------------------------------
// Health pickups — dropped by enemies on death. A glowing green orb floats
// at the kill site, pulses, and is collected when the player walks near it.
// Shared geometry/material keep the per-pickup cost near zero.
// ---------------------------------------------------------------------------
const _pickups = [];
let _pickupGeo = null;
let _pickupMats = {};
const PICKUP_HEAL = 20;
const PICKUP_SHIELD = 30;
const PICKUP_LIFETIME = 15;
const PICKUP_COLLECT_DIST_SQ = 4;
const PICKUP_DROP_CHANCE = 0.3;

function _initPickupPrimitives() {
  if (_pickupGeo) return;
  _pickupGeo = new THREE.SphereGeometry(0.2, 8, 8);
  _pickupGeo.__shared = true;
  const makeMat = (color) => {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false });
    m.color.multiplyScalar(3.0);
    m.__shared = true;
    return m;
  };
  _pickupMats.health = makeMat(0x00ff66);
  _pickupMats.shield = makeMat(0x0088ff);
  _pickupMats.ammo = makeMat(0xffaa00);
  _pickupMats.grenade = makeMat(0x44ff44);
}

function _spawnPickup(position, type) {
  _initPickupPrimitives();
  const kind = type || 'health';
  const mesh = new THREE.Mesh(_pickupGeo, _pickupMats[kind] || _pickupMats.health);
  mesh.position.set(position.x, 0.5, position.z);
  scene.add(mesh);
  _pickups.push({ mesh, life: PICKUP_LIFETIME, type: kind });
}

function _updatePickups(delta, playerPos) {
  for (let i = _pickups.length - 1; i >= 0; i--) {
    const p = _pickups[i];
    p.life -= delta;
    p.mesh.position.y = 0.5 + Math.sin(performance.now() * 0.004 + i) * 0.15;
    p.mesh.rotation.y += delta * 2;
    if (p.life < 3) {
      p.mesh.visible = Math.sin(p.life * 10) > 0;
    }
    const dx = p.mesh.position.x - playerPos.x;
    const dz = p.mesh.position.z - playerPos.z;
    if (dx * dx + dz * dz < PICKUP_COLLECT_DIST_SQ && !player.dead) {
      if (p.type === 'health') {
        player.heal(PICKUP_HEAL);
        if (vfx) vfx.showHealFlash();
      } else if (p.type === 'shield') {
        player.addShield(PICKUP_SHIELD);
        const flash = _domCache.damageFlash;
        if (flash) {
          flash.style.background = 'rgba(0, 100, 255, 0.25)';
          flash.style.opacity = '1';
          setTimeout(() => { flash.style.opacity = '0'; setTimeout(() => { flash.style.background = ''; }, 200); }, 150);
        }
      } else if (p.type === 'ammo') {
        if (weapons) {
          weapons.addAmmo('sniperRifle', 4);
          weapons.addAmmo('rocketLauncher', 2);
        }
      } else if (p.type === 'grenade') {
        if (weapons) weapons.addGrenade(1);
      }
      audio.playPickup();
      _removePickup(i);
      continue;
    }
    if (p.life <= 0) {
      _removePickup(i);
    }
  }
}

function _removePickup(index) {
  const p = _pickups[index];
  scene.remove(p.mesh);
  _pickups.splice(index, 1);
}

function _clearPickups() {
  for (const p of _pickups) scene.remove(p.mesh);
  _pickups.length = 0;
}
// Kill feedback — brief time slowdown on rapid kills
let _killTimeScale = 1;
let _killTimeScaleTimer = 0;
let _recentKills = 0;
let _recentKillTimer = 0;
const MULTI_KILL_WINDOW = 1.0;
const MULTI_KILL_THRESHOLD = 3;

// Detail polish state
let _footstepTimer = 0;
let _crosshairFireTimer = 0;
let _crosshairHitTimer = 0;
let _lastHp = 100;
let _killStreakTimer = 0;
let _heartbeatTimer = 0;
let _dashSoundPlayed = false;
let _dmgDirTimers = { n: 0, s: 0, e: 0, w: 0 };
let _seenEnemyTypes = new Set();
let _calloutTimer = 0;
let _weaponHeat = 0;

const KILL_STREAK_NAMES = [
  '', '', '', 'TRIPLE KILL', 'QUAD KILL',
  'RAMPAGE', 'UNSTOPPABLE', 'GODLIKE', 'LEGENDARY',
];

let currentLevelIndex = 0;
let currentLevelData = null;
let selectedStartLevel = 0;
let clock;
let menuScene, menuCamera, menuRenderer, menuUfo;

// iOS / mobile detection (iPhone, iPad, iPod; also matches iPadOS Safari reporting as Mac with touch)
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_TOUCH = IS_IOS || ('ontouchstart' in window && navigator.maxTouchPoints > 0);

// ===== INITIALIZATION =====
function init() {
  try {
    _init();
  } catch (e) {
    const loading = document.getElementById('loading');
    if (loading) {
      loading.style.whiteSpace = 'pre-wrap';
      loading.style.fontSize = '14px';
      loading.style.padding = '20px';
      loading.style.textAlign = 'left';
      loading.textContent = 'ERROR during init:\n' + (e && e.stack ? e.stack : e);
    }
    console.error('Init failed:', e);
  }
}

function _init() {
  // Main renderer - enhanced quality
  const canvas = document.getElementById('gameCanvas');
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
    logarithmicDepthBuffer: false,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap at 1.5 instead of 2 — retina displays render 4× the fragments at
  // dpr=2 and MSAA mostly hides the downsampling. 44% fewer fragments for
  // nearly identical visual quality.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // The only shadow casters are static world geometry (buildings, props) and
  // the only light source moves with the scene, not per frame. Disable the
  // per-frame shadow map re-render and trigger a single refresh after each
  // level loads. Huge savings on shadow map generation cost.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.physicallyCorrectLights = false;

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 600);
  camera.position.set(0, 1.7, 0);

  // Postprocessing composer — unreal bloom wraps every additive glow
  // (lasers, eyes, muzzle flash, explosion cores, neon signage) in a
  // soft haloed glow that makes the sci-fi look pop. OutputPass handles
  // tonemap + sRGB conversion since the composer's intermediate render
  // target is linear-space float.
  if (window.THREE_POST) {
    const { EffectComposer, RenderPass, UnrealBloomPass, OutputPass } = window.THREE_POST;
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    composer.setSize(window.innerWidth, window.innerHeight);
    renderPass = new RenderPass(null, null); // scene/camera set per-frame
    composer.addPass(renderPass);
    // strength / radius / threshold — threshold 0.9 gates bloom to the
    // HDR-boosted glow cores (laser/bolt/muzzle/explosion/sword) while
    // leaving baseline lit geometry crisp. glowMat's intensity multiplier
    // pushes core colors to 3-5x so they dominate the bloom pass.
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.7,  // strength (reduced from 0.9)
      0.4,  // radius (reduced from 0.6 — smaller radius = cheaper blur)
      0.95  // threshold (higher = fewer pixels bloom, cheaper pass)
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

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

  // Show "ready" splash — the click serves as the user gesture for audio
  const loadStatus = document.getElementById('load-status');
  const loadReady = document.getElementById('load-ready');
  const loadingEl = document.getElementById('loading');
  if (loadStatus) loadStatus.style.display = 'none';
  if (loadReady) loadReady.style.display = 'block';

  const _enterGame = () => {
    loadingEl.style.display = 'none';
    audio.startMenuMusic();
    loadingEl.removeEventListener('click', _enterGame);
    document.removeEventListener('keydown', _enterKeyHandler);
  };
  const _enterKeyHandler = (e) => {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      _enterGame();
    }
  };
  loadingEl.addEventListener('click', _enterGame);
  document.addEventListener('keydown', _enterKeyHandler);

  // Cache frequently-accessed DOM elements
  _cacheDom();

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
    if (state === GameState.PLAYING && !helpGuide.isOpen && !_perkPending) {
      controls.lock();
    }
  });

  // Touch buttons (wired once at startup - they call into live `controls`)
  const wireTouchBtn = (id, onPress) => {
    const el = document.getElementById(id);
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (state !== GameState.PLAYING || helpGuide.isOpen) return;
      onPress();
    };
    el.addEventListener('touchstart', handler, { passive: false });
  };
  wireTouchBtn('touch-fire', () => fireWeapon());
  wireTouchBtn('touch-jump', () => { if (controls) controls.touchJump(); });
  wireTouchBtn('touch-weapon', () => {
    currentWeaponIdx = (currentWeaponIdx + 1) % weaponOrder.length;
    weapons.switchWeapon(weaponOrder[currentWeaponIdx]);
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (state === GameState.PLAYING) {
      switch (e.code) {
        case 'Digit1': weapons.switchWeapon('laserRifle'); currentWeaponIdx = 0; break;
        case 'Digit2': weapons.switchWeapon('laserSword'); currentWeaponIdx = 1; break;
        case 'Digit3': weapons.switchWeapon('sniperRifle'); currentWeaponIdx = 2; break;
        case 'Digit4': weapons.switchWeapon('rocketLauncher'); currentWeaponIdx = 3; break;
        case 'KeyQ': weapons.throwGrenade(); break;
        case 'KeyR': weapons.reload(); break;
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
    // Performance profiler
    if (e.code === 'F3') { e.preventDefault(); perf.toggle(); }
    if (e.code === 'F4') { e.preventDefault(); perf.dumpReport(); }
  });

  // Mouse
  document.addEventListener('mousedown', (e) => {
    if (state !== GameState.PLAYING || !controls.isLocked || helpGuide.isOpen) return;
    if (e.button === 0) {
      // Left click - fire
      fireWeapon();
    } else if (e.button === 2) {
      // Right click - alt fire or zoom
      if (weapons.current === 'sniperRifle' && !weapons.zoomed) {
        weapons.toggleZoom();
      } else if (weapons.current === 'sniperRifle' && weapons.zoomed) {
        fireWeaponAlt();
      } else {
        fireWeaponAlt();
      }
    }
  });

  // Mouse wheel - cycle weapons
  document.addEventListener('wheel', (e) => {
    if (state !== GameState.PLAYING || !controls.isLocked || helpGuide.isOpen) return;
    if (e.deltaY > 0) {
      currentWeaponIdx = (currentWeaponIdx + 1) % weaponOrder.length;
    } else if (e.deltaY < 0) {
      currentWeaponIdx = (currentWeaponIdx - 1 + weaponOrder.length) % weaponOrder.length;
    }
    weapons.switchWeapon(weaponOrder[currentWeaponIdx]);
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
    if (composer) {
      composer.setSize(w, h);
      if (bloomPass) bloomPass.setSize(w, h);
    }
    if (menuRenderer) {
      menuRenderer.setSize(w, h);
      menuCamera.aspect = w / h;
      menuCamera.updateProjectionMatrix();
    }
  });
}

const weaponOrder = ['laserRifle', 'laserSword', 'sniperRifle', 'rocketLauncher'];
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

  // LB (Button 4) = grenade
  controls.onGamepadGrenade = () => {
    if (state !== GameState.PLAYING || helpGuide.isOpen) return;
    weapons.throwGrenade();
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
  audio.stopMenuMusic();

  // Reset state
  state = GameState.PLAYING;
  currentLevelIndex = selectedStartLevel;
  _seenEnemyTypes = new Set();
  _weaponHeat = 0;
  _lastHp = 100;

  // Hide menus
  document.getElementById('main-menu').style.display = 'none';
  document.getElementById('game-over').style.display = 'none';

  // Show game UI
  document.getElementById('hud').style.display = 'block';
  document.getElementById('crosshair').style.display = 'block';
  document.getElementById('weapon-model').style.display = 'block';
  document.getElementById('scanlines').style.display = 'block';
  document.getElementById('vignette').style.display = 'block';

  // Create scene
  scene = new THREE.Scene();

  // Controls
  controls = new FPSControls(camera, renderer.domElement);
  _setupGamepadCallbacks();

  // Enable touch controls on iOS / touch devices
  if (IS_TOUCH) {
    controls.enableTouchControls({
      onFire: () => fireWeapon(),
      onJump: () => controls.touchJump(),
      onCycleWeapon: () => {
        currentWeaponIdx = (currentWeaponIdx + 1) % weaponOrder.length;
        weapons.switchWeapon(weaponOrder[currentWeaponIdx]);
      },
    });
    document.getElementById('touch-controls').classList.add('active');
  }

  // Particles
  particles = new ParticleSystem(scene);

  // VFX
  vfx = new VFXManager(camera, scene);

  // Weapons
  weapons = new WeaponManager(camera, scene, particles, audio);
  // Rocket detonation hits are delivered asynchronously
  weapons.onRocketHit = (hits, pos) => {
    if (vfx) {
      vfx.shake(0.3, 0.5);
      vfx.createScorchMark(pos, 3);
    }
    for (const hit of hits) processHit(hit);
  };
  weapons.onGrenadeHit = (hits, pos) => {
    if (vfx) {
      vfx.shake(0.25, 0.4);
      vfx.createScorchMark(pos, 2.5);
    }
    for (const hit of hits) processHit(hit);
  };

  // Player
  player = new Player();
  weapons.player = player;

  // Wave manager
  waveManager = new WaveManager(scene, particles, audio);
  waveManager.vfx = vfx;

  // Load selected level
  loadLevel(currentLevelIndex);

  // Start music + ambient
  audio.startMusic();
  audio.startAmbient();

  // Lock pointer
  controls.lock();
}

function loadLevel(index) {
  // Clean up previous level
  if (currentLevelData) {
    scene.remove(currentLevelData.group);
    // Dispose all GPU buffers from the old level (buildings, cars, props)
    disposeTree(currentLevelData.group);
    // Remove fog and lights from scene
    scene.fog = null;
    // Dispose any remaining GPU resources on scene before rebuilding
    disposeTree(scene);
    // Rebuild the scene
    scene = new THREE.Scene();
    controls.camera = camera;
    particles.scene = scene;
    // Re-seed the shared PointLight pool and GPU particle fields into the new scene
    initLightPool(scene);
    initParticleFields(scene);
    particles.cleanup();
    if (vfx) { vfx.scene = scene; vfx.cleanup(); }
    waveManager.scene = scene;
    waveManager.cleanup();
    _clearPickups();
    // Clear any in-flight rocket/grenade projectiles (they reference the old scene)
    if (weapons && weapons.projectiles) {
      for (const p of weapons.projectiles) {
        if (p.mesh) _disposeProjectile(p.mesh);
      }
      weapons.projectiles.length = 0;
    }
    if (weapons && weapons.grenadeProjectiles) {
      for (const g of weapons.grenadeProjectiles) {
        if (g.mesh) disposeTree(g.mesh);
      }
      weapons.grenadeProjectiles.length = 0;
    }
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
    vfx.initRain();
    vfx.initGroundFog();
    vfx.initLightning();
    vfx.initSmokeWisps();
    vfx.initPuddles();
    vfx.initDustMotes();
  }

  // One-shot shadow map refresh — static world just finished building, so
  // bake shadows once and freeze the shadow cascade until the next level.
  renderer.shadowMap.needsUpdate = true;

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
  document.getElementById('vignette').style.display = 'none';
  const tc = document.getElementById('touch-controls');
  if (tc) tc.classList.remove('active');
  audio.stopMusic();
  audio.stopAmbient();
  audio.stopHeartbeat();
  audio.startMenuMusic();
  _hideOverlays();
  if (waveManager) waveManager.cleanup();
  if (particles) particles.cleanup();
  if (vfx) vfx.cleanup();
}

function fireWeaponAlt() {
  // Sword dash strike triggers a player dash
  weapons._onDashStrike = () => {
    if (controls && controls.dashCooldown <= 0) {
      controls.dashTimer = 0.12;
    }
  };
  // Burst fire delivers delayed hits
  weapons._onAltHit = (hit) => {
    if (hit && hit.hit) processHit(hit);
  };
  const result = weapons.fireAlt(waveManager.enemies);
  if (!result) return;
  if (Array.isArray(result)) {
    for (const hit of result) {
      if (hit.hit) processHit(hit);
    }
  } else if (result.hit) {
    processHit(result);
  }
}

function _hideOverlays() {
  const ids = ['boss-health', 'kill-streak', 'speed-lines', 'wave-countdown', 'enemy-callout'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active', 'mega', 'enraged');
  }
  document.querySelectorAll('.dmg-dir-wedge').forEach(el => el.classList.remove('active'));
}

function _showDamageDirection(enemyPos) {
  camera.getWorldDirection(_tmpFwd);
  _tmpFwd.y = 0;
  _tmpFwd.normalize();
  const right = _tmpRight.crossVectors(_tmpFwd, _UP).normalize();
  _tmpToE.subVectors(enemyPos, camera.position);
  _tmpToE.y = 0;
  _tmpToE.normalize();
  const dotFwd = _tmpFwd.dot(_tmpToE);
  const dotRight = right.dot(_tmpToE);
  let dir;
  if (Math.abs(dotFwd) > Math.abs(dotRight)) {
    dir = dotFwd > 0 ? 'n' : 's';
  } else {
    dir = dotRight > 0 ? 'e' : 'w';
  }
  // Map: 'n' = front (from ahead), 's' = behind, 'e' = right, 'w' = left
  // Show the indicator on the side the damage came FROM
  _dmgDirTimers[dir] = 0.5;
  const dirEls = { n: _domCache.dmgDirN, s: _domCache.dmgDirS, e: _domCache.dmgDirE, w: _domCache.dmgDirW };
  if (dirEls[dir]) dirEls[dir].classList.add('active');
}

let _lastBossActive = false;
let _lastBossPct = -1;
let _lastBossEnraged = false;
let _lastBossName = '';

function _updateBossHealthBar(enemies) {
  const bossEl = _domCache.bossHealth;
  if (!bossEl) return;
  let boss = null;
  for (const e of enemies) {
    if (e.isBoss && !e.dead) { boss = e; break; }
  }
  if (boss) {
    if (!_lastBossActive) {
      bossEl.classList.add('active');
      _lastBossActive = true;
    }
    const pct = Math.round(Math.max(0, boss.hp / boss.maxHp * 100));
    if (pct !== _lastBossPct) {
      if (_domCache.bossBarFill) _domCache.bossBarFill.style.width = pct + '%';
      _lastBossPct = pct;
    }
    const name = boss.isElite ? '◆ ELITE OVERLORD' : '◆ OVERLORD';
    if (name !== _lastBossName) {
      if (_domCache.bossName) _domCache.bossName.textContent = name;
      _lastBossName = name;
    }
    const enraged = pct < 30;
    if (enraged !== _lastBossEnraged) {
      if (enraged) bossEl.classList.add('enraged');
      else bossEl.classList.remove('enraged');
      _lastBossEnraged = enraged;
    }
  } else if (_lastBossActive) {
    bossEl.classList.remove('active', 'enraged');
    _lastBossActive = false;
    _lastBossPct = -1;
    _lastBossEnraged = false;
    _lastBossName = '';
  }
}

function _crosshairFire() {
  if (_domCache.crosshair) {
    _domCache.crosshair.classList.add('firing');
    _crosshairFireTimer = 0.12;
  }
}
function _crosshairHit() {
  if (_domCache.crosshair) {
    _domCache.crosshair.classList.add('hit');
    _crosshairHitTimer = 0.15;
  }
}

function fireWeapon() {
  const result = weapons.fire(waveManager.enemies);
  if (!result) return;
  _crosshairFire();

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
  let damage = hit.damage;
  let isCrit = false;
  if (hit.point && hit.enemy.mesh) {
    const hitY = hit.point.y;
    const baseY = hit.enemy.mesh.position.y;
    const heights = { grunt: 1.8, swarmer: 1.0, bloater: 2.0, stalker: 1.6, spitter: 1.8, drone: 1.4, boss: 3.5 };
    const h = heights[hit.enemy.type] || 1.5;
    if (hitY > baseY + h * 0.7) {
      isCrit = true;
      damage = Math.floor(damage * 2);
    }
  }
  const killed = hit.enemy.takeDamage(damage);
  const enemyPos = hit.enemy.mesh.position;
  const alienData = ALIEN_TYPES[hit.enemy.type];
  _crosshairHit();

  // Crit feedback
  if (isCrit) {
    if (audio.playCritHit) audio.playCritHit();
  }

  // Hit marker and damage number
  if (vfx) {
    vfx.showHitMarker(killed);
    _dmgNumPos.set(enemyPos.x, enemyPos.y + 1.5, enemyPos.z);
    vfx.showDamageNumber(_dmgNumPos, damage, killed, isCrit);
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

    // Kill feedback — track rapid kills and trigger time slowdown + streak
    _recentKills++;
    _recentKillTimer = MULTI_KILL_WINDOW;
    if (_recentKills >= MULTI_KILL_THRESHOLD) {
      _killTimeScale = 0.35;
      _killTimeScaleTimer = 0.4;
      audio.playMultiKill();
      const streakName = KILL_STREAK_NAMES[Math.min(_recentKills, KILL_STREAK_NAMES.length - 1)];
      if (streakName) {
        if (_domCache.killStreak) {
          _domCache.killStreak.textContent = streakName;
          _domCache.killStreak.classList.remove('active', 'mega');
          void _domCache.killStreak.offsetWidth;
          _domCache.killStreak.classList.add('active');
          if (_recentKills >= 6) _domCache.killStreak.classList.add('mega');
          _killStreakTimer = 1.5;
        }
      }
      _recentKills = 0;
    }

    // Vampire perk
    if (player.vampireHeal > 0) player.heal(player.vampireHeal);

    // Pickup drops — varied types based on luck
    const dropChance = PICKUP_DROP_CHANCE + (alienData.hp > 50 ? 0.15 : 0) + player.dropRateBonus;
    const guaranteedDrop = hit.enemy.isElite;
    if (guaranteedDrop || Math.random() < dropChance) {
      const roll = Math.random();
      let pickupType = 'health';
      if (roll < 0.12) pickupType = 'grenade';
      else if (roll < 0.25) pickupType = 'ammo';
      else if (roll < 0.38) pickupType = 'shield';
      _spawnPickup(enemyPos, pickupType);
    }

    // Kill feed entry + type-scaled death VFX
    if (vfx) {
      const weaponData = weapons.getWeaponData();
      vfx.addKillFeedEntry(alienData.name, weaponData.name);
      const deathScale = { bloater: 2.5, drone: 0.6, swarmer: 0.5, stalker: 0.8, spitter: 1.3 }[hit.enemy.type] || 1;
      vfx.createDeathEffect(enemyPos, alienData.color || 0x00ff00, deathScale);
    }

    // Bloater explosion chain damage
    if (hit.enemy.type === 'bloater') {
      const pos = enemyPos;
      const radius = ALIEN_TYPES.bloater.explosionRadius;
      if (vfx) {
        vfx.shake(0.15, 0.3);
        vfx.createScorchMark(pos, radius * 0.6);
      }

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
            if (Math.random() < PICKUP_DROP_CHANCE) {
              const cr = Math.random();
              _spawnPickup(other.mesh.position, cr < 0.15 ? 'ammo' : (cr < 0.3 ? 'shield' : 'health'));
            }
            if (vfx) {
              vfx.addKillFeedEntry(ALIEN_TYPES[other.type].name, 'EXPLOSION');
              vfx.createDeathEffect(other.mesh.position, ALIEN_TYPES[other.type].color || 0x00ff00, 1);
            }
          }
        }
      }
      // Damage player if close (dash = invincible)
      const playerDist = camera.position.distanceTo(pos);
      if (playerDist < radius && !(controls && controls.dashTimer > 0)) {
        const dmg = ALIEN_TYPES.bloater.damage * (1 - playerDist / radius);
        player.takeDamage(dmg, audio);
        if (vfx) vfx.triggerChromaticAberration(dmg / 15);
      }
    }
  }
}

// ===== PERK SELECTION =====
let _perkPending = false;

function _showPerkSelection(onComplete) {
  const el = document.getElementById('perk-select');
  if (!el) { onComplete(); return; }

  if (controls) controls.unlock();

  // Pick 3 random unique perks
  const pool = PERKS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const choices = pool.slice(0, 3);

  el.innerHTML = '<div class="perk-title">CHOOSE AN UPGRADE</div><div class="perk-cards"></div>';
  const cards = el.querySelector('.perk-cards');
  _perkPending = true;

  for (const perk of choices) {
    const card = document.createElement('button');
    card.className = 'perk-card';
    card.innerHTML = `<div class="perk-name">${perk.name}</div><div class="perk-desc">${perk.desc}</div>`;
    card.addEventListener('click', () => {
      player.addPerk(perk.id);
      if (perk.id === 'quickFeet' && controls) {
        controls.speed = 12 * player.speedMultiplier;
      }
      el.style.display = 'none';
      _perkPending = false;
      hud.updatePerks(player.perks);
      if (controls) controls.lock();
      onComplete();
    });
    cards.appendChild(card);
  }
  el.style.display = 'flex';
}

// ===== GAME LOOP =====
let lastWaveState = '';
let _frameCounter = 0;
// Reusable vectors for animate() loop - avoid per-frame allocations
const _minimapDir = new THREE.Vector3();
const _dmgNumPos = new THREE.Vector3();
const _tmpFwd = new THREE.Vector3();
const _tmpRight = new THREE.Vector3();
const _tmpToE = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);

function animate() {
  requestAnimationFrame(animate);
  let delta = Math.min(clock.getDelta(), 0.05); // Cap delta
  _frameCounter++;

  if (state === GameState.MENU) {
    updateMenu(delta);
    return;
  }

  if (state === GameState.GAME_OVER) return;
  if (state !== GameState.PLAYING) return;
  if (helpGuide.isOpen) return;
  if (_perkPending) return;

  // Kill feedback time scale
  if (_killTimeScaleTimer > 0) {
    _killTimeScaleTimer -= delta;
    if (_killTimeScaleTimer <= 0) {
      _killTimeScale = 1;
    }
  }
  if (_recentKillTimer > 0) {
    _recentKillTimer -= delta;
    if (_recentKillTimer <= 0) _recentKills = 0;
  }
  delta *= _killTimeScale;

  perf.frameBegin();

  // Update systems
  perf.sectionBegin('controls');
  controls.update(delta, currentLevelData ? currentLevelData.colliders : []);
  perf.sectionEnd('controls');
  perf.sectionBegin('player');
  player.update(delta);
  perf.sectionEnd('player');
  perf.sectionBegin('particles');
  particles.update(delta);
  perf.sectionEnd('particles');

  // Feed movement direction to weapon for tilt
  if (weapons && controls) {
    const dir = controls.direction;
    const right = controls._tmpRight;
    const fwd = controls._tmpForward;
    const sideSpeed = dir.x * right.x + dir.z * right.z;
    const fwdSpeed = dir.x * fwd.x + dir.z * fwd.z;
    weapons._moveTiltX = (weapons._moveTiltX || 0) + (sideSpeed - (weapons._moveTiltX || 0)) * Math.min(1, 8 * delta);
    weapons._moveTiltZ = (weapons._moveTiltZ || 0) + (fwdSpeed - (weapons._moveTiltZ || 0)) * Math.min(1, 8 * delta);
  }
  perf.sectionBegin('weapons');
  weapons.update(delta, waveManager ? waveManager.enemies : null);
  perf.sectionEnd('weapons');
  hud.updateAnnouncement(delta);

  // Footsteps
  if (controls && controls.onGround && controls.direction.length() > 0.1 && controls.dashTimer <= 0) {
    const stepInterval = controls.sprint ? 0.28 : 0.4;
    _footstepTimer -= delta;
    if (_footstepTimer <= 0) {
      audio.playFootstep(controls.sprint);
      _footstepTimer = stepInterval;
    }
  } else {
    _footstepTimer = 0;
  }

  // Dash sound
  if (controls && controls.dashTimer > 0 && !_dashSoundPlayed) {
    audio.playDash();
    _dashSoundPlayed = true;
  }
  if (controls && controls.dashTimer <= 0) _dashSoundPlayed = false;

  // Crosshair dynamics
  if (_crosshairFireTimer > 0) {
    _crosshairFireTimer -= delta;
    if (_crosshairFireTimer <= 0) {
      if (_domCache.crosshair) _domCache.crosshair.classList.remove('firing');
    }
  }
  if (_crosshairHitTimer > 0) {
    _crosshairHitTimer -= delta;
    if (_crosshairHitTimer <= 0) {
      if (_domCache.crosshair) _domCache.crosshair.classList.remove('hit');
    }
  }

  // Health bar damage flash
  if (player.hp < _lastHp) {
    const hbc = _domCache.healthBarContainer;
    if (hbc) {
      hbc.classList.remove('damage-flash');
      void hbc.offsetWidth;
      hbc.classList.add('damage-flash');
    }
  }
  _lastHp = player.hp;

  // Low health heartbeat
  const hpPct = player.hp / player.maxHp;
  if (hpPct < 0.25 && hpPct > 0) {
    audio.startHeartbeat();
    _heartbeatTimer -= delta;
    if (_heartbeatTimer <= 0) {
      audio._pulseHeartbeat();
      _heartbeatTimer = 0.8 + hpPct * 2;
    }
  } else {
    audio.stopHeartbeat();
    _heartbeatTimer = 0;
  }

  // Kill streak announcement
  if (_killStreakTimer > 0) {
    _killStreakTimer -= delta;
    if (_killStreakTimer <= 0) {
      if (_domCache.killStreak) _domCache.killStreak.classList.remove('active', 'mega');
    }
  }
  perf.sectionBegin('vfx');
  if (vfx) {
    vfx.update(delta, player.hp / player.maxHp, camera.position);
    if (vfx.lastAcidDamage && !player.dead && !(controls && controls.dashTimer > 0)) {
      player.takeDamage(vfx.lastAcidDamage, audio);
    }
  }
  perf.sectionEnd('vfx');

  // Wave management
  perf.sectionBegin('waves');
  const prevState = waveManager.state;
  waveManager.update(delta, camera.position);
  perf.sectionEnd('waves');

  if (waveManager.state === 'complete' && prevState !== 'complete') {
    audio.playWaveComplete();
    hud.showWaveComplete(waveManager.wave);

    // Check level transition
    if (waveManager.shouldChangeLevelAfterWave()) {
      setTimeout(() => {
        loadLevel(currentLevelIndex + 1);
        _showPerkSelection(() => {
          waveManager.startWave();
          const theme = waveManager.waveTheme;
          hud.showWaveAnnouncement(waveManager.wave, LEVELS[currentLevelIndex].name, true, theme ? theme.name : null);
        });
      }, 2500);
    } else {
      setTimeout(() => {
        _showPerkSelection(() => {
          waveManager.startWave();
          const theme = waveManager.waveTheme;
          hud.showWaveAnnouncement(waveManager.wave, LEVELS[currentLevelIndex].name, false, theme ? theme.name : null);
        });
      }, 2000);
    }
  }

  // Auto-start first wave
  if (waveManager.wave === 0 && waveManager.state === 'waiting') {
    waveManager.startWave();
    const theme = waveManager.waveTheme;
    hud.showWaveAnnouncement(waveManager.wave, LEVELS[currentLevelIndex].name, false, theme ? theme.name : null);
  }

  // Update health pickups
  _updatePickups(delta, camera.position);

  // Check enemy collisions with player (dash = i-frames)
  perf.sectionBegin('collision');
  const dashing = controls && controls.dashTimer > 0;
  for (const enemy of waveManager.enemies) {
    const result = enemy.checkPlayerCollision(camera.position, delta);
    if (result && !dashing) {
      player.takeDamage(result.damage, audio);
      _showDamageDirection(enemy.mesh.position);
      if (vfx) {
        vfx.shake(0.08, 0.15);
        vfx.triggerChromaticAberration(result.damage / 20);
      }
      if (result.type === 'explosion') {
        particles.createExplosion(enemy.mesh.position, 0xff4400, 5, 0.8);
        if (vfx) {
          vfx.shake(0.2, 0.4);
          vfx.createScorchMark(enemy.mesh.position, 2.5);
        }
      }
    }
  }

  perf.sectionEnd('collision');

  // Check player death
  if (player.dead) {
    gameOver();
    return;
  }

  // Animate UFO mothership
  perf.sectionBegin('worldAnim');
  if (currentLevelData && currentLevelData.ufo) {
    const ufo = currentLevelData.ufo;
    ufo.rotation.y += delta * 0.1;
    const bt = performance.now() * 0.001;
    // Gentle hover bob
    ufo.position.y = 80 + Math.sin(bt * 0.3) * 1.5 + Math.sin(bt * 0.7) * 0.5;
    // Tractor beam pulse
    const ud = ufo.userData;
    if (ud._beamMat) {
      const pulse = 0.03 + 0.015 * Math.sin(bt * 1.5) + 0.008 * Math.sin(bt * 3.7);
      ud._beamMat.opacity = pulse;
    }
  }

  // Animate twinkling stars
  if (currentLevelData && currentLevelData.starMats) {
    const t = performance.now() * 0.001;
    for (const m of currentLevelData.starMats) {
      if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = t;
    }
  }

  // Animate neon sign flicker (throttled — every 3rd frame is imperceptible)
  if (currentLevelData && currentLevelData.neonSigns && (_frameCounter % 3) === 0) {
    const t = performance.now() * 0.001;
    for (const ns of currentLevelData.neonSigns) {
      const ud = ns.userData;
      const flicker = Math.random() < ud._neonFlickerChance;
      const pulse = 0.7 + 0.3 * Math.sin(t * ud._neonSpeed + ud._neonPhase);
      const alpha = flicker ? 0.1 : pulse;
      ud._neonMat.opacity = alpha * 0.9;
    }
  }

  // Animate streetlight flicker (throttled — every 3rd frame)
  if (currentLevelData && currentLevelData.streetLights && (_frameCounter % 3) === 0) {
    const t = performance.now() * 0.001;
    for (const sl of currentLevelData.streetLights) {
      const ud = sl.userData;
      if (!ud._streetHalo) continue;
      const flicker = Math.random() < ud._streetFlickerChance;
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.2 + ud._streetPhase);
      const intensity = flicker ? 0.2 : pulse;
      ud._streetHalo.opacity = 0.55 * intensity;
      ud._streetCone.opacity = 0.045 * intensity;
      ud._streetPool.opacity = 0.06 * intensity;
    }
  }

  perf.sectionEnd('worldAnim');

  // Boss health bar
  perf.sectionBegin('hud');
  _updateBossHealthBar(waveManager.enemies);

  // Speed lines on dash
  if (_domCache.speedLines) {
    if (controls && controls.dashTimer > 0) {
      _domCache.speedLines.classList.add('active');
    } else {
      _domCache.speedLines.classList.remove('active');
    }
  }

  // Damage direction timers
  const _dmgDirEls = { n: _domCache.dmgDirN, s: _domCache.dmgDirS, e: _domCache.dmgDirE, w: _domCache.dmgDirW };
  for (const dir of ['n', 's', 'e', 'w']) {
    if (_dmgDirTimers[dir] > 0) {
      _dmgDirTimers[dir] -= delta;
      if (_dmgDirTimers[dir] <= 0) {
        if (_dmgDirEls[dir]) _dmgDirEls[dir].classList.remove('active');
      }
    }
  }

  // Enemy type callouts
  if (_calloutTimer > 0) {
    _calloutTimer -= delta;
    if (_calloutTimer <= 0) {
      if (_domCache.enemyCallout) _domCache.enemyCallout.classList.remove('active');
    }
  }
  for (const enemy of waveManager.enemies) {
    if (!enemy.dead && !_seenEnemyTypes.has(enemy.type)) {
      _seenEnemyTypes.add(enemy.type);
      const alienData = ALIEN_TYPES[enemy.type];
      if (_domCache.enemyCallout && alienData) {
        _domCache.enemyCallout.textContent = `▸ NEW THREAT: ${alienData.name.toUpperCase()}`;
        _domCache.enemyCallout.classList.add('active');
        _calloutTimer = 3;
      }
    }
  }

  // Wave countdown between waves
  const wcEl = _domCache.waveCountdown;
  if (wcEl) {
    if (waveManager.state === 'complete') {
      const t = Math.ceil(waveManager.stateTimer);
      wcEl.textContent = `NEXT WAVE IN ${t}`;
      wcEl.classList.add('active');
    } else {
      wcEl.classList.remove('active');
    }
  }

  // Weapon heat glow
  if (weapons.cooldown > 0) {
    _weaponHeat = Math.min(1, _weaponHeat + delta * 3);
  } else {
    _weaponHeat = Math.max(0, _weaponHeat - delta * 1.5);
  }
  if (weapons._weaponAccentLight) {
    weapons._weaponAccentLight.intensity = 0.35 + _weaponHeat * 0.8 + Math.sin(performance.now() * 0.003) * 0.12;
    if (_weaponHeat > 0.5) {
      const r = 1, g = 1 - (_weaponHeat - 0.5) * 1.2, b = 1 - _weaponHeat;
      weapons._weaponAccentLight.color.setRGB(r, Math.max(0.2, g), Math.max(0, b));
    }
  }

  // Update HUD
  const _wd = weapons.getWeaponData();
  hud.update(player, waveManager, _wd, LEVELS[currentLevelIndex].name, controls);

  // Reload bar
  const reloadBarC = _domCache.reloadBarContainer;
  const reloadBar = _domCache.reloadBar;
  if (reloadBarC && reloadBar) {
    if (_wd.isReloading) {
      reloadBarC.style.display = 'block';
      reloadBar.style.width = Math.round(_wd.reloadPct * 100) + '%';
    } else {
      reloadBarC.style.display = 'none';
    }
  }

  // Minimap
  camera.getWorldDirection(_minimapDir);
  hud.drawMinimap(camera.position, _minimapDir, waveManager.enemies);

  perf.sectionEnd('hud');

  // Render — routed through the postprocessing composer so UnrealBloom
  // picks up the additive laser/VFX glow. Falls back to direct render if
  // the postprocessing addons failed to load.
  perf.sectionBegin('render');
  if (composer) {
    renderPass.scene = scene;
    renderPass.camera = camera;
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
  perf.sectionEnd('render');

  // Update profiler counters and finalize frame
  if (perf.enabled) {
    const ri = renderer.info;
    perf.counters.enemies = waveManager ? waveManager.enemies.filter(e => !e.dead).length : 0;
    perf.counters.particles = getActiveParticleCount();
    perf.counters.drawCalls = ri.render.calls;
    perf.counters.triangles = ri.render.triangles;
    perf.counters.damageNumbers = vfx ? (vfx.damageNumbers ? vfx.damageNumbers.length : 0) : 0;
    perf.counters.pickups = _pickups.length;
    perf.counters.lights = getActiveLightCount();
  }
  perf.frameEnd();
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
  audio.stopAmbient();

  const tc = document.getElementById('touch-controls');
  if (tc) tc.classList.remove('active');

  document.getElementById('hud').style.display = 'none';
  document.getElementById('crosshair').style.display = 'none';
  document.getElementById('weapon-model').style.display = 'none';
  document.getElementById('scope-overlay').style.display = 'none';
  document.getElementById('scanlines').style.display = 'none';
  document.getElementById('vignette').style.display = 'none';

  document.getElementById('game-over').style.display = 'flex';
  const perkEl = document.getElementById('perk-select');
  if (perkEl) perkEl.style.display = 'none';
  _perkPending = false;
  document.getElementById('go-waves').textContent = waveManager.wave;
  document.getElementById('go-kills').textContent = player.kills;
  document.getElementById('go-score').textContent = player.score;
  const bestComboEl = document.getElementById('go-combo');
  if (bestComboEl) bestComboEl.textContent = player.bestCombo;
  _clearPickups();
  _hideOverlays();
}

// ===== START =====
// Module may load after DOMContentLoaded has already fired
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
