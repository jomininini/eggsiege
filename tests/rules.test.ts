import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { addKill, createMatch, eggIndex, formatClock, leader, stepPoint, tickMatch } from '../src/game/rules'

const kinds = ['building', 'egg', 'building'] as const
const run = (fn: () => void, seconds: number, dt = 0.1) => {
  for (let t = 0; t < seconds; t += dt) fn()
}

describe('capture', () => {
  it('captures a neutral point with a single team and reports it', () => {
    const s = createMatch([...kinds])
    let captured = false
    run(() => {
      const e = stepPoint(s, 0, [1, 0], 0.1)
      if (e?.type === 'captured') captured = true
    }, 1 / CONFIG.capture.rate + 0.5)
    expect(captured).toBe(true)
    expect(s.points[0].owner).toBe(0)
  })
  it('pauses while contested and lets more units capture faster', () => {
    const a = createMatch([...kinds])
    stepPoint(a, 0, [1, 1], 1)
    expect(a.points[0].contested).toBe(true)
    expect(a.points[0].progress).toBe(0)
    const b = createMatch([...kinds])
    stepPoint(b, 0, [3, 0], 1)
    const c = createMatch([...kinds])
    stepPoint(c, 0, [1, 0], 1)
    expect(b.points[0].progress).toBeGreaterThan(c.points[0].progress)
  })
  it('must neutralize an owned point before taking it', () => {
    const s = createMatch([...kinds])
    s.points[0].owner = 1
    s.points[0].progress = 1
    const events: string[] = []
    run(() => {
      const e = stepPoint(s, 0, [2, 0], 0.1)
      if (e) events.push(e.type)
    }, 20)
    expect(events).toEqual(['neutralized', 'captured'])
    expect(s.points[0].owner).toBe(0)
  })
  it('supports more than two teams', () => {
    const s = createMatch([...kinds], 3)
    run(() => stepPoint(s, 2, [0, 0, 2], 0.1), 10)
    expect(s.points[2].owner).toBe(2)
    expect(s.scores).toHaveLength(3)
  })
})

describe('match', () => {
  it('scores owned points every second, the egg worth more', () => {
    const s = createMatch([...kinds])
    s.points[0].owner = 0
    s.points[eggIndex(s)].owner = 1
    tickMatch(s, 1)
    expect(s.scores).toEqual([CONFIG.match.tick.building, CONFIG.match.tick.egg])
  })
  it('wins by holding the Golden Egg long enough', () => {
    const s = createMatch([...kinds])
    s.points[eggIndex(s)].owner = 1
    let end = null
    for (let i = 0; i < CONFIG.match.eggHoldToWin + 2 && !end; i += 1) end = tickMatch(s, 1)
    expect(end).toMatchObject({ type: 'ended', winner: 1, reason: 'egg' })
  })
  it('wins on target score and awards kill points', () => {
    const s = createMatch([...kinds])
    s.scores[0] = CONFIG.match.targetScore - CONFIG.match.killPoints
    addKill(s, 0)
    expect(s.kills[0]).toBe(1)
    expect(tickMatch(s, 0.01)).toMatchObject({ winner: 0, reason: 'score' })
  })
  it('ends on time with the leader, and freezes afterwards', () => {
    const s = createMatch([...kinds])
    s.scores = [10, 20]
    const e = tickMatch(s, CONFIG.match.seconds)
    expect(e).toMatchObject({ winner: 1, reason: 'time' })
    expect(tickMatch(s, 1)).toBeNull()
    addKill(s, 0)
    expect(s.scores[0]).toBe(10)
  })
  it('detects ties and formats the clock', () => {
    const s = createMatch([...kinds])
    s.scores = [5, 5]
    expect(leader(s)).toBe(-1)
    expect(formatClock(125)).toBe('2:05')
    expect(formatClock(0)).toBe('0:00')
  })
})
