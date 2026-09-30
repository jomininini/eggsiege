/**
 * Versioned local save: settings plus a small career record. Corrupt data falls back to defaults.
 */
export type Quality = 'low' | 'medium' | 'high'
export type SaveData = {
  version: 2
  musicVolume: number
  sfxVolume: number
  muted: boolean
  sensitivity: number
  invertY: boolean
  quality: Quality
  wins: number
  matches: number
  bestKills: number
}
export const SAVE_KEY = 'eggsiege.save'

export function defaultSave(): SaveData {
  return { version: 2, musicVolume: 0.5, sfxVolume: 0.8, muted: false, sensitivity: 1, invertY: false, quality: 'high', wins: 0, matches: 0, bestKills: 0 }
}
const clamp01 = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : f)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let d: Record<string, unknown>
  try {
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || Array.isArray(p)) return base
    d = p as Record<string, unknown>
  } catch {
    return base
  }
  if (d.version !== 2) return base
  return {
    version: 2,
    musicVolume: clamp01(d.musicVolume, base.musicVolume),
    sfxVolume: clamp01(d.sfxVolume, base.sfxVolume),
    muted: d.muted === true,
    sensitivity: typeof d.sensitivity === 'number' && d.sensitivity >= 0.2 && d.sensitivity <= 3 ? d.sensitivity : base.sensitivity,
    invertY: d.invertY === true,
    quality: d.quality === 'low' || d.quality === 'medium' || d.quality === 'high' ? d.quality : base.quality,
    wins: count(d.wins),
    matches: count(d.matches),
    bestKills: count(d.bestKills),
  }
}

export class SaveStore {
  data: SaveData
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }
  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Private mode: keep settings in memory.
    }
  }
}
