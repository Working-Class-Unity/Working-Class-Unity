import { expect } from '@playwright/test'

const invitationId = 'Browser_invite-123'
const invitationPath = `/invite/${invitationId}`
const invitationApi = `/api/invitations/${invitationId}`

export async function assertWorkspaceInvitationJourney(context, helpers) {
  await assertSignedOutReturn(context, helpers)
  await assertExplicitReject(context, helpers)
  await assertExplicitAccept(context, helpers)
  await assertSafeActionError(context, helpers)
}

async function assertSignedOutReturn(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  let magicLinkBody
  let socialBody

  try {
    await page.route('**/api/auth/get-session', (route) => helpers.fulfillJson(route, null))
    await page.route('**/api/baseline', (route) => helpers.fulfillJson(route, { socialProviders: { google: 'ready' } }))
    await page.route('**/api/auth/sign-in/magic-link', async (route) => {
      magicLinkBody = route.request().postDataJSON()
      await helpers.fulfillJson(route, { status: true })
    })
    await page.route('**/api/auth/sign-in/social', async (route) => {
      socialBody = route.request().postDataJSON()
      await helpers.fulfillJson(route, { redirect: false, url: null })
    })

    const response = await page.goto(invitationPath)
    expect(response?.headers()['cache-control']).toBe('private, no-store')
    expect(response?.headers()['referrer-policy']).toBe('no-referrer')
    await expect(page.getByRole('heading', { name: 'Workspace invitation' })).toBeVisible()
    expect(observations.sameOriginRequests.filter((request) => request.includes('/api/invitations'))).toEqual([])
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    const signInLink = page.getByRole('link', { name: 'Sign in to continue' })
    await signInLink.focus()
    await expect(signInLink).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe(invitationPath)

    const email = page.getByRole('textbox', { name: 'Email', exact: true })
    await email.fill('browser.invited@example.test')
    await page.getByRole('button', { name: 'Send email link' }).click()
    await expect
      .poll(() => magicLinkBody)
      .toEqual({
        email: 'browser.invited@example.test',
        callbackURL: invitationPath,
        newUserCallbackURL: invitationPath,
        errorCallbackURL: '/login'
      })
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await expect
      .poll(() => socialBody)
      .toEqual({
        provider: 'google',
        callbackURL: invitationPath,
        newUserCallbackURL: invitationPath,
        errorCallbackURL: '/login'
      })
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertExplicitReject(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const commands = []

  try {
    await installSignedInInvitationRoutes(page, helpers, commands)
    await page.goto(invitationPath)
    await expect(page.getByText('Shared Home', { exact: true })).toBeVisible()
    expect(
      observations.sameOriginRequests.filter((request) => request.startsWith('GET ') && request.endsWith(invitationApi))
    ).toHaveLength(1)
    expect(commands).toEqual([])
    const decline = page.getByRole('button', { name: 'Decline invitation' })
    await decline.focus()
    await expect(decline).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByText('Invitation declined', { exact: true })).toBeVisible()
    expect(commands).toEqual([`POST ${invitationApi}/reject`])
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertExplicitAccept(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const commands = []

  try {
    await installSignedInInvitationRoutes(page, helpers, commands)
    await page.goto(invitationPath)
    const accept = page.getByRole('button', { name: 'Accept invitation' })
    await accept.focus()
    await expect(accept).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/app$/)
    await expect(page.getByText('Your private app is ready.', { exact: true })).toBeVisible()
    await expect(page.getByText('Signed in as browser.invited@example.test', { exact: true })).toBeVisible()
    await expect(page.getByText(/workspace/i)).toHaveCount(0)
    expect(commands).toEqual([`POST ${invitationApi}/accept`])
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/workspaces'))).toBe(false)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertSafeActionError(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const commands = []

  try {
    await installSignedInInvitationRoutes(page, helpers, commands, true)
    await page.goto(invitationPath)
    await page.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(page.getByRole('alert')).toHaveText('This invitation is no longer available.')
    expect(commands).toEqual([`POST ${invitationApi}/accept`])
    const expectedResponses = observations.errorResponses.filter(
      (entry) => entry.includes(`POST 404`) && entry.includes(`${invitationApi}/accept`)
    )
    expect(expectedResponses).toHaveLength(1)
    observations.errorResponses = observations.errorResponses.filter((entry) => !expectedResponses.includes(entry))
    observations.console = observations.console.filter((entry) => !/Failed to load resource.*404/.test(entry))
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function installSignedInInvitationRoutes(page, helpers, commands, failAccept = false) {
  const now = new Date().toISOString()
  await page.route('**/api/auth/get-session', (route) =>
    helpers.fulfillJson(route, {
      session: {
        id: 'browser-invitation-session',
        token: 'browser-invitation-token',
        userId: 'browser-invitation-user',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: null
      },
      user: {
        id: 'browser-invitation-user',
        name: 'Browser Invitee',
        email: 'browser.invited@example.test',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now
      }
    })
  )
  await page.route('**/api/me', (route) =>
    helpers.fulfillJson(route, {
      user: {
        id: 'browser-invitation-user',
        name: 'Browser Invitee',
        email: 'browser.invited@example.test',
        image: null
      },
      modules: {
        ai: 'disabled',
        billing: 'disabled',
        files: 'disabled',
        jobs: 'disabled',
        observability: 'disabled',
        turnstile: 'disabled'
      }
    })
  )
  await page.route(`**${invitationApi}`, (route) =>
    helpers.fulfillJson(route, {
      invitation: {
        workspace: { name: 'Shared Home' },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
      }
    })
  )
  await page.route(`**${invitationApi}/accept`, async (route) => {
    commands.push(`${route.request().method()} ${invitationApi}/accept`)
    if (failAccept) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ statusMessage: 'Invitation not found' })
      })
      return
    }
    await helpers.fulfillJson(route, { status: 'accepted', location: '/app' })
  })
  await page.route(`**${invitationApi}/reject`, async (route) => {
    commands.push(`${route.request().method()} ${invitationApi}/reject`)
    await helpers.fulfillJson(route, { status: 'rejected' })
  })
}
