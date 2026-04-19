// weapons.js - Three weapon types: Laser Rifle, Laser Sword, Sniper Laser Rifle
import { disposeTree } from './particles.js';

export const WEAPONS = {
  laserRifle: {
    name: 'LASER RIFLE',
    damage: 8,
    fireRate: 0.12,
    range: 80,
    type: 'hitscan',
    color: 0xff0000,
    beamWidth: 0.02,
    spread: 0.015,
    description: 'Fast and forgiving. Low per-shot damage but high fire rate. Slight spread at range.',
    key: '1',
  },
  laserSword: {
    name: 'LASER SWORD',
    damage: 55,
    fireRate: 0.35,
    range: 4.0,
    type: 'melee',
    color: 0x0088ff,
    description: 'Extreme close-range DPS. Hits all enemies in a wide arc — the ultimate combo builder.',
    key: '2',
  },
  sniperRifle: {
    name: 'SNIPER LASER RIFLE',
    damage: 95,
    fireRate: 1.2,
    range: 200,
    type: 'hitscan',
    color: 0x8800ff,
    beamWidth: 0.015,
    zoom: 3,
    description: 'Pinpoint burst damage. One-shots most enemies. Slow fire rate demands accuracy.',
    key: '3',
  },
  rocketLauncher: {
    name: 'PLASMA ROCKET',
    damage: 150,
    fireRate: 1.8,
    range: 150,
    type: 'projectile',
    color: 0x00ffee,
    projectileSpeed: 55,
    explosionRadius: 8,
    description: 'Devastating AoE. Slow and self-damaging but obliterates clusters.',
    key: '4',
  },
};

// Fresnel rim-light shader patch for weapon viewmodels. Gives the hero's
// gun a subtle glowing edge that reads against any background.
function _weaponRim(material, rimColorHex, rimIntensity = 0.55, rimPower = 3.0) {
  const rimColor = new THREE.Color(rimColorHex);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: rimColor };
    shader.uniforms.rimIntensity = { value: rimIntensity };
    shader.uniforms.rimPower = { value: rimPower };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec3 rimColor;
         uniform float rimIntensity;
         uniform float rimPower;`
      )
      .replace(
        '#include <output_fragment>',
        `float rimDot = 1.0 - max(0.0, dot(normalize(vViewPosition), normal));
         float rim = pow(rimDot, rimPower) * rimIntensity;
         outgoingLight += rimColor * rim;
         #include <output_fragment>`
      );
  };
  material.customProgramCacheKey = () =>
    'wrim_' + rimColor.getHexString() + '_' + rimIntensity.toFixed(2) + '_' + rimPower.toFixed(2);
  material.needsUpdate = true;
}

function _rimLightWeaponModel(model, rimColorHex) {
  const patched = new WeakSet();
  model.traverse(child => {
    const mat = child.material;
    if (!mat) return;
    if (Array.isArray(mat)) {
      mat.forEach(m => {
        if (m && m.isMeshPhongMaterial && !patched.has(m)) {
          _weaponRim(m, rimColorHex);
          patched.add(m);
        }
      });
    } else if (mat.isMeshPhongMaterial && !patched.has(mat)) {
      _weaponRim(mat, rimColorHex);
      patched.add(mat);
    }
  });
}

export class WeaponManager {
  constructor(camera, scene, particles, audio) {
    this.camera = camera;
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.current = 'laserRifle';
    this.cooldown = 0;
    this.zoomed = false;
    this.originalFov = 75;

    this.weaponScene = null;
    this.weaponCamera = null;
    this.weaponRenderer = null;
    this.weaponModels = {};
    this.swingAngle = 0;
    this.recoilOffset = 0;
    this.recoilRotX = 0;

    // Reusable temporaries for fire path - avoid per-shot allocations
    this._tmpDir = new THREE.Vector3();
    this._tmpMuzzle = new THREE.Vector3();
    this._tmpEnd = new THREE.Vector3();
    this._tmpToEnemy = new THREE.Vector3();
    this._tmpRaycaster = new THREE.Raycaster();
    this._tmpSphere = new THREE.Sphere();
    // Rough bounding radius by alien type (for ray prefilter)
    this._alienRadius = { bloater: 1.5, grunt: 0.9, spitter: 1.0, drone: 0.7, stalker: 0.9, swarmer: 0.6, boss: 2.5 };

    // Active rocket projectiles in the world
    this.projectiles = [];
    // Callback: called with array of hits when a rocket detonates
    this.onRocketHit = null;

    // Weapon switch draw animation
    this._switchTimer = 0;
    this._switchDuration = 0.2;

    this._initWeaponView();
  }

  _initWeaponView() {
    const canvas = document.getElementById('weapon-canvas');
    if (!canvas) return;
    this.weaponRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.weaponRenderer.setSize(500, 400);
    this.weaponRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.weaponRenderer.setClearColor(0x000000, 0);

    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(45, 500 / 400, 0.1, 100);
    this.weaponCamera.position.set(0, 0, 2);

    // Key light - main illumination from upper right
    const keyLight = new THREE.DirectionalLight(0xddeeff, 1.3);
    keyLight.position.set(2, 2, 3);
    this.weaponScene.add(keyLight);
    // Fill light - softer from left side
    const fillLight = new THREE.DirectionalLight(0x8899bb, 0.45);
    fillLight.position.set(-2, 0.5, 1);
    this.weaponScene.add(fillLight);
    // Rim light - edge definition from behind
    const rimLight = new THREE.DirectionalLight(0x6688cc, 0.65);
    rimLight.position.set(-1, 1, -2);
    this.weaponScene.add(rimLight);
    // Bottom fill to reduce harsh shadows under weapon
    const bottomFill = new THREE.DirectionalLight(0x445566, 0.2);
    bottomFill.position.set(0, -2, 1);
    this.weaponScene.add(bottomFill);
    // Ambient fill
    this.weaponScene.add(new THREE.AmbientLight(0x3a4455, 0.55));
    // Weapon-colored accent light (changes per weapon)
    this._weaponAccentLight = new THREE.PointLight(0xff0000, 0.4, 3);
    this._weaponAccentLight.position.set(0, 0, -0.8);
    this.weaponScene.add(this._weaponAccentLight);

    // Build weapon models
    this.weaponModels.laserRifle = this._buildRifleModel(0xff0000);
    this.weaponModels.laserSword = this._buildSwordModel();
    this.weaponModels.sniperRifle = this._buildSniperModel();
    this.weaponModels.rocketLauncher = this._buildRocketLauncherModel();

    // Rim-light each weapon with its signature energy color so the
    // viewmodel silhouette glows subtly against the scene.
    _rimLightWeaponModel(this.weaponModels.laserRifle, 0xff3322);
    _rimLightWeaponModel(this.weaponModels.laserSword, 0x44aaff);
    _rimLightWeaponModel(this.weaponModels.sniperRifle, 0xbb66ff);
    _rimLightWeaponModel(this.weaponModels.rocketLauncher, 0x00ffee);

    // Cache glowing materials for each weapon (avoid per-frame traverse)
    this._glowMaterials = {};
    for (const [key, model] of Object.entries(this.weaponModels)) {
      const mats = [];
      model.traverse(child => {
        if (child.material && child.material.type === 'MeshBasicMaterial' && child.material.transparent) {
          child.material.userData = child.material.userData || {};
          child.material.userData.baseOpacity = child.material.opacity;
          mats.push(child.material);
        }
      });
      this._glowMaterials[key] = mats;
    }

    Object.values(this.weaponModels).forEach(m => {
      m.visible = false;
      this.weaponScene.add(m);
    });
    this.weaponModels.laserRifle.visible = true;
  }

