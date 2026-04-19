// audio.js - Procedural eerie alien music and sound effects
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicPlaying = false;
    this.musicNodes = [];
  }

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.25;
    this.musicGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.masterGain);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // === EERIE ALIEN MUSIC ===
  startMusic() {
    if (this.musicPlaying) return;
    this.musicPlaying = true;

    // Deep drone
    const drone = this.ctx.createOscillator();
    drone.type = 'sawtooth';
    drone.frequency.value = 40;
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.15;
    const droneFilter = this.ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 200;
    drone.connect(droneFilter);
    droneFilter.connect(droneGain);
    droneGain.connect(this.musicGain);
    drone.start();

    // LFO modulating drone pitch
    const lfo1 = this.ctx.createOscillator();
    lfo1.type = 'sine';
    lfo1.frequency.value = 0.05;
    const lfo1Gain = this.ctx.createGain();
    lfo1Gain.gain.value = 5;
    lfo1.connect(lfo1Gain);
    lfo1Gain.connect(drone.frequency);
    lfo1.start();

    // Eerie high pad
    const pad = this.ctx.createOscillator();
    pad.type = 'sine';
    pad.frequency.value = 440;
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.04;
    const padFilter = this.ctx.createBiquadFilter();
    padFilter.type = 'bandpass';
    padFilter.frequency.value = 800;
    padFilter.Q.value = 5;
    pad.connect(padFilter);
    padFilter.connect(padGain);
    padGain.connect(this.musicGain);
    pad.start();

    // LFO for pad
    const lfo2 = this.ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.value = 0.1;
    const lfo2Gain = this.ctx.createGain();
    lfo2Gain.gain.value = 100;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(pad.frequency);
    lfo2.start();

    // Creepy delay feedback
    const delay = this.ctx.createDelay(2);
    delay.delayTime.value = 1.5;
    const feedback = this.ctx.createGain();
    feedback.gain.value = 0.3;
    const delayFilter = this.ctx.createBiquadFilter();
    delayFilter.type = 'highpass';
    delayFilter.frequency.value = 300;
    padGain.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(feedback);
    feedback.connect(delay);
    feedback.connect(this.musicGain);

    // Sub bass pulse
    const sub = this.ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 30;
    const subGain = this.ctx.createGain();
    subGain.gain.value = 0.1;
    const subLfo = this.ctx.createOscillator();
    subLfo.type = 'sine';
    subLfo.frequency.value = 0.25;
    const subLfoGain = this.ctx.createGain();
    subLfoGain.gain.value = 0.1;
    subLfo.connect(subLfoGain);
    subLfoGain.connect(subGain.gain);
    sub.connect(subGain);
    subGain.connect(this.musicGain);
    sub.start();
    subLfo.start();

    // Random alien chirps
    this._chirpInterval = setInterval(() => {
      if (!this.musicPlaying) return;
      this._alienChirp();
    }, 4000 + Math.random() * 6000);

    this.musicNodes = [drone, lfo1, pad, lfo2, sub, subLfo];
  }

  _alienChirp() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    const startFreq = 800 + Math.random() * 2000;
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(startFreq * (Math.random() > 0.5 ? 2 : 0.5), t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.8);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.8);
  }

  stopMusic() {
    this.musicPlaying = false;
    this.musicNodes.forEach(n => { try { n.stop(); } catch(e) {} });
    this.musicNodes = [];
    if (this._chirpInterval) clearInterval(this._chirpInterval);
  }

  // === SOUND EFFECTS ===

  playLaserRifle() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playLaserSword() {
    const t = this.ctx.currentTime;
    // Whoosh sweep
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.4);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 2;
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  playSniperShot() {
    const t = this.ctx.currentTime;
    // Sharp crack
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2000, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.4);

    // Echo
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.2;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.3;
    g.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    fb.connect(this.sfxGain);
  }

  playAlienHit() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  playAlienDeath() {
    const t = this.ctx.currentTime;
    // Descending pitch
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.6);

    // Noise burst
    this._noiseBurst(0.15, 0.3);
  }

  playRocketLaunch() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // Deep whoosh: low saw ramping down with noise
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.4);
    // High hiss layer
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1600, t);
    osc2.frequency.exponentialRampToValueAtTime(300, t + 0.3);
    const g2 = this.ctx.createGain();
    g2.gain.setValueAtTime(0.1, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc2.connect(g2);
    g2.connect(this.sfxGain);
    osc2.start(t);
    osc2.stop(t + 0.3);
    // Noise whoosh
    this._noiseBurst(0.25, 0.35);
  }

  playExplosion() {
    const t = this.ctx.currentTime;
    // Low boom
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.8);

    // Noise
    this._noiseBurst(0.4, 0.5);
  }

  playPlayerHit() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  playWaveComplete() {
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t + i * 0.15);
      g.gain.linearRampToValueAtTime(0.2, t + i * 0.15 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.4);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t + i * 0.15);
      osc.stop(t + i * 0.15 + 0.4);
    });
  }

  playAlienShoot() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  playAlienGrowl() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.linearRampToValueAtTime(60, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  playPickup() {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
    osc.frequency.exponentialRampToValueAtTime(1600, t + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.linearRampToValueAtTime(0, t + 0.2);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  startAmbient() {
    this.stopAmbient();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // City wind — filtered noise
    const bufSize = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
    const windSrc = this.ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 180;
    const windLfo = this.ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.15;
    const windLfoGain = this.ctx.createGain();
    windLfoGain.gain.value = 60;
    windLfo.connect(windLfoGain);
    windLfoGain.connect(windFilter.frequency);
    windLfo.start(t);
    const windGain = this.ctx.createGain();
    windGain.gain.value = 0.025;
    windSrc.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(this.musicGain);
    windSrc.start(t);

    // Electrical hum (60 Hz mains)
    const hum = this.ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 60;
    const humGain = this.ctx.createGain();
    humGain.gain.value = 0.012;
    hum.connect(humGain);
    humGain.connect(this.musicGain);
    hum.start(t);

    // Distant rumble — very low filtered noise
    const rumbleSrc = this.ctx.createBufferSource();
    rumbleSrc.buffer = buf;
    rumbleSrc.loop = true;
    const rumbleFilter = this.ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 50;
    const rumbleGain = this.ctx.createGain();
    rumbleGain.gain.value = 0.03;
    rumbleSrc.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(this.musicGain);
    rumbleSrc.start(t);

    this._ambientNodes = [windSrc, windLfo, hum, rumbleSrc];
  }

  stopAmbient() {
    if (this._ambientNodes) {
      this._ambientNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      this._ambientNodes = null;
    }
  }

  _noiseBurst(volume, duration) {
    const t = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    noise.connect(g);
    g.connect(this.sfxGain);
    noise.start(t);
  }
}
