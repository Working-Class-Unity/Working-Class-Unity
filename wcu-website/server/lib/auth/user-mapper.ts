import type { RecordModel } from 'pocketbase'

import type { Role, SessionUser } from '~~/shared/types/auth'

const ROLES = new Set<Role>(['member', 'organizer', 'treasurer', 'admin'])

const normalizeRole = (value: unknown): Role => {
  if (typeof value === 'string' && ROLES.has(value as Role)) {
    return value as Role
  }

  return 'member'
}

const normalizeDateValue = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }

  return value
}

export function mapPocketBaseUserRecordToSession(record: RecordModel): SessionUser {
  const config = useRuntimeConfig()

  const roleField = config.pocketbaseUserRoleField || 'role'
  const duesField = config.pocketbaseUserDuesPaidThroughField || 'duesPaidThrough'

  const email = typeof record.email === 'string' ? record.email : ''
  const role = normalizeRole(record[roleField])
  const duesPaidThrough = normalizeDateValue(
    record[duesField]
    ?? record.duesPaidThrough
    ?? record.dues_paid_through
  )

  return {
    userId: record.id,
    email,
    role,
    duesPaidThrough,
  }
}
