// Server-authoritative progression rules. The client only displays what these return.

/** XP needed to reach each rank (index = rank). Names live in the client (bilingual). */
export const RANK_XP = [0, 500, 1500, 3500, 6500, 10500, 16000, 23000, 32000, 45000, 60000, 80000]

const DIFF_MULT = { easy: 0.8, normal: 1, hard: 1.25, elite: 1.5 }

export function rankOf(xp) {
  let r = 0
  for (let i = 0; i < RANK_XP.length; i++) if (xp >= RANK_XP[i]) r = i
  const next = RANK_XP[r + 1] ?? null
  return { rank: r, rankXp: RANK_XP[r], nextXp: next }
}

/** XP for one validated match. */
export function matchXp(m) {
  const base = 50 + m.kills * 10 + m.captures * 30 + Math.min(m.headshots, m.kills * 3) * 5
  const bonus = m.result === 'win' ? 150 : m.result === 'draw' ? 60 : 0
  const mult = (DIFF_MULT[m.difficulty] ?? 1) * (m.mode === 'sea' ? 1.1 : 1)
  // Short matches (quick wins or early quits are both fine) scale down below 2 minutes.
  const time = Math.min(1, Math.max(0.25, m.durationSec / 120))
  return Math.max(0, Math.round((base + bonus) * mult * time))
}