  _buildRifleModel(color) {
    const group = new THREE.Group();
    const metalDark = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 90 });
    const metalMed = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, shininess: 70 });
    const metalLight = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 100 });
    const metalBright = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 120 });
    const gripMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 15 });
    const rubberMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 5 });
    const glowMat = (c, o = 0.7) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o });

    // === BARREL ASSEMBLY ===
    // Inner barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.4, 14), metalDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.4;
    group.add(barrel);
    // Barrel shroud - octagonal feel
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.058, 0.65, 8), metalMed);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.z = -0.15;
    group.add(shroud);
    // Shroud ventilation slots (cutouts along top/sides)
    for (let i = 0; i < 6; i++) {
      for (const yOff of [0.04, -0.04]) {
        const slot = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.015, 0.03), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
        slot.position.set(0, yOff, -0.35 - i * 0.06);
        group.add(slot);
      }
    }
    // Heat sink fins
    for (let i = 0; i < 6; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.002, 0.05), metalLight);
      fin.position.set(0, 0, -0.52 - i * 0.08);
      group.add(fin);
    }
    // Muzzle brake - multi-port
    const muzzleBase = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.14, 10), metalLight);
    muzzleBase.rotation.x = Math.PI / 2;
    muzzleBase.position.z = -1.1;
    group.add(muzzleBase);
    // Muzzle ports
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const port = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
        port.position.set(side * 0.045, 0, -1.06 - i * 0.03);
        group.add(port);
      }
    }
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.006, 8, 16), metalBright);
    muzzleRing.position.z = -1.17;
    group.add(muzzleRing);

    // === GAS BLOCK / FRONT SIGHT ===
    const gasBlock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 0.04), metalMed);
    gasBlock.position.set(0, 0.045, -0.7);
    group.add(gasBlock);
    // Front sight post with protective ears
    const sightPost = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.035, 0.006), metalLight);
    sightPost.position.set(0, 0.085, -0.7);
    group.add(sightPost);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.04, 0.008), metalLight);
      ear.position.set(side * 0.015, 0.08, -0.7);
      group.add(ear);
    }

    // === RECEIVER ===
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.52), metalDark);
    receiver.position.z = 0.15;
    group.add(receiver);
    // Top picatinny rail with notches
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.018, 0.52), metalMed);
    rail.position.set(0, 0.078, 0.15);
    group.add(rail);
    for (let i = 0; i < 8; i++) {
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.057, 0.006, 0.012), metalDark);
      notch.position.set(0, 0.09, -0.08 + i * 0.07);
      group.add(notch);
    }
    // Side rails (short)
    for (const side of [-1, 1]) {
      const sideRail = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.15), metalMed);
      sideRail.position.set(side * 0.072, 0.02, 0.05);
      group.add(sideRail);
    }
    // Ejection port (right side)
    const ejPort = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.06), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    ejPort.position.set(0.07, 0.03, 0.12);
    group.add(ejPort);
    // Charging handle (top rear)
    const chargeHandle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.025), metalLight);
    chargeHandle.position.set(0, 0.078, 0.38);
    group.add(chargeHandle);
    // Forward assist (right side bump)
    const fwdAssist = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.015, 6), metalMed);
    fwdAssist.rotation.z = Math.PI / 2;
    fwdAssist.position.set(0.075, 0.04, 0.25);
    group.add(fwdAssist);
    // Bolt release (left side)
    const boltRelease = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.03), metalLight);
    boltRelease.position.set(-0.07, 0.0, 0.18);
    group.add(boltRelease);

    // === MAGAZINE ===
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.22, 0.075), metalDark);
    mag.position.set(0, -0.17, 0.18);
    mag.rotation.x = 0.08;
    group.add(mag);
    // Mag texture ribs
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.057, 0.003, 0.06), metalMed);
      rib.position.set(0, -0.1 - i * 0.06, 0.18);
      group.add(rib);
    }
    // Mag well
    const magWell = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.035, 0.085), metalMed);
    magWell.position.set(0, -0.06, 0.18);
    group.add(magWell);
    // Mag release button
    const magRelease = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 6), metalLight);
    magRelease.rotation.z = Math.PI / 2;
    magRelease.position.set(0.07, -0.04, 0.2);
    group.add(magRelease);

    // === TRIGGER GROUP ===
    const guardGeo = new THREE.TorusGeometry(0.038, 0.007, 6, 10, Math.PI);
    const guard = new THREE.Mesh(guardGeo, metalMed);
    guard.position.set(0, -0.09, 0.32);
    guard.rotation.x = Math.PI;
    guard.rotation.z = Math.PI / 2;
    group.add(guard);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.012), metalLight);
    trigger.position.set(0, -0.075, 0.32);
    group.add(trigger);
    // Safety selector (left side)
    const safety = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.006, 0.015), metalLight);
    safety.position.set(-0.07, -0.02, 0.3);
    safety.rotation.z = -0.5;
    group.add(safety);

    // === GRIP ===
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.23, 0.085), gripMat);
    grip.position.set(0, -0.2, 0.36);
    grip.rotation.x = -0.18;
    group.add(grip);
    // Grip finger grooves
    for (let i = 0; i < 5; i++) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(0.067, 0.003, 0.05), metalDark);
      groove.position.set(0, -0.11 - i * 0.035, 0.355);
      group.add(groove);
    }
    // Grip bottom plug
    const gripPlug = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.07), metalMed);
    gripPlug.position.set(0, -0.31, 0.37);
    group.add(gripPlug);

    // === FOREGRIP (angled) ===
    const foregrip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), gripMat);
    foregrip.position.set(0, -0.11, -0.05);
    foregrip.rotation.x = 0.25;
    group.add(foregrip);
    const fgBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.06), metalMed);
    fgBase.position.set(0, -0.06, -0.05);
    group.add(fgBase);

    // === STOCK ===
    // Buffer tube
    const bufferTube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.15, 8), metalMed);
    bufferTube.rotation.x = Math.PI / 2;
    bufferTube.position.set(0, 0.01, 0.48);
    group.add(bufferTube);
    // Stock body
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.22), metalDark);
    stock.position.set(0, -0.01, 0.56);
    group.add(stock);
    // Cheek weld riser
    const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.12), metalMed);
    cheek.position.set(0, 0.04, 0.54);
    group.add(cheek);
    // Buttpad
    const buttpad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.015), rubberMat);
    buttpad.position.set(0, -0.01, 0.67);
    group.add(buttpad);
    // Stock adjustment lever
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.015, 0.03), metalLight);
    lever.position.set(0, -0.06, 0.47);
    group.add(lever);
    // Sling mount (rear)
    const slingRear = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.003, 4, 8), metalMed);
    slingRear.position.set(0, -0.06, 0.64);
    slingRear.rotation.x = Math.PI / 2;
    group.add(slingRear);
    // Sling mount (front)
    const slingFront = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.003, 4, 8), metalMed);
    slingFront.position.set(0, -0.06, -0.3);
    slingFront.rotation.x = Math.PI / 2;
    group.add(slingFront);

    // === ENERGY / SCI-FI ELEMENTS ===
    // Energy conduit along barrel
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 6), glowMat(color, 0.3));
    conduit.rotation.x = Math.PI / 2;
    conduit.position.set(0, -0.04, -0.6);
    group.add(conduit);
    // Energy coils
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.042, 0.005, 6, 14),
        glowMat(color, 0.6)
      );
      coil.position.z = -0.82 - i * 0.1;
      group.add(coil);
    }
    // Charging indicator LEDs (3 dots on left side)
    for (let i = 0; i < 3; i++) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), glowMat(color, 0.9));
      led.position.set(-0.068, 0.04, 0.05 + i * 0.035);
      group.add(led);
    }
    // Glowing muzzle tip
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 12), new THREE.MeshBasicMaterial({ color }));
    tip.position.z = -1.17;
    group.add(tip);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), glowMat(color, 0.12));
    tip.add(halo);
    // Accent strips along both sides
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.004, 0.004, 0.45),
        glowMat(color, 0.4)
      );
      strip.position.set(side * 0.067, 0.04, 0.0);
      group.add(strip);
    }
    // Receiver window (glowing panel)
    const recWindow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.03, 0.05),
      glowMat(color, 0.3)
    );
    recWindow.position.set(0.067, 0.02, 0.05);
    recWindow.rotation.y = Math.PI / 2;
    group.add(recWindow);

    // === HOLOGRAPHIC SIGHT ===
    // Sight housing
    const sightBase = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, 0.06), metalDark);
    sightBase.position.set(0, 0.105, 0.0);
    group.add(sightBase);
    // Sight front window frame
    const sightFront = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.05, 0.003), metalMed);
    sightFront.position.set(0, 0.115, -0.03);
    group.add(sightFront);
    // Sight front glass
    const sightGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.034, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x001108, transparent: true, opacity: 0.35 })
    );
    sightGlass.position.set(0, 0.115, -0.029);
    group.add(sightGlass);
    // Sight rear window frame
    const sightRear = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.05, 0.003), metalMed);
    sightRear.position.set(0, 0.115, 0.03);
    group.add(sightRear);
    // Sight top hood
    const sightHood = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.004, 0.062), metalDark);
    sightHood.position.set(0, 0.138, 0.0);
    group.add(sightHood);
    // Sight side walls
    for (const side of [-1, 1]) {
      const sightWall = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.05, 0.058), metalDark);
      sightWall.position.set(side * 0.022, 0.115, 0.0);
      group.add(sightWall);
    }
    // Holographic reticle dot (glowing red/green)
    const reticleDot = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), glowMat(0xff2200, 1.0));
    reticleDot.position.set(0, 0.115, 0.0);
    group.add(reticleDot);
    // Reticle ring
    const reticleRing = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.001, 6, 16), glowMat(0xff2200, 0.5));
    reticleRing.position.set(0, 0.115, 0.0);
    group.add(reticleRing);
    // Sight adjustment knobs
    for (const side of [-1, 1]) {
      const sightKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 6), metalLight);
      sightKnob.rotation.z = Math.PI / 2;
      sightKnob.position.set(side * 0.028, 0.12, 0.01);
      group.add(sightKnob);
    }
    // Sight battery compartment
    const sightBatt = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, 0.025), metalMed);
    sightBatt.position.set(0.015, 0.1, 0.015);
    group.add(sightBatt);

    // === ENERGY CAPACITOR MODULE (left side) ===
    const capHousing = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.08), metalDark);
    capHousing.position.set(-0.088, 0.0, 0.1);
    group.add(capHousing);
    // Capacitor cell window
    const capWindow = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.04), glowMat(color, 0.2));
    capWindow.position.set(-0.109, 0.0, 0.1);
    capWindow.rotation.y = -Math.PI / 2;
    group.add(capWindow);
    // Energy cell glow inside
    const capCell = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8), glowMat(color, 0.55));
    capCell.position.set(-0.088, 0.0, 0.1);
    group.add(capCell);
    // Capacitor mounting screws
    for (const y of [-0.025, 0.025]) {
      for (const z of [0.065, 0.135]) {
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.005, 6), metalBright);
        screw.rotation.z = Math.PI / 2;
        screw.position.set(-0.109, y, z);
        group.add(screw);
      }
    }
    // Cable routing from capacitor to barrel
    const cableClips = [
      { x: -0.068, y: -0.02, z: 0.05 },
      { x: -0.058, y: -0.03, z: -0.05 },
      { x: -0.048, y: -0.035, z: -0.2 },
      { x: -0.04, y: -0.035, z: -0.4 },
    ];
    for (let i = 0; i < cableClips.length - 1; i++) {
      const c0 = cableClips[i], c1 = cableClips[i + 1];
      const dx = c1.x - c0.x, dy = c1.y - c0.y, dz = c1.z - c0.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, len, 4), metalDark);
      cable.position.set((c0.x + c1.x) / 2, (c0.y + c1.y) / 2, (c0.z + c1.z) / 2);
      cable.lookAt(c1.x, c1.y, c1.z);
      cable.rotateX(Math.PI / 2);
      group.add(cable);
      // Cable clip
      const clip = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.002, 4, 6), metalMed);
      clip.position.set(c0.x, c0.y, c0.z);
      group.add(clip);
    }
    // Cable energy glow trace
    const cableGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.4, 4), glowMat(color, 0.35));
    cableGlow.rotation.x = Math.PI / 2;
    cableGlow.position.set(-0.045, -0.035, -0.15);
    group.add(cableGlow);

    // === TACTICAL FLASHLIGHT (under foregrip) ===
    const flashBody = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.05, 8), metalDark);
    flashBody.rotation.x = Math.PI / 2;
    flashBody.position.set(0, -0.17, -0.1);
    group.add(flashBody);
    const flashLens = new THREE.Mesh(new THREE.CircleGeometry(0.013, 8), glowMat(0xffffcc, 0.15));
    flashLens.position.set(0, -0.17, -0.126);
    group.add(flashLens);
    const flashBezel = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.002, 6, 8), metalLight);
    flashBezel.position.set(0, -0.17, -0.126);
    group.add(flashBezel);

    // === BARREL BORE GLOW ===
    const boreGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 8), glowMat(color, 0.4));
    boreGlow.rotation.x = Math.PI / 2;
    boreGlow.position.z = -1.17;
    group.add(boreGlow);

    // === RECEIVER PANEL LINES ===
    // Horizontal panel lines on receiver sides
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const panelLine = new THREE.Mesh(
          new THREE.BoxGeometry(0.001, 0.001, 0.25),
          new THREE.MeshBasicMaterial({ color: 0x151515 })
        );
        panelLine.position.set(side * 0.066, -0.02 + i * 0.03, 0.15);
        group.add(panelLine);
      }
      // Vertical divider
      const vLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.001, 0.1, 0.001),
        new THREE.MeshBasicMaterial({ color: 0x151515 })
      );
      vLine.position.set(side * 0.066, 0.0, 0.08);
      group.add(vLine);
    }
    // Serial number plate (right side)
    const serialPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.012), metalLight);
    serialPlate.position.set(0.067, -0.04, 0.3);
    serialPlate.rotation.y = Math.PI / 2;
    group.add(serialPlate);
    // Warning decal strip (yellow hash on barrel shroud)
    const warnStrip = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.058, 0.015), glowMat(0xffaa00, 0.3));
    warnStrip.position.set(0, 0.0, -0.48);
    group.add(warnStrip);

    // === ADDITIONAL RIVETS & SCREWS ===
    const rivetPositions = [
      [0.065, 0.05, -0.05], [0.065, 0.05, 0.15], [0.065, 0.05, 0.35],
      [-0.065, 0.05, -0.05], [-0.065, 0.05, 0.15], [-0.065, 0.05, 0.35],
      [0.065, -0.04, 0.0], [-0.065, -0.04, 0.0],
    ];
    for (const [rx, ry, rz] of rivetPositions) {
      const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.004, 6), metalBright);
      rivet.rotation.z = Math.PI / 2;
      rivet.position.set(rx, ry, rz);
      group.add(rivet);
    }

    group.position.set(0.4, -0.35, -0.3);
    group.rotation.set(0, -0.1, 0);
    return group;
  }

  _buildSwordModel() {
    const group = new THREE.Group();
    const metalBright = new THREE.MeshPhongMaterial({ color: 0x889999, shininess: 120 });
    const metalMat = new THREE.MeshPhongMaterial({ color: 0x667777, shininess: 100 });
    const darkMetal = new THREE.MeshPhongMaterial({ color: 0x3a3a44, shininess: 70 });
    const gripMat = new THREE.MeshPhongMaterial({ color: 0x2a2a2a, shininess: 15 });
    const leatherMat = new THREE.MeshPhongMaterial({ color: 0x332211, shininess: 10 });
    const glowMat = (c, o = 0.7) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o });

    // === POMMEL ===
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 10), metalBright);
    pommel.scale.set(1, 0.8, 1);
    pommel.position.y = -0.24;
    group.add(pommel);
    // Pommel ring
    const pommelRing = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 12), metalMat);
    pommelRing.position.y = -0.2;
    pommelRing.rotation.x = Math.PI / 2;
    group.add(pommelRing);
    // Pommel glow crystal
    const pommelGlow = new THREE.Mesh(new THREE.OctahedronGeometry(0.015, 0), glowMat(0x0088ff, 0.9));
    pommelGlow.position.y = -0.24;
    group.add(pommelGlow);

    // === HANDLE ===
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.42, 12), gripMat);
    group.add(handle);
    // Leather wrap bands
    for (let i = 0; i < 10; i++) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.004, 6, 12), leatherMat);
      wrap.position.y = -0.17 + i * 0.04;
      wrap.rotation.x = Math.PI / 2;
      group.add(wrap);
    }
    // Grip texture between wraps (diamond pattern hint)
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 4, 4), darkMetal);
        dot.position.set(side * 0.028, -0.1 + i * 0.07, 0);
        group.add(dot);
      }
    }
    // Power switch (small button on handle)
    const powerBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 6), metalBright);
    powerBtn.rotation.z = Math.PI / 2;
    powerBtn.position.set(0.035, 0.05, 0);
    group.add(powerBtn);
    // Power indicator LED
    const powerLed = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), glowMat(0x00ff44, 1.0));
    powerLed.position.set(0.037, 0.07, 0);
    group.add(powerLed);

    // === ENERGY CHANNELS (handle grooves) ===
    // Vertical energy lines running up the handle
    for (const side of [-1, 1]) {
      const eChan = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.35, 0.003), glowMat(0x0066cc, 0.3));
      eChan.position.set(side * 0.025, 0.02, 0.012);
      group.add(eChan);
      // Secondary thinner channel
      const eChan2 = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.3, 0.002), glowMat(0x44aaff, 0.5));
      eChan2.position.set(side * 0.025, 0.02, -0.012);
      group.add(eChan2);
    }
    // Front/back channels
    for (const z of [-0.03, 0.03]) {
      const fChan = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.25, 0.001), glowMat(0x0066cc, 0.25));
      fChan.position.set(0, 0.03, z);
      group.add(fChan);
    }

    // === RUNE/CIRCUIT MARKINGS on handle ===
    // Small circuit trace dots along the handle
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + 0.3;
      const ry = -0.12 + i * 0.06;
      const runeDot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 4, 4), glowMat(0x0088ff, 0.4 + Math.sin(i * 1.5) * 0.2));
      runeDot.position.set(Math.cos(angle) * 0.032, ry, Math.sin(angle) * 0.032);
      group.add(runeDot);
    }
    // Horizontal circuit traces (3 rings)
    for (let i = 0; i < 3; i++) {
      const circuitRing = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.001, 4, 16), glowMat(0x0066cc, 0.2));
      circuitRing.position.y = -0.05 + i * 0.1;
      circuitRing.rotation.x = Math.PI / 2;
      group.add(circuitRing);
    }

    // === CROSSGUARD ===
    // Main guard bar
    const guardMain = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.045), metalMat);
    guardMain.position.y = 0.22;
    group.add(guardMain);
    // Guard detail ridge
    const guardRidge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.008, 0.05), metalBright);
    guardRidge.position.y = 0.235;
    group.add(guardRidge);
    // Guard bottom edge detail
    const guardBottom = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.004, 0.048), darkMetal);
    guardBottom.position.y = 0.203;
    group.add(guardBottom);
    // Curved guard tips with scrollwork
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), metalBright);
      tip.position.set(side * 0.14, 0.22, 0);
      group.add(tip);
      // Upward curve
      const curveUp = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.035, 0.025), metalMat);
      curveUp.position.set(side * 0.12, 0.25, 0);
      curveUp.rotation.z = side * 0.4;
      group.add(curveUp);
      const curveTip = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), metalBright);
      curveTip.position.set(side * 0.11, 0.27, 0);
      group.add(curveTip);
      // Guard wing accents (energy) - wider, double-lined
      const wingGlow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.003, 0.01), glowMat(0x0088ff, 0.4));
      wingGlow.position.set(side * 0.08, 0.22, 0.025);
      group.add(wingGlow);
      const wingGlow2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, 0.008), glowMat(0x44bbff, 0.25));
      wingGlow2.position.set(side * 0.08, 0.215, -0.025);
      group.add(wingGlow2);
      // Guard circuit trace to tips
      const guardTrace = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.001, 0.002), glowMat(0x0066cc, 0.35));
      guardTrace.position.set(side * 0.06, 0.228, 0.0);
      group.add(guardTrace);
      // Quillon emitter vents (small energy outlets at guard ends)
      const quillonVent = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.008, 6), darkMetal);
      quillonVent.position.set(side * 0.135, 0.22, 0);
      quillonVent.rotation.z = side * Math.PI / 2;
      group.add(quillonVent);
      const quillonGlow = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 6), glowMat(0x0088ff, 0.6));
      quillonGlow.position.set(side * 0.14, 0.22, 0);
      group.add(quillonGlow);
    }
    // Center gem - larger, faceted with mounting
    const gemMount = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.015), darkMetal);
    gemMount.position.set(0, 0.22, 0.025);
    group.add(gemMount);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), glowMat(0x00bbff, 1.0));
    gem.position.set(0, 0.22, 0.028);
    group.add(gem);
    const gemHalo = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), glowMat(0x0088ff, 0.15));
    gem.add(gemHalo);
    // Secondary side gems
    for (const side of [-1, 1]) {
      const sideGem = new THREE.Mesh(new THREE.OctahedronGeometry(0.008, 0), glowMat(0x00ddff, 0.7));
      sideGem.position.set(side * 0.04, 0.228, 0.026);
      group.add(sideGem);
    }

    // === EMITTER HOUSING (enhanced multi-ring) ===
    // Lower emitter collar
    const emitterCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.015, 10), darkMetal);
    emitterCollar.position.y = 0.245;
    group.add(emitterCollar);
    // Main emitter body
    const emitterBase = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.04, 10), metalMat);
    emitterBase.position.y = 0.265;
    group.add(emitterBase);
    // Emitter mid ring
    const emitterMid = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.003, 6, 12), metalBright);
    emitterMid.position.y = 0.27;
    emitterMid.rotation.x = Math.PI / 2;
    group.add(emitterMid);
    // Top emitter ring
    const emitterRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 12), metalBright);
    emitterRing.position.y = 0.285;
    emitterRing.rotation.x = Math.PI / 2;
    group.add(emitterRing);
    // Energy channeling ring (glowing)
    const emitterEnergyRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.002, 6, 16), glowMat(0x0088ff, 0.6));
    emitterEnergyRing.position.y = 0.288;
    emitterEnergyRing.rotation.x = Math.PI / 2;
    group.add(emitterEnergyRing);
    // Emitter vents (8 radial)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.02, 0.003), darkMetal);
      vent.position.set(Math.cos(angle) * 0.03, 0.27, Math.sin(angle) * 0.03);
      group.add(vent);
      // Vent glow
      if (i % 2 === 0) {
        const ventGlow = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.015, 0.001), glowMat(0x0088ff, 0.4));
        ventGlow.position.set(Math.cos(angle) * 0.031, 0.27, Math.sin(angle) * 0.031);
        group.add(ventGlow);
      }
    }
    // Emitter glow disc
    const emitterGlow = new THREE.Mesh(new THREE.CircleGeometry(0.022, 12), glowMat(0x44aaff, 0.6));
    emitterGlow.position.y = 0.29;
    emitterGlow.rotation.x = -Math.PI / 2;
    group.add(emitterGlow);
    // Emitter inner bore glow
    const emitterBore = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.02, 8), glowMat(0x88ccff, 0.5));
    emitterBore.position.y = 0.285;
    group.add(emitterBore);

    // === BLADE ===
    const bladeLen = 1.05;
    // Blade shape - pointed with slight curve
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.lineTo(0.026, 0);
    bladeShape.lineTo(0.024, bladeLen * 0.3);
    bladeShape.lineTo(0.021, bladeLen * 0.7);
    bladeShape.lineTo(0.012, bladeLen * 0.92);
    bladeShape.lineTo(0, bladeLen);
    bladeShape.lineTo(-0.012, bladeLen * 0.92);
    bladeShape.lineTo(-0.021, bladeLen * 0.7);
    bladeShape.lineTo(-0.024, bladeLen * 0.3);
    bladeShape.lineTo(-0.026, 0);
    bladeShape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.014, bevelEnabled: false });
    const blade = new THREE.Mesh(bladeGeo, glowMat(0x2288ff, 0.8));
    blade.position.set(0, 0.3, -0.007);
    group.add(blade);

    // Blade inner core (hot white center)
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, bladeLen * 0.95, 0.002),
      glowMat(0xccddff, 0.95)
    );
    core.position.set(0, 0.3 + bladeLen * 0.475, 0);
    group.add(core);
    // Core secondary (slightly wider)
    const core2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, bladeLen * 0.9, 0.004),
      glowMat(0x88bbff, 0.6)
    );
    core2.position.set(0, 0.3 + bladeLen * 0.45, 0);
    group.add(core2);

    // Glow layers (4 layers for rich depth)
    const glowLayers = [
      { w: 0.06, h: bladeLen, d: 0.03, c: 0x0077dd, o: 0.18 },
      { w: 0.10, h: bladeLen, d: 0.05, c: 0x0055bb, o: 0.08 },
      { w: 0.16, h: bladeLen, d: 0.08, c: 0x003388, o: 0.04 },
      { w: 0.24, h: bladeLen, d: 0.12, c: 0x002266, o: 0.02 },
    ];
    for (const gl of glowLayers) {
      const gMesh = new THREE.Mesh(
        new THREE.BoxGeometry(gl.w, gl.h, gl.d),
        glowMat(gl.c, gl.o)
      );
      gMesh.position.set(0, 0.3 + bladeLen / 2, 0);
      group.add(gMesh);
    }

    // Blade edge sparkle particles (more, varied)
    for (let i = 0; i < 18; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.004 + Math.random() * 0.005, 4, 4),
        glowMat(0xccddff, 0.5 + Math.random() * 0.5)
      );
      const y = 0.35 + Math.random() * bladeLen * 0.9;
      const xSpread = 0.025 + (y - 0.35) / bladeLen * 0.015;
      spark.position.set((Math.random() - 0.5) * xSpread * 2, y, (Math.random() - 0.5) * 0.012);
      group.add(spark);
    }

    // Blade edge shimmer lines (left & right edges)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const ey = 0.4 + i * bladeLen * 0.18;
        const eWidth = 0.022 - (i * 0.003);
        const edgeLine = new THREE.Mesh(
          new THREE.BoxGeometry(0.001, bladeLen * 0.15, 0.002),
          glowMat(0xeeffff, 0.35 + Math.random() * 0.2)
        );
        edgeLine.position.set(side * eWidth, ey, 0);
        group.add(edgeLine);
      }
    }

    // Plasma instability nodes (bright spots along blade)
    for (let i = 0; i < 4; i++) {
      const nodeY = 0.5 + i * bladeLen * 0.22;
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), glowMat(0xeeffff, 0.7));
      node.position.set(0, nodeY, 0);
      group.add(node);
      // Node halo
      const nodeHalo = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), glowMat(0x44aaff, 0.15));
      node.add(nodeHalo);
    }

    // Blade base emission flare (where blade meets emitter)
    const baseFlare = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), glowMat(0x88ccff, 0.45));
    baseFlare.scale.set(1, 0.4, 1);
    baseFlare.position.set(0, 0.31, 0);
    group.add(baseFlare);

    // Blade tip glow point (enhanced)
    const bladeTip = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 8), glowMat(0xaaddff, 0.95));
    bladeTip.position.set(0, 0.3 + bladeLen, 0);
    group.add(bladeTip);
    const bladeTipHalo = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), glowMat(0x0088ff, 0.2));
    bladeTip.add(bladeTipHalo);
    // Tip flash point
    const tipFlash = new THREE.Mesh(new THREE.SphereGeometry(0.006, 6, 6), glowMat(0xffffff, 0.9));
    bladeTip.add(tipFlash);

    group.position.set(0.5, -0.5, -0.2);
    group.rotation.set(-0.5, 0, 0.3);
    return group;
  }

  _buildSniperModel() {
    const group = new THREE.Group();
    const metalDark = new THREE.MeshPhongMaterial({ color: 0x252535, shininess: 90 });
    const metalMed = new THREE.MeshPhongMaterial({ color: 0x3a3a4a, shininess: 80 });
    const metalLight = new THREE.MeshPhongMaterial({ color: 0x5a5a6a, shininess: 100 });
    const metalBright = new THREE.MeshPhongMaterial({ color: 0x777788, shininess: 120 });
    const gripMat = new THREE.MeshPhongMaterial({ color: 0x151515, shininess: 12 });
    const rubberMat = new THREE.MeshPhongMaterial({ color: 0x0e0e0e, shininess: 5 });
    const woodMat = new THREE.MeshPhongMaterial({ color: 0x3a2815, shininess: 25 });
    const glowMat = (c, o = 0.7) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o });
    const color = 0x8800ff;

    // === BARREL ASSEMBLY ===
    // Heavy match barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 2.1, 14), metalDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.65;
    group.add(barrel);
    // Barrel fluting (6 channels for lighter weight)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const flute = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 1.5), metalLight);
      flute.position.set(Math.cos(angle) * 0.026, Math.sin(angle) * 0.026, -0.55);
      group.add(flute);
    }
    // Barrel band / gas block
    const barrelBand = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 10), metalMed);
    barrelBand.rotation.x = Math.PI / 2;
    barrelBand.position.z = -0.5;
    group.add(barrelBand);
    // Suppressor / muzzle device - multi-baffle
    const suppressorBody = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.18, 12), metalMed);
    suppressorBody.rotation.x = Math.PI / 2;
    suppressorBody.position.z = -1.72;
    group.add(suppressorBody);
    // Suppressor rings
    for (let i = 0; i < 3; i++) {
      const sRing = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.003, 6, 14), metalLight);
      sRing.position.z = -1.65 - i * 0.06;
      group.add(sRing);
    }
    // Suppressor end cap
    const endCap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.02, 10), metalBright);
    endCap.rotation.x = Math.PI / 2;
    endCap.position.z = -1.82;
    group.add(endCap);
    // Suppressor bore
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.02, 8), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    bore.rotation.x = Math.PI / 2;
    bore.position.z = -1.83;
    group.add(bore);

    // === RECEIVER ===
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.56), metalDark);
    receiver.position.z = 0.15;
    group.add(receiver);
    // Top long rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.014, 0.56), metalMed);
    rail.position.set(0, 0.082, 0.15);
    group.add(rail);
    // Rail notches
    for (let i = 0; i < 9; i++) {
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.005, 0.01), metalDark);
      notch.position.set(0, 0.092, -0.1 + i * 0.065);
      group.add(notch);
    }
    // Bolt handle (right side)
    const boltBody = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6), metalBright);
    boltBody.rotation.z = Math.PI / 2;
    boltBody.position.set(0.075, 0.04, 0.2);
    group.add(boltBody);
    const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), metalBright);
    boltKnob.position.set(0.095, 0.04, 0.2);
    group.add(boltKnob);
    // Ejection port
    const ejPort = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.035, 0.055), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    ejPort.position.set(0.057, 0.03, 0.15);
    group.add(ejPort);

    // === SCOPE (detailed high-power) ===
    // Scope main tube
    const scopeMain = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.45, 14), metalDark);
    scopeMain.position.set(0, 0.145, 0.1);
    scopeMain.rotation.x = Math.PI / 2;
    group.add(scopeMain);
    // Objective bell (large front lens)
    const objBell = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.034, 0.1, 12), metalMed);
    objBell.rotation.x = Math.PI / 2;
    objBell.position.set(0, 0.145, -0.15);
    group.add(objBell);
    // Objective lens - glowing purple
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14), glowMat(color, 0.5));
    lens.position.set(0, 0.145, -0.2);
    group.add(lens);
    // Lens ring
    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.003, 6, 14), metalBright);
    lensRing.position.set(0, 0.145, -0.2);
    group.add(lensRing);
    // Eyepiece with rubber eye cup
    const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.06, 12), metalMed);
    eyepiece.rotation.x = Math.PI / 2;
    eyepiece.position.set(0, 0.145, 0.35);
    group.add(eyepiece);
    const eyeCup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.038, 0.02, 10), rubberMat);
    eyeCup.rotation.x = Math.PI / 2;
    eyeCup.position.set(0, 0.145, 0.38);
    group.add(eyeCup);
    // Elevation turret (top)
    const turretTop = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.04, 8), metalLight);
    turretTop.position.set(0, 0.19, 0.1);
    group.add(turretTop);
    const turretTopCap = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.008, 8), metalBright);
    turretTopCap.position.set(0, 0.21, 0.1);
    group.add(turretTopCap);
    // Windage turret (right side)
    const turretSide = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 8), metalLight);
    turretSide.rotation.z = Math.PI / 2;
    turretSide.position.set(0.055, 0.145, 0.1);
    group.add(turretSide);
    // Parallax adjustment (left side)
    const parallax = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), metalMed);
    parallax.rotation.z = Math.PI / 2;
    parallax.position.set(-0.055, 0.145, 0.0);
    group.add(parallax);
    // Scope mount rings (4 screws each)
    for (const z of [-0.04, 0.24]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 6, 12), metalMed);
      ring.position.set(0, 0.145, z);
      group.add(ring);
      // Mount base
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.035), metalMed);
      base.position.set(0, 0.11, z);
      group.add(base);
      // Screws
      for (const side of [-1, 1]) {
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.008, 6), metalBright);
        screw.rotation.z = Math.PI / 2;
        screw.position.set(side * 0.022, 0.11, z);
        group.add(screw);
      }
    }

    // === STOCK ===
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.1, 0.32), woodMat);
    stock.position.set(0, -0.01, 0.56);
    group.add(stock);
    // Cheek riser
    const cheekRest = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.035, 0.14), woodMat);
    cheekRest.position.set(0, 0.045, 0.52);
    group.add(cheekRest);
    // Cheek riser adjustment wheel
    const cheekWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.015, 6), metalBright);
    cheekWheel.rotation.z = Math.PI / 2;
    cheekWheel.position.set(0.038, 0.04, 0.5);
    group.add(cheekWheel);
    // Recoil pad (rubber)
    const recoilPad = new THREE.Mesh(new THREE.BoxGeometry(0.073, 0.11, 0.018), rubberMat);
    recoilPad.position.set(0, -0.01, 0.73);
    group.add(recoilPad);
    // Stock monopod
    const monopod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 6), metalMed);
    monopod.position.set(0, -0.1, 0.65);
    group.add(monopod);
    const monopodFoot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), rubberMat);
    monopodFoot.position.set(0, -0.14, 0.65);
    group.add(monopodFoot);

    // === GRIP & TRIGGER ===
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.21, 0.075), gripMat);
    grip.position.set(0, -0.18, 0.36);
    grip.rotation.x = -0.12;
    group.add(grip);
    // Grip texture
    for (let i = 0; i < 5; i++) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(0.057, 0.003, 0.04), metalDark);
      groove.position.set(0, -0.1 - i * 0.035, 0.355);
      group.add(groove);
    }
    const tGuard = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.006, 6, 10, Math.PI), metalMed);
    tGuard.position.set(0, -0.09, 0.33);
    tGuard.rotation.x = Math.PI;
    tGuard.rotation.z = Math.PI / 2;
    group.add(tGuard);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.032, 0.01), metalBright);
    trigger.position.set(0, -0.075, 0.33);
    group.add(trigger);

    // === BIPOD ===
    const bipodMount = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.035), metalMed);
    bipodMount.position.set(0, -0.04, -0.25);
    group.add(bipodMount);
    for (const side of [-1, 1]) {
      // Leg upper
      const legUp = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.18, 6), metalMed);
      legUp.position.set(side * 0.035, -0.06, -0.25);
      legUp.rotation.x = 0.15;
      legUp.rotation.z = side * 0.2;
      group.add(legUp);
      // Leg lower (telescoping)
      const legLow = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), metalLight);
      legLow.position.set(side * 0.05, -0.17, -0.26);
      legLow.rotation.x = 0.15;
      legLow.rotation.z = side * 0.2;
      group.add(legLow);
      // Rubber foot
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 6), rubberMat);
      foot.position.set(side * 0.06, -0.26, -0.27);
      group.add(foot);
    }

    // === LASER DESIGNATOR (under barrel) ===
    const laserHousing = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.06), metalDark);
    laserHousing.position.set(0, -0.04, -0.1);
    group.add(laserHousing);
    const laserLens = new THREE.Mesh(new THREE.CircleGeometry(0.008, 8), glowMat(color, 0.8));
    laserLens.position.set(0, -0.04, -0.131);
    group.add(laserLens);
    // Pressure switch wire
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.25, 4), metalDark);
    wire.rotation.x = Math.PI / 2;
    wire.position.set(0.02, -0.035, 0.05);
    group.add(wire);

    // === BARREL HEAT SHIELD ===
    // Perforated heat shield wrapping the barrel mid-section
    const heatShield = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.5, 10), metalMed);
    heatShield.rotation.x = Math.PI / 2;
    heatShield.position.set(0, 0.0, -0.85);
    group.add(heatShield);
    // Heat shield vents (slots cut into the shield)
    for (let i = 0; i < 8; i++) {
      for (const side of [0.028, -0.028]) {
        const hSlot = new THREE.Mesh(
          new THREE.BoxGeometry(0.008, 0.015, 0.025),
          new THREE.MeshBasicMaterial({ color: 0x080808 })
        );
        hSlot.position.set(0, side, -0.68 - i * 0.05);
        group.add(hSlot);
      }
    }
    // Heat shield mounting bands
    for (const z of [-0.65, -0.85, -1.05]) {
      const hBand = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.002, 6, 10), metalLight);
      hBand.position.z = z;
      group.add(hBand);
    }

    // === ANTI-GRAV STABILIZER MODULE ===
    // Stabilizer housing (underneath barrel, forward of receiver)
    const stabHousing = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.08), metalDark);
    stabHousing.position.set(0, -0.05, -0.45);
    group.add(stabHousing);
    // Stabilizer emitter plates
    for (const side of [-1, 1]) {
      const stabPlate = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.025, 0.06), metalLight);
      stabPlate.position.set(side * 0.02, -0.05, -0.45);
      group.add(stabPlate);
      // Stabilizer glow strip
      const stabGlow = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.018, 0.05), glowMat(color, 0.3));
      stabGlow.position.set(side * 0.021, -0.05, -0.45);
      group.add(stabGlow);
    }
    // Stabilizer indicator light
    const stabLight = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), glowMat(0x00ff44, 0.9));
    stabLight.position.set(0, -0.033, -0.42);
    group.add(stabLight);

    // === POWER CELL (visible on right side of receiver) ===
    const powerCell = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 8), metalDark);
    powerCell.rotation.z = Math.PI / 2;
    powerCell.position.set(0.074, -0.02, 0.05);
    group.add(powerCell);
    // Power cell energy window
    const cellWindow = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.04, 8), glowMat(color, 0.35));
    cellWindow.rotation.z = Math.PI / 2;
    cellWindow.position.set(0.074, -0.02, 0.05);
    group.add(cellWindow);
    // Power cell cap
    const cellCap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.01, 8), metalBright);
    cellCap.rotation.z = Math.PI / 2;
    cellCap.position.set(0.11, -0.02, 0.05);
    group.add(cellCap);
    // Power cell release latch
    const cellLatch = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.02), metalLight);
    cellLatch.position.set(0.09, -0.005, 0.05);
    group.add(cellLatch);

    // === RANGE FINDER MODULE (on scope) ===
    const rfBody = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, 0.04), metalDark);
    rfBody.position.set(0.045, 0.17, -0.05);
    group.add(rfBody);
    // Range finder lens
    const rfLens = new THREE.Mesh(new THREE.CircleGeometry(0.007, 8), glowMat(0xff4400, 0.6));
    rfLens.position.set(0.045, 0.17, -0.071);
    group.add(rfLens);
    // Range finder LED
    const rfLed = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 6), glowMat(0xff0000, 0.8));
    rfLed.position.set(0.045, 0.182, -0.04);
    group.add(rfLed);

    // === DATA LINK ANTENNA ===
    const antennaBase = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 6), metalMed);
    antennaBase.position.set(-0.04, 0.09, 0.35);
    group.add(antennaBase);
    const antennaMast = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.003, 0.06, 4), metalLight);
    antennaMast.position.set(-0.04, 0.125, 0.35);
    group.add(antennaMast);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), glowMat(color, 0.6));
    antennaTip.position.set(-0.04, 0.157, 0.35);
    group.add(antennaTip);

    // === BARREL CROWN (detailed muzzle end) ===
    // Crown face with ports
    const crownFace = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.015, 12), metalBright);
    crownFace.rotation.x = Math.PI / 2;
    crownFace.position.z = -1.62;
    group.add(crownFace);
    // Crown ports (6 radial)
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const crownPort = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.016, 6), new THREE.MeshBasicMaterial({ color: 0x050505 }));
      crownPort.rotation.x = Math.PI / 2;
      crownPort.position.set(Math.cos(angle) * 0.025, Math.sin(angle) * 0.025, -1.62);
      group.add(crownPort);
    }

    // === ENERGY / SCI-FI ELEMENTS ===
    // Energy coils near muzzle (more, varied sizes)
    for (let i = 0; i < 5; i++) {
      const coilSize = 0.028 + (i % 2) * 0.006;
      const coil = new THREE.Mesh(new THREE.TorusGeometry(coilSize, 0.004, 6, 12), glowMat(color, 0.45 + (i % 2) * 0.15));
      coil.position.z = -1.25 - i * 0.07;
      group.add(coil);
    }
    // Energy conduit along barrel underside (with nodes)
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 6), glowMat(color, 0.25));
    conduit.rotation.x = Math.PI / 2;
    conduit.position.set(0, -0.03, -1.05);
    group.add(conduit);
    // Conduit junction nodes
    for (let i = 0; i < 3; i++) {
      const jNode = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), glowMat(color, 0.5));
      jNode.position.set(0, -0.03, -0.7 - i * 0.3);
      group.add(jNode);
    }
    // Top energy conduit
    const conduitTop = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.6, 4), glowMat(color, 0.2));
    conduitTop.rotation.x = Math.PI / 2;
    conduitTop.position.set(0, 0.025, -1.0);
    group.add(conduitTop);
    // Glowing muzzle tip (enhanced)
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 12), new THREE.MeshBasicMaterial({ color }));
    tip.position.z = -1.83;
    group.add(tip);
    const tipHalo = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), glowMat(color, 0.14));
    tip.add(tipHalo);
    const tipCore = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), glowMat(0xddaaff, 0.9));
    tip.add(tipCore);
    // Muzzle bore glow
    const muzzleBore = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 8), glowMat(color, 0.4));
    muzzleBore.rotation.x = Math.PI / 2;
    muzzleBore.position.z = -1.83;
    group.add(muzzleBore);
    // Accent strips (doubled)
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.5), glowMat(color, 0.35));
      strip.position.set(side * 0.057, 0.04, 0.05);
      group.add(strip);
      // Lower accent strip
      const strip2 = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.002, 0.35), glowMat(color, 0.2));
      strip2.position.set(side * 0.057, -0.01, -0.05);
      group.add(strip2);
    }
    // Receiver panel lines
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const pLine = new THREE.Mesh(new THREE.BoxGeometry(0.001, 0.001, 0.22), new THREE.MeshBasicMaterial({ color: 0x111118 }));
        pLine.position.set(side * 0.056, -0.02 + i * 0.03, 0.15);
        group.add(pLine);
      }
    }
    // Digital ammo counter (glowing display on left side)
    const displayBg = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.025), new THREE.MeshBasicMaterial({ color: 0x050510 }));
    displayBg.position.set(-0.058, 0.02, 0.08);
    displayBg.rotation.y = -Math.PI / 2;
    group.add(displayBg);
    const displayTxt = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.02), glowMat(color, 0.7));
    displayTxt.position.set(-0.059, 0.02, 0.08);
    displayTxt.rotation.y = -Math.PI / 2;
    group.add(displayTxt);
    // Display border
    const displayBorder = new THREE.Mesh(new THREE.PlaneGeometry(0.048, 0.028), new THREE.MeshBasicMaterial({ color: 0x1a1a2a }));
    displayBorder.position.set(-0.057, 0.02, 0.08);
    displayBorder.rotation.y = -Math.PI / 2;
    group.add(displayBorder);
    // Status LEDs (3 dots below display)
    for (let i = 0; i < 3; i++) {
      const ledColor = i === 0 ? 0x00ff44 : (i === 1 ? 0xffaa00 : color);
      const statusLed = new THREE.Mesh(new THREE.SphereGeometry(0.003, 6, 6), glowMat(ledColor, 0.8));
      statusLed.position.set(-0.059, 0.003, 0.065 + i * 0.015);
      group.add(statusLed);
    }

    // === ADDITIONAL RECEIVER DETAILS ===
    // Picatinny rail screws
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const rScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.004, 6), metalBright);
        rScrew.rotation.z = Math.PI / 2;
        rScrew.position.set(side * 0.056, 0.06, -0.05 + i * 0.1);
        group.add(rScrew);
      }
    }
    // Magazine floor plate detail
    const magFloor = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.005, 0.045), metalLight);
    magFloor.position.set(0, -0.28, 0.3);
    group.add(magFloor);

    group.position.set(0.35, -0.35, -0.3);
    group.rotation.set(0, -0.1, 0);
    return group;
  }

  _buildRocketLauncherModel() {
    const group = new THREE.Group();
    const accent = 0x00ffee;
    const metalMat = new THREE.MeshPhongMaterial({ color: 0x2a3540, shininess: 70, specular: 0x88aabb });
    const darkMat = new THREE.MeshPhongMaterial({ color: 0x151a22, shininess: 40 });
    const panelMat = new THREE.MeshPhongMaterial({ color: 0x333e4a, shininess: 90, specular: 0x99bbcc });
    const glowMat = (c, o = 0.75) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o });

    // === Main launch tube ===
    const tubeOuter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.095, 1.2, 16),
      metalMat
    );
    tubeOuter.rotation.x = Math.PI / 2;
    tubeOuter.position.z = -0.1;
    group.add(tubeOuter);

    // Inner barrel (darker, visible through front)
    const tubeInner = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.08, 1.21, 14),
      darkMat
    );
    tubeInner.rotation.x = Math.PI / 2;
    tubeInner.position.z = -0.1;
    group.add(tubeInner);

    // Ring reinforcements along the tube
    for (const zz of [-0.55, -0.25, 0.05, 0.35]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.098, 0.012, 6, 20),
        panelMat
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.z = zz;
      group.add(ring);
    }

    // Cooling vent slots along the top
    for (let i = 0; i < 5; i++) {
      const vent = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.01, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x050910 })
      );
      vent.position.set(0, 0.1, -0.45 + i * 0.18);
      group.add(vent);
    }

    // Forward muzzle ring with flared tip
    const muzzleFlare = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.09, 0.09, 16),
      panelMat
    );
    muzzleFlare.rotation.x = Math.PI / 2;
    muzzleFlare.position.z = -0.73;
    group.add(muzzleFlare);
    // Muzzle inner glow
    const muzzleGlow = new THREE.Mesh(
      new THREE.CircleGeometry(0.085, 16),
      glowMat(accent, 0.6)
    );
    muzzleGlow.rotation.y = Math.PI;
    muzzleGlow.position.z = -0.78;
    group.add(muzzleGlow);
    // Muzzle outer ring
    const muzzleRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.11, 0.008, 6, 20),
      glowMat(accent, 0.85)
    );
    muzzleRing.rotation.y = Math.PI / 2;
    muzzleRing.position.z = -0.77;
    group.add(muzzleRing);
    // Muzzle claws (4 forward prongs)
    for (let c = 0; c < 4; c++) {
      const claw = new THREE.Mesh(
        new THREE.BoxGeometry(0.025, 0.025, 0.12),
        metalMat
      );
      const ang = (c / 4) * Math.PI * 2 + Math.PI / 4;
      claw.position.set(Math.cos(ang) * 0.11, Math.sin(ang) * 0.11, -0.82);
      group.add(claw);
    }

    // === Plasma loading core visible midway (peek through tube) ===
    const plasmaChamber = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.3, 12),
      glowMat(accent, 0.9)
    );
    plasmaChamber.rotation.x = Math.PI / 2;
    plasmaChamber.position.z = 0.12;
    plasmaChamber.position.y = 0.02;
    group.add(plasmaChamber);
    // Chamber halo
    const plasmaHalo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.32, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
    );
    plasmaHalo.rotation.x = Math.PI / 2;
    plasmaHalo.position.z = 0.12;
    plasmaHalo.position.y = 0.02;
    group.add(plasmaHalo);

    // Viewport window showing plasma (slot on top of tube)
    const window1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.005, 0.18),
      glowMat(accent, 0.8)
    );
    window1.position.set(0, 0.095, 0.12);
    group.add(window1);
    const window2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.003, 0.2),
      glowMat(accent, 0.4)
    );
    window2.position.set(0, 0.097, 0.12);
    group.add(window2);

    // === Energy coils wrapped around the front of the tube ===
    for (let c = 0; c < 3; c++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.105, 0.01, 6, 20),
        glowMat(accent, 0.7 - c * 0.15)
      );
      coil.rotation.y = Math.PI / 2;
      coil.position.z = -0.4 + c * 0.12;
      group.add(coil);
    }

    // === Side ammo canisters (2 per side) ===
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const canister = new THREE.Mesh(
          new THREE.CylinderGeometry(0.028, 0.028, 0.22, 8),
          panelMat
        );
        canister.rotation.x = Math.PI / 2;
        canister.position.set(side * 0.13, -0.02, -0.05 + i * 0.28);
        group.add(canister);
        // Glow tip on each canister
        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.02, 6, 6),
          glowMat(accent, 0.9)
        );
        tip.position.set(side * 0.13, -0.02, -0.17 + i * 0.28);
        group.add(tip);
        // Connector tube to main body
        const conn = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4),
          metalMat
        );
        conn.rotation.z = Math.PI / 2;
        conn.position.set(side * 0.1, -0.02, -0.05 + i * 0.28);
        group.add(conn);
      }
    }

    // === Receiver / body block ===
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.14, 0.32),
      panelMat
    );
    receiver.position.set(0, -0.03, 0.38);
    group.add(receiver);
    // Angled side panels
    for (const side of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.12, 0.28),
        new THREE.MeshPhongMaterial({ color: 0x1a2430, shininess: 100 })
      );
      panel.position.set(side * 0.095, -0.03, 0.38);
      group.add(panel);
      // Glowing side strips
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.002, 0.005, 0.2),
        glowMat(accent, 0.7)
      );
      strip.position.set(side * 0.1, -0.06, 0.38);
      group.add(strip);
    }

    // Top-mounted targeting sight / display
    const sightBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.025, 0.1),
      darkMat
    );
    sightBase.position.set(0, 0.075, 0.3);
    group.add(sightBase);
    const sightScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.04),
      glowMat(accent, 0.75)
    );
    sightScreen.rotation.x = -Math.PI / 3;
    sightScreen.position.set(0, 0.095, 0.27);
    group.add(sightScreen);
    // Crosshair on screen
    const crossH = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.002, 0.001),
      glowMat(0xffffff, 0.9)
    );
    crossH.rotation.x = -Math.PI / 3;
    crossH.position.set(0, 0.099, 0.266);
    group.add(crossH);
    const crossV = new THREE.Mesh(
      new THREE.BoxGeometry(0.002, 0.003, 0.04),
      glowMat(0xffffff, 0.9)
    );
    crossV.rotation.x = -Math.PI / 3;
    crossV.position.set(0, 0.099, 0.266);
    group.add(crossV);
    // Sight lens at front
    const sightLens = new THREE.Mesh(
      new THREE.CircleGeometry(0.02, 8),
      glowMat(accent, 0.6)
    );
    sightLens.position.set(0, 0.09, 0.21);
    group.add(sightLens);

    // Grip (pistol style)
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.2, 0.08),
      darkMat
    );
    grip.position.set(0, -0.2, 0.42);
    grip.rotation.x = 0.25;
    group.add(grip);
    // Grip textured ridges
    for (let r = 0; r < 5; r++) {
      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.005, 0.085),
        new THREE.MeshPhongMaterial({ color: 0x0a0f18 })
      );
      ridge.position.set(0, -0.13 - r * 0.028, 0.43 + r * 0.006);
      ridge.rotation.x = 0.25;
      group.add(ridge);
    }
    // Trigger guard
    const triggerGuard = new THREE.Mesh(
      new THREE.TorusGeometry(0.035, 0.005, 4, 12, Math.PI),
      metalMat
    );
    triggerGuard.rotation.x = Math.PI / 2 + 0.2;
    triggerGuard.position.set(0, -0.11, 0.47);
    group.add(triggerGuard);

    // Shoulder rest / rear brace
    const shoulderRest = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.12, 0.08),
      darkMat
    );
    shoulderRest.position.set(0, -0.02, 0.6);
    group.add(shoulderRest);
    // Rest pad
    const restPad = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.14, 0.03),
      new THREE.MeshPhongMaterial({ color: 0x080808 })
    );
    restPad.position.set(0, -0.02, 0.65);
    group.add(restPad);

    // Rear exhaust vents (glowing)
    for (let v = 0; v < 3; v++) {
      const ang = (v - 1) * 0.4;
      const ventSlot = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.008, 0.04),
        glowMat(accent, 0.6)
      );
      ventSlot.position.set(Math.sin(ang) * 0.06, 0.02, 0.68);
      group.add(ventSlot);
    }

    // Status LEDs on the side of the receiver
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const led = new THREE.Mesh(
          new THREE.SphereGeometry(0.005, 6, 6),
          glowMat(i === 0 ? 0x00ff44 : (i === 1 ? 0xffaa00 : accent), 0.9)
        );
        led.position.set(side * 0.1, 0.02, 0.28 + i * 0.03);
        group.add(led);
      }
    }

    // Ammo counter display on left side
    const counterBg = new THREE.Mesh(
      new THREE.PlaneGeometry(0.06, 0.03),
      new THREE.MeshBasicMaterial({ color: 0x030508 })
    );
    counterBg.rotation.y = -Math.PI / 2;
    counterBg.position.set(-0.096, 0.0, 0.4);
    group.add(counterBg);
    const counterScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.055, 0.025),
      glowMat(accent, 0.7)
    );
    counterScreen.rotation.y = -Math.PI / 2;
    counterScreen.position.set(-0.097, 0.0, 0.4);
    group.add(counterScreen);

    // Fore grip under the barrel
    const foreGrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.09, 0.1),
      darkMat
    );
    foreGrip.position.set(0, -0.12, 0.05);
    group.add(foreGrip);
    for (let i = 0; i < 3; i++) {
      const ridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.005, 0.11),
        new THREE.MeshPhongMaterial({ color: 0x0a0f18 })
      );
      ridge.position.set(0, -0.08 - i * 0.025, 0.05);
      group.add(ridge);
    }

    // Warning stripes (hazard markings near muzzle)
    for (let i = 0; i < 4; i++) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.05, 0.01),
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xffaa00 : 0x222222 })
      );
      const ang = i * Math.PI / 2;
      stripe.position.set(Math.cos(ang) * 0.1, Math.sin(ang) * 0.1, -0.6);
      group.add(stripe);
    }

    group.position.set(0.32, -0.3, -0.35);
    group.rotation.set(0, -0.06, 0);
    return group;
  }

  switchWeapon(name) {
    if (!WEAPONS[name]) return;
    if (this.current === name) return;
    if (this.zoomed) this.toggleZoom();
    Object.values(this.weaponModels).forEach(m => m.visible = false);
    if (this.weaponModels[name]) this.weaponModels[name].visible = true;
    this.current = name;
    this.cooldown = 0;
    this._switchTimer = this._switchDuration;
    if (this._weaponAccentLight) {
      const colors = { laserRifle: 0xff0000, laserSword: 0x0088ff, sniperRifle: 0x8800ff, rocketLauncher: 0x00ffee };
      this._weaponAccentLight.color.setHex(colors[name] || 0xff0000);
    }
    this.audio.playWeaponSwitch();
  }

  toggleZoom() {
    if (this.current !== 'sniperRifle') return;
    this.zoomed = !this.zoomed;
    this.camera.fov = this.zoomed ? this.originalFov / WEAPONS.sniperRifle.zoom : this.originalFov;
    this.camera.updateProjectionMatrix();
    document.getElementById('scope-overlay').style.display = this.zoomed ? 'block' : 'none';
    document.getElementById('weapon-model').style.display = this.zoomed ? 'none' : 'block';
    document.getElementById('crosshair').style.display = this.zoomed ? 'none' : 'block';
  }

  fire(enemies) {
    if (this.cooldown > 0) return null;
    const weapon = WEAPONS[this.current];
    const frMul = this.player ? this.player.fireRateMultiplier : 1;
    this.cooldown = weapon.fireRate * frMul;

    // Play sound
    if (this.current === 'laserRifle') this.audio.playLaserRifle();
    else if (this.current === 'laserSword') this.audio.playLaserSword();
    else if (this.current === 'sniperRifle') this.audio.playSniperShot();
    else if (this.current === 'rocketLauncher' && this.audio.playRocketLaunch) this.audio.playRocketLaunch();

    if (weapon.type === 'melee') {
      return this._meleeAttack(enemies, weapon);
    } else if (weapon.type === 'projectile') {
      // Big recoil kick
      this.recoilOffset = 2.0;
      this.recoilRotX = 1.8;
      this._launchRocket(weapon);
      return null; // hits are delivered asynchronously via onRocketHit
    } else {
      // Recoil kick
      this.recoilOffset = this.current === 'sniperRifle' ? 1.5 : 0.8;
      this.recoilRotX = this.current === 'sniperRifle' ? 1.2 : 0.6;
      return this._hitscanAttack(enemies, weapon);
    }
  }

  fireAlt(enemies) {
    if (this.cooldown > 0) return null;
    const frMul = this.player ? this.player.fireRateMultiplier : 1;
    const dmgMul = this.player ? this.player.damageMultiplier : 1;

    if (this.current === 'laserRifle') {
      // Burst mode — 3 rapid shots with tighter grouping
      this.cooldown = 0.5 * frMul;
      this.recoilOffset = 1.2;
      this.recoilRotX = 0.9;
      const weapon = WEAPONS.laserRifle;
      const results = [];
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          if (this.cooldown > 0.4) return;
          this.audio.playLaserRifle();
          this.recoilOffset = 0.6;
          this.recoilRotX = 0.4;
          const r = this._hitscanAttack(enemies, {
            ...weapon,
            damage: Math.floor(7 * dmgMul),
            spread: 0.01,
          });
          if (r && r.hit && this._onAltHit) this._onAltHit(r);
        }, i * 80);
      }
      this.audio.playLaserRifle();
      return this._hitscanAttack(enemies, { ...weapon, damage: Math.floor(7 * dmgMul), spread: 0.01 });
    } else if (this.current === 'sniperRifle') {
      // Explosive round — hitscan that detonates at impact point
      this.cooldown = 2.5 * frMul;
      this.recoilOffset = 2.0;
      this.recoilRotX = 1.8;
      this.audio.playSniperShot();
      const weapon = WEAPONS.sniperRifle;
      const result = this._hitscanAttack(enemies, { ...weapon, damage: Math.floor(70 * dmgMul) });
      if (result && result.hit && result.point) {
        const pos = result.point;
        this.particles.createExplosion(pos, 0x8800ff, 4, 0.6);
        if (this.audio.playExplosion) this.audio.playExplosion();
        const hits = [];
        const radius = 4 * (this.player ? this.player.explosionRadiusMultiplier : 1);
        const radiusSq = radius * radius;
        for (const enemy of enemies) {
          if (enemy.dead || enemy === result.enemy) continue;
          const dx = enemy.mesh.position.x - pos.x;
          const dz = enemy.mesh.position.z - pos.z;
          if (dx * dx + dz * dz < radiusSq) {
            hits.push({
              hit: true, enemy,
              damage: Math.floor(40 * dmgMul * (1 - Math.sqrt(dx * dx + dz * dz) / radius)),
              point: enemy.mesh.position,
              weaponKey: 'sniperRifle',
            });
          }
        }
        if (hits.length > 0 && this.onRocketHit) this.onRocketHit(hits, pos);
      }
      return result;
    } else if (this.current === 'laserSword') {
      // Dash strike — lunge forward while slashing
      this.cooldown = 0.6 * frMul;
      this.swingAngle = 1.5;
      this.recoilOffset = 0.5;
      this.audio.playLaserSword();
      this.particles.createSwordSlash(this.camera, WEAPONS.laserSword.color);
      if (this._onDashStrike) this._onDashStrike();
      return this._meleeAttack(enemies, { ...WEAPONS.laserSword, range: 6, damage: Math.floor(40 * dmgMul) });
    } else if (this.current === 'rocketLauncher') {
      // Cluster rocket — splits into 3 mini-rockets
      this.cooldown = 2.2 * frMul;
      this.recoilOffset = 2.5;
      this.recoilRotX = 2.0;
      if (this.audio.playRocketLaunch) this.audio.playRocketLaunch();
      const weapon = WEAPONS.rocketLauncher;
      this._launchRocket({
        ...weapon,
        damage: Math.floor(50 * dmgMul),
        explosionRadius: 4,
        projectileSpeed: 40,
      });
      return null;
    }
    return null;
  }

  _launchRocket(weapon) {
    const origin = this.camera.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    // Spawn slightly ahead of camera, offset down-right to match hip-fired rocket
    const right = new THREE.Vector3();
    right.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const spawn = new THREE.Vector3().copy(origin)
      .add(dir.clone().multiplyScalar(1.2))
      .add(right.multiplyScalar(0.25))
      .add(new THREE.Vector3(0, -0.2, 0));

    // Build rocket mesh: elongated glowing warhead with trail
    const rocket = new THREE.Group();
    // Main body (cyan metal)
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.6, 10),
      new THREE.MeshPhongMaterial({ color: 0x223344, emissive: 0x001122, shininess: 80 })
    );
    body.rotation.x = Math.PI / 2;
    rocket.add(body);
    // Nose cone
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.22, 10),
      new THREE.MeshPhongMaterial({ color: 0x445566, emissive: 0x112233, shininess: 100 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.z = 0.4;
    rocket.add(nose);
    // Glowing plasma core (visible through slots)
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x00ffee, transparent: true, opacity: 0.85 })
    );
    rocket.add(core);
    // Outer halo glow
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x00ffee, transparent: true, opacity: 0.25 })
    );
    rocket.add(halo);
    // Stabilizer fins
    for (let f = 0; f < 4; f++) {
      const fin = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.02, 0.15),
        new THREE.MeshPhongMaterial({ color: 0x334455 })
      );
      fin.position.z = -0.25;
      fin.rotation.z = (f / 4) * Math.PI * 2;
      rocket.add(fin);
    }
    // Exhaust cone behind
    const exhaust = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.4, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x88ffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    );
    exhaust.rotation.x = -Math.PI / 2;
    exhaust.position.z = -0.55;
    rocket.add(exhaust);

    // Rocket no longer carries a dedicated PointLight — it's redundant with
    // the emissive nose/exhaust glow and adding/removing a light on spawn
    // forces every MeshPhongMaterial in the scene to recompile.
    rocket.position.copy(spawn);
    // Orient rocket to face direction of travel
    rocket.lookAt(spawn.clone().add(dir));
    this.scene.add(rocket);

    // Muzzle flash at launch
    this.particles.createMuzzleFlash(spawn, dir, 0x00ffee);

    this.projectiles.push({
      mesh: rocket,
      body, nose, core, halo, exhaust,
      position: spawn.clone(),
      velocity: dir.clone().multiplyScalar(weapon.projectileSpeed),
      damage: Math.floor(weapon.damage * (this.player ? this.player.damageMultiplier : 1)),
      radius: weapon.explosionRadius * (this.player ? this.player.explosionRadiusMultiplier : 1),
      range: weapon.range,
      distanceTraveled: 0,
      age: 0,
      weapon,
    });
  }

  _updateProjectiles(delta, enemies) {
    if (this.projectiles.length === 0) return;
    const tmp = this._tmpToEnemy;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += delta;
      // Inline velocity * delta without allocating a new Vector3 each frame
      const stepX = p.velocity.x * delta;
      const stepY = p.velocity.y * delta;
      const stepZ = p.velocity.z * delta;
      p.position.x += stepX;
      p.position.y += stepY;
      p.position.z += stepZ;
      p.distanceTraveled += Math.sqrt(stepX * stepX + stepY * stepY + stepZ * stepZ);
      p.mesh.position.copy(p.position);

      // Animate core/halo pulsing
      const pulse = 0.8 + Math.sin(p.age * 40) * 0.2;
      if (p.core) p.core.scale.set(pulse, pulse, pulse);
      if (p.halo) p.halo.scale.set(pulse * 1.15, pulse * 1.15, pulse * 1.15);
      if (p.exhaust) {
        const exS = 0.8 + Math.sin(p.age * 30) * 0.2;
        p.exhaust.scale.set(exS, exS, 1 + Math.sin(p.age * 25) * 0.3);
      }
      // Spin for visual interest
      p.mesh.rotateZ(delta * 6);

      // Check enemy collision
      let hitEnemy = null;
      for (let e = 0; e < enemies.length; e++) {
        const enemy = enemies[e];
        if (enemy.dead) continue;
        const r = (this._alienRadius[enemy.type] || 1.0) + 0.4;
        tmp.subVectors(enemy.mesh.position, p.position);
        tmp.y += 0.8;
        if (tmp.lengthSq() < r * r) {
          hitEnemy = enemy;
          break;
        }
      }

      // Detonate on enemy hit, ground hit, or max range
      const hitGround = p.position.y <= 0.3;
      const outOfRange = p.distanceTraveled >= p.range;
      if (hitEnemy || hitGround || outOfRange) {
        this._detonateRocket(p, enemies);
        this.scene.remove(p.mesh);
        disposeTree(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  _detonateRocket(p, enemies) {
    // Spectacular explosion visuals
    if (this.particles.createMegaExplosion) {
      this.particles.createMegaExplosion(p.position, p.radius);
    } else {
      this.particles.createExplosion(p.position, 0x00ffee, p.radius, 1.2);
    }
    if (this.audio.playExplosion) this.audio.playExplosion();

    // Apply AoE damage
    const hits = [];
    const radiusSq = p.radius * p.radius;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy.dead) continue;
      const dx = enemy.mesh.position.x - p.position.x;
      const dy = enemy.mesh.position.y + 0.8 - p.position.y;
      const dz = enemy.mesh.position.z - p.position.z;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq < radiusSq) {
        const d = Math.sqrt(dSq);
        const falloff = 1 - d / p.radius;
        const dmg = p.damage * (0.5 + falloff * 0.5);
        hits.push({
          hit: true,
          enemy,
          damage: dmg,
          point: enemy.mesh.position,
          weaponKey: 'rocketLauncher',
        });
      }
    }
    if (hits.length > 0 && this.onRocketHit) {
      this.onRocketHit(hits, p.position);
    }
  }

  _hitscanAttack(enemies, weapon) {
    const origin = this.camera.position;
    const dir = this._tmpDir;
    this.camera.getWorldDirection(dir);

    // Weapon spread — adds slight random deviation to the aim direction.
    // Sniper has zero spread; rifle has a small cone that makes it less
    // precise at long range, reinforcing the sniper's niche.
    const spread = weapon.spread || 0;
    if (spread > 0) {
      dir.x += (Math.random() - 0.5) * spread;
      dir.y += (Math.random() - 0.5) * spread;
      dir.z += (Math.random() - 0.5) * spread;
      dir.normalize();
    }

    // Muzzle flash
    const muzzlePos = this._tmpMuzzle.set(
      origin.x + dir.x,
      origin.y + dir.y,
      origin.z + dir.z
    );
    this.particles.createMuzzleFlash(muzzlePos, dir, weapon.color);

    // Raycast against enemies (reused)
    const raycaster = this._tmpRaycaster;
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = weapon.range;
    const ray = raycaster.ray;
    const sphere = this._tmpSphere;
    let closestHit = null;
    let closestDist = Infinity;

    for (let i = 0, n = enemies.length; i < n; i++) {
      const enemy = enemies[i];
      if (enemy.dead) continue;
      // Cheap bounding-sphere prefilter: skip deep raycast if the ray
      // cannot possibly intersect the enemy's rough bounds.
      const r = this._alienRadius[enemy.type] || 1.0;
      sphere.center.copy(enemy.mesh.position);
      sphere.center.y += 0.8;
      sphere.radius = r + 0.3;
      if (!ray.intersectsSphere(sphere)) continue;
      const intersects = raycaster.intersectObject(enemy.mesh, true);
      if (intersects.length > 0 && intersects[0].distance < closestDist) {
        closestDist = intersects[0].distance;
        closestHit = { enemy, point: intersects[0].point, distance: closestDist };
      }
    }

    if (closestHit) {
      // Draw beam to hit point - weapon-specific
      if (this.current === 'sniperRifle') {
        this.particles.createSniperTracer(muzzlePos, closestHit.point, weapon.color);
        this.particles.createWeaponImpact(closestHit.point, 'sniperRifle');
      } else {
        this.particles.createLaserBeam(muzzlePos, closestHit.point, weapon.color, 0.15, weapon.beamWidth);
      }
      const dmgMul = this.player ? this.player.damageMultiplier : 1;
      return { hit: true, enemy: closestHit.enemy, damage: Math.floor(weapon.damage * dmgMul), point: closestHit.point, weaponKey: this.current };
    } else {
      // Draw beam to max range
      const endPoint = this._tmpEnd.set(
        origin.x + dir.x * weapon.range,
        origin.y + dir.y * weapon.range,
        origin.z + dir.z * weapon.range
      );
      if (this.current === 'sniperRifle') {
        this.particles.createSniperTracer(muzzlePos, endPoint, weapon.color);
      } else {
        this.particles.createLaserBeam(muzzlePos, endPoint, weapon.color, 0.1, weapon.beamWidth);
      }
      return { hit: false };
    }
  }

  _meleeAttack(enemies, weapon) {
    this.particles.createSwordSlash(this.camera, weapon.color);

    const origin = this.camera.position;
    const dir = this._tmpDir;
    this.camera.getWorldDirection(dir);

    // Animate sword swing
    this.swingAngle = 1.0;

    const hits = [];
    const toEnemy = this._tmpToEnemy;
    for (let i = 0, n = enemies.length; i < n; i++) {
      const enemy = enemies[i];
      if (enemy.dead) continue;
      toEnemy.subVectors(enemy.mesh.position, origin);
      const dist = toEnemy.length();
      if (dist > weapon.range) continue;
      // Check angle (wide arc - 90 degrees)
      toEnemy.multiplyScalar(1 / dist);
      const dot = dir.dot(toEnemy);
      if (dot > 0.3) {
        this.particles.createWeaponImpact(enemy.mesh.position, 'laserSword');
        const dmgMul = this.player ? this.player.damageMultiplier : 1;
        hits.push({ hit: true, enemy, damage: Math.floor(weapon.damage * dmgMul), point: enemy.mesh.position, weaponKey: 'laserSword' });
      }
    }
    return hits.length > 0 ? hits : { hit: false };
  }

  update(delta, enemies) {
    if (this.cooldown > 0) this.cooldown -= delta;

    // Advance rocket projectiles
    if (enemies) this._updateProjectiles(delta, enemies);

    // Recoil recovery
    if (this.recoilOffset > 0) {
      this.recoilOffset *= Math.pow(0.02, delta); // Exponential decay
      if (this.recoilOffset < 0.001) this.recoilOffset = 0;
    }
    if (this.recoilRotX > 0) {
      this.recoilRotX *= Math.pow(0.02, delta);
      if (this.recoilRotX < 0.001) this.recoilRotX = 0;
    }

    const time = performance.now() * 0.001;

    // Animate weapon
    if (this.weaponModels[this.current]) {
      const model = this.weaponModels[this.current];

      // Default position based on weapon type
      let baseX = 0, baseY = 0, baseZ = 0;
      let baseRotX = 0, baseRotY = 0, baseRotZ = 0;
      if (this.current === 'laserRifle') {
        baseX = 0.15; baseY = -0.15; baseRotY = -0.1;
      } else if (this.current === 'sniperRifle') {
        baseX = 0.1; baseY = -0.12; baseRotY = -0.08;
      } else if (this.current === 'rocketLauncher') {
        baseX = 0.2; baseY = -0.2; baseRotY = -0.05;
      } else {
        baseX = 0.2; baseY = -0.1; baseRotZ = 0.3;
      }

      // Idle sway (slow, smooth)
      const swayX = Math.sin(time * 0.8) * 0.003 + Math.sin(time * 1.3) * 0.002;
      const swayY = Math.sin(time * 1.1) * 0.004 + Math.cos(time * 0.7) * 0.002;
      const swayRotZ = Math.sin(time * 0.6) * 0.005;

      // Breathing bob
      const breatheY = Math.sin(time * 2.0) * 0.003;

      // Movement tilt — weapon leans into movement direction
      const moveTiltX = (this._moveTiltX || 0);
      const moveTiltZ = (this._moveTiltZ || 0);

      // Apply recoil (kick back and up)
      const recoilZ = (this.recoilOffset || 0) * 0.15;
      const recoilRotUp = -(this.recoilRotX || 0) * 0.1;

      // Switch draw animation — weapon rises from below
      let switchY = 0;
      if (this._switchTimer > 0) {
        this._switchTimer -= delta;
        const t = Math.max(0, this._switchTimer / this._switchDuration);
        switchY = -t * 0.35;
      }

      model.position.set(
        baseX + swayX + moveTiltX * 0.02,
        baseY + swayY + breatheY + switchY,
        baseZ + recoilZ
      );
      model.rotation.set(
        baseRotX + recoilRotUp + moveTiltZ * 0.015,
        baseRotY,
        baseRotZ + swayRotZ - moveTiltX * 0.03
      );
    }

    // Sword swing animation
    if (this.swingAngle > 0 && this.weaponModels.laserSword) {
      this.swingAngle -= delta * 5;
      this.weaponModels.laserSword.rotation.z = 0.3 + Math.sin(this.swingAngle * Math.PI) * 0.8;
    }

    // Weapon energy glow pulse - use cached material refs (no traverse)
    const glowMats = this._glowMaterials && this._glowMaterials[this.current];
    if (glowMats) {
      for (let i = 0, len = glowMats.length; i < len; i++) {
        const mat = glowMats[i];
        const base = mat.userData.baseOpacity;
        const phase = base * 12.0;
        mat.opacity = base * (0.88 + Math.sin(time * 2.5 + phase) * 0.1 + Math.sin(time * 6.0 + phase * 0.7) * 0.05);
      }
    }

    // Pulse accent light intensity
    if (this._weaponAccentLight) {
      this._weaponAccentLight.intensity = 0.35 + Math.sin(time * 3.0) * 0.12;
    }

    // Render weapon view
    if (this.weaponRenderer && this.weaponScene && !this.zoomed) {
      this.weaponRenderer.render(this.weaponScene, this.weaponCamera);
    }
  }

  getWeaponData() {
    const w = WEAPONS[this.current];
    const cooldownPct = this.cooldown > 0 ? this.cooldown / w.fireRate : 0;
    return { ...w, cooldownPct, currentKey: this.current };
  }

  // Build a standalone model for help guide preview
  static buildPreviewModel(type) {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x404040));
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 3);
    scene.add(light);

    let model;
    const wm = new WeaponManager.__proto__.constructor.prototype;
    if (type === 'laserRifle') {
      model = WeaponManager.prototype._buildRifleModel.call({}, 0xff0000);
    } else if (type === 'laserSword') {
      model = WeaponManager.prototype._buildSwordModel.call({});
    } else {
      model = WeaponManager.prototype._buildSniperModel.call({});
    }
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0.5, 0);
    scene.add(model);
    return { scene, model };
  }
}
