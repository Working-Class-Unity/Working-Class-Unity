import { createServer, type Server } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, toNodeListener, type EventHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseMocks = vi.hoisted(() => ({ useDatabase: vi.fn() }))
const emailMocks = vi.hoisted(() => ({ getTransactionalEmailSender: vi.fn() }))
const familyMembershipMocks = vi.hoisted(() => ({ leaveJoinedFamily: vi.fn() }))
const moduleMocks = vi.hoisted(() => ({ requireModuleReady: vi.fn() }))
const invitationMocks = vi.hoisted(() => ({
  acceptWorkspaceInvitation: vi.fn(),
  cancelWorkspaceInvitation: vi.fn(),
  getWorkspaceInvitationForRecipient: vi.fn(),
  listWorkspaceInvitationSummaries: vi.fn(),
  rejectWorkspaceInvitation: vi.fn(),
  resendWorkspaceInvitation: vi.fn(),
  sendWorkspaceInvitation: vi.fn()
}))
const sessionMocks = vi.hoisted(() => ({
  getBetterAuthRequestHeaders: vi.fn(),
  requireSession: vi.fn()
}))
const runtimeMocks = vi.hoisted(() => ({ getAppRuntimeConfig: vi.fn() }))
const stripeMocks = vi.hoisted(() => ({ getStripeClient: vi.fn() }))
const authApi = Object.freeze({ test: 'auth-api' })

vi.mock('../server/db/client', () => databaseMocks)
vi.mock('../server/services/email', () => emailMocks)
vi.mock('../server/services/family-membership', () => familyMembershipMocks)
vi.mock('../server/services/payments/stripe-client', () => stripeMocks)
vi.mock('../server/services/workspace-invitations', () => invitationMocks)
vi.mock('../server/utils/auth', () => ({ auth: { api: authApi } }))
vi.mock('../server/utils/auth/require-session', () => sessionMocks)
vi.mock('../server/utils/module-state', () => moduleMocks)
vi.mock('../server/utils/runtime', () => runtimeMocks)

const connection = Object.freeze({ test: 'database' })
const sender = Object.freeze({ send: vi.fn() })
const stripe = Object.freeze({ test: 'stripe-client' })
const headers = new Headers({ cookie: 'better-auth.session_token=test' })
const session = Object.freeze({
  user: { id: 'user-owner', email: 'owner@example.test', emailVerified: true },
  session: { activeOrganizationId: 'joined-organization' }
})

let server: Server
let baseUrl: string

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', defineEventHandler)
  const [invitePost, inviteList, resend, cancel, recipientGet, accept, reject, leaveFamily] = await Promise.all([
    import('../server/api/invitations/index.post').then((module) => module.default),
    import('../server/api/invitations/index.get').then((module) => module.default),
    import('../server/api/invitations/[invitationId]/resend.post').then((module) => module.default),
    import('../server/api/invitations/[invitationId]/cancel.post').then((module) => module.default),
    import('../server/api/invitations/[invitationId].get').then((module) => module.default),
    import('../server/api/invitations/[invitationId]/accept.post').then((module) => module.default),
    import('../server/api/invitations/[invitationId]/reject.post').then((module) => module.default),
    import('../server/api/account/family/leave.post').then((module) => module.default)
  ])
  const router = createRouter()
    .post('/api/invitations', invitePost as EventHandler)
    .get('/api/invitations', inviteList as EventHandler)
    .post('/api/invitations/:invitationId/resend', resend as EventHandler)
    .post('/api/invitations/:invitationId/cancel', cancel as EventHandler)
    .get('/api/invitations/:invitationId', recipientGet as EventHandler)
    .post('/api/invitations/:invitationId/accept', accept as EventHandler)
    .post('/api/invitations/:invitationId/reject', reject as EventHandler)
    .post('/api/account/family/leave', leaveFamily as EventHandler)
  server = createServer(toNodeListener(createApp().use(router)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new TypeError('Expected a TCP test address')
  baseUrl = `http://127.0.0.1:${address.port}`
})

