// player.js - Player state, health, score
export class Player {
  constructor() {
    this.maxHp = 100;
    this.hp = this.maxHp;
    this.score = 0;
    this.kills = 0;
    this.dead = false;
    this.damageFlashTimer = 0;
    this.regenTimer = 0;
    this.regenDelay = 5;
    this.regenRate = 5;

    // Combo system — rapid kills within a time window increase the
    // multiplier. Score from each kill is multiplied by the current
    // combo count. The timer resets on each kill; if it expires the
    // combo drops back to 0.
    this.combo = 0;
    this.comboTimer = 0;
    this.comboWindow = 3.0; // seconds to maintain combo
    this.bestCombo = 0;
  }

  takeDamage(amount, audio) {
    if (this.dead) return;
    this.hp -= amount;
    this.damageFlashTimer = 0.2;
    this.regenTimer = this.regenDelay;
    audio.playPlayerHit();

    const flash = document.getElementById('damage-flash');
    if (flash) {
      flash.style.opacity = '1';
      setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
    }
  }

  heal(amount) {
    if (this.dead) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }

  addScore(points) {
    const multiplier = Math.max(1, this.combo);
    this.score += points * multiplier;
  }

  addKill() {
    this.kills++;
    this.combo++;
    this.comboTimer = this.comboWindow;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
  }

  update(delta) {
    if (this.regenTimer > 0) {
      this.regenTimer -= delta;
    } else if (this.hp < this.maxHp && !this.dead) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * delta);
    }

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= delta;
    }

    // Combo decay
    if (this.comboTimer > 0) {
      this.comboTimer -= delta;
      if (this.comboTimer <= 0) {
        this.combo = 0;
      }
    }
  }

  reset() {
    this.hp = this.maxHp;
    this.score = 0;
    this.kills = 0;
    this.dead = false;
    this.damageFlashTimer = 0;
    this.regenTimer = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.bestCombo = 0;
  }
}
