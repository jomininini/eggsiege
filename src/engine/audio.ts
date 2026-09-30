/**
 * Web Audio mixer with synthesized SFX (no audio files). Call `unlock()` from a user gesture.
 * Positional sounds pass a distance; volume falls off with it.
 */
export type Sfx =
  | 'shot' | 'enemyShot' | 'hit' | 'kill' | 'headshot' | 'hurt' | 'reload' | 'empty' | 'explode' | 'capture' | 'lost'
  | 'supply' | 'skill' | 'heal' | 'ui' | 'win' | 'lose' | 'drone' | 'vehicle' | 'heliCall' | 'gun' | 'jump' | 'splash' | 'deny'
  | 'missile' | 'lock' | 'locked' | 'flak' | 'rocket' | 'siren' | 'swap'
export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private noise: AudioBuffer
  private musicTimer = 0
  private musicOn = false
  private engine?: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode }
  private rotor?: { gain: GainNode }
  private lastShot = 0

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    const comp = this.ctx.createDynamicsCompressor()
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(comp).connect(this.ctx.destination)
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate * 1.5, this.ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1
  }
  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : music * 0.5, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.9, t, 0.05)
  }

  private tone(freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.sfx)
    o.start(t)
    o.stop(t + dur + 0.05)
  }
  private burst(dur: number, vol: number, freq: number, q = 0.8, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const t = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const f = this.ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(Math.max(vol, 0.0002), t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.sfx)
    src.start(t, Math.random() * 0.5)
    src.stop(t + dur + 0.05)
  }

  /** `dist` in metres for positional sounds (0 = at the listener). */
  play(name: Sfx, dist = 0): void {
    if (this.ctx.state !== 'running') return
    const fall = dist > 0 ? Math.max(0, 1 - dist / 130) ** 1.6 : 1
    if (fall < 0.02) return
    switch (name) {
      case 'shot':
        this.burst(0.12, 0.55, 2600, 0.7)
        this.burst(0.2, 0.35, 380, 1)
        this.tone(170, 60, 0.09, 'square', 0.12)
        break
      case 'enemyShot': {
        const now = this.ctx.currentTime
        if (now - this.lastShot < 0.035) return
        this.lastShot = now
        this.burst(0.1, 0.3 * fall, Math.max(500, 1500 - Math.min(dist, 100) * 8), 0.7)
        break
      }
      case 'gun':
        this.burst(0.09, 0.5 * fall, 900, 0.9)
        this.tone(120, 50, 0.08, 'square', 0.14 * fall)
        break
      case 'hit': this.tone(1800, 1500, 0.05, 'square', 0.12); break
      case 'headshot': this.tone(2400, 2000, 0.06, 'square', 0.14); this.tone(3200, 3000, 0.08, 'sine', 0.1, 0.03); break
      case 'kill': this.tone(900, 1400, 0.1, 'triangle', 0.22); this.tone(1400, 1900, 0.14, 'triangle', 0.18, 0.08); break
      case 'hurt': this.burst(0.12, 0.35, 500, 1.5, 'bandpass'); this.tone(200, 90, 0.2, 'sawtooth', 0.12); break
      case 'reload': this.tone(700, 500, 0.05, 'square', 0.1); this.tone(420, 380, 0.06, 'square', 0.1, 0.9); this.tone(900, 700, 0.05, 'square', 0.12, 1.7); break
      case 'empty': this.tone(1200, 1100, 0.03, 'square', 0.08); break
      case 'explode':
        this.burst(1.1, 0.9 * fall, 700, 0.6)
        this.tone(90, 30, 0.8, 'sine', 0.6 * fall)
        break
      case 'capture': [523, 659, 784].forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.22, i * 0.09)); break
      case 'lost': [392, 311, 262].forEach((f, i) => this.tone(f, f, 0.24, 'sawtooth', 0.12, i * 0.1)); break
      case 'supply': this.tone(600, 900, 0.1, 'triangle', 0.25); this.tone(900, 1200, 0.12, 'triangle', 0.2, 0.08); break
      case 'skill': this.tone(300, 1200, 0.35, 'sawtooth', 0.12); this.tone(600, 2400, 0.35, 'sine', 0.12); break
      case 'heal': this.tone(660, 990, 0.2, 'sine', 0.1); break
      case 'ui': this.tone(660, 700, 0.05, 'triangle', 0.16); break
      case 'deny': this.tone(220, 180, 0.12, 'square', 0.1); break
      case 'drone': this.tone(400, 1600, 0.5, 'sawtooth', 0.08); break
      case 'vehicle': this.tone(80, 160, 0.4, 'sawtooth', 0.15); break
      case 'heliCall': [880, 660, 880].forEach((f, i) => this.tone(f, f, 0.14, 'square', 0.1, i * 0.16)); break
      case 'jump': this.burst(0.06, 0.12, 900); break
      case 'splash': this.burst(0.5, 0.3 * fall, 1200, 0.5, 'highpass'); break
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f * 1.01, 0.35, 'triangle', 0.25, i * 0.12)); break
      case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.4, 'sine', 0.25, i * 0.16)); break
      case 'missile':
        this.burst(0.7, 0.5 * fall, 1600, 0.4, 'highpass')
        this.tone(220, 90, 0.5, 'sawtooth', 0.12 * fall)
        break
      case 'lock': this.tone(1200, 1200, 0.04, 'square', 0.06); break
      case 'locked': this.tone(1800, 1800, 0.12, 'square', 0.09); this.tone(1800, 1800, 0.12, 'square', 0.09, 0.16); break
      case 'flak':
        this.burst(0.08, 0.45 * fall, 1300, 0.9)
        this.tone(140, 70, 0.07, 'square', 0.12 * fall)
        break
      case 'rocket':
        this.burst(0.9, 0.35 * fall, 900, 0.5)
        this.tone(160, 60, 0.6, 'sawtooth', 0.08 * fall)
        break
      case 'siren': [0, 0.45, 0.9].forEach(d => this.tone(600, 1100, 0.4, 'sawtooth', 0.07, d)); break
      case 'swap': this.tone(500, 420, 0.05, 'square', 0.08); this.tone(760, 760, 0.04, 'square', 0.08, 0.12); break
    }
  }

  /** Continuous vehicle engine. level 0 = off, 1 = full throttle. */
  setEngine(level: number, boat = false): void {
    if (this.ctx.state !== 'running') return
    if (!this.engine && level > 0) {
      const osc = this.ctx.createOscillator()
      const osc2 = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      osc2.type = 'square'
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 500
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      osc.connect(filter)
      osc2.connect(filter)
      filter.connect(gain).connect(this.sfx)
      osc.start()
      osc2.start()
      this.engine = { osc, osc2, gain, filter }
    }
    if (!this.engine) return
    const t = this.ctx.currentTime
    this.engine.gain.gain.setTargetAtTime(level > 0 ? 0.04 + level * 0.05 : 0, t, 0.1)
    const base = boat ? 55 : 45
    this.engine.osc.frequency.setTargetAtTime(base + level * 90, t, 0.1)
    this.engine.osc2.frequency.setTargetAtTime((base + level * 90) * 0.5, t, 0.1)
    this.engine.filter.frequency.setTargetAtTime(300 + level * 900, t, 0.1)
  }

  /** Continuous helicopter rotor thump. level 0..1 by proximity. */
  setRotor(level: number): void {
    if (this.ctx.state !== 'running') return
    if (!this.rotor && level > 0.01) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 240
      const amp = this.ctx.createGain()
      amp.gain.value = 0.5
      const lfo = this.ctx.createOscillator()
      lfo.frequency.value = 11
      const lfoGain = this.ctx.createGain()
      lfoGain.gain.value = 0.5
      lfo.connect(lfoGain).connect(amp.gain)
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      src.connect(filter).connect(amp).connect(gain).connect(this.sfx)
      src.start()
      lfo.start()
      this.rotor = { gain }
    }
    if (!this.rotor) return
    this.rotor.gain.gain.setTargetAtTime(Math.min(1, level) * 0.9, this.ctx.currentTime, 0.2)
  }

  /** Tense generative pulse: bass ostinato + pad, scheduled per bar. */
  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    const roots = [110, 98, 87.3, 98]
    let bar = 0
    const schedule = () => {
      if (!this.musicOn) return
      const t0 = this.ctx.currentTime + 0.05
      const root = roots[bar % roots.length]
      for (let i = 0; i < 8; i += 1) {
        const t = t0 + i * 0.3
        const o = this.ctx.createOscillator()
        const g = this.ctx.createGain()
        o.type = 'triangle'
        o.frequency.value = i % 4 === 3 ? root * 1.5 : root
        g.gain.setValueAtTime(0.0001, t)
        g.gain.exponentialRampToValueAtTime(0.08, t + 0.01)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26)
        o.connect(g).connect(this.music)
        o.start(t)
        o.stop(t + 0.3)
      }
      for (const m of [2, 2.4, 3]) {
        const o = this.ctx.createOscillator()
        const g = this.ctx.createGain()
        o.type = 'sine'
        o.frequency.value = root * m
        g.gain.setValueAtTime(0.0001, t0)
        g.gain.linearRampToValueAtTime(0.025, t0 + 0.8)
        g.gain.linearRampToValueAtTime(0.0001, t0 + 2.4)
        o.connect(g).connect(this.music)
        o.start(t0)
        o.stop(t0 + 2.5)
      }
      bar += 1
      this.musicTimer = window.setTimeout(schedule, 2400)
    }
    schedule()
  }
  stopMusic(): void {
    this.musicOn = false
    clearTimeout(this.musicTimer)
  }
  silenceLoops(): void {
    this.setEngine(0)
    this.setRotor(0)
  }
}
