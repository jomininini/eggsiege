import { ManusAuth, type ManusSession } from '../../manus-auth.js'
import type { SaveData } from '../engine/save'

/** Server-shaped profile (see server/profiles.mjs). */
export type CloudProfile = {
  callsign: string
  settings: Partial<SaveData>
  xp: number
  rank: number
  rankXp: number
  nextXp: number | null
  matches: number
  wins: number
  losses: number
  draws: number
  kills: number
  deaths: number
  captures: number
  headshots: number
  damage: number
  bestKills: number
  playSeconds: number
  lastMatchAt: string | null
  createdAt: string
}

export type CloudRecord = {
  id: number
  mode: 'standard' | 'sea'
  difficulty: SaveData['difficulty']
  perTeam: number
  result: 'win' | 'loss' | 'draw'
  reason: 'score' | 'egg' | 'time'
  teamScore: number
  enemyScore: number
  kills: number
  deaths: number
  captures: number
  headshots: number
  damage: number
  accuracy: number
  durationSec: number
  xpGained: number
  createdAt: string
}

export type MatchUpload = Omit<CloudRecord, 'id' | 'xpGained' | 'createdAt'> & { clientMatchId: string }

/** What the end screen shows about the cloud upload of the match that just finished. */
export type UploadState =
  | { kind: 'local' }
  | { kind: 'uploading' }
  | { kind: 'saved'; xpGained: number; rankUp: boolean; rank: number }
  | { kind: 'queued' }

export type AccountStatus = 'checking' | 'offline' | 'logged_out' | 'authenticated'

type ProfilePayload = { profile: CloudProfile | null; recent: CloudRecord[] }
type RecordPayload = ProfilePayload & { xpGained: number; rankUp: boolean; duplicate: boolean }

const SETTING_KEYS = ['lang', 'mode', 'perTeam', 'difficulty', 'sensitivity', 'invertY', 'musicVolume', 'sfxVolume', 'muted', 'quality'] as const
const PENDING_KEY = 'eggsiege.pending.v1'

function pickSettings(d: Partial<SaveData>): Partial<SaveData> {
  const out: Record<string, unknown> = {}
  for (const k of SETTING_KEYS) if (d[k] !== undefined) out[k] = d[k]
  return out as Partial<SaveData>
}

function errCode(e: unknown): string {
  const any = e as { data?: { code?: string }; message?: string }
  return any?.data?.code ?? any?.message ?? 'error'
}

/**
 * Player account: Manus login, a cloud profile (callsign, settings, XP/rank, career) and match
 * history. Logged-out and offline play keep working exactly as before on local saves.
 */
export class Account {
  status: AccountStatus = 'checking'
  userName: string | null = null
  profile: CloudProfile | null = null
  recent: CloudRecord[] = []
  syncing = false
  error = ''
  lastUpload: UploadState = { kind: 'local' }
  private listeners = new Set<() => void>()
  private settingsTimer = 0
  private pendingSettings: Partial<SaveData> = {}
  private retryTimer = 0

