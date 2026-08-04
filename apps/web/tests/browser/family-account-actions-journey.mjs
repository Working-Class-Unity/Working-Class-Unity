import { expect } from '@playwright/test'

const joinedFamilyPlanId = 'joined-family-plan-must-not-select-authority'
const acceptedMemberReference = 'opaque-member-reference-must-not-render'
const memberPrivacyCanaries = [
  acceptedMemberReference,
  'private-member-user-id',
  'private-member-role',
  'private-member-joined-at',
  'cus_private_manager',
  'sub_private_manager'
]
const acceptedMember = {
  reference: acceptedMemberReference,
  name: 'Accepted Family Member',
  email: 'accepted.member@example.test',
  userId: memberPrivacyCanaries[1],
  role: memberPrivacyCanaries[2],
  joinedAt: memberPrivacyCanaries[3]
}
const initialInvitation = {
  id: 'Browser_pending-invitation-1',
  email: 'pending.person.with.a.long.address@example.test',
  expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
}

export async function assertFamilyAccountActionsJourney(context, helpers) {
  await assertOwnerInvitationControls(context, helpers)
  await assertInvitationControlsRecoverWithoutRoleState(context, helpers)
  await assertAccountDeletionStates(context, helpers)
}

async function assertOwnerInvitationControls(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const invitations = [initialInvitation]
  let acceptedMembers = [acceptedMember]
  const memberRemovalCommands = []
  const invitationCommands = []
  let firstListRelease
  let firstList = true

  try {
    await installAccountRoutes(page, helpers, {
      billingState: () => managerBillingState({ members: acceptedMembers, reserved: invitations.length })
    })
    await page.route('**/api/account/family/members/remove', async (route) => {
      const request = route.request()
      memberRemovalCommands.push({
        method: request.method(),
        path: new URL(request.url()).pathname,
        body: request.postDataJSON()
      })
      acceptedMembers = acceptedMembers.filter((member) => member.reference !== request.postDataJSON().memberReference)
      return helpers.fulfillJson(route, { status: 'removed' })
    })
    await page.route('**/api/invitations**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())

      if (request.method() === 'GET' && url.pathname === '/api/invitations') {
        if (firstList) {
          firstList = false
          await new Promise((resolve) => {
            firstListRelease = resolve
          })
        }
        return helpers.fulfillJson(route, { invitations })
      }

      if (request.method() === 'POST' && url.pathname === '/api/invitations') {
        const body = request.postDataJSON()
        invitationCommands.push({ method: request.method(), path: url.pathname, body })
        const invitation = {
          id: body.email === 'delivery.fail@example.test' ? 'Browser_delivery-failure' : 'Browser_created',
          email: body.email,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        }
        if (!invitations.some((item) => item.id === invitation.id)) invitations.unshift(invitation)

        if (body.email === 'delivery.fail@example.test') {
          return route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ statusMessage: 'Invitation delivery is temporarily unavailable' })
          })
        }
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'sent' }) })
      }

      const action = url.pathname.match(/^\/api\/invitations\/([^/]+)\/(resend|cancel)$/)
      if (request.method() === 'POST' && action) {
        const [, invitationId, command] = action
        invitationCommands.push({ method: request.method(), path: url.pathname, body: request.postData() })
        if (command === 'cancel') {
          const index = invitations.findIndex((item) => item.id === invitationId)
          if (index >= 0) invitations.splice(index, 1)
          return helpers.fulfillJson(route, { status: 'canceled' })
        }
        return helpers.fulfillJson(route, { status: 'resent' })
      }

      return route.fallback()
    })

    await page.goto('/')
    await navigateToAccountFromMenu(page)
    await expect(page.getByRole('heading', { name: 'Share access' })).toBeVisible()
    await expect(page.getByText('Loading family access', { exact: true })).toBeVisible()
    await expect.poll(() => typeof firstListRelease).toBe('function')
    firstListRelease()

    await expect(page.getByText(initialInvitation.email, { exact: true })).toBeVisible()
    const familySurface = page.locator('#family-access')
    await expect(familySurface.getByText('Accepted Family Member', { exact: true })).toBeVisible()
    await expect(familySurface.getByText('accepted.member@example.test', { exact: true })).toBeVisible()
    await expect(familySurface.getByText('2 of 6', { exact: true })).toBeVisible()
    await expect(familySurface.getByText('1', { exact: true })).toBeVisible()
    await expect(familySurface.getByText(joinedFamilyPlanId, { exact: true })).toHaveCount(0)
    await expect(familySurface.getByText(/workspace|organization|slug|activeOrganizationId/i)).toHaveCount(0)
    await expect(familySurface.getByRole('combobox')).toHaveCount(0)
    const visibleFamilyText = (await familySurface.textContent()) ?? ''
    const familyMarkup = await familySurface.evaluate((element) => element.outerHTML)
    for (const canary of memberPrivacyCanaries) {
      expect(visibleFamilyText).not.toContain(canary)
      expect(familyMarkup).not.toContain(canary)
    }

    const removeMember = familySurface.getByRole('button', {
      name: 'Remove Accepted Family Member (accepted.member@example.test)',
      exact: true
    })
    await removeMember.click()
    expect(memberRemovalCommands).toEqual([])
    const confirmRemoval = familySurface.getByRole('button', { name: 'Confirm removal', exact: true })
    await expect(confirmRemoval).toBeFocused()
    await confirmRemoval.press('Enter')
    await expect
      .poll(() => memberRemovalCommands[0])
      .toEqual({
        method: 'POST',
        path: '/api/account/family/members/remove',
        body: { memberReference: acceptedMemberReference }
      })
    await expect(familySurface.getByText('Accepted Family Member', { exact: true })).toHaveCount(0)
    await expect(
      familySurface.getByText('Accepted Family Member (accepted.member@example.test) no longer has Family access.', {
        exact: true
      })
    ).toBeVisible()
    await expect(familySurface.getByText('1 of 6', { exact: true })).toBeVisible()

    const email = page.getByRole('textbox', { name: 'Email address' })
    await email.fill('not-an-email')
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText('Enter a valid email address.')
    expect(invitationCommands).toEqual([])

    await email.fill('NEW.PERSON@EXAMPLE.TEST')
    await page.getByRole('button', { name: 'Send invitation', exact: true }).press('Enter')
    await expect
      .poll(() => invitationCommands[0])
      .toEqual({
        method: 'POST',
        path: '/api/invitations',
        body: { email: 'new.person@example.test' }
      })
    await expect(page.getByText('Invitation sent to new.person@example.test.', { exact: true })).toBeVisible()

    const resend = page.getByRole('button', { name: `Resend invitation to ${initialInvitation.email}` })
    await resend.focus()
    await expect(resend).toBeFocused()
    await page.keyboard.press('Enter')
    await expect
      .poll(() => invitationCommands[1])
      .toEqual({
        method: 'POST',
        path: `/api/invitations/${initialInvitation.id}/resend`,
        body: null
      })
    await expect(page.getByText(`Invitation resent to ${initialInvitation.email}.`, { exact: true })).toBeVisible()

    const cancel = page.getByRole('button', { name: `Cancel invitation to ${initialInvitation.email}` })
    await cancel.click()
    await expect
      .poll(() => invitationCommands[2])
      .toEqual({
        method: 'POST',
        path: `/api/invitations/${initialInvitation.id}/cancel`,
        body: null
      })
    await expect(page.getByText(initialInvitation.email, { exact: true })).toHaveCount(0)
    await expect(page.getByText(`Invitation to ${initialInvitation.email} canceled.`, { exact: true })).toBeVisible()

    await email.fill('delivery.fail@example.test')
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click()
    await expect(page.getByText(/could not confirm delivery/i)).toBeVisible()
    await expect(page.getByText('delivery.fail@example.test', { exact: true })).toBeVisible()
    await expect
      .poll(() => invitationCommands[3])
      .toEqual({
        method: 'POST',
        path: '/api/invitations',
        body: { email: 'delivery.fail@example.test' }
      })
    const retryDelivery = page.getByRole('button', { name: 'Resend invitation to delivery.fail@example.test' })
    await retryDelivery.press('Enter')
    await expect
      .poll(() => invitationCommands[4])
      .toEqual({
        method: 'POST',
        path: '/api/invitations/Browser_delivery-failure/resend',
        body: null
      })
    await expect(page.getByText('Invitation resent to delivery.fail@example.test.', { exact: true })).toBeVisible()

    helpers.removeExpectedHttpFailure(observations, 'POST', 503, '/api/invitations')
    await page.setViewportSize({ width: 320, height: 800 })
    await helpers.assertNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 640, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await helpers.assertNoHorizontalOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertInvitationControlsRecoverWithoutRoleState(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  let shouldFail = true

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/invitations', async (route) => {
      if (shouldFail) {
        shouldFail = false
        return route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ statusMessage: 'Family access unavailable' })
        })
      }
      return helpers.fulfillJson(route, { invitations: [] })
    })

    await page.goto('/')
    await navigateToAccountFromMenu(page)
    await expect(page.getByText('Family access unavailable', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveCount(0)
    const familySurface = page.locator('#family-access')
    await expect(familySurface.getByText(joinedFamilyPlanId, { exact: true })).toHaveCount(0)
    await expect(familySurface.getByText(/workspace|organization|slug|activeOrganizationId|role:/i)).toHaveCount(0)
    await page.getByRole('button', { name: 'Try again' }).press('Enter')
    await expect(page.getByText('No pending invitations', { exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email address' })).toBeVisible()

    helpers.removeExpectedHttpFailure(observations, 'GET', 403, '/api/invitations')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertAccountDeletionStates(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const deletionCommands = []
  let deletionAttempt = 0
  let sessionActive = true

  try {
    await installAccountRoutes(page, helpers, { sessionState: () => sessionActive })
    await page.route('**/api/invitations', (route) => helpers.fulfillJson(route, { invitations: [] }))
    await page.route('**/api/account', async (route) => {
      deletionAttempt += 1
      deletionCommands.push({ method: route.request().method(), body: route.request().postDataJSON() })
      if (deletionAttempt === 1) {
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'SESSION_EXPIRED', message: 'Session is not fresh' })
        })
      }
      if (deletionAttempt === 2) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'ACCOUNT_DELETION_BILLING_PENDING',
            message: 'Account deletion is awaiting billing confirmation. Please retry.'
          })
        })
      }
      if (deletionAttempt === 3) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ statusMessage: 'Deletion unavailable' })
        })
      }
      if (deletionAttempt === 4) {
        return helpers.fulfillJson(route, { success: true, message: 'Verification email sent' })
      }

      sessionActive = false
      return helpers.fulfillJson(route, { success: true, message: 'User deleted' })
    })

    await page.goto('/')
    await navigateToAccountFromMenu(page)
    const deletionSection = page.getByRole('heading', { name: 'Delete account' }).locator('..').locator('..')
    await expect(deletionSection).toContainText('deletion waits until cancellation is confirmed')
    await expect(deletionSection).toContainText('their separate accounts and private data remain')
    await expect(deletionSection).toContainText('minimized billing references')

    const confirmation = page.getByRole('textbox', { name: 'Type DELETE to confirm' })
    const deleteButton = page.getByRole('button', { name: 'Delete account', exact: true })
    await confirmation.fill('delete')
    await expect(deleteButton).toBeDisabled()
    expect(deletionCommands).toEqual([])

    await confirmation.fill('DELETE')
    await deleteButton.focus()
    await expect(deleteButton).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByText(/session is too old/i)).toBeVisible()
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByText('Browser Family User', { exact: true })).toBeVisible()

    await deleteButton.click()
    await expect(page.getByText(/Stripe cancellation is not confirmed/i)).toBeVisible()
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByText('Browser Family User', { exact: true })).toBeVisible()

    await deleteButton.click()
    await expect(page.getByText(/could not confirm whether deletion completed/i)).toBeVisible()
    await expect(page).toHaveURL(/\/account$/)
    await expect(deleteButton).toBeEnabled()

    await deleteButton.click()
    await expect(page.getByText(/could not confirm whether deletion completed/i)).toBeVisible()
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByText('Browser Family User', { exact: true })).toBeVisible()

    await deleteButton.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByText('Browser Family User', { exact: true })).toHaveCount(0)
    expect(deletionCommands).toEqual([
      { method: 'DELETE', body: { confirmation: 'DELETE' } },
      { method: 'DELETE', body: { confirmation: 'DELETE' } },
      { method: 'DELETE', body: { confirmation: 'DELETE' } },
      { method: 'DELETE', body: { confirmation: 'DELETE' } },
      { method: 'DELETE', body: { confirmation: 'DELETE' } }
    ])

    helpers.removeExpectedHttpFailure(observations, 'DELETE', 400, '/api/account')
    helpers.removeExpectedHttpFailure(observations, 'DELETE', 503, '/api/account', 2)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function installAccountRoutes(
  page,
  helpers,
  { sessionState = () => true, billingState = () => managerBillingState() } = {}
) {
  const now = new Date().toISOString()
  await page.route('**/api/baseline', (route) =>
    helpers.fulfillJson(route, {
      modules: { billing: 'ready' },
      socialProviders: { google: 'disabled' }
    })
  )
  await page.route('**/api/account/billing', (route) => helpers.fulfillJson(route, billingState()))
  await page.route('**/api/auth/get-session', (route) => {
    if (!sessionState()) return helpers.fulfillJson(route, null)
    return helpers.fulfillJson(route, {
      session: {
        id: 'browser-family-session',
        token: 'browser-family-session-token',
        userId: 'browser-family-user',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: joinedFamilyPlanId
      },
      user: {
        id: 'browser-family-user',
        name: 'Browser Family User',
        email: 'browser.family@example.test',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now
      }
    })
  })
}

