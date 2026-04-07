// hud.js - HUD rendering and minimap
export class HUD {
  constructor() {
    this.elements = {
      waveNum: document.getElementById('wave-num'),
      enemyCount: document.getElementById('enemy-count'),
      score: document.getElementById('score'),
      levelName: document.getElementById('level-name'),
      healthBar: document.getElementById('health-bar'),
      healthText: document.getElementById('health-text'),
      weaponName: document.getElementById('weapon-name'),
      ammoDisplay: document.getElementById('ammo-display'),
      cooldownFill: document.getElementById('cooldown-fill'),
      waveAnnounce: document.getElementById('wave-announce'),
      waveAnnounceText: document.getElementById('wave-announce-text'),
      waveAnnounceSub: document.getElementById('wave-announce-sub'),
    };
    this.minimapCanvas = document.getElementById('minimap');
    this.minimapCtx = this.minimapCanvas ? this.minimapCanvas.getContext('2d') : null;
    this.announceTimer = 0;
  }

  update(player, waveManager, weaponData, levelName) {
    const els = this.elements;

    // Wave info
    els.waveNum.textContent = waveManager.wave;
    els.enemyCount.textContent = waveManager.getAliveCount();
    els.score.textContent = player.score;
    els.levelName.textContent = levelName;

    // Health
    const hpPct = Math.max(0, player.hp / player.maxHp * 100);
    els.healthBar.style.width = hpPct + '%';
    els.healthText.textContent = `HP: ${Math.ceil(player.hp)}/${player.maxHp}`;
    if (hpPct < 25) {
      els.healthBar.style.background = '#f00';
    } else if (hpPct < 50) {
      els.healthBar.style.background = 'linear-gradient(90deg, #f00, #ff0)';
    } else {
      els.healthBar.style.background = 'linear-gradient(90deg, #f00, #0f0)';
    }

    // Weapon
    els.weaponName.textContent = weaponData.name;
    els.cooldownFill.style.width = ((1 - weaponData.cooldownPct) * 100) + '%';
    if (weaponData.currentKey === 'laserSword') {
      els.ammoDisplay.textContent = 'MELEE';
    } else {
      els.ammoDisplay.textContent = weaponData.cooldownPct > 0 ? 'CHARGING...' : 'READY';
    }
  }

  showWaveAnnouncement(wave, levelName, isNewLevel) {
    const els = this.elements;
    if (isNewLevel) {
      els.waveAnnounceText.textContent = levelName;
      els.waveAnnounceSub.textContent = `Wave ${wave} incoming...`;
    } else {
      els.waveAnnounceText.textContent = `WAVE ${wave}`;
      els.waveAnnounceSub.textContent = 'Get ready!';
    }
    els.waveAnnounce.style.display = 'block';
    this.announceTimer = 3;
  }

  showWaveComplete(wave) {
    const els = this.elements;
    els.waveAnnounceText.textContent = `WAVE ${wave} COMPLETE`;
    els.waveAnnounceSub.textContent = 'Regroup!';
    els.waveAnnounce.style.display = 'block';
    this.announceTimer = 2;
  }

  updateAnnouncement(delta) {
    if (this.announceTimer > 0) {
      this.announceTimer -= delta;
      if (this.announceTimer <= 0) {
        this.elements.waveAnnounce.style.display = 'none';
      }
    }
  }

  drawMinimap(playerPos, playerDir, enemies, mapSize = 100) {
    if (!this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const w = 150, h = 150;
    const scale = w / (mapSize * 2);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= w; i += 15) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
    }

    // Player position (center of minimap)
    const cx = w / 2;
    const cy = h / 2;

    // Player dot
    ctx.fillStyle = '#0f0';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();

    // Player direction
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + playerDir.x * 10, cy - playerDir.z * 10);
    ctx.stroke();

    // Enemies
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = (enemy.mesh.position.x - playerPos.x) * scale;
      const dz = (enemy.mesh.position.z - playerPos.z) * scale;
      const ex = cx + dx;
      const ey = cy - dz;

      if (ex < 0 || ex > w || ey < 0 || ey > h) continue;

      if (enemy.type === 'grunt') ctx.fillStyle = '#0c4';
      else if (enemy.type === 'swarmer') ctx.fillStyle = '#90f';
      else ctx.fillStyle = '#f22';

      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = '#0f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);
  }
}
