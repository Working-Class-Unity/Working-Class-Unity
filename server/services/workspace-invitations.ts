import { invitationLocation } from '../../shared/invitation-path'
import type { DatabaseConnection } from '../db/connect'
import {
  assertCanOperatePersonalFamily,
  FamilyAuthorityConflictError,
  FamilyAuthorityInvariantError,
  FamilyManagerBillingConflictError,
  requireCurrentFamilyManagerAuthority
} from '../db/repositories/family-authority'
import {
  compareAndSetPendingWorkspaceInvitationStatus,
  createPendingWorkspaceInvitation,
  getPendingWorkspaceInvitation,
  listPendingWorkspaceInvitationProjections,
  refreshPendingWorkspaceInvitation,
  type ManagedWorkspaceInvitation
} from '../db/repositories/workspace-invitations'
import { getPersonalWorkspaceForUser } from '../db/repositories/workspaces'
import { createWorkspaceInvitationEmail, type TransactionalEmailSender } from './email'
import { configurationError, conflictError, forbiddenError, notFoundError, upstreamServiceError } from '../utils/errors'
import type { auth as configuredAuth } from '../utils/auth'
import { joinFamilyFromInvitation, type FamilyJoinStripeClient } from './family-join'

export type WorkspaceInvitationAuthApi = Pick<typeof configuredAuth.api, 'getInvitation' | 'acceptInvitation'>

export type WorkspaceInvitationServiceContext = Readonly<{
  api: WorkspaceInvitationAuthApi
  connection: DatabaseConnection
  headers: Headers
  stripe?: FamilyJoinStripeClient
}>

const workspaceInvitationTerminalTails = new Map<string, Promise<void>>()

export async function sendWorkspaceInvitation(
  context: WorkspaceInvitationServiceContext,
  input: Readonly<{
    ownerUserId: string
    email: string
    appName: string
    appUrl: string
    sender: TransactionalEmailSender
  }>
) {
  let invitation: ManagedWorkspaceInvitation

  try {
    invitation = withImmediateWorkspaceTransaction(context.connection, () => {
      const workspace = getCurrentOwnedFamilyPlan(context.connection, input.ownerUserId)
      const created = createPendingWorkspaceInvitation(context.connection, {
        email: input.email,
        inviterId: input.ownerUserId,
        organizationId: workspace.id
      })
      if (!created) throw conflictError('Invitation cannot be created')
      return created
    })
  } catch (error) {
    mapManagerInvitationError(error)
  }

  const workspace = getOwnedFamilyPlan(context.connection, input.ownerUserId)
  await deliverWorkspaceInvitation(invitation, { ...input, workspaceName: workspace.name })

  return Object.freeze({ status: 'sent' as const })
}

export async function resendWorkspaceInvitation(
  context: WorkspaceInvitationServiceContext,
  input: Readonly<{
    ownerUserId: string
    invitationId: string
    appName: string
    appUrl: string
    sender: TransactionalEmailSender
  }>
) {
  return withWorkspaceInvitationTerminalLock(input.invitationId, async () => {
    let invitation: ManagedWorkspaceInvitation
    try {
      invitation = withImmediateWorkspaceTransaction(context.connection, () => {
        const workspace = getCurrentOwnedFamilyPlan(context.connection, input.ownerUserId)
        const pending = getPendingWorkspaceInvitation(context.connection, workspace.id, input.invitationId)
        if (!pending || pending.role !== 'member' || pending.expiresAt.getTime() <= Date.now()) {
          throw notFoundError('Invitation not found')
        }

        const resent = refreshPendingWorkspaceInvitation(context.connection, {
          id: pending.id,
          email: pending.email.trim().toLowerCase(),
          expiresAt: pending.expiresAt,
          organizationId: pending.organizationId,
          role: 'member',
          status: 'pending'
        })
        if (!resent) throw notFoundError('Invitation not found')
        return resent
      })
    } catch (error) {
      mapManagerInvitationError(error)
    }

    const workspace = getOwnedFamilyPlan(context.connection, input.ownerUserId)
    await deliverWorkspaceInvitation(invitation, { ...input, workspaceName: workspace.name })
    return Object.freeze({ status: 'resent' as const })
  })
}

export function listWorkspaceInvitationSummaries(
  context: Pick<WorkspaceInvitationServiceContext, 'connection'>,
  ownerUserId: string
) {
  const workspace = getOwnedFamilyPlan(context.connection, ownerUserId)
  return listPendingWorkspaceInvitationProjections(context.connection, workspace.id).map((item) => ({
    id: item.id,
    email: item.email,
    expiresAt: item.expiresAt.toISOString()
  }))
}

export async function cancelWorkspaceInvitation(
  context: WorkspaceInvitationServiceContext,
  ownerUserId: string,
  invitationId: string
) {
  return withWorkspaceInvitationTerminalLock(invitationId, async () => {
    return withImmediateWorkspaceTransaction(context.connection, () => {
      const workspace = getOwnedFamilyPlan(context.connection, ownerUserId)
      if (
        !compareAndSetPendingWorkspaceInvitationStatus(context.connection, {
          invitationId,
          organizationId: workspace.id,
          status: 'canceled'
        })
      ) {
        throw notFoundError('Invitation not found')
      }

      return Object.freeze({ status: 'canceled' as const })
    })
  })
}

export async function getWorkspaceInvitationForRecipient(
  context: WorkspaceInvitationServiceContext,
  invitationId: string
) {
  try {
    const invitation = await context.api.getInvitation({
      headers: context.headers,
      query: { id: invitationId }
    })
    requireMemberInvitationRole(invitation.role)

    return Object.freeze({
      workspace: Object.freeze({ name: invitation.organizationName }),
      expiresAt: toIsoString(invitation.expiresAt)
    })
  } catch {
    throw notFoundError('Invitation not found')
  }
}

