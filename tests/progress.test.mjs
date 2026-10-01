import { describe, expect, it } from 'vitest'
import { splitStatements } from '../server/migrate.mjs'
import { matchXp, RANK_XP, rankOf } from '../server/progress.mjs'

const base = { kills: 0, captures: 0, headshots: 0, result: 'loss', difficulty: 'normal', mode: 'standard', durationSec: 300 }

describe('progression (server-authoritative)', () => {
  it('awards participation, kills, captures and a win bonus', () => {
    expect(matchXp(base)).toBe(50)
    expect(matchXp({ ...base, kills: 10, captures: 2, result: 'win' })).toBe(50 + 100 + 60 + 150)
    expect(matchXp({ ...base, result: 'draw' })).toBe(110)
  })
  it('scales with difficulty, sea mode and short matches', () => {
    expect(matchXp({ ...base, difficulty: 'elite' })).toBe(75)
    expect(matchXp({ ...base, mode: 'sea' })).toBe(55)
    expect(matchXp({ ...base, durationSec: 60 })).toBe(25)
    expect(matchXp({ ...base, durationSec: 5 })).toBe(13)
  })
  it('caps headshot XP relative to kills', () => {
    expect(matchXp({ ...base, kills: 1, headshots: 500 })).toBe(50 + 10 + 15)
  })
  it('maps XP to ranks with the next threshold', () => {
    expect(rankOf(0)).toEqual({ rank: 0, rankXp: 0, nextXp: 500 })
    expect(rankOf(1499).rank).toBe(1)
    expect(rankOf(RANK_XP.at(-1) + 10)).toEqual({ rank: RANK_XP.length - 1, rankXp: RANK_XP.at(-1), nextXp: null })
  })
})

describe('migration splitting', () => {
  it('splits statements and drops comments', () => {
    expect(splitStatements('-- c\nCREATE TABLE a (x int);\n\nCREATE INDEX i ON a (x);\n')).toEqual(['CREATE TABLE a (x int)', 'CREATE INDEX i ON a (x)'])
  })
})
