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
    } else {
      camera.position.set(0, 1.2, 4);
    }
    camera.lookAt(0, 1, 0);

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

// Standalone weapon model builders for help previews
function buildPreviewRifle(color) {
  const group = new THREE.Group();
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8),
    new THREE.MeshPhongMaterial({ color: 0x444444 })
  );
  barrel.rotation.x = Math.PI / 2;
  group.add(barrel);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.12, 0.6),
    new THREE.MeshPhongMaterial({ color: 0x333333 })
  );
  body.position.z = 0.5;
  group.add(body);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.25, 0.1),
    new THREE.MeshPhongMaterial({ color: 0x222222 })
  );
  grip.position.set(0, -0.18, 0.6);
  group.add(grip);
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color })
  );
  tip.position.z = -0.6;
  group.add(tip);
  return group;
}

function buildPreviewSword() {
  const group = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8),
    new THREE.MeshPhongMaterial({ color: 0x666666 })
  );
  group.add(handle);
  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.03, 0.06),
    new THREE.MeshPhongMaterial({ color: 0x888888 })
  );
  guard.position.y = 0.2;
  group.add(guard);
  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 1.0, 0.015),
    new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.8 })
  );
  blade.position.y = 0.72;
  group.add(blade);
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.0, 0.04),
    new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.2 })
  );
  glow.position.y = 0.72;
  group.add(glow);
  return group;
}

function buildPreviewSniper() {
  const group = new THREE.Group();
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.035, 1.8, 8),
    new THREE.MeshPhongMaterial({ color: 0x333344 })
  );
  barrel.rotation.x = Math.PI / 2;
  group.add(barrel);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.14, 0.5),
    new THREE.MeshPhongMaterial({ color: 0x222233 })
  );
  body.position.z = 0.5;
  group.add(body);
  const scope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8),
    new THREE.MeshPhongMaterial({ color: 0x111122 })
  );
  scope.position.set(0, 0.1, 0.35);
  group.add(scope);
  const stock = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.1, 0.35),
    new THREE.MeshPhongMaterial({ color: 0x443322 })
  );
  stock.position.set(0, -0.02, 0.85);
  group.add(stock);
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x8800ff })
  );
  tip.position.z = -0.9;
  group.add(tip);
  return group;
}
