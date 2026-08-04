import { expect } from '@playwright/test'

const familyAuthorityId = 'family-authority-is-not-a-provider-id'
const providerCanaries = ['cus_browser_private', 'sub_browser_private', 'price_browser_private']

export async function assertFamilyBillingJourney(context, helpers, projectName) {
  if (projectName === 'desktop-chromium') {
    await assertDisabledBillingStaysOutOfAccount(context, helpers)
    await assertIndependentCheckoutJourney(context, helpers)
    await assertCheckoutSessionLoss(context, helpers)
    await assertPersonalBillingJourney(context, helpers)
    await assertManagerBillingJourney(context, helpers)
    await assertReconciliationJourney(context, helpers)
    await assertCommittedLeaveResponseLoss(context, helpers)
    await assertMemberSessionLoss(context, helpers)
  }

  await assertMemberPresentationAndLeave(context, helpers, projectName)
}

async function assertDisabledBillingStaysOutOfAccount(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)

  try {
    await installAccountRoutes(page, helpers, { billingModule: 'disabled' })
    await navigateToAccount(page)

    await expect(page.getByRole('heading', { name: 'Account', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'View billing', exact: true })).toHaveCount(0)
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/account/billing'))).toBe(false)
    await helpers.assertAccessibleWithoutOverflow(page)

    await page.evaluate(async () => {
      const nuxtApp = window.useNuxtApp()
      nuxtApp.$config.public.moduleStates.billing = 'disabled'
      await nuxtApp.$router.push('/account/billing').catch(() => undefined)
    })
    await expect(page).toHaveURL(/\/account\/billing$/)
    await expect(page.getByRole('heading', { name: 'Module unavailable', exact: true })).toBeVisible()
    await expect(page.getByText('Code: MODULE_DISABLED', { exact: true })).toBeVisible()
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/account/billing'))).toBe(false)
    expect(observations.externalRequests).toEqual([])
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertIndependentCheckoutJourney(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const checkoutCommands = []
  let checkoutAttempt = 0
  let billingReadCount = 0
  let releaseBilling
  let releaseCheckout
  let currentBillingState = independentState()

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname

      if (request.method() === 'GET' && path === '/api/account/billing') {
        billingReadCount += 1
        if (billingReadCount === 2) {
          await new Promise((resolve) => {
            releaseBilling = resolve
          })
        }
        return helpers.fulfillJson(route, currentBillingState)
      }

      if (request.method() === 'POST' && path === '/api/account/billing/checkout') {
        checkoutAttempt += 1
        checkoutCommands.push(request.postDataJSON())
        if (checkoutAttempt === 1) {
          await new Promise((resolve) => {
            releaseCheckout = resolve
          })
          return fulfillFailure(route, 503, 'Checkout temporarily unavailable')
        }
        return helpers.fulfillJson(route, { url: 'https://checkout.example.test/family' })
      }

      return route.fallback()
    })
    await page.route('https://checkout.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Provider checkout</title>' })
    )

    await navigateToAccount(page)
    const billingLink = page.getByRole('link', { name: 'View billing', exact: true })
    await expect(billingLink).toHaveAttribute('href', '/account/billing')
    const billingNavigation = billingLink.click()
    await expect.poll(() => typeof releaseBilling).toBe('function')
    await expect(page.getByText('Loading billing', { exact: true })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    releaseBilling()
    await billingNavigation

    await expect(page).toHaveURL(/\/account\/billing$/)
    await expect(page.getByRole('heading', { name: 'Billing', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByText('No subscription', { exact: true })).toBeVisible()
    await expect(page.getByText('Independent', { exact: true })).toBeVisible()
    await expect(page.getByText('Not currently available', { exact: true })).toBeVisible()
    for (const offering of [
      'Personal · Weekly',
      'Personal · Monthly',
      'Personal · Annual',
      'Family · Monthly',
      'Family · Annual'
    ]) {
      await expect(page.getByRole('button', { name: `Choose ${offering}`, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Manage billing', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Check billing status', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Leave family membership', exact: true })).toHaveCount(0)
    await expect(page.getByText(/shares paid access, not private app data/i)).toBeVisible()
    await expect(page.getByText(/free trial/i)).toHaveCount(0)

    currentBillingState = checkoutPendingState()
    await navigateToBillingReturn(page, 'success')
    await expect(
      page.getByText('Checkout returned to the app. Payment and access are confirmed only by the billing status below.')
    ).toBeVisible()
    await expect(page.getByText('Checkout confirmation pending', { exact: true })).toBeVisible()
    await expect(page.getByText('Not currently available', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0)
    await helpers.assertAccessibleWithoutOverflow(page)

    currentBillingState = independentState()
    await navigateToBillingReturn(page, 'cancelled')
    await expect(page.getByText('Checkout was canceled. No billing change is assumed.', { exact: true })).toBeVisible()
    await expect(page.getByText('No subscription', { exact: true })).toBeVisible()

    const checkout = page.getByRole('button', { name: 'Choose Personal · Monthly', exact: true })
    await checkout.click()
    await expect.poll(() => typeof releaseCheckout).toBe('function')
    const openingCheckout = page.getByRole('button', { name: 'Opening checkout...', exact: true })
    await expect(openingCheckout).toBeDisabled()
    await openingCheckout.evaluate((button) => button.click())
    expect(checkoutCommands).toEqual([{ offering: 'personal.monthly' }])
    releaseCheckout()
    await expect(page.getByText(/could not start Stripe Checkout/i)).toBeFocused()
    await expect(page.getByRole('button', { name: 'Choose Personal · Monthly', exact: true })).toBeEnabled()

    helpers.removeExpectedHttpFailure(observations, 'POST', 503, '/api/account/billing/checkout')
    await assertNoProviderLeak(page, observations)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)

    await Promise.all([
      page.waitForURL('https://checkout.example.test/family'),
      page.getByRole('button', { name: 'Choose Personal · Monthly', exact: true }).click()
    ])
    expect(checkoutCommands).toEqual([{ offering: 'personal.monthly' }, { offering: 'personal.monthly' }])
    removeExpectedExternalNavigation(observations, 'https://checkout.example.test/family')
  } finally {
    await page.close()
  }
}

async function assertCheckoutSessionLoss(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const commands = []

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === 'GET' && path === '/api/account/billing') {
        return helpers.fulfillJson(route, independentState())
      }
      if (request.method() === 'POST' && path === '/api/account/billing/checkout') {
        commands.push(request.postDataJSON())
        return fulfillFailure(route, 401, 'Session expired')
      }
      return route.fallback()
    })

    await navigateToBilling(page)
    await page.getByRole('button', { name: 'Choose Personal · Monthly', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText('No subscription', { exact: true })).toHaveCount(0)
    expect(commands).toEqual([{ offering: 'personal.monthly' }])

    helpers.removeExpectedHttpFailure(observations, 'POST', 401, '/api/account/billing/checkout')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertPersonalBillingJourney(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const changeCommands = []
  let currentState = personalState()

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === 'GET' && path === '/api/account/billing') {
        return helpers.fulfillJson(route, currentState)
      }
      if (request.method() === 'POST' && path === '/api/account/billing/change') {
        changeCommands.push(request.postDataJSON())
        currentState = personalState({
          transition: {
            kind: 'personal_to_family',
            targetOffering: 'family.annual',
            effectiveAt: null,
            state: 'action_required'
          },
          canChange: false
        })
        return helpers.fulfillJson(route, currentState)
      }
      return route.fallback()
    })

    await navigateToBilling(page)
    await expect(page.getByText('Personal active', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Personal · Monthly', exact: true })).toBeVisible()
    await expect(page.getByText('Stripe', { exact: true })).toBeVisible()
    await expect(page.getByText('Monthly', { exact: true })).toBeVisible()
    await expect(page.getByText('On', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Manage billing', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Change to Personal · Monthly', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Change to Family · Annual', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Change to Family · Annual', exact: true }).click()
    expect(changeCommands).toEqual([{ offering: 'family.annual' }])
    await expect(page.getByText('Subscription change pending', { exact: true })).toBeVisible()
    await expect(page.getByText(/waiting for payment action/i)).toBeVisible()
    await expect(page.getByText(/processing or has scheduled the subscription change/i)).toBeFocused()
    await expect(page.getByRole('button', { name: /^Change to / })).toHaveCount(0)
    await assertNoProviderLeak(page, observations)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertManagerBillingJourney(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const portalCommands = []
  let billingFailures = 0
  let billingShouldFail = true
  let portalAttempt = 0
  let releasePortal
  let managerProjection = managerState({
    state: 'grace',
    granted: true,
    acceptedPeople: 4,
    reservedPeople: 1,
    renewalEnabled: true,
    graceDeadline: '2026-08-11T00:00:00.000Z'
  })

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname

      if (request.method() === 'GET' && path === '/api/account/billing') {
        if (billingShouldFail) {
          billingFailures += 1
          return fulfillFailure(route, 503, 'Billing temporarily unavailable')
        }
        return helpers.fulfillJson(route, managerProjection)
      }

      if (request.method() === 'POST' && path === '/api/account/billing/portal') {
        portalAttempt += 1
        portalCommands.push(request.postDataJSON())
        if (portalAttempt === 1) {
          await new Promise((resolve) => {
            releasePortal = resolve
          })
          return fulfillFailure(route, 503, 'Portal temporarily unavailable')
        }
        return helpers.fulfillJson(route, { url: 'https://billing.example.test/session' })
      }

      return route.fallback()
    })
    await page.route('https://billing.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Provider portal</title>' })
    )

    await navigateToBilling(page)
    await expect(page.getByText('Billing unavailable', { exact: true })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    billingShouldFail = false
    await page.getByRole('button', { name: 'Retry', exact: true }).press('Enter')
    await expect(page.getByText('Payment needs attention', { exact: true })).toBeVisible()
    await expect(page.getByText(/Premium access remains available through/)).toBeVisible()
    await expect(page.getByText('Available', { exact: true })).toBeVisible()
    await expect(page.getByText('Family manager', { exact: true })).toBeVisible()
    await expect(page.getByText('4 of 6', { exact: true })).toBeVisible()
    await expect(page.getByText('Reserved invitations', { exact: true })).toBeVisible()
    await expect(page.locator('.billing-facts').getByText('1', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Manage billing', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave family membership', exact: true })).toHaveCount(0)
    await helpers.assertAccessibleWithoutOverflow(page)

    managerProjection = managerState({ state: 'active', granted: true, acceptedPeople: 2, renewalEnabled: true })
    await refreshBillingThroughAccount(page)
    await expect(page.getByText('Family active', { exact: true })).toBeVisible()
    await expect(page.getByText('2 of 6', { exact: true })).toBeVisible()
    await expect(page.getByText(/trial/i)).toHaveCount(0)

    const portal = page.getByRole('button', { name: 'Manage billing', exact: true })
    await portal.click()
    await expect.poll(() => typeof releasePortal).toBe('function')
    const openingPortal = page.getByRole('button', { name: 'Opening billing...', exact: true })
    await expect(openingPortal).toBeDisabled()
    await openingPortal.evaluate((button) => button.click())
    expect(portalCommands).toEqual([{}])
    releasePortal()
    await expect(page.getByText(/could not open Stripe billing management/i)).toBeFocused()

    helpers.removeExpectedHttpFailure(observations, 'GET', 503, '/api/account/billing', billingFailures, false)
    helpers.removeExpectedHttpFailure(observations, 'POST', 503, '/api/account/billing/portal', 1, false)
    helpers.removeExpectedConsoleFailures(observations, 503, billingFailures + 1)
    await assertNoProviderLeak(page, observations)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)

    await Promise.all([
      page.waitForURL('https://billing.example.test/session'),
      page.getByRole('button', { name: 'Manage billing', exact: true }).click()
    ])
    expect(portalCommands).toEqual([{}, {}])
    removeExpectedExternalNavigation(observations, 'https://billing.example.test/session')
  } finally {
    await page.close()
  }
}