export async function acceptWorkspaceInvitation(
  context: WorkspaceInvitationServiceContext,
  invitationId: string,
  userId: string
) {
  return withWorkspaceInvitationTerminalLock(invitationId, async () => {
    return joinFamilyFromInvitation(
      {
        api: context.api,
        connection: context.connection,
        headers: context.headers,
        stripe: context.stripe ?? unavailableFamilyJoinStripeClient
      },
      invitationId,
      userId
    )
  })
}

export async function rejectWorkspaceInvitation(
  context: WorkspaceInvitationServiceContext,
  invitationId: string,
  recipientUserId: string
) {
  return withWorkspaceInvitationTerminalLock(invitationId, async () => {
    return withImmediateWorkspaceTransaction(context.connection, () => {
      const authority = getWorkspaceInvitationRecipientAuthority(context.connection, invitationId, recipientUserId)
      if (
        !authority ||
        !compareAndSetPendingWorkspaceInvitationStatus(context.connection, {
          expectedEmail: authority.email,
          invitationId,
          organizationId: authority.organizationId,
          status: 'rejected'
        })
      ) {
        throw notFoundError('Invitation not found')
      }

      return Object.freeze({ status: 'rejected' as const })
    })
  })
}

function getWorkspaceInvitationRecipientAuthority(
  connection: DatabaseConnection,
  invitationId: string,
  recipientUserId: string
) {
  return (
    (connection.sqlite
      .prepare(
        `select invitation.organization_id as organizationId,
                user.email as email
         from invitation
         inner join user on lower(user.email) = lower(invitation.email)
         where invitation.id = ?
           and invitation.status = 'pending'
           and user.id = ?
           and user.email_verified = 1`
      )
      .get(invitationId, recipientUserId) as
      | {
          organizationId: string
          email: string
        }
      | undefined) ?? null
  )
}

async function withWorkspaceInvitationTerminalLock<T>(invitationId: string, action: () => Promise<T>): Promise<T> {
  const predecessor = workspaceInvitationTerminalTails.get(invitationId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = predecessor.then(() => current)
  workspaceInvitationTerminalTails.set(invitationId, tail)

  await predecessor
  try {
    return await action()
  } finally {
    release()
    if (workspaceInvitationTerminalTails.get(invitationId) === tail) {
      workspaceInvitationTerminalTails.delete(invitationId)
    }
  }
}

function mapManagerInvitationError(error: unknown): never {
  if (error instanceof FamilyManagerBillingConflictError) {
    throw conflictError('Family invitations require current billing')
  }

  if (isHttpError(error)) throw error

  if (isSqliteConstraintError(error)) {
    throw conflictError('Invitation cannot be created')
  }

  throw upstreamServiceError(503, 'Invitation service is temporarily unavailable')
}

function getCurrentOwnedFamilyPlan(connection: DatabaseConnection, ownerUserId: string) {
  const workspace = getOwnedFamilyPlan(connection, ownerUserId)
  const authority = requireCurrentFamilyManagerAuthority(connection, ownerUserId)
  if (authority.organizationId !== workspace.id) {
    throw new FamilyAuthorityInvariantError('Family plan owner does not match billing authority')
  }
  return workspace
}

function getOwnedFamilyPlan(connection: DatabaseConnection, ownerUserId: string) {
  try {
    assertCanOperatePersonalFamily(connection, ownerUserId)
  } catch (error) {
    if (error instanceof FamilyAuthorityConflictError) {
      throw forbiddenError('Family management is unavailable while sharing another plan')
    }
    if (error instanceof FamilyAuthorityInvariantError) {
      throw configurationError('Family plan is temporarily unavailable')
    }
    throw error
  }

  const workspace = getPersonalWorkspaceForUser(connection, ownerUserId)
  if (!workspace || workspace.role !== 'owner') {
    throw configurationError('Family plan is temporarily unavailable')
  }

  return workspace
}

async function deliverWorkspaceInvitation(
  invitation: ManagedWorkspaceInvitation,
  input: Readonly<{
    appName: string
    appUrl: string
    sender: TransactionalEmailSender
    workspaceName: string
  }>
) {
  try {
    const url = new URL(invitationLocation(invitation.id), input.appUrl).toString()
    await input.sender.send(
      createWorkspaceInvitationEmail({
        to: invitation.email,
        url,
        appName: input.appName,
        workspaceName: input.workspaceName
      })
    )
  } catch {
    // The pending invitation remains durable. The explicit ID-bound resend
    // reuses it under the same terminal-operation lock.
    throw upstreamServiceError(503, 'Invitation delivery is temporarily unavailable')
  }
}

function requireMemberInvitationRole(value: unknown): asserts value is 'member' {
  if (value !== 'member') {
    throw notFoundError('Invitation not found')
  }
}

function toIsoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw notFoundError('Invitation not found')
  return date.toISOString()
}

function isSqliteConstraintError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && String(error.code).startsWith('SQLITE_CONSTRAINT')
}

function isHttpError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
}

function withImmediateWorkspaceTransaction<T>(connection: DatabaseConnection, action: () => T): T {
  return connection.sqlite.transaction(action).immediate()
}

const unavailableFamilyJoinStripeClient: FamilyJoinStripeClient = {
  subscriptions: {
    async retrieve() {
      throw new Error('Stripe Family-join client is unavailable')
    },
    async update() {
      throw new Error('Stripe Family-join client is unavailable')
    }
  } as FamilyJoinStripeClient['subscriptions']
}
