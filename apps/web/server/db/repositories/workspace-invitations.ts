import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { DatabaseConnection } from '../connect'
import { invitation } from '../schema'
import { frozenFamilyInvitationReservationSql } from './family-invitation-reservation'

// Better Auth's pinned default invitation and membership caps are both 100.
// The complete configured set therefore remains bounded without pagination.
const workspacePeopleProjectionLimit = 100

export type WorkspaceInvitationProjection = Readonly<{
  id: string
  email: string
  expiresAt: Date
}>

export type ManagedWorkspaceInvitation = Readonly<{
  id: string
  email: string
  expiresAt: Date
  organizationId: string
  role: 'member'
  status: 'pending'
}>

const workspaceInvitationLifetimeMs = 48 * 60 * 60 * 1_000

export function createPendingWorkspaceInvitation(
  connection: DatabaseConnection,
  input: Readonly<{
    email: string
    inviterId: string
    organizationId: string
    now?: Date
  }>
): ManagedWorkspaceInvitation | null {
  if (!connection.sqlite.inTransaction) {
    throw new Error('Workspace invitation creation requires an active transaction')
  }

  const now = input.now ?? new Date()
  const email = input.email.trim().toLowerCase()
  const unavailable = connection.sqlite
    .prepare(
      `select 1
       from member
       inner join user on user.id = member.user_id
       where member.organization_id = ?
         and lower(trim(user.email)) = ?
       union all
       select 1
       from invitation
       where invitation.organization_id = ?
         and lower(trim(invitation.email)) = ?
         and invitation.status = 'pending'
         and invitation.expires_at > ?
       limit 1`
    )
    .get(input.organizationId, email, input.organizationId, email, now.getTime())
  if (unavailable) return null

  const created: ManagedWorkspaceInvitation = {
    id: randomUUID(),
    email,
    expiresAt: new Date(now.getTime() + workspaceInvitationLifetimeMs),
    organizationId: input.organizationId,
    role: 'member',
    status: 'pending'
  }
  connection.sqlite
    .prepare(
      `insert into invitation (
         id, organization_id, email, role, status, expires_at, created_at, inviter_id
       ) values (?, ?, ?, 'member', 'pending', ?, ?, ?)`
    )
    .run(created.id, created.organizationId, created.email, created.expiresAt.getTime(), now.getTime(), input.inviterId)
  return created
}

export function refreshPendingWorkspaceInvitation(
  connection: DatabaseConnection,
  invitation: ManagedWorkspaceInvitation,
  now = new Date()
): ManagedWorkspaceInvitation | null {
  if (!connection.sqlite.inTransaction) {
    throw new Error('Workspace invitation resend requires an active transaction')
  }

  const expiresAt = new Date(now.getTime() + workspaceInvitationLifetimeMs)
  const updated = connection.sqlite
    .prepare(
      `update invitation
       set expires_at = ?
       where id = ?
         and organization_id = ?
         and lower(trim(email)) = ?
         and role = 'member'
         and status = 'pending'
         and expires_at > ?`
    )
    .run(expiresAt.getTime(), invitation.id, invitation.organizationId, invitation.email, now.getTime())
  if (updated.changes !== 1) return null
  return { ...invitation, expiresAt }
}

export function compareAndSetPendingWorkspaceInvitationStatus(
  connection: DatabaseConnection,
  input: Readonly<{
    expectedEmail?: string
    invitationId: string
    organizationId: string
    status: 'canceled' | 'rejected'
  }>
): boolean {
  if (!connection.sqlite.inTransaction) {
    throw new Error('Workspace invitation terminal transition requires an active transaction')
  }

  const updated =
    input.expectedEmail !== undefined
      ? connection.sqlite
          .prepare(
            `update invitation
           set status = ?
           where id = ?
             and organization_id = ?
             and status = 'pending'
             and lower(email) = lower(?)`
          )
          .run(input.status, input.invitationId, input.organizationId, input.expectedEmail)
      : connection.sqlite
          .prepare(
            `update invitation
           set status = ?
           where id = ?
             and organization_id = ?
             and status = 'pending'`
          )
          .run(input.status, input.invitationId, input.organizationId)
  return updated.changes === 1
}

export function listPendingWorkspaceInvitationProjections(
  connection: DatabaseConnection,
  organizationId: string,
  now = new Date()
): WorkspaceInvitationProjection[] {
  const rows = connection.sqlite
    .prepare(
      `select id, email, expires_at as expiresAt
       from invitation
       where organization_id = ?
         and status = 'pending'
         and (expires_at > ? or ${frozenFamilyInvitationReservationSql})
       order by created_at desc, id
       limit ?`
    )
    .all(organizationId, now.getTime(), now.toISOString(), workspacePeopleProjectionLimit) as Array<{
    id: string
    email: string
    expiresAt: number
  }>

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    expiresAt: new Date(row.expiresAt)
  }))
}

export function getPendingWorkspaceInvitation(
  connection: DatabaseConnection,
  organizationId: string,
  invitationId: string
) {
  return (
    connection.db
      .select({
        id: invitation.id,
        email: invitation.email,
        expiresAt: invitation.expiresAt,
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: invitation.status
      })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, invitationId),
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, 'pending')
        )
      )
      .get() ?? null
  )
}
