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
    // Barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8),
      new THREE.MeshPhongMaterial({ color: 0x444444 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.3;
    group.add(barrel);
    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.6),
      new THREE.MeshPhongMaterial({ color: 0x333333 })
    );
    body.position.z = 0.2;
    group.add(body);
    // Grip
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.25, 0.1),
      new THREE.MeshPhongMaterial({ color: 0x222222 })
    );
    grip.position.set(0, -0.18, 0.35);
    group.add(grip);
    // Glow tip
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: color })
    );
    tip.position.z = -0.9;
    group.add(tip);

    group.position.set(0.4, -0.35, -0.3);
    group.rotation.set(0, -0.1, 0);
    return group;
  }

  _buildSwordModel() {
    const group = new THREE.Group();
    // Handle
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8),
      new THREE.MeshPhongMaterial({ color: 0x666666 })
    );
    group.add(handle);
    // Guard
    const guard = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.03, 0.06),
      new THREE.MeshPhongMaterial({ color: 0x888888 })
    );
    guard.position.y = 0.2;
    group.add(guard);
    // Blade
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 1.0, 0.015),
      new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.8 })
    );
    blade.position.y = 0.72;
    group.add(blade);
    // Blade glow
    const bladeGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.0, 0.04),
      new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.2 })
    );
    bladeGlow.position.y = 0.72;
    group.add(bladeGlow);

    group.position.set(0.5, -0.5, -0.2);
    group.rotation.set(-0.5, 0, 0.3);
    return group;
  }

  _buildSniperModel() {
    const group = new THREE.Group();
    // Long barrel
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.035, 1.8, 8),
      new THREE.MeshPhongMaterial({ color: 0x333344 })
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.5;
    group.add(barrel);
    // Body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.14, 0.5),
      new THREE.MeshPhongMaterial({ color: 0x222233 })
    );
    body.position.z = 0.2;
    group.add(body);
    // Scope
    const scope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8),
      new THREE.MeshPhongMaterial({ color: 0x111122 })
    );
    scope.position.set(0, 0.1, 0.1);
    group.add(scope);
    // Scope lens
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.03, 8),
      new THREE.MeshBasicMaterial({ color: 0x8800ff })
    );
    lens.position.set(0, 0.1, -0.05);
    lens.rotation.x = -Math.PI / 2;
    scope.add(lens);
    // Stock
    const stock = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.1, 0.35),
      new THREE.MeshPhongMaterial({ color: 0x443322 })
    );
    stock.position.set(0, -0.02, 0.55);
    group.add(stock);
    // Grip
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.2, 0.08),
      new THREE.MeshPhongMaterial({ color: 0x222222 })
    );
    grip.position.set(0, -0.17, 0.35);
    group.add(grip);
    // Tip
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x8800ff })
    );
    tip.position.z = -1.4;
    group.add(tip);

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