  constructor(
    private readonly local: () => SaveData,
    /** Apply settings that came from the cloud profile to the local save (no echo back). */
    private readonly applyCloudSettings: (s: Partial<SaveData>) => void,
  ) {
    window.addEventListener('manus-auth-change', e => void this.onSession(e.detail))
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  private emit(): void {
    for (const cb of this.listeners) cb()
  }

  async init(): Promise<void> {
    try {
      await this.onSession(await ManusAuth.prepare())
    } catch (e) {
      // No API reachable (static hosting / dev without server): local saves only.
      console.warn('[account] offline:', errCode(e))
      this.status = 'offline'
      this.emit()
    }
  }

  private async onSession(s: ManusSession): Promise<void> {
    if (s.status !== 'authenticated') {
      this.status = s.status
      this.userName = null
      this.profile = null
      this.recent = []
      this.emit()
      return
    }
    const wasAuthed = this.status === 'authenticated'
    this.status = 'authenticated'
    this.userName = s.user.name
    this.emit()
    if (!wasAuthed) await this.loadProfile()
  }

  /** First login on a device creates the profile from local settings + local career (once per account). */
  private async loadProfile(): Promise<void> {
    this.syncing = true
    this.emit()
    try {
      let p = await ManusAuth.query<ProfilePayload>('profile')
      if (!p.profile) {
        const d = this.local()
        p = await ManusAuth.mutate<ProfilePayload>('syncProfile', {
          settings: pickSettings(d),
          importLocal: d.matches ? { matches: d.matches, wins: Math.min(d.wins, d.matches), bestKills: Math.min(d.bestKills, 300) } : undefined,
        })
      } else if (p.profile.settings && Object.keys(p.profile.settings).length) {
        this.applyCloudSettings(pickSettings(p.profile.settings))
      }
      this.take(p)
      this.error = ''
      void this.flushPending()
    } catch (e) {
      this.error = errCode(e)
    } finally {
      this.syncing = false
      this.emit()
    }
  }

  private take(p: ProfilePayload): void {
    this.profile = p.profile
    this.recent = p.recent
  }

  async login(): Promise<void> {
    this.error = ''
    try {
      await ManusAuth.login()
    } catch (e) {
      this.error = errCode(e)
      this.emit()
    }
  }

  async logout(): Promise<void> {
    try {
      await ManusAuth.logout()
    } catch (e) {
      this.error = errCode(e)
      this.emit()
    }
  }

  /** Called on every local settings change; batched to one cloud write. */
  settingsChanged(patch: Partial<SaveData>): void {
    const s = pickSettings(patch)
    if (this.status !== 'authenticated' || !Object.keys(s).length) return
    Object.assign(this.pendingSettings, s)
    clearTimeout(this.settingsTimer)
    this.settingsTimer = window.setTimeout(() => {
      const settings = this.pendingSettings
      this.pendingSettings = {}
      ManusAuth.mutate<ProfilePayload>('syncProfile', { settings }).then(
        p => this.take(p),
        e => console.warn('[account] settings sync failed:', errCode(e)),
      )
    }, 1500)
  }

  async setCallsign(callsign: string): Promise<boolean> {
    if (this.status !== 'authenticated') return false
    try {
      this.take(await ManusAuth.mutate<ProfilePayload>('syncProfile', { callsign }))
      this.error = ''
      return true
    } catch (e) {
      this.error = errCode(e)
      return false
    } finally {
      this.emit()
    }
  }

  /** Upload a finished match. Logged-out matches stay local; network failures are queued and retried. */
  async recordMatch(m: Omit<MatchUpload, 'clientMatchId'>): Promise<UploadState> {
    if (this.status !== 'authenticated' || m.durationSec < 20) {
      this.lastUpload = { kind: 'local' }
      this.emit()
      return this.lastUpload
    }
    const payload: MatchUpload = { ...m, clientMatchId: crypto.randomUUID() }
    this.lastUpload = { kind: 'uploading' }
    this.emit()
    try {
      const r = await ManusAuth.mutate<RecordPayload>('recordMatch', payload)
      this.take(r)
      this.lastUpload = { kind: 'saved', xpGained: r.xpGained, rankUp: r.rankUp, rank: r.profile?.rank ?? 0 }
    } catch (e) {
      console.warn('[account] match upload failed, queued:', errCode(e))
      this.queue(payload)
      this.lastUpload = { kind: 'queued' }
    }
    this.emit()
    return this.lastUpload
  }

  private readPending(): MatchUpload[] {
    try {
      const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]')
      return Array.isArray(v) ? v : []
    } catch {
      return []
    }
  }
  private writePending(list: MatchUpload[]): void {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20)))
    } catch {
      // ignore (private mode)
    }
  }
  private queue(m: MatchUpload): void {
    this.writePending([...this.readPending(), m])
    this.scheduleRetry()
  }
  private scheduleRetry(): void {
    clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => void this.flushPending(), 20_000)
  }

  get pendingCount(): number {
    return this.readPending().length
  }

  /** Re-send queued matches one at a time (the server accepts one record per 15 s). */
  private async flushPending(): Promise<void> {
    const list = this.readPending()
    if (!list.length || this.status !== 'authenticated') return
    const [first, ...rest] = list
    try {
      this.take(await ManusAuth.mutate<RecordPayload>('recordMatch', first))
      this.writePending(rest)
    } catch (e) {
      const code = errCode(e)
      // Permanently invalid payloads are dropped; everything else waits for the next retry.
      if (code === 'BAD_REQUEST') this.writePending(rest)
    }
    this.emit()
    if (this.readPending().length) this.scheduleRetry()
  }
}
