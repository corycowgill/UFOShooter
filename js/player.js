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
    this.regenDelay = 5; // seconds before regen starts
    this.regenRate = 5;  // HP per second
  }

  takeDamage(amount, audio) {
    if (this.dead) return;
    this.hp -= amount;
    this.damageFlashTimer = 0.2;
    this.regenTimer = this.regenDelay;
    audio.playPlayerHit();

    // Flash red
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

  addScore(points) {
    this.score += points;
  }

  addKill() {
    this.kills++;
  }

  update(delta) {
    // Health regen after not taking damage for a while
    if (this.regenTimer > 0) {
      this.regenTimer -= delta;
    } else if (this.hp < this.maxHp && !this.dead) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * delta);
    }

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer -= delta;
    }
  }

  reset() {
    this.hp = this.maxHp;
    this.score = 0;
    this.kills = 0;
    this.dead = false;
    this.damageFlashTimer = 0;
    this.regenTimer = 0;
  }
}
