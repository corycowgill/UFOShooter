// help.js - Bestiary/help guide with 3D rendered previews
import { ALIEN_TYPES, createAlienModel } from './aliens.js';
import { WEAPONS } from './weapons.js';

export class HelpGuide {
  constructor() {
    this.isOpen = false;
    this.previewRenderers = [];
    this.animationId = null;
  }

  init() {
    this._buildAlienCards();
    this._buildWeaponCards();

    document.getElementById('help-close').addEventListener('click', () => this.close());
  }

  _buildAlienCards() {
    const container = document.getElementById('bestiary-cards');
    container.innerHTML = '';

    for (const [key, data] of Object.entries(ALIEN_TYPES)) {
      const card = document.createElement('div');
      card.className = 'alien-card';

      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      card.appendChild(canvas);

      card.innerHTML += `
        <h3>${data.name}</h3>
        <div class="stat">HP: <span>${data.hp}</span></div>
        <div class="stat">Speed: <span>${data.speed}</span></div>
        <div class="stat">Damage: <span>${data.damage}</span></div>
        <div class="stat">Behavior: <span>${data.behavior}</span></div>
        <div class="stat">Score: <span>${data.scoreValue}</span></div>
        <p style="margin-top:8px;font-size:12px;color:#8a8;">${data.description}</p>
      `;

      // Re-insert canvas at top
      card.insertBefore(canvas, card.firstChild);
      container.appendChild(card);

      // Set up 3D preview
      this._setupPreview(canvas, key);
    }
  }

  _buildWeaponCards() {
    const container = document.getElementById('weapon-cards');
    container.innerHTML = '';

    for (const [key, data] of Object.entries(WEAPONS)) {
      const card = document.createElement('div');
      card.className = 'weapon-card';

      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 200;
      card.appendChild(canvas);

      card.innerHTML += `
        <h3>${data.name}</h3>
        <div class="stat">Damage: <span>${data.damage}</span></div>
        <div class="stat">Fire Rate: <span>${(1/data.fireRate).toFixed(1)}/s</span></div>
        <div class="stat">Range: <span>${data.range}${data.type === 'melee' ? ' (melee)' : 'm'}</span></div>
        <div class="stat">Type: <span>${data.type}</span></div>
        <div class="stat">Key: <span>[${data.key}]</span></div>
        <p style="margin-top:8px;font-size:12px;color:#8aa;">${data.description}</p>
      `;

      card.insertBefore(canvas, card.firstChild);
      container.appendChild(card);

      this._setupWeaponPreview(canvas, key);
    }
  }

  _setupPreview(canvas, alienType) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(200, 200);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x404040, 0.6));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(2, 3, 3);
    scene.add(light);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    if (alienType === 'bloater') {
      camera.position.set(0, 1.5, 5);
    } else if (alienType === 'swarmer') {
      camera.position.set(0, 0.8, 3);
    } else if (alienType === 'drone') {
      camera.position.set(0, 0.5, 2.5);
      camera.lookAt(0, 0, 0);
    } else if (alienType === 'spitter') {
      camera.position.set(0, 1.0, 3.5);
    } else {
      camera.position.set(0, 1.2, 4);
    }
    if (alienType !== 'drone') camera.lookAt(0, 1, 0);

    const model = createAlienModel(alienType);
    scene.add(model);

    this.previewRenderers.push({ renderer, scene, camera, model });
  }

  _setupWeaponPreview(canvas, weaponType) {
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(200, 200);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x404040, 0.6));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(2, 3, 3);
    scene.add(light);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.3, 2.5);
    camera.lookAt(0, 0, 0);

    let model;
    if (weaponType === 'laserRifle') {
      model = buildPreviewRifle(0xff0000);
    } else if (weaponType === 'laserSword') {
      model = buildPreviewSword();
    } else {
      model = buildPreviewSniper();
    }
    scene.add(model);

    this.previewRenderers.push({ renderer, scene, camera, model });
  }

  open() {
    this.isOpen = true;
    document.getElementById('help-guide').style.display = 'block';
    this._animatePreviews();
  }

  close() {
    this.isOpen = false;
    document.getElementById('help-guide').style.display = 'none';
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  _animatePreviews() {
    if (!this.isOpen) return;
    for (const p of this.previewRenderers) {
      p.model.rotation.y += 0.02;
      p.renderer.render(p.scene, p.camera);
    }
    this.animationId = requestAnimationFrame(() => this._animatePreviews());
  }
}

