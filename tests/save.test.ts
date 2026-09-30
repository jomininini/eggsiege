import { describe, expect, it } from 'vitest'
import { defaultSave, parseSave, SAVE_KEY, SaveStore } from '../src/engine/save'

describe('save', () => {
  it('falls back to defaults for missing, corrupt or foreign data', () => {
    expect(parseSave(null)).toEqual(defaultSave())
    expect(parseSave('{nope')).toEqual(defaultSave())
    expect(parseSave('[]')).toEqual(defaultSave())
    expect(parseSave(JSON.stringify({ version: 1, musicVolume: 0.1 }))).toEqual(defaultSave())
  })
  it('clamps and validates fields', () => {
    const s = parseSave(JSON.stringify({ version: 2, musicVolume: 5, sfxVolume: -1, quality: 'ultra', sensitivity: 9, wins: -3, bestKills: 12.7 }))
    expect(s.musicVolume).toBe(1)
    expect(s.sfxVolume).toBe(0)
    expect(s.quality).toBe('high')
    expect(s.sensitivity).toBe(1)
    expect(s.wins).toBe(0)
    expect(s.bestKills).toBe(12)
  })
  it('validates match options and language', () => {
    const s = parseSave(JSON.stringify({ version: 3, lang: 'en', mode: 'sea', perTeam: 9, difficulty: 'elite' }))
    expect([s.lang, s.mode, s.perTeam, s.difficulty]).toEqual(['en', 'sea', 9, 'elite'])
    const bad = parseSave(JSON.stringify({ version: 3, lang: 'fr', mode: 'air', perTeam: 40, difficulty: 'god' }))
    expect([bad.lang, bad.mode, bad.perTeam, bad.difficulty]).toEqual(['zh', 'standard', 6, 'normal'])
  })
  it('persists updates and survives storage failures', () => {
    const mem = new Map<string, string>()
    const store = new SaveStore({ getItem: k => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) })
    store.update({ wins: 3 })
    expect(JSON.parse(mem.get(SAVE_KEY)!).wins).toBe(3)
    expect(new SaveStore({ getItem: k => mem.get(k) ?? null, setItem: () => undefined }).data.wins).toBe(3)
    const broken = new SaveStore({ getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } })
    broken.update({ muted: true })
    expect(broken.data.muted).toBe(true)
  })
})
