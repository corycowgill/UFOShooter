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

    this._initWeaponView();
  }

  _initWeaponView() {
    const canvas = document.getElementById('weapon-canvas');
    if (!canvas) return;
    this.weaponRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.weaponRenderer.setSize(350, 300);
    this.weaponRenderer.setClearColor(0x000000, 0);

    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(50, 350 / 300, 0.1, 100);
    this.weaponCamera.position.set(0, 0, 2);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(1, 1, 2);
    this.weaponScene.add(light);
    this.weaponScene.add(new THREE.AmbientLight(0x404040));

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
    const metalDark = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 80 });
    const metalMed = new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 60 });
    const metalLight = new THREE.MeshPhongMaterial({ color: 0x666666, shininess: 90 });
    const gripMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 20 });
    const accentMat = new THREE.MeshPhongMaterial({ color: 0x880000, emissive: 0x330000 });

    // Main barrel - longer, with muzzle brake
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.3, 12), metalDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.35;
    group.add(barrel);
    // Barrel shroud (outer casing)
    const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.6, 10), metalMed);
    shroud.rotation.x = Math.PI / 2;
    shroud.position.z = -0.1;
    group.add(shroud);
    // Heat sink fins along barrel
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.002, 0.06), metalLight);
      fin.position.set(0, 0, -0.5 - i * 0.1);
      group.add(fin);
    }
    // Muzzle brake
    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8), metalLight);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = -1.0;
    group.add(muzzle);
    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 12), metalLight);
    muzzleRing.position.z = -1.05;
    group.add(muzzleRing);

    // Receiver body - more detailed
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.5), metalDark);
    receiver.position.z = 0.15;
    group.add(receiver);
    // Top rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.5), metalMed);
    rail.position.set(0, 0.075, 0.15);
    group.add(rail);
    // Rail notches
    for (let i = 0; i < 6; i++) {
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.008, 0.015), metalDark);
      notch.position.set(0, 0.088, -0.05 + i * 0.08);
      group.add(notch);
    }

    // Magazine
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), metalDark);
    mag.position.set(0, -0.16, 0.18);
    mag.rotation.x = 0.1;
    group.add(mag);
    // Mag well
    const magWell = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.09), metalMed);
    magWell.position.set(0, -0.06, 0.18);
    group.add(magWell);

    // Trigger guard
    const guardGeo = new THREE.TorusGeometry(0.04, 0.008, 4, 8, Math.PI);
    const guard = new THREE.Mesh(guardGeo, metalMed);
    guard.position.set(0, -0.09, 0.32);
    guard.rotation.x = Math.PI;
    guard.rotation.z = Math.PI / 2;
    group.add(guard);
    // Trigger
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.04, 0.015), metalLight);
    trigger.position.set(0, -0.08, 0.32);
    group.add(trigger);

    // Grip - ergonomic
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.09), gripMat);
    grip.position.set(0, -0.19, 0.35);
    grip.rotation.x = -0.15;
    group.add(grip);
    // Grip texture lines
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.003, 0.04), metalDark);
      line.position.set(0, -0.12 - i * 0.04, 0.35);
      group.add(line);
    }

    // Stock
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.25), metalDark);
    stock.position.set(0, -0.01, 0.52);
    group.add(stock);
    // Stock pad
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.11, 0.02), gripMat);
    pad.position.set(0, -0.01, 0.65);
    group.add(pad);

    // Front sight post
    const sightPost = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.008), metalLight);
    sightPost.position.set(0, 0.085, -0.7);
    group.add(sightPost);

    // Energy coil (glowing accent)
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.006, 6, 12),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.7 })
    );
    coil.position.z = -0.85;
    group.add(coil);
    // Glow tip
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 10, 10),
      new THREE.MeshBasicMaterial({ color: color })
    );
    tip.position.z = -1.05;
    group.add(tip);
    // Glow halo
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 8),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.15 })
    );
    tip.add(halo);
    // Accent strip along body
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.005, 0.4),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.5 })
    );
    strip.position.set(0.065, 0.04, 0.05);
    group.add(strip);

    group.position.set(0.4, -0.35, -0.3);
    group.rotation.set(0, -0.1, 0);
    return group;
  }

  _buildSwordModel() {
    const group = new THREE.Group();
    const metalMat = new THREE.MeshPhongMaterial({ color: 0x777777, shininess: 100 });
    const darkMetal = new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 60 });
    const gripMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 20 });

    // Pommel
    const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), metalMat);
    pommel.position.y = -0.22;
    group.add(pommel);
    // Pommel glow
    const pommelGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x0088ff })
    );
    pommelGlow.position.y = -0.22;
    group.add(pommelGlow);

    // Handle - wrapped grip
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 0.4, 10), gripMat);
    group.add(handle);
    // Grip wrapping
    for (let i = 0; i < 8; i++) {
      const wrap = new THREE.Mesh(
        new THREE.TorusGeometry(0.033, 0.004, 4, 10),
        darkMetal
      );
      wrap.position.y = -0.16 + i * 0.046;
      wrap.rotation.x = Math.PI / 2;
      group.add(wrap);
    }

    // Guard - ornate crossguard
    const guardMain = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.05), metalMat);
    guardMain.position.y = 0.21;
    group.add(guardMain);
    // Guard curves
    for (const side of [-1, 1]) {
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), metalMat);
      tip.position.set(side * 0.13, 0.21, 0);
      group.add(tip);
      const curve = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.04), metalMat);
      curve.position.set(side * 0.1, 0.23, 0);
      curve.rotation.z = side * 0.3;
      group.add(curve);
    }
    // Guard center gem
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.02, 0),
      new THREE.MeshBasicMaterial({ color: 0x00aaff })
    );
    gem.position.set(0, 0.21, 0.03);
    group.add(gem);

    // Emitter housing
    const emitter = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.06, 8), metalMat);
    emitter.position.y = 0.26;
    group.add(emitter);

    // Blade - 3D with pointed tip
    const bladeLen = 1.0;
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.lineTo(0.025, 0);
    bladeShape.lineTo(0.02, bladeLen * 0.9);
    bladeShape.lineTo(0, bladeLen);
    bladeShape.lineTo(-0.02, bladeLen * 0.9);
    bladeShape.lineTo(-0.025, 0);
    bladeShape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.012, bevelEnabled: false });
    const blade = new THREE.Mesh(
      bladeGeo,
      new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.85 })
    );
    blade.position.set(0, 0.29, -0.006);
    group.add(blade);

    // Blade inner core (brighter)
    const coreGeo = new THREE.BoxGeometry(0.008, bladeLen * 0.95, 0.003);
    const core = new THREE.Mesh(
      coreGeo,
      new THREE.MeshBasicMaterial({ color: 0xaaddff, transparent: true, opacity: 0.9 })
    );
    core.position.set(0, 0.29 + bladeLen * 0.475, 0);
    group.add(core);

    // Blade outer glow - multiple layers
    const glow1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, bladeLen, 0.035),
      new THREE.MeshBasicMaterial({ color: 0x0066cc, transparent: true, opacity: 0.12 })
    );
    glow1.position.set(0, 0.29 + bladeLen / 2, 0);
    group.add(glow1);
    const glow2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, bladeLen, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x0044aa, transparent: true, opacity: 0.05 })
    );
    glow2.position.set(0, 0.29 + bladeLen / 2, 0);
    group.add(glow2);

    // Blade edge crackle (energy sparks along edges)
    for (let i = 0; i < 6; i++) {
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 4, 4),
        new THREE.MeshBasicMaterial({ color: 0xaaddff })
      );
      const y = 0.35 + Math.random() * bladeLen * 0.8;
      spark.position.set((Math.random() - 0.5) * 0.04, y, 0);
      group.add(spark);
    }

    group.position.set(0.5, -0.5, -0.2);
    group.rotation.set(-0.5, 0, 0.3);
    return group;
  }

  _buildSniperModel() {
    const group = new THREE.Group();
    const metalDark = new THREE.MeshPhongMaterial({ color: 0x282838, shininess: 80 });
    const metalMed = new THREE.MeshPhongMaterial({ color: 0x3a3a4a, shininess: 70 });
    const metalLight = new THREE.MeshPhongMaterial({ color: 0x555565, shininess: 90 });
    const gripMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 20 });
    const woodMat = new THREE.MeshPhongMaterial({ color: 0x443322, shininess: 30 });
    const accentMat = new THREE.MeshPhongMaterial({ color: 0x440066, emissive: 0x220033 });

    // Long fluted barrel
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.0, 12), metalDark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.6;
    group.add(barrel);
    // Barrel fluting (recessed channels)
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const flute = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, 0.005, 1.4),
        metalLight
      );
      flute.position.set(Math.cos(angle) * 0.028, Math.sin(angle) * 0.028, -0.5);
      group.add(flute);
    }
    // Muzzle brake - advanced
    const muzzle1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.12, 8), metalLight);
    muzzle1.rotation.x = Math.PI / 2;
    muzzle1.position.z = -1.62;
    group.add(muzzle1);
    // Muzzle ports
    for (let i = 0; i < 3; i++) {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.008, 0.02), metalDark);
      port.position.set(0, 0, -1.55 - i * 0.03);
      group.add(port);
    }

    // Receiver body
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.15, 0.55), metalDark);
    receiver.position.z = 0.15;
    group.add(receiver);
    // Top rail
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.015, 0.55), metalMed);
    rail.position.set(0, 0.082, 0.15);
    group.add(rail);

    // Scope - detailed
    const scopeMain = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 12), metalDark);
    scopeMain.position.set(0, 0.14, 0.1);
    scopeMain.rotation.x = Math.PI / 2;
    group.add(scopeMain);
    // Scope objective bell (front)
    const objBell = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.08, 10), metalMed);
    objBell.rotation.x = Math.PI / 2;
    objBell.position.set(0, 0.14, -0.12);
    group.add(objBell);
    // Scope eyepiece (rear)
    const eyepiece = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.06, 10), metalMed);
    eyepiece.rotation.x = Math.PI / 2;
    eyepiece.position.set(0, 0.14, 0.32);
    group.add(eyepiece);
    // Scope lens (front) - glowing
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.04, 12),
      new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.6 })
    );
    lens.position.set(0, 0.14, -0.16);
    group.add(lens);
    // Scope turrets
    const turretTop = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 6), metalLight);
    turretTop.position.set(0, 0.18, 0.1);
    group.add(turretTop);
    const turretSide = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 6), metalLight);
    turretSide.rotation.z = Math.PI / 2;
    turretSide.position.set(0.055, 0.14, 0.1);
    group.add(turretSide);
    // Scope mount rings
    for (const z of [-0.02, 0.22]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.006, 4, 10), metalMed);
      ring.position.set(0, 0.14, z);
      group.add(ring);
    }

    // Stock - ergonomic with cheek rest
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.35), woodMat);
    stock.position.set(0, -0.01, 0.55);
    group.add(stock);
    const cheekRest = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.15), woodMat);
    cheekRest.position.set(0, 0.05, 0.5);
    group.add(cheekRest);
    // Recoil pad
    const recoilPad = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.02), gripMat);
    recoilPad.position.set(0, -0.01, 0.73);
    group.add(recoilPad);

    // Grip - pistol style
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), gripMat);
    grip.position.set(0, -0.17, 0.35);
    grip.rotation.x = -0.1;
    group.add(grip);
    // Trigger guard
    const tGuard = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 4, 8, Math.PI), metalMed);
    tGuard.position.set(0, -0.09, 0.32);
    tGuard.rotation.x = Math.PI;
    tGuard.rotation.z = Math.PI / 2;
    group.add(tGuard);

    // Bipod (folded)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 6), metalMed);
      leg.position.set(side * 0.04, -0.02, -0.2);
      leg.rotation.x = 0.2;
      leg.rotation.z = side * 0.15;
      group.add(leg);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), metalLight);
      foot.position.set(side * 0.055, -0.14, -0.22);
      group.add(foot);
    }
    // Bipod mount
    const bipodMount = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.04), metalMed);
    bipodMount.position.set(0, -0.04, -0.2);
    group.add(bipodMount);

    // Energy coils near muzzle
    for (let i = 0; i < 3; i++) {
      const coil = new THREE.Mesh(
        new THREE.TorusGeometry(0.032, 0.004, 4, 10),
        new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.5 })
      );
      coil.position.z = -1.3 - i * 0.08;
      group.add(coil);
    }
    // Glow tip
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0x8800ff })
    );
    tip.position.z = -1.62;
    group.add(tip);
    const tipHalo = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.15 })
    );
    tip.add(tipHalo);

    // Accent strips
    const accentStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.004, 0.004, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.4 })
    );
    accentStrip.position.set(0.055, 0.04, 0.05);
    group.add(accentStrip);

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

    // Animate weapon bob
    if (this.weaponModels[this.current]) {
      const model = this.weaponModels[this.current];
      const time = performance.now() * 0.003;
      model.position.y += Math.sin(time) * 0.0005;
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