// Standalone weapon model builders for help previews (matches upgraded viewmodels)
function buildPreviewRifle(color) {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshPhongMaterial({ color: 0x444444, shininess: 60 });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
  const accentMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 80 });
  // Barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.2, 8), metalMat);
  barrel.rotation.x = Math.PI / 2;
  group.add(barrel);
  // Barrel shroud
  const shroud = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8), accentMat);
  shroud.rotation.x = Math.PI / 2;
  shroud.position.z = -0.2;
  group.add(shroud);
  // Heat sink fins
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.06), metalMat);
    fin.position.set(0, 0, -0.35 + i * 0.07);
    group.add(fin);
  }
  // Muzzle brake
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.1, 8), metalMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = -0.65;
  group.add(muzzle);
  // Receiver body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), darkMat);
  body.position.z = 0.35;
  group.add(body);
  // Rail on top
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.4), accentMat);
  rail.position.set(0, 0.07, 0.35);
  group.add(rail);
  // Magazine
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), darkMat);
  mag.position.set(0, -0.15, 0.4);
  group.add(mag);
  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.08), darkMat);
  grip.position.set(0, -0.16, 0.55);
  grip.rotation.x = 0.2;
  group.add(grip);
  // Stock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.25), accentMat);
  stock.position.set(0, -0.01, 0.72);
  group.add(stock);
  // Glowing tip
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshBasicMaterial({ color }));
  tip.position.z = -0.7;
  group.add(tip);
  // Energy coil
  const coil = new THREE.Mesh(
    new THREE.TorusGeometry(0.05, 0.01, 6, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
  );
  coil.position.z = 0.1;
  coil.rotation.y = Math.PI / 2;
  group.add(coil);
  return group;
}

function buildPreviewSword() {
  const group = new THREE.Group();
  // Pommel
  const pommel = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshPhongMaterial({ color: 0x888888 })
  );
  pommel.position.y = -0.22;
  group.add(pommel);
  // Handle with wraps
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, 0.4, 8),
    new THREE.MeshPhongMaterial({ color: 0x555555 })
  );
  group.add(handle);
  for (let i = 0; i < 5; i++) {
    const wrap = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.005, 4, 8),
      new THREE.MeshPhongMaterial({ color: 0x333333 })
    );
    wrap.position.y = -0.15 + i * 0.07;
    group.add(wrap);
  }
  // Crossguard with curved tips
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.03, 0.04),
    new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 80 })
  );
  guard.position.y = 0.2;
  group.add(guard);
  for (const side of [-1, 1]) {
    const guardTip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6),
      new THREE.MeshPhongMaterial({ color: 0x999999 }));
    guardTip.position.set(side * 0.13, 0.22, 0);
    group.add(guardTip);
  }
  // Center gem
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.025, 0),
    new THREE.MeshBasicMaterial({ color: 0x0088ff })
  );
  gem.position.y = 0.21;
  group.add(gem);
  // Blade - glowing
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 0.9, 0.012),
    new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.9 })
  );
  blade.position.y = 0.67;
  group.add(blade);
  // Blade glow layers
  const bladeGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.9, 0.03),
    new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.25 })
  );
  bladeGlow.position.y = 0.67;
  group.add(bladeGlow);
  const outerGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.9, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x0066cc, transparent: true, opacity: 0.1 })
  );
  outerGlow.position.y = 0.67;
  group.add(outerGlow);
  return group;
}

function buildPreviewSniper() {
  const group = new THREE.Group();
  const metalMat = new THREE.MeshPhongMaterial({ color: 0x333344, shininess: 50 });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x222233 });
  // Long barrel
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 8), metalMat);
  barrel.rotation.x = Math.PI / 2;
  group.add(barrel);
  // Muzzle brake
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.12, 8), metalMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.z = -0.95;
  group.add(muzzle);
  // Receiver
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.45), darkMat);
  body.position.z = 0.45;
  group.add(body);
  // Scope
  const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8),
    new THREE.MeshPhongMaterial({ color: 0x111122, shininess: 60 }));
  scopeBody.rotation.x = Math.PI / 2;
  scopeBody.position.set(0, 0.1, 0.35);
  group.add(scopeBody);
  const objective = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.08, 8), metalMat);
  objective.rotation.x = Math.PI / 2;
  objective.position.set(0, 0.1, 0.15);
  group.add(objective);
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.04, 8),
    new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.5 })
  );
  lens.position.set(0, 0.1, 0.11);
  group.add(lens);
  // Scope mount rings
  for (const zz of [0.25, 0.45]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 4, 8), metalMat);
    ring.position.set(0, 0.1, zz);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
  }
  // Stock
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.3),
    new THREE.MeshPhongMaterial({ color: 0x443322 }));
  stock.position.set(0, -0.01, 0.8);
  group.add(stock);
  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.07), darkMat);
  grip.position.set(0, -0.14, 0.6);
  grip.rotation.x = 0.2;
  group.add(grip);
  // Bipod (folded)
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 4), metalMat);
    leg.position.set(side * 0.04, -0.05, -0.3);
    leg.rotation.x = 0.3;
    group.add(leg);
  }
  // Glowing tip
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x8800ff }));
  tip.position.z = -1.0;
  group.add(tip);
  // Energy coils
  for (let i = 0; i < 2; i++) {
    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.04, 0.008, 6, 10),
      new THREE.MeshBasicMaterial({ color: 0x8800ff, transparent: true, opacity: 0.4 })
    );
    coil.position.z = -0.5 - i * 0.2;
    coil.rotation.y = Math.PI / 2;
    group.add(coil);
  }
  return group;
}
