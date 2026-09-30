import { CONFIG } from './config'

/**
 * Pure match rules: capture progress, team scoring, Golden Egg hold timer and win conditions.
 * Works for any number of teams; the scene reports presence counts and reads the state.
 */
export type PointKind = 'building' | 'egg'
export type PointState = {
  kind: PointKind
  /** Owning team, or -1 when neutral. */
  owner: number
  /** 0..1. With an owner it is the hold strength; when neutral it belongs to `progressTeam`. */
  progress: number
  progressTeam: number
  contested: boolean
  /** Team currently standing alone in the zone (or -1). */
  capturing: number
}
export type MatchPhase = 'playing' | 'ended'
export type EndReason = 'egg' | 'score' | 'time' | ''
export type MatchState = {
  teams: number
  scores: number[]
  kills: number[]
  points: PointState[]
  timeLeft: number
  /** Seconds the current Golden Egg owner has kept it. */
  eggHold: number
  phase: MatchPhase
  winner: number
  reason: EndReason
  tickAcc: number
}
export type MatchEvent =
  | { type: 'captured'; point: number; team: number; previous: number }
  | { type: 'neutralized'; point: number; team: number; previous: number }
  | { type: 'ended'; winner: number; reason: EndReason }

export function createMatch(kinds: PointKind[], teams = 2): MatchState {
  return {
    teams,
    scores: new Array(teams).fill(0),
    kills: new Array(teams).fill(0),
    points: kinds.map(kind => ({ kind, owner: -1, progress: 0, progressTeam: -1, contested: false, capturing: -1 })),
    timeLeft: CONFIG.match.seconds,
    eggHold: 0,
    phase: 'playing',
    winner: -1,
    reason: '',
    tickAcc: 0,
  }
}

export function eggIndex(state: MatchState): number {
  return state.points.findIndex(p => p.kind === 'egg')
}

/**
 * Advance capture for one point. `presence[t]` is the number of living units of team t inside.
 * Mutates the point, returns an event when ownership changes.
 */
export function stepPoint(state: MatchState, index: number, presence: number[], dt: number): MatchEvent | null {
  const p = state.points[index]
  const present: number[] = []
  for (let t = 0; t < state.teams; t += 1) if ((presence[t] ?? 0) > 0) present.push(t)
  p.contested = present.length > 1
  p.capturing = present.length === 1 ? present[0] : -1
  if (p.contested || state.phase !== 'playing') return null
  if (present.length === 0) {
    if (p.owner === -1 && p.progress > 0) {
      p.progress = Math.max(0, p.progress - CONFIG.capture.decay * dt)
      if (p.progress === 0) p.progressTeam = -1
    } else if (p.owner !== -1 && p.progress < 1) {
      p.progress = Math.min(1, p.progress + CONFIG.capture.decay * dt)
    }
    return null
  }
  const team = present[0]
  const units = Math.min(presence[team], CONFIG.capture.maxUnits)
  const rate = (p.kind === 'egg' ? CONFIG.capture.eggRate : CONFIG.capture.rate) * (1 + (units - 1) * 0.5) * dt
  if (p.owner === team) {
    p.progress = Math.min(1, p.progress + rate)
    p.progressTeam = team
    return null
  }
  if (p.owner !== -1) {
    p.progress -= rate
    if (p.progress <= 0) {
      const previous = p.owner
      p.owner = -1
      p.progress = 0
      p.progressTeam = team
      if (p.kind === 'egg') state.eggHold = 0
      return { type: 'neutralized', point: index, team, previous }
    }
    return null
  }
  if (p.progressTeam !== team && p.progress > 0) {
    p.progress -= rate
    if (p.progress <= 0) {
      p.progress = 0
      p.progressTeam = team
    }
    return null
  }
  p.progressTeam = team
  p.progress += rate
  if (p.progress >= 1) {
    p.progress = 1
    p.owner = team
    if (p.kind === 'egg') state.eggHold = 0
    return { type: 'captured', point: index, team, previous: -1 }
  }
  return null
}

export function addKill(state: MatchState, team: number): void {
  if (state.phase !== 'playing' || team < 0) return
  state.kills[team] += 1
  state.scores[team] += CONFIG.match.killPoints
}

function finish(state: MatchState, winner: number, reason: EndReason): MatchEvent {
  state.phase = 'ended'
  state.winner = winner
  state.reason = reason
  return { type: 'ended', winner, reason }
}

/** Advance clock, per-second scoring and win checks. */
export function tickMatch(state: MatchState, dt: number): MatchEvent | null {
  if (state.phase !== 'playing') return null
  state.timeLeft = Math.max(0, state.timeLeft - dt)
  const egg = eggIndex(state)
  const eggOwner = egg >= 0 ? state.points[egg].owner : -1
  if (eggOwner >= 0) state.eggHold += dt
  else state.eggHold = 0
  state.tickAcc += dt
  while (state.tickAcc >= 1) {
    state.tickAcc -= 1
    for (const p of state.points) {
      if (p.owner >= 0) state.scores[p.owner] += p.kind === 'egg' ? CONFIG.match.tick.egg : CONFIG.match.tick.building
    }
  }
  if (eggOwner >= 0 && state.eggHold >= CONFIG.match.eggHoldToWin) return finish(state, eggOwner, 'egg')
  const best = leader(state)
  if (best >= 0 && state.scores[best] >= CONFIG.match.targetScore) return finish(state, best, 'score')
  if (state.timeLeft <= 0) {
    let winner = best
    if (winner < 0) winner = eggOwner
    return finish(state, winner, 'time')
  }
  return null
}

/** Team with the strictly highest score, or -1 on a tie. */
export function leader(state: MatchState): number {
  let best = -1
  let bestScore = -Infinity
  let tie = false
  state.scores.forEach((s, t) => {
    if (s > bestScore) {
      best = t
      bestScore = s
      tie = false
    } else if (s === bestScore) tie = true
  })
  return tie ? -1 : best
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
