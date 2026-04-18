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
    this.comboEl = document.getElementById('combo-display');
    this._last = {
      wave: -1, enemyCount: -1, score: -1, levelName: '',
      hpBucket: -2, hpText: '', hpBarColor: '',
      weaponName: '', cooldownBucket: -1, ammoText: '',
      combo: 0,
    };
  }

  update(player, waveManager, weaponData, levelName) {
    const els = this.elements;
    const last = this._last;

    // Wave info — only write when the underlying value changes.
    const wave = waveManager.wave;
    if (wave !== last.wave) { els.waveNum.textContent = wave; last.wave = wave; }
    const enemyCount = waveManager.getAliveCount();
    if (enemyCount !== last.enemyCount) {
      els.enemyCount.textContent = enemyCount;
      last.enemyCount = enemyCount;
    }
    const score = player.score;
    if (score !== last.score) { els.score.textContent = score; last.score = score; }
    if (levelName !== last.levelName) {
      els.levelName.textContent = levelName;
      last.levelName = levelName;
    }

    // Health — bucket the percentage to 1% so sub-pixel jitter doesn't
    // churn the style attribute, and the bar color only flips at boundaries.
    const hpPct = Math.max(0, player.hp / player.maxHp * 100);
    const hpBucket = Math.round(hpPct);
    if (hpBucket !== last.hpBucket) {
      els.healthBar.style.width = hpBucket + '%';
      last.hpBucket = hpBucket;
    }
    const hpText = `HP: ${Math.ceil(player.hp)}/${player.maxHp}`;
    if (hpText !== last.hpText) {
      els.healthText.textContent = hpText;
      last.hpText = hpText;
    }
    const hpBarColor = hpPct < 25 ? '#f00'
      : hpPct < 50 ? 'linear-gradient(90deg, #f00, #ff0)'
      : 'linear-gradient(90deg, #f00, #0f0)';
    if (hpBarColor !== last.hpBarColor) {
      els.healthBar.style.background = hpBarColor;
      last.hpBarColor = hpBarColor;
    }

    // Weapon
    if (weaponData.name !== last.weaponName) {
      els.weaponName.textContent = weaponData.name;
      last.weaponName = weaponData.name;
    }
    // Cooldown fill — bucket to integer percent
    const cdBucket = Math.round((1 - weaponData.cooldownPct) * 100);
    if (cdBucket !== last.cooldownBucket) {
      els.cooldownFill.style.width = cdBucket + '%';
      last.cooldownBucket = cdBucket;
    }
    const ammoText = weaponData.currentKey === 'laserSword'
      ? 'MELEE'
      : (weaponData.cooldownPct > 0 ? 'CHARGING...' : 'READY');
    if (ammoText !== last.ammoText) {
      els.ammoDisplay.textContent = ammoText;
      last.ammoText = ammoText;
    }

    // Combo display
    const combo = player.combo;
    if (combo !== last.combo) {
      if (this.comboEl) {
        if (combo >= 2) {
          this.comboEl.textContent = `${combo}x COMBO`;
          this.comboEl.style.opacity = '1';
          this.comboEl.style.transform = 'scale(1.2)';
          setTimeout(() => { if (this.comboEl) this.comboEl.style.transform = 'scale(1)'; }, 100);
          if (combo >= 10) {
            this.comboEl.style.color = '#ff00aa';
            this.comboEl.style.textShadow = '0 0 12px #ff00aa, 0 0 24px rgba(255,0,170,0.4)';
          } else if (combo >= 5) {
            this.comboEl.style.color = '#ff6600';
            this.comboEl.style.textShadow = '0 0 12px #ff6600, 0 0 24px rgba(255,102,0,0.4)';
          } else {
            this.comboEl.style.color = '#ffcc00';
            this.comboEl.style.textShadow = '0 0 12px #ffcc00, 0 0 24px rgba(255,200,0,0.4)';
          }
        } else {
          this.comboEl.style.opacity = '0';
        }
      }
      last.combo = combo;
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