function managerBillingState({ members = [], reserved = 0 } = {}) {
  return {
    catalog: [
      { key: 'personal.weekly', plan: 'personal', cadence: 'weekly' },
      { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
      { key: 'personal.annual', plan: 'personal', cadence: 'annual' },
      { key: 'family.monthly', plan: 'family', cadence: 'monthly' },
      { key: 'family.annual', plan: 'family', cadence: 'annual' }
    ],
    relationship: { kind: 'manager' },
    entitlement: {
      granted: true,
      source: 'manager',
      state: 'active',
      plan: 'family',
      cadence: 'monthly'
    },
    subscription: {
      provider: 'Stripe',
      state: 'active',
      plan: 'family',
      cadence: 'monthly',
      currentPeriodEnd: '2026-08-28T00:00:00.000Z',
      renewalEnabled: true,
      graceDeadline: null,
      checkoutPending: false
    },
    transition: null,
    seats: {
      accepted: members.length + 1,
      reserved,
      capacity: 6
    },
    members,
    capabilities: {
      canCheckout: false,
      canChange: true,
      canManage: true,
      canReconcile: true,
      canLeaveFamily: false,
      canCreateFamilyInvitation: members.length + reserved + 1 < 6,
      canResendFamilyInvitation: reserved > 0,
      canAcceptFamilyInvitation: false,
      canAddFamilyMember: members.length + reserved + 1 < 6,
      canRemoveFamilyMember: members.length > 0
    },
    stripeCustomerId: memberPrivacyCanaries[4],
    stripeSubscriptionId: memberPrivacyCanaries[5]
  }
}

async function navigateToAccountFromMenu(page) {
  const trigger = page.getByRole('button', { name: /^Account menu for / })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
}