async function assertReconciliationJourney(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const reconcileCommands = []

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === 'GET' && path === '/api/account/billing') {
        return helpers.fulfillJson(
          route,
          managerState({ state: 'reconciliation_required', granted: false, canReconcile: true })
        )
      }
      if (request.method() === 'POST' && path === '/api/account/billing/reconcile') {
        reconcileCommands.push(request.postDataJSON())
        return helpers.fulfillJson(route, managerState({ state: 'active', granted: true, acceptedPeople: 2 }))
      }
      return route.fallback()
    })

    await navigateToBilling(page)
    await expect(page.getByText('Billing status unavailable', { exact: true })).toBeVisible()
    await expect(page.getByText('Not currently available', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check billing status', exact: true })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    await page.getByRole('button', { name: 'Check billing status', exact: true }).click()
    await expect(page.getByText('Billing status refreshed.', { exact: true })).toBeFocused()
    expect(reconcileCommands).toEqual([{}])
    await expect(page.getByText('Family active', { exact: true })).toBeVisible()
    await expect(page.getByText('2 of 6', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check billing status', exact: true })).toHaveCount(0)
    await assertNoProviderLeak(page, observations)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertMemberPresentationAndLeave(context, helpers, projectName) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const leaveCommands = []
  let currentState = memberState()
  let leaveAttempt = 0

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      if (request.method() === 'GET' && path === '/api/account/billing') {
        return helpers.fulfillJson(route, withProviderCanaries(currentState))
      }
      return route.fallback()
    })
    await page.route('**/api/account/family/leave', async (route) => {
      leaveAttempt += 1
      leaveCommands.push(route.request().postDataJSON())
      if (leaveAttempt === 1) return fulfillFailure(route, 503, 'Family membership temporarily unavailable')
      currentState = independentState()
      return helpers.fulfillJson(route, { status: 'left' })
    })

    await navigateToBilling(page)
    await expect(page.getByRole('heading', { name: 'Family membership', exact: true, level: 2 })).toBeVisible()
    await expect(page.getByText('Family membership active', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Your premium access is included through a Family membership.', { exact: true })
    ).toBeVisible()
    await expect(page.getByText('Available', { exact: true })).toBeVisible()
    await expect(page.getByText('Family member', { exact: true })).toBeVisible()
    await expect(page.getByText(/^People$/)).toHaveCount(0)
    await expect(
      page.getByText(
        "The Family manager controls billing. Your payment details and the payer's identity are not shown.",
        { exact: true }
      )
    ).toBeVisible()
    await assertMemberBillingControlsAbsent(page)
    await assertNoProviderLeak(page, observations)

    if (projectName !== 'desktop-chromium') {
      await page.setViewportSize({ width: 390, height: 844 })
      await helpers.assertNoHorizontalOverflow(page)
      await page.setViewportSize({ width: 320, height: 800 })
      await helpers.assertNoHorizontalOverflow(page)
      await page.setViewportSize({ width: 640, height: 900 })
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
      await helpers.assertNoHorizontalOverflow(page)
      await helpers.assertCleanPage(page, observations)
      return
    }

    currentState = memberState({ state: 'suspended', granted: false })
    await refreshBillingThroughAccount(page)
    await expect(page.getByText('Family membership inactive', { exact: true })).toBeVisible()
    await expect(page.getByText('Not currently available', { exact: true })).toBeVisible()
    await assertMemberBillingControlsAbsent(page)
    await helpers.assertAccessibleWithoutOverflow(page)

    currentState = memberState()
    await refreshBillingThroughAccount(page)
    await expect(page.getByText('Family membership active', { exact: true })).toBeVisible()

    const leave = page.getByRole('button', { name: 'Leave family membership', exact: true })
    await leave.click()
    const confirm = page.getByRole('button', { name: 'Confirm leave', exact: true })
    await expect(confirm).toBeFocused()
    await helpers.assertAccessibleWithoutOverflow(page)
    await page.getByRole('button', { name: 'Keep membership', exact: true }).press('Enter')
    await expect(leave).toBeFocused()

    await leave.click()
    await confirm.click()
    await expect(page.getByText(/could not confirm that you left the family membership/i)).toBeFocused()
    await expect(page.getByText('Family membership active', { exact: true })).toBeVisible()
    await confirm.click()
    await expect(
      page.getByText(/You left the family membership. Your current billing options are shown below./)
    ).toBeFocused()
    expect(leaveCommands).toEqual([{}, {}])
    await expect(page.getByText('Independent', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose Personal · Monthly', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave family membership', exact: true })).toHaveCount(0)

    helpers.removeExpectedHttpFailure(observations, 'POST', 503, '/api/account/family/leave')
    await assertNoProviderLeak(page, observations)
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertMemberSessionLoss(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const commands = []

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', (route) => {
      const request = route.request()
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/account/billing') {
        return helpers.fulfillJson(route, memberState())
      }
      return route.fallback()
    })
    await page.route('**/api/account/family/leave', (route) => {
      commands.push(route.request().postDataJSON())
      return fulfillFailure(route, 401, 'Session expired')
    })

    await navigateToBilling(page)
    await page.getByRole('button', { name: 'Leave family membership', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm leave', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible()
    await expect(page.getByText('Family membership active', { exact: true })).toHaveCount(0)
    expect(commands).toEqual([{}])

    helpers.removeExpectedHttpFailure(observations, 'POST', 401, '/api/account/family/leave')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertCommittedLeaveResponseLoss(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  const commands = []
  let currentState = memberState()

  try {
    await installAccountRoutes(page, helpers)
    await page.route('**/api/account/billing**', (route) => {
      const request = route.request()
      if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/account/billing') {
        return helpers.fulfillJson(route, currentState)
      }
      return route.fallback()
    })
    await page.route('**/api/account/family/leave', (route) => {
      commands.push(route.request().postDataJSON())
      currentState = independentState()
      return fulfillFailure(route, 503, 'Response lost after commit')
    })

    await navigateToBilling(page)
    await page.getByRole('button', { name: 'Leave family membership', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm leave', exact: true }).click()
    await expect(
      page.getByText(/You left the family membership. Your current billing options are shown below./)
    ).toBeFocused()
    await expect(page.getByText('Independent', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Choose Personal · Monthly', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave family membership', exact: true })).toHaveCount(0)
    expect(commands).toEqual([{}])

    helpers.removeExpectedHttpFailure(observations, 'POST', 503, '/api/account/family/leave')
    await helpers.assertAccessibleWithoutOverflow(page)
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function installAccountRoutes(page, helpers, { billingModule = 'ready' } = {}) {
  const now = new Date().toISOString()
  await page.route('**/api/baseline', (route) =>
    helpers.fulfillJson(route, {
      modules: { billing: billingModule },
      socialProviders: { google: 'disabled' }
    })
  )
  await page.route('**/api/invitations', (route) => helpers.fulfillJson(route, { invitations: [] }))
  await page.route('**/api/auth/get-session', (route) =>
    helpers.fulfillJson(route, {
      session: {
        id: 'browser-billing-session',
        token: 'browser-billing-session-token',
        userId: 'browser-billing-user',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: familyAuthorityId
      },
      user: {
        id: 'browser-billing-user',
        name: 'Browser Billing User',
        email: 'browser.billing@example.test',
        emailVerified: true,
        image: null,
        createdAt: now,
        updatedAt: now
      }
    })
  )
}

async function navigateToAccount(page) {
  await page.waitForLoadState('networkidle')
  await page.goto('/')
  const trigger = page.getByRole('button', { name: /^Account menu for / })
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await page.waitForLoadState('networkidle')
}

async function navigateToBilling(page) {
  await navigateToAccount(page)
  await page.getByRole('link', { name: 'View billing', exact: true }).click()
  await expect(page).toHaveURL(/\/account\/billing$/)
  await page.waitForLoadState('networkidle')
}

async function navigateToBillingReturn(page, result) {
  await page.getByRole('link', { name: 'Return to account', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (target) => {
    await window.useNuxtApp().$router.push(target)
  }, `/account/billing?checkout=${result}`)
  await expect(page).toHaveURL(new RegExp(`/account/billing\\?checkout=${result}$`))
  await page.waitForLoadState('networkidle')
}

async function refreshBillingThroughAccount(page) {
  await page.getByRole('link', { name: 'Return to account', exact: true }).click()
  await expect(page).toHaveURL(/\/account$/)
  await page.waitForLoadState('networkidle')
  await page.getByRole('link', { name: 'View billing', exact: true }).click()
  await expect(page).toHaveURL(/\/account\/billing$/)
  await page.waitForLoadState('networkidle')
}

function independentState() {
  return createBillingState({ kind: 'independent', state: 'none', canCheckout: true })
}

function checkoutPendingState() {
  return createBillingState({
    kind: 'independent',
    state: 'none',
    canReconcile: true,
    checkoutPending: true
  })
}

function personalState({ transition = null, canChange = true } = {}) {
  return createBillingState({
    kind: 'independent',
    state: 'active',
    granted: true,
    plan: 'personal',
    cadence: 'monthly',
    renewalEnabled: true,
    canManage: true,
    canChange,
    transition
  })
}

function managerState({
  state,
  granted,
  acceptedPeople = 1,
  reservedPeople = 0,
  canReconcile = false,
  renewalEnabled = false,
  graceDeadline = null
}) {
  return createBillingState({
    kind: 'manager',
    state,
    granted,
    plan: 'family',
    cadence: 'monthly',
    acceptedPeople,
    reservedPeople,
    canManage: state !== 'reconciliation_required',
    canReconcile,
    renewalEnabled,
    graceDeadline
  })
}

function memberState({ state = 'active', granted = true } = {}) {
  return createBillingState({
    kind: 'member',
    state,
    granted,
    plan: 'family',
    cadence: 'monthly',
    canLeave: true
  })
}

function createBillingState({
  kind,
  state,
  granted = false,
  plan = null,
  cadence = null,
  acceptedPeople = 1,
  reservedPeople = 0,
  canCheckout = false,
  canManage = false,
  canReconcile = false,
  canLeave = false,
  canChange = false,
  renewalEnabled = false,
  graceDeadline = null,
  checkoutPending = false,
  transition = null
}) {
  return {
    catalog: [
      { key: 'personal.weekly', plan: 'personal', cadence: 'weekly' },
      { key: 'personal.monthly', plan: 'personal', cadence: 'monthly' },
      { key: 'personal.annual', plan: 'personal', cadence: 'annual' },
      { key: 'family.monthly', plan: 'family', cadence: 'monthly' },
      { key: 'family.annual', plan: 'family', cadence: 'annual' }
    ],
    relationship: { kind },
    entitlement: {
      granted,
      source: granted ? (kind === 'member' ? 'family' : plan === 'family' ? 'manager' : 'personal') : null,
      state: granted ? (state === 'grace' ? 'grace' : 'active') : 'none',
      plan: granted ? plan : null,
      cadence: granted ? cadence : null
    },
    subscription: {
      provider: 'Stripe',
      state,
      plan,
      cadence,
      currentPeriodEnd: plan ? '2026-08-28T00:00:00.000Z' : null,
      renewalEnabled,
      graceDeadline,
      checkoutPending
    },
    transition,
    seats:
      kind === 'manager'
        ? {
            accepted: acceptedPeople,
            reserved: reservedPeople,
            capacity: 6
          }
        : null,
    members: kind === 'manager' ? [] : null,
    capabilities: {
      canCheckout,
      canChange,
      canManage,
      canReconcile,
      canLeaveFamily: canLeave,
      canCreateFamilyInvitation: false,
      canResendFamilyInvitation: false,
      canAcceptFamilyInvitation: false,
      canAddFamilyMember: false,
      canRemoveFamilyMember: false
    }
  }
}

function withProviderCanaries(state) {
  return {
    ...state,
    stripeCustomerId: providerCanaries[0],
    catalog: state.catalog.map((offering, index) => ({
      ...offering,
      providerPriceId: index === 0 ? providerCanaries[2] : undefined
    })),
    subscription: { ...state.subscription, providerSubscriptionId: providerCanaries[1] }
  }
}

async function assertMemberBillingControlsAbsent(page) {
  for (const name of ['Manage billing', 'Check billing status']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0)
  }
  await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Change to / })).toHaveCount(0)
}

async function assertNoProviderLeak(page, observations) {
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage }
  }))
  const visibleAndPersisted = [
    await page.locator('body').innerText(),
    await page.locator('body').evaluate((element) => element.outerHTML),
    page.url(),
    JSON.stringify(storage),
    JSON.stringify(await page.context().cookies()),
    JSON.stringify(observations.sameOriginRequests),
    JSON.stringify(observations.allConsole)
  ].join('\n')

  for (const canary of providerCanaries) expect(visibleAndPersisted).not.toContain(canary)
}

async function fulfillFailure(route, status, statusMessage) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ statusMessage })
  })
}

function removeExpectedExternalNavigation(observations, url) {
  const expected = observations.externalRequests.filter((entry) => entry === `GET ${url}`)
  expect(expected).toHaveLength(1)
  observations.externalRequests = observations.externalRequests.filter((entry) => !expected.includes(entry))
}
