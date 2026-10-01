// Player profile, career aggregates and match history (managed MySQL / TiDB).
import mysql from 'mysql2/promise'
import { matchXp, rankOf } from './progress.mjs'

let pool = null
function db() {
  if (!pool) pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 5, waitForConnections: true })
  return pool
}

const SETTING_KEYS = ['lang', 'mode', 'perTeam', 'difficulty', 'sensitivity', 'invertY', 'musicVolume', 'sfxVolume', 'muted', 'quality']

/** Keep only known, well-typed settings so arbitrary JSON never lands in the profile. */
export function cleanSettings(s) {
  if (!s || typeof s !== 'object') return {}
  const out = {}
  for (const k of SETTING_KEYS) if (k in s) out[k] = s[k]
  return out
}

function parseJson(v) {
  if (v == null) return {}
  if (typeof v === 'object') return v
  try {
    return JSON.parse(v)
  } catch {
    return {}
  }
}

function shapeProfile(row) {
  if (!row) return null
  return {
    callsign: row.callsign,
    settings: parseJson(row.settings),
    xp: row.xp,
    ...rankOf(row.xp),
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    kills: row.kills,
    deaths: row.deaths,
    captures: row.captures,
    headshots: row.headshots,
    damage: Number(row.damage),
    bestKills: row.bestKills,
    playSeconds: row.playSeconds,
    lastMatchAt: row.lastMatchAt ? new Date(row.lastMatchAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

function shapeRecord(r) {
  return {
    id: r.id,
    mode: r.mode,
    difficulty: r.difficulty,
    perTeam: r.perTeam,
    result: r.result,
    reason: r.reason,
    teamScore: r.teamScore,
    enemyScore: r.enemyScore,
    kills: r.kills,
    deaths: r.deaths,
    captures: r.captures,
    headshots: r.headshots,
    damage: r.damage,
    accuracy: r.accuracyPm / 1000,
    durationSec: r.durationSec,
    xpGained: r.xpGained,
    createdAt: new Date(r.createdAt).toISOString(),
  }
}

async function profileRow(userId, conn = db()) {
  const [rows] = await conn.query('SELECT * FROM `player_profiles` WHERE `userId` = ?', [userId])
  return rows[0] ?? null
}

export async function recentRecords(userId, limit = 15) {
  const [rows] = await db().query('SELECT * FROM `match_records` WHERE `userId` = ? ORDER BY `createdAt` DESC, `id` DESC LIMIT ?', [userId, limit])
  return rows.map(shapeRecord)
}

export async function getProfile(userId) {
  const row = await profileRow(userId)
  return { profile: shapeProfile(row), recent: row ? await recentRecords(userId) : [] }
}

export function defaultCallsign(name, userId) {
  const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24)
  return n || `Operator-${userId}`
}

/**
 * Create the profile on first sync (optionally importing the device's local career once),
 * otherwise update callsign / settings. Career numbers are never accepted from the client
 * after creation; they only change through recordMatch.
 */
export async function syncProfile(user, input) {
  const conn = await db().getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT * FROM `player_profiles` WHERE `userId` = ? FOR UPDATE', [user.id])
    let created = false
    if (!rows[0]) {
      created = true
      const imp = input.importLocal
      const matches = imp ? imp.matches : 0
      const wins = imp ? Math.min(imp.wins, matches) : 0
      const bestKills = imp ? imp.bestKills : 0
      await conn.query(
        'INSERT INTO `player_profiles` (`userId`, `callsign`, `settings`, `matches`, `wins`, `losses`, `bestKills`, `importedLocal`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [user.id, input.callsign ?? defaultCallsign(user.name, user.id), JSON.stringify(cleanSettings(input.settings)), matches, wins, matches - wins, bestKills, imp ? 1 : 0],
      )
    } else {
      const sets = []
      const vals = []
      if (input.callsign) {
        sets.push('`callsign` = ?')
        vals.push(input.callsign)
      }
      if (input.settings) {
        const merged = { ...parseJson(rows[0].settings), ...cleanSettings(input.settings) }
        sets.push('`settings` = ?')
        vals.push(JSON.stringify(merged))
      }
      if (sets.length) await conn.query(`UPDATE \`player_profiles\` SET ${sets.join(', ')} WHERE \`userId\` = ?`, [...vals, user.id])
    }
    await conn.commit()
    const row = await profileRow(user.id)
    return { created, profile: shapeProfile(row), recent: await recentRecords(user.id) }
  } catch (e) {
    await conn.rollback().catch(() => undefined)
    throw e
  } finally {
    conn.release()
  }
}

export class RecordRejected extends Error {}

/** Record one finished match idempotently (clientMatchId) and fold it into the career totals. */
export async function recordMatch(user, m) {
  const conn = await db().getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT * FROM `player_profiles` WHERE `userId` = ? FOR UPDATE', [user.id])
    if (!rows[0]) {
      await conn.query('INSERT INTO `player_profiles` (`userId`, `callsign`, `settings`) VALUES (?, ?, ?)', [user.id, defaultCallsign(user.name, user.id), '{}'])
    }
    const [dup] = await conn.query('SELECT * FROM `match_records` WHERE `userId` = ? AND `clientMatchId` = ?', [user.id, m.clientMatchId])
    if (dup[0]) {
      await conn.commit()
      const row = await profileRow(user.id)
      return { duplicate: true, xpGained: dup[0].xpGained, rankUp: false, record: shapeRecord(dup[0]), profile: shapeProfile(row), recent: await recentRecords(user.id) }
    }
    const before = rows[0]?.xp ?? 0
    const last = rows[0]?.lastMatchAt ? new Date(rows[0].lastMatchAt).getTime() : 0
    if (Date.now() - last < 15_000) throw new RecordRejected('too_frequent')
    const xp = matchXp(m)
    const [ins] = await conn.query(
      'INSERT INTO `match_records` (`userId`, `clientMatchId`, `mode`, `difficulty`, `perTeam`, `result`, `reason`, `teamScore`, `enemyScore`, `kills`, `deaths`, `captures`, `headshots`, `damage`, `accuracyPm`, `durationSec`, `xpGained`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [user.id, m.clientMatchId, m.mode, m.difficulty, m.perTeam, m.result, m.reason, m.teamScore, m.enemyScore, m.kills, m.deaths, m.captures, m.headshots, m.damage, Math.round(m.accuracy * 1000), m.durationSec, xp],
    )
    await conn.query(
      `UPDATE \`player_profiles\` SET \`xp\` = \`xp\` + ?, \`matches\` = \`matches\` + 1, \`wins\` = \`wins\` + ?, \`losses\` = \`losses\` + ?, \`draws\` = \`draws\` + ?,
        \`kills\` = \`kills\` + ?, \`deaths\` = \`deaths\` + ?, \`captures\` = \`captures\` + ?, \`headshots\` = \`headshots\` + ?, \`damage\` = \`damage\` + ?,
        \`bestKills\` = GREATEST(\`bestKills\`, ?), \`playSeconds\` = \`playSeconds\` + ?, \`lastMatchAt\` = CURRENT_TIMESTAMP WHERE \`userId\` = ?`,
      [xp, m.result === 'win' ? 1 : 0, m.result === 'loss' ? 1 : 0, m.result === 'draw' ? 1 : 0, m.kills, m.deaths, m.captures, m.headshots, m.damage, m.kills, m.durationSec, user.id],
    )
    await conn.commit()
    const row = await profileRow(user.id)
    const [rec] = await db().query('SELECT * FROM `match_records` WHERE `id` = ?', [ins.insertId])
    return { duplicate: false, xpGained: xp, rankUp: rankOf(row.xp).rank > rankOf(before).rank, record: shapeRecord(rec[0]), profile: shapeProfile(row), recent: await recentRecords(user.id) }
  } catch (e) {
    await conn.rollback().catch(() => undefined)
    throw e
  } finally {
    conn.release()
  }
}