beforeEach(() => {
  vi.clearAllMocks()
  moduleMocks.requireModuleReady.mockReset()
  databaseMocks.useDatabase.mockReturnValue(connection)
  emailMocks.getTransactionalEmailSender.mockReturnValue(sender)
  stripeMocks.getStripeClient.mockReturnValue(stripe)
  runtimeMocks.getAppRuntimeConfig.mockReturnValue({
    public: { appName: 'Baseline App', appUrl: 'https://app.example.test' }
  })
  sessionMocks.getBetterAuthRequestHeaders.mockReturnValue(headers)
  sessionMocks.requireSession.mockResolvedValue(session)
  invitationMocks.sendWorkspaceInvitation.mockResolvedValue({ status: 'sent' })
  invitationMocks.resendWorkspaceInvitation.mockResolvedValue({ status: 'resent' })
  invitationMocks.listWorkspaceInvitationSummaries.mockReturnValue([{ id: 'Invite_123' }])
  invitationMocks.getWorkspaceInvitationForRecipient.mockResolvedValue({
    workspace: { name: 'Shared Home' },
    expiresAt: '2026-07-13T00:00:00.000Z'
  })
  invitationMocks.acceptWorkspaceInvitation.mockResolvedValue({
    status: 'accepted',
    location: '/app'
  })
  invitationMocks.rejectWorkspaceInvitation.mockResolvedValue({ status: 'rejected' })
  invitationMocks.cancelWorkspaceInvitation.mockResolvedValue({ status: 'canceled' })
  familyMembershipMocks.leaveJoinedFamily.mockResolvedValue({ status: 'left' })
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('family-plan invitation HTTP boundaries', () => {
  it('authenticates and derives the marker-owned family plan from the session user', async () => {
    const response = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: '  Person@Example.TEST  ' })
    })

    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ status: 'sent' })
    expect(invitationMocks.sendWorkspaceInvitation).toHaveBeenCalledWith(
      { api: authApi, connection, headers },
      {
        ownerUserId: session.user.id,
        email: 'person@example.test',
        appName: 'Baseline App',
        appUrl: 'https://app.example.test',
        sender
      }
    )
  })

  it('authenticates before validation, rejects scope/role injection, and preserves generic delivery failure', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const unauthenticated = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    })
    expect(unauthenticated.status).toBe(401)
    expect(moduleMocks.requireModuleReady).not.toHaveBeenCalled()
    expect(invitationMocks.sendWorkspaceInvitation).not.toHaveBeenCalled()

    for (const injected of [
      { role: 'admin' },
      { organizationId: 'joined-organization' },
      { workspaceSlug: 'joined-workspace' },
      { resend: true }
    ]) {
      const rejected = await fetch(`${baseUrl}/api/invitations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'private@example.test', ...injected })
      })
      expect(rejected.status).toBe(400)
    }
    expect(invitationMocks.sendWorkspaceInvitation).not.toHaveBeenCalled()

    invitationMocks.sendWorkspaceInvitation.mockRejectedValueOnce(
      createError({ statusCode: 503, statusMessage: 'Invitation delivery is temporarily unavailable' })
    )
    const failed = await fetch(`${baseUrl}/api/invitations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'private@example.test' })
    })
    const failedBody = await failed.text()
    expect(failed.status).toBe(503)
    expect(failedBody).toContain('Invitation delivery is temporarily unavailable')
    expect(failedBody).not.toMatch(/private@example|joined-organization|smtp|capture/i)
  })

  it('checks the Billing module before create input, resend parameters, or accept Stripe setup', async () => {
    moduleMocks.requireModuleReady.mockImplementation(() => {
      throw createError({ statusCode: 404, statusMessage: 'Module disabled' })
    })

    const [created, resent, accepted] = await Promise.all([
      fetch(`${baseUrl}/api/invitations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{'
      }),
      fetch(`${baseUrl}/api/invitations/%20invalid%20/resend`, { method: 'POST' }),
      fetch(`${baseUrl}/api/invitations/%20invalid%20/accept`, { method: 'POST' })
    ])

    expect([created.status, resent.status, accepted.status]).toEqual([404, 404, 404])
    expect(moduleMocks.requireModuleReady).toHaveBeenCalledTimes(3)
    expect(moduleMocks.requireModuleReady).toHaveBeenCalledWith('billing')
    expect(stripeMocks.getStripeClient).not.toHaveBeenCalled()
    expect(invitationMocks.sendWorkspaceInvitation).not.toHaveBeenCalled()
    expect(invitationMocks.resendWorkspaceInvitation).not.toHaveBeenCalled()
    expect(invitationMocks.acceptWorkspaceInvitation).not.toHaveBeenCalled()
  })

  it('returns only the owner pending-invitation projection and no accepted-member directory', async () => {
    const invitationsResponse = await fetch(`${baseUrl}/api/invitations`)
    const membersResponse = await fetch(`${baseUrl}/api/workspaces/workspace-opaque/members`)

    expect(invitationsResponse.status).toBe(200)
    expect(membersResponse.status).toBe(404)
    expect(invitationsResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(await invitationsResponse.json()).toEqual({ invitations: [{ id: 'Invite_123' }] })
    expect(invitationMocks.listWorkspaceInvitationSummaries).toHaveBeenCalledWith({ connection }, session.user.id)
  })

  it('authenticates recipient GET before validating an opaque route ID and returns a private projection', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await fetch(`${baseUrl}/api/invitations/%20invalid%20`)
    expect(anonymous.status).toBe(401)
    expect(invitationMocks.getWorkspaceInvitationForRecipient).not.toHaveBeenCalled()

    const invalid = await fetch(`${baseUrl}/api/invitations/%20invalid%20`)
    expect(invalid.status).toBe(400)
    expect(invitationMocks.getWorkspaceInvitationForRecipient).not.toHaveBeenCalled()

    const response = await fetch(`${baseUrl}/api/invitations/Invite_123`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({
      invitation: {
        workspace: { name: 'Shared Home' },
        expiresAt: '2026-07-13T00:00:00.000Z'
      }
    })
  })

  it('uses explicit POST commands for accept and reject and passes the authenticated user to acceptance', async () => {
    const [accepted, rejected] = await Promise.all([
      fetch(`${baseUrl}/api/invitations/Invite_123/accept`, { method: 'POST' }),
      fetch(`${baseUrl}/api/invitations/Invite_456/reject`, { method: 'POST' })
    ])

    expect(accepted.status).toBe(200)
    expect(rejected.status).toBe(200)
    expect(await accepted.json()).toEqual({ status: 'accepted', location: '/app' })
    expect(await rejected.json()).toEqual({ status: 'rejected' })
    expect(invitationMocks.acceptWorkspaceInvitation).toHaveBeenCalledWith(
      { api: authApi, connection, headers, stripe },
      'Invite_123',
      session.user.id
    )
    expect(invitationMocks.rejectWorkspaceInvitation).toHaveBeenCalledWith(
      { api: authApi, connection, headers },
      'Invite_456',
      session.user.id
    )
  })

  it('binds resend and cancellation to the authenticated marker owner and opaque invitation ID', async () => {
    const [resent, canceled] = await Promise.all([
      fetch(`${baseUrl}/api/invitations/Invite_123/resend`, { method: 'POST' }),
      fetch(`${baseUrl}/api/invitations/Invite_456/cancel`, { method: 'POST' })
    ])

    expect(resent.status).toBe(200)
    expect(canceled.status).toBe(200)
    expect(await resent.json()).toEqual({ status: 'resent' })
    expect(await canceled.json()).toEqual({ status: 'canceled' })
    expect(invitationMocks.resendWorkspaceInvitation).toHaveBeenCalledWith(
      { api: authApi, connection, headers },
      {
        ownerUserId: session.user.id,
        invitationId: 'Invite_123',
        appName: 'Baseline App',
        appUrl: 'https://app.example.test',
        sender
      }
    )
    expect(invitationMocks.cancelWorkspaceInvitation).toHaveBeenCalledWith(
      { api: authApi, connection, headers },
      session.user.id,
      'Invite_456'
    )
  })

  it('authenticates family self-leave before strict empty-body validation and derives scope from the session', async () => {
    sessionMocks.requireSession.mockRejectedValueOnce(
      createError({ statusCode: 401, statusMessage: 'Authentication required' })
    )
    const anonymous = await fetch(`${baseUrl}/api/account/family/leave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    })
    expect(anonymous.status).toBe(401)
    expect(familyMembershipMocks.leaveJoinedFamily).not.toHaveBeenCalled()

    const injected = await fetch(`${baseUrl}/api/account/family/leave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: 'client-selected-family' })
    })
    expect(injected.status).toBe(400)
    expect(familyMembershipMocks.leaveJoinedFamily).not.toHaveBeenCalled()

    const response = await fetch(`${baseUrl}/api/account/family/leave`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ status: 'left' })
    expect(familyMembershipMocks.leaveJoinedFamily).toHaveBeenCalledWith({ connection }, session.user.id)
  })
})
