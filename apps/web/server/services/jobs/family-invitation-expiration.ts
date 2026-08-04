import { z } from 'zod'
import type { DatabaseConnection } from '../../db/connect'
import { frozenFamilyInvitationReservationSql } from '../../db/repositories/family-invitation-reservation'
import type { JsonValue } from '../../db/schema'
import type { JobHandler } from './job-queue'

export const familyInvitationExpirationJobType = 'family.invitation-expiration' as const
export const familyInvitationExpirationMaxAttempts = 12
export const familyInvitationExpirationPageSize = 50

const familyInvitationExpirationPayloadSchema = z
  .object({
    cursor: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => value === value.trim())
      .nullable()
  })
  .strict()

export type FamilyInvitationExpirationPayload = Readonly<{
  cursor: string | null
}>

export type FamilyInvitationExpirationResult = Readonly<{
  expired: number
  nextCursor: string | null
}>

export function createFamilyInvitationExpirationJobHandler(
  connection: DatabaseConnection,
  now: () => Date = () => new Date()
): JobHandler {
  return async (payload: JsonValue) => {
    const parsed = familyInvitationExpirationPayloadSchema.safeParse(payload)
    if (!parsed.success) throw new Error('Invalid Family invitation expiration job payload')
    expirePendingFamilyInvitations(connection, parsed.data, now())
  }
}

export function createFamilyInvitationExpirationJobHandlers(
  connection: DatabaseConnection,
  now?: () => Date
): Record<typeof familyInvitationExpirationJobType, JobHandler> {
  return {
    [familyInvitationExpirationJobType]: createFamilyInvitationExpirationJobHandler(connection, now)
  }
}

/**
 * Better Auth 1.6.23 recognizes pending/accepted/rejected/canceled invitation
 * states, so expiry is represented by a guarded pending -> canceled update.
 * The page and its successor are committed together.
 */
export function expirePendingFamilyInvitations(
  connection: DatabaseConnection,
  payload: FamilyInvitationExpirationPayload,
  now = new Date()
): FamilyInvitationExpirationResult {
  return connection.sqlite
    .transaction(() => {
      const rows = connection.sqlite
        .prepare(
          `select id
           from invitation
           where status = 'pending'
             and expires_at <= ?
             and not (${frozenFamilyInvitationReservationSql})
             and (? is null or id > ?)
           order by id
           limit ?`
        )
        .all(
          now.getTime(),
          now.toISOString(),
          payload.cursor,
          payload.cursor,
          familyInvitationExpirationPageSize + 1
        ) as Array<{
        id: string
      }>
      const page = rows.slice(0, familyInvitationExpirationPageSize)

      let expired = 0
      for (const row of page) {
        expired += connection.sqlite
          .prepare(
            `update invitation
             set status = 'canceled'
             where id = ?
               and status = 'pending'
               and expires_at <= ?
               and not (${frozenFamilyInvitationReservationSql})`
          )
          .run(row.id, now.getTime(), now.toISOString()).changes
      }

      const nextCursor =
        rows.length > familyInvitationExpirationPageSize && page.length ? page[page.length - 1]!.id : null
      if (nextCursor) {
        enqueueFamilyInvitationExpiration(connection, { cursor: nextCursor }, now)
      }
      return { expired, nextCursor }
    })
    .immediate()
}

export function enqueueFamilyInvitationExpiration(
  connection: DatabaseConnection,
  payload: FamilyInvitationExpirationPayload = { cursor: null },
  now = new Date()
): boolean {
  const parsed = familyInvitationExpirationPayloadSchema.safeParse(payload)
  if (!parsed.success) throw new TypeError('Invalid Family invitation expiration job payload')
  const serialized = JSON.stringify(parsed.data)
  const inserted = connection.sqlite
    .prepare(
      `insert into job_queue (
         type, payload, max_attempts, run_after, created_at, updated_at
       )
       select ?, ?, ?, ?, ?, ?
       where not exists (
         select 1
         from job_queue
         where type = ?
           and status in ('queued', 'running')
           and json_valid(payload)
           and json_extract(payload, '$.cursor') is ?
           and json_remove(payload, '$.cursor') = '{}'
       )`
    )
    .run(
      familyInvitationExpirationJobType,
      serialized,
      familyInvitationExpirationMaxAttempts,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
      familyInvitationExpirationJobType,
      parsed.data.cursor
    )
  return inserted.changes === 1
}

/**
 * Worker integration can call this cheap safety scan before claiming jobs.
 * A completed root is intentionally not permanent dedupe: later invitations
 * can expire and require a new bounded pass.
 */
export function ensureFamilyInvitationExpirationJob(
  connection: DatabaseConnection,
  now = new Date()
): 'not-needed' | 'covered' | 'scheduled' {
  return connection.sqlite
    .transaction(() => {
      const expired = connection.sqlite
        .prepare(
          `select 1
           from invitation
           where status = 'pending'
             and expires_at <= ?
             and not (${frozenFamilyInvitationReservationSql})
           limit 1`
        )
        .get(now.getTime(), now.toISOString())
      if (!expired) return 'not-needed' as const

      const covered = connection.sqlite
        .prepare(
          `select 1
           from job_queue
           where type = ?
             and status in ('queued', 'running')
           limit 1`
        )
        .get(familyInvitationExpirationJobType)
      if (covered) return 'covered' as const

      enqueueFamilyInvitationExpiration(connection, { cursor: null }, now)
      return 'scheduled' as const
    })
    .immediate()
}
