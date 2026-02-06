import type { H3Event } from 'h3'

import type { Role, SessionUser } from '~~/shared/types/auth'
import { requireSession } from './session'

const ROLE_PRIORITY: Record<Role, number> = {
  member: 1,
  organizer: 2,
  treasurer: 3,
  admin: 4,
}

const DUES_GRACE_DAYS = 60

export function hasMinimumRole(currentRole: Role, requiredRole: Role): boolean {
  return ROLE_PRIORITY[currentRole] >= ROLE_PRIORITY[requiredRole]
}

export function assertMinimumRole(event: H3Event, requiredRole: Role): SessionUser {
  const session = requireSession(event)

  if (!hasMinimumRole(session.role, requiredRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Insufficient role permissions',
    })
  }

  return session
}

export function isDuesCurrent(session: SessionUser, now = new Date()): boolean {
  if (!session.duesPaidThrough) return false

  const paidThroughDate = new Date(session.duesPaidThrough)
  if (Number.isNaN(paidThroughDate.getTime())) return false

  const graceCutoff = new Date(paidThroughDate)
  graceCutoff.setDate(graceCutoff.getDate() + DUES_GRACE_DAYS)

  return now <= graceCutoff
}

export function assertDuesCurrent(event: H3Event): SessionUser {
  const session = requireSession(event)

  if (!isDuesCurrent(session)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Dues are not current',
    })
  }

  return session
}
