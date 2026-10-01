import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { getProfile, RecordRejected, recordMatch, syncProfile } from './profiles.mjs'
import { router, protectedProcedure } from './webdev-adapter.mjs'

// Every write derives the owner from ctx.user (the validated session), never from browser input.

const callsign = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[^\u0000-\u001f<>]+$/)

const settings = z
  .object({
    lang: z.enum(['zh', 'en']),
    mode: z.enum(['standard', 'sea']),
    perTeam: z.number().int().min(2).max(10),
    difficulty: z.enum(['easy', 'normal', 'hard', 'elite']),
    sensitivity: z.number().min(0.2).max(3),
    invertY: z.boolean(),
    musicVolume: z.number().min(0).max(1),
    sfxVolume: z.number().min(0).max(1),
    muted: z.boolean(),
    quality: z.enum(['low', 'medium', 'high']),
  })
  .partial()

const count = max => z.number().int().min(0).max(max)

const match = z
  .object({
    clientMatchId: z.string().regex(/^[A-Za-z0-9-]{8,40}$/),
    mode: z.enum(['standard', 'sea']),
    difficulty: z.enum(['easy', 'normal', 'hard', 'elite']),
    perTeam: z.number().int().min(2).max(10),
    result: z.enum(['win', 'loss', 'draw']),
    reason: z.enum(['score', 'egg', 'time']),
    teamScore: count(1200),
    enemyScore: count(1200),
    kills: count(300),
    deaths: count(300),
    captures: count(200),
    headshots: count(3000),
    damage: count(300000),
    accuracy: z.number().min(0).max(1),
    durationSec: z.number().int().min(20).max(660),
  })
  .refine(m => m.result !== 'win' || m.reason !== 'score' || m.teamScore >= m.enemyScore, { message: 'inconsistent_result' })

function translate(e) {
  if (e instanceof RecordRejected) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: e.message })
  throw e
}

export const gameRouter = router({
  player: protectedProcedure.query(({ ctx }) => ({ id: ctx.user.id, name: ctx.user.name })),
  /** Profile + 15 most recent matches; profile is null until the first sync creates it. */
  profile: protectedProcedure.query(({ ctx }) => getProfile(ctx.user.id)),
  syncProfile: protectedProcedure
    .input(
      z.object({
        callsign: callsign.optional(),
        settings: settings.optional(),
        importLocal: z.object({ matches: count(100000), wins: count(100000), bestKills: count(300) }).optional(),
      }),
    )
    .mutation(({ ctx, input }) => syncProfile(ctx.user, input)),
  recordMatch: protectedProcedure.input(match).mutation(({ ctx, input }) => recordMatch(ctx.user, input).catch(translate)),
})
