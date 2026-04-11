// weapons.js - Three weapon types: Laser Rifle, Laser Sword, Sniper Laser Rifle
export const WEAPONS = {
  laserRifle: {
    name: 'LASER RIFLE',
    damage: 10,
    fireRate: 0.15,       // seconds between shots
    range: 100,
    type: 'hitscan',
    color: 0xff0000,
    beamWidth: 0.02,
    description: 'Standard issue laser rifle. Fast fire rate, reliable damage.',
    key: '1',
  },
  laserSword: {
    name: 'LASER SWORD',
    damage: 40,
    fireRate: 0.4,
    range: 3.5,
    type: 'melee',
    color: 0x0088ff,
    description: 'High-energy plasma blade. Devastating at close range.',
    key: '2',
  },
  sniperRifle: {
    name: 'SNIPER LASER RIFLE',
    damage: 75,
    fireRate: 1.0,
    range: 200,
    type: 'hitscan',
    color: 0x8800ff,
    beamWidth: 0.015,
    zoom: 3,
    description: 'Precision long-range laser. One shot, one kill.',
    key: '3',
  },
};

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
    const keyLight = new THREE.DirectionalLight(0xddeeff, 1.2);
    keyLight.position.set(2, 2, 3);
    this.weaponScene.add(keyLight);
    // Fill light - softer from left side
    const fillLight = new THREE.DirectionalLight(0x8899bb, 0.4);
    fillLight.position.set(-2, 0.5, 1);
    this.weaponScene.add(fillLight);
    // Rim light - edge definition from behind
    const rimLight = new THREE.DirectionalLight(0x6688cc, 0.6);
    rimLight.position.set(-1, 1, -2);
    this.weaponScene.add(rimLight);
    // Ambient fill
    this.weaponScene.add(new THREE.AmbientLight(0x334455, 0.5));

    // Build weapon models
    this.weaponModels.laserRifle = this._buildRifleModel(0xff0000);
    this.weaponModels.laserSword = this._buildSwordModel();
    this.weaponModels.sniperRifle = this._buildSniperModel();

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

    // === CROSSGUARD ===
    // Main guard bar
    const guardMain = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.045), metalMat);
    guardMain.position.y = 0.22;
    group.add(guardMain);
    // Guard detail ridge
    const guardRidge = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.008, 0.05), metalBright);
    guardRidge.position.y = 0.235;
    group.add(guardRidge);
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
      // Guard wing accents (energy)
      const wingGlow = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.003, 0.01), glowMat(0x0088ff, 0.4));
      wingGlow.position.set(side * 0.08, 0.22, 0.025);
      group.add(wingGlow);
    }
    // Center gem - larger, faceted
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), glowMat(0x00bbff, 1.0));
    gem.position.set(0, 0.22, 0.028);
    group.add(gem);
    const gemHalo = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), glowMat(0x0088ff, 0.15));
    gem.add(gemHalo);

    // === EMITTER HOUSING ===
    const emitterBase = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.04, 10), metalMat);
    emitterBase.position.y = 0.265;
    group.add(emitterBase);
    const emitterRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 12), metalBright);
    emitterRing.position.y = 0.285;
    emitterRing.rotation.x = Math.PI / 2;
    group.add(emitterRing);
    // Emitter vents
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.025, 0.004), darkMetal);
      vent.position.set(Math.cos(angle) * 0.03, 0.27, Math.sin(angle) * 0.03);
      group.add(vent);
    }
    // Emitter glow disc
    const emitterGlow = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), glowMat(0x44aaff, 0.6));
    emitterGlow.position.y = 0.29;
    emitterGlow.rotation.x = -Math.PI / 2;
    group.add(emitterGlow);

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

    // Blade edge sparkle particles
    for (let i = 0; i < 10; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.006 + Math.random() * 0.004, 4, 4),
        glowMat(0xccddff, 0.6 + Math.random() * 0.4)
      );
      const y = 0.4 + Math.random() * bladeLen * 0.8;
      spark.position.set((Math.random() - 0.5) * 0.04, y, (Math.random() - 0.5) * 0.01);
      group.add(spark);
    }
    // Blade tip glow point
    const bladeTip = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), glowMat(0xaaddff, 0.9));
    bladeTip.position.set(0, 0.3 + bladeLen, 0);
    group.add(bladeTip);
    const bladeTipHalo = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), glowMat(0x0088ff, 0.15));
    bladeTip.add(bladeTipHalo);

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

    // === ENERGY / SCI-FI ELEMENTS ===
    // Energy coils near muzzle
    for (let i = 0; i < 4; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 12), glowMat(color, 0.5));
      coil.position.z = -1.3 - i * 0.08;
      group.add(coil);
    }
    // Energy conduit along barrel underside
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.8, 6), glowMat(color, 0.25));
    conduit.rotation.x = Math.PI / 2;
    conduit.position.set(0, -0.03, -1.0);
    group.add(conduit);
    // Glowing muzzle tip
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 12), new THREE.MeshBasicMaterial({ color }));
    tip.position.z = -1.83;
    group.add(tip);
    const tipHalo = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), glowMat(color, 0.12));
    tip.add(tipHalo);
    // Accent strips
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, 0.5), glowMat(color, 0.35));
      strip.position.set(side * 0.057, 0.04, 0.05);
      group.add(strip);
    }
    // Digital ammo counter (glowing display on left side)
    const displayBg = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.02), new THREE.MeshBasicMaterial({ color: 0x050510 }));
    displayBg.position.set(-0.058, 0.02, 0.08);
    displayBg.rotation.y = -Math.PI / 2;
    group.add(displayBg);
    const displayTxt = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.015), glowMat(color, 0.7));
    displayTxt.position.set(-0.059, 0.02, 0.08);
    displayTxt.rotation.y = -Math.PI / 2;
    group.add(displayTxt);

    group.position.set(0.35, -0.35, -0.3);
    group.rotation.set(0, -0.1, 0);
    return group;
  }

  switchWeapon(name) {
    if (!WEAPONS[name]) return;
    if (this.zoomed) this.toggleZoom();
    Object.values(this.weaponModels).forEach(m => m.visible = false);
    if (this.weaponModels[name]) this.weaponModels[name].visible = true;
    this.current = name;
    this.cooldown = 0;
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
    this.cooldown = weapon.fireRate;

    // Play sound
    if (this.current === 'laserRifle') this.audio.playLaserRifle();
    else if (this.current === 'laserSword') this.audio.playLaserSword();
    else if (this.current === 'sniperRifle') this.audio.playSniperShot();

    if (weapon.type === 'melee') {
      return this._meleeAttack(enemies, weapon);
    } else {
      // Recoil kick
      this.recoilOffset = this.current === 'sniperRifle' ? 1.5 : 0.8;
      this.recoilRotX = this.current === 'sniperRifle' ? 1.2 : 0.6;
      return this._hitscanAttack(enemies, weapon);
    }
  }

  _hitscanAttack(enemies, weapon) {
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    // Muzzle flash
    const muzzlePos = origin.clone().add(dir.clone().multiplyScalar(1));
    this.particles.createMuzzleFlash(muzzlePos, dir, weapon.color);

    // Raycast against enemies
    const raycaster = new THREE.Raycaster(origin, dir, 0, weapon.range);
    let closestHit = null;
    let closestDist = Infinity;

    for (const enemy of enemies) {
      if (enemy.dead) continue;
      // Check intersection with enemy mesh
      const intersects = raycaster.intersectObject(enemy.mesh, true);
      if (intersects.length > 0 && intersects[0].distance < closestDist) {
        closestDist = intersects[0].distance;
        closestHit = { enemy, point: intersects[0].point, distance: closestDist };
      }
    }

    if (closestHit) {
      // Draw beam to hit point
      this.particles.createLaserBeam(muzzlePos, closestHit.point, weapon.color, 0.15, weapon.beamWidth);
      return { hit: true, enemy: closestHit.enemy, damage: weapon.damage, point: closestHit.point };
    } else {
      // Draw beam to max range
      const endPoint = origin.clone().add(dir.clone().multiplyScalar(weapon.range));
      this.particles.createLaserBeam(muzzlePos, endPoint, weapon.color, 0.1, weapon.beamWidth);
      return { hit: false };
    }
  }

  _meleeAttack(enemies, weapon) {
    this.particles.createSwordSlash(this.camera, weapon.color);

    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);

    // Animate sword swing
    this.swingAngle = 1.0;

    const hits = [];
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const toEnemy = new THREE.Vector3().subVectors(enemy.mesh.position, origin);
      const dist = toEnemy.length();
      if (dist > weapon.range) continue;
      // Check angle (wide arc - 90 degrees)
      toEnemy.normalize();
      const dot = dir.dot(toEnemy);
      if (dot > 0.3) {
        hits.push({ hit: true, enemy, damage: weapon.damage, point: enemy.mesh.position.clone() });
      }
    }
    return hits.length > 0 ? hits : { hit: false };
  }

  update(delta) {
    if (this.cooldown > 0) this.cooldown -= delta;

    // Recoil recovery
    if (this.recoilOffset > 0) {
      this.recoilOffset *= Math.pow(0.02, delta); // Exponential decay
      if (this.recoilOffset < 0.001) this.recoilOffset = 0;
    }
    if (this.recoilRotX > 0) {
      this.recoilRotX *= Math.pow(0.02, delta);
      if (this.recoilRotX < 0.001) this.recoilRotX = 0;
    }

    // Animate weapon
    if (this.weaponModels[this.current]) {
      const model = this.weaponModels[this.current];
      const time = performance.now() * 0.001;

      // Default position based on weapon type
      let baseX = 0, baseY = 0, baseZ = 0;
      let baseRotX = 0, baseRotY = 0, baseRotZ = 0;
      if (this.current === 'laserRifle') {
        baseX = 0.15; baseY = -0.15; baseRotY = -0.1;
      } else if (this.current === 'sniperRifle') {
        baseX = 0.1; baseY = -0.12; baseRotY = -0.08;
      } else {
        baseX = 0.2; baseY = -0.1; baseRotZ = 0.3;
      }

      // Idle sway (slow, smooth)
      const swayX = Math.sin(time * 0.8) * 0.003 + Math.sin(time * 1.3) * 0.002;
      const swayY = Math.sin(time * 1.1) * 0.004 + Math.cos(time * 0.7) * 0.002;
      const swayRotZ = Math.sin(time * 0.6) * 0.005;

      // Breathing bob
      const breatheY = Math.sin(time * 2.0) * 0.003;

      // Apply recoil (kick back and up)
      const recoilZ = (this.recoilOffset || 0) * 0.15;
      const recoilRotUp = -(this.recoilRotX || 0) * 0.1;

      model.position.set(
        baseX + swayX,
        baseY + swayY + breatheY,
        baseZ + recoilZ
      );
      model.rotation.set(
        baseRotX + recoilRotUp,
        baseRotY,
        baseRotZ + swayRotZ
      );
    }

    // Sword swing animation
    if (this.swingAngle > 0 && this.weaponModels.laserSword) {
      this.swingAngle -= delta * 5;
      this.weaponModels.laserSword.rotation.z = 0.3 + Math.sin(this.swingAngle * Math.PI) * 0.8;
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
