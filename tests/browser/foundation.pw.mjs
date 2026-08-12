import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { assertIdentityAccountJourney } from './identity-account-journey.mjs'

const runtimeName = requiredEnvironment('BROWSER_RUNTIME_APP_NAME')
const runtimeUrl = requiredEnvironment('BROWSER_RUNTIME_APP_URL')
const runtimeAuthSecret = requiredEnvironment('BROWSER_RUNTIME_AUTH_SECRET')
const runtimeDatabase = requiredEnvironment('BROWSER_RUNTIME_DATABASE_PATH')
const runtimeReadinessToken = requiredEnvironment('BROWSER_RUNTIME_READINESS_TOKEN')
const buildName = requiredEnvironment('BROWSER_BUILD_APP_NAME')
const buildUrl = requiredEnvironment('BROWSER_BUILD_APP_URL')
const buildReadinessToken = requiredEnvironment('BROWSER_BUILD_READINESS_TOKEN')
const buildSentryRelease = requiredEnvironment('BROWSER_BUILD_SENTRY_RELEASE')
const runtimeSentryRelease = requiredEnvironment('BROWSER_RUNTIME_SENTRY_RELEASE')
const runtimeStripeSecret = requiredEnvironment('BROWSER_RUNTIME_STRIPE_SECRET')
const runtimeStripeWebhookSecret = requiredEnvironment('BROWSER_RUNTIME_STRIPE_WEBHOOK_SECRET')
const authEmailMarker = requiredEnvironment('BROWSER_AUTH_EMAIL_MARKER')
const emailCaptureDirectory = requiredEnvironment('BROWSER_EMAIL_CAPTURE_DIRECTORY')
const runtimeSentryOrigin = requiredEnvironment('BROWSER_RUNTIME_SENTRY_ORIGIN')
const turnstileOrigin = 'https://challenges.cloudflare.com'
const turnstileScriptUrl = `${turnstileOrigin}/turnstile/v0/api.js?render=explicit`
const sentryEnvelopePath = '/api/1/envelope/'
const maxCaptureFileBytes = 65_536
const maxCaptureFiles = 64
const intentionalManifestNavigations = new WeakMap()

if (new URL(runtimeSentryOrigin).origin !== runtimeSentryOrigin) {
  throw new Error('BROWSER_RUNTIME_SENTRY_ORIGIN must be an exact origin')
}

test.beforeEach(async ({ context }) => {
  await context.route(`${turnstileOrigin}/**`, async (route) => {
    if (route.request().method() !== 'GET' || route.request().url() !== turnstileScriptUrl) {
      throw new Error('The Turnstile browser fixture received an unexpected request')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: isolatedTurnstileBrowserSource
    })
  })
  await context.route(`${runtimeSentryOrigin}/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() !== 'POST' || url.origin !== runtimeSentryOrigin || url.pathname !== sentryEnvelopePath) {
      throw new Error('The Sentry browser fixture received an unexpected request')
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': new URL(runtimeUrl).origin },
      body: '{}'
    })
  })
})

const isolatedTurnstileBrowserSource = `
(() => {
  const widgets = new Map()
  let nextWidgetId = 0
  const complete = (widgetId) => queueMicrotask(() => {
    const options = widgets.get(widgetId)
    if (options) options.callback('isolated-turnstile-' + crypto.randomUUID())
  })

  window.turnstile = Object.freeze({
    render(container, options) {
      if (
        !(container instanceof HTMLElement) ||
        !String(options?.sitekey || '').startsWith('isolated-turnstile-') ||
        options?.action !== 'auth_magic_link' ||
        typeof options?.callback !== 'function'
      ) {
        throw new Error('Invalid isolated Turnstile widget configuration')
      }
      const widgetId = 'isolated-turnstile-widget-' + String(++nextWidgetId)
      widgets.set(widgetId, options)
      complete(widgetId)
      return widgetId
    },
    reset(widgetId) {
      if (!widgets.has(widgetId)) throw new Error('Unknown isolated Turnstile widget')
      complete(widgetId)
    },
    remove(widgetId) {
      widgets.delete(widgetId)
    }
  })
})()
`

test('home presents the WCU foundation and preserves client navigation', async ({ page }) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.route(
    `${runtimeUrl}/`,
    async (route) => {
      const original = await route.fetch()
      const html = await original.text()
      const closingHead = html.indexOf('</head>')
      if (closingHead < 0) throw new Error('The packaged home document did not contain a head boundary')
      const injected = `${html.slice(0, closingHead)}<script id="csp-unapproved-inline-script-probe">window.__cspUnapprovedInlineScriptRan = true</script>${html.slice(closingHead)}`
      await route.fulfill({ response: original, body: injected })
    },
    { times: 1 }
  )
  const response = await page.goto('/')
  await assertContentSecurityPolicy(page, response, observations)
  await expect(page.getByRole('heading', { name: 'Working People Need an Organization of Our Own' })).toBeVisible()
  await expect(
    page.getByText(
      'WCU brings tenants, workers, and neighbors together to win concrete changes, develop new leaders, and build lasting power.',
      {
        exact: true
      }
    )
  ).toBeVisible()
  await expect(page.locator('.brand')).toHaveAccessibleName(`${runtimeName} home`)
  await expect(page.locator('.brand')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle('Working Class Unity')
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  await assertRuntimePublicConfig(page)
  await assertAccessibleWithoutOverflow(page)

  const skipLink = page.getByRole('link', { name: 'Skip to main content' })
  const topbar = page.getByRole('banner', { name: 'Application' })
  await assertMinimumTargetSize(page.locator('.brand'))
  await assertMinimumTargetSize(topbar.getByRole('link', { name: 'Log In', exact: true }))
  await assertMinimumTargetSize(topbar.getByRole('link', { name: 'JOIN NOW', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'JOIN WCU', exact: true }))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.keyboard.press('Tab')
  await expect(skipLink).toBeFocused()
  await expect(skipLink).toBeInViewport()
  await assertVisibleFocusIndicator(page, skipLink)
  expect(await skipLink.evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(
    0.001
  )
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()

  const timeOrigin = await page.evaluate(() => performance.timeOrigin)
  await page.getByRole('link', { name: 'JOIN WCU', exact: true }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /(?:first|last|display) name/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'JOIN NOW', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle('Sign up')
  await expect(page.getByLabel('Security check')).toBeVisible()
  await expect(page.locator(`script[src="${turnstileScriptUrl}"]`)).toHaveCount(1)
  await expect(page.getByText('Security check complete.', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await page.setViewportSize({ width: 320, height: 800 })
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 640, height: 900 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await assertNoHorizontalOverflow(page)
  await assertCleanPage(page, observations)
})

test('global public navigation exposes current routes and a route-closing mobile disclosure', async ({ page }) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1024, height: 900 })

  for (const destination of [
    { path: '/about', label: 'About', title: 'About' },
    { path: '/calendar', label: 'Calendar', title: 'Calendar' },
    { path: '/forum', label: 'Forum', title: 'Forum' }
  ]) {
    await page.goto(destination.path)
    const primaryNavigation = page.getByRole('navigation', { name: 'Primary' })
    const currentLink = primaryNavigation.getByRole('link', { name: destination.label, exact: true })

    await expect(page.getByRole('heading', { name: destination.title, exact: true })).toBeVisible()
    await expect(page).toHaveTitle(destination.title)
    await expect(currentLink).toHaveAttribute('href', destination.path)
    await expect(currentLink).toHaveAttribute('aria-current', 'page')
    await expect(primaryNavigation.locator('[aria-current="page"]')).toHaveCount(1)
    await page.waitForLoadState('networkidle')
  }

  const desktopNavigation = page.locator('[data-reka-navigation-menu]')
  const aboutLink = desktopNavigation.getByRole('link', { name: 'About', exact: true })
  const calendarLink = desktopNavigation.getByRole('link', { name: 'Calendar', exact: true })
  const forumLink = desktopNavigation.getByRole('link', { name: 'Forum', exact: true })

  await expect(desktopNavigation).toHaveRole('navigation')
  await expect(desktopNavigation).toHaveAttribute('data-orientation', 'horizontal')
  await aboutLink.focus()
  await page.keyboard.press('ArrowRight')
  await expect(calendarLink).toBeFocused()
  await page.keyboard.press('End')
  await expect(forumLink).toBeFocused()
  await page.keyboard.press('Home')
  await expect(aboutLink).toBeFocused()

  await page.setViewportSize({ width: 320, height: 800 })
  const menuToggle = page.getByRole('button', { name: 'Menu', exact: true })
  const navigationPanel = page.locator('#primary-navigation-panel')

  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await assertMinimumTargetSize(menuToggle)

  await menuToggle.click()
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(navigationPanel).toBeVisible()
  await assertMinimumTargetSize(page.getByRole('link', { name: 'About', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'Calendar', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'Forum', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'Log In', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'JOIN NOW', exact: true }))
  await assertNoHorizontalOverflow(page)

  await page.getByRole('link', { name: 'About', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await expect(menuToggle).toBeFocused()

  await menuToggle.click()
  await page.getByRole('link', { name: 'About', exact: true }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await assertAccessibleWithoutOverflow(page)
  await assertCleanPage(page, observations)
})

test('session retry announces progress and failure without losing focus', async ({ page }) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  let requestCount = 0
  let deferSessionResponses = false
  let releaseRetryResponse = () => {}
  const retryResponseReady = new Promise((resolve) => {
    releaseRetryResponse = resolve
  })
  await page.route('**/api/auth/get-session*', async (route) => {
    requestCount += 1
    if (deferSessionResponses) await retryResponseReady
    await fulfillJson(route, { code: 'SESSION_UNAVAILABLE' }, 503)
  })

  await page.evaluate(async () => {
    const sessionData = window.useNuxtApp?.()._asyncData?.['app-session']
    if (!sessionData) throw new Error('The app-session async-data entry was unavailable')
    await sessionData.execute()
  })

  const topbar = page.getByRole('banner', { name: 'Application' })
  await expect(topbar.getByText('Session check unavailable', { exact: true })).toBeVisible()
  await expect(topbar.getByRole('alert')).toHaveCount(0)
  await expect(topbar.getByRole('status')).toHaveCount(0)

  const retryButton = topbar.getByRole('button')
  const requestsBeforeRetry = requestCount
  deferSessionResponses = true
  await retryButton.focus()
  await retryButton.click()
  await expect.poll(() => requestCount).toBeGreaterThan(requestsBeforeRetry)
  await expect(retryButton).toBeFocused()
  await expect(retryButton).toHaveAttribute('aria-disabled', 'true')
  await expect(retryButton).toHaveAccessibleName('Checking your session...')
  await expect(topbar.getByRole('status')).toContainText('Checking your session...')
  const pendingRequestCount = requestCount
  await retryButton.dispatchEvent('click')
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  expect(requestCount).toBe(pendingRequestCount)

  releaseRetryResponse()
  await expect(retryButton).toBeEnabled()
  await expect(retryButton).toBeFocused()
  await expect(retryButton).toHaveAccessibleName('Try again')
  await expect(topbar.getByRole('alert')).toContainText('Session check unavailable')
  await page.unroute('**/api/auth/get-session*')

  observations.errorResponses = observations.errorResponses.filter(
    (entry) => !(entry.includes('503') && entry.includes('/api/auth/get-session'))
  )
  observations.console = observations.console.filter(
    (entry) => !/Failed to load resource: the server responded with a status of 503/.test(entry)
  )
  await assertCleanPage(page, observations)
})

test('login is accessible before and after requesting a magic link', async ({ page }) => {
  test.setTimeout(35_000)
  const observations = observePage(page)
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.locator('.brand')).toHaveAccessibleName(`${runtimeName} home`)
  await expect(page).toHaveTitle('Log in')
  await assertRuntimePublicConfig(page)
  const emailInput = page.getByRole('textbox', { name: 'Email', exact: true })
  await expect(emailInput).toBeVisible()
  await expect(page.getByRole('textbox', { name: /(?:first|last|display) name/i })).toHaveCount(0)
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.locator('.mode-tabs')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0)
  await expect(page.getByLabel('Security check')).toBeVisible()
  await expect(page.locator(`script[src="${turnstileScriptUrl}"]`)).toHaveCount(1)
  await expect(page.getByText('Security check complete.', { exact: true })).toBeVisible()
  const submitButton = page.getByRole('button', { name: 'Send email link' })
  await expect(submitButton).toBeEnabled()
  await assertMinimumTargetSize(emailInput)
  await assertMinimumTargetSize(submitButton)
  await assertControlBoundaryContrast(emailInput)
  await assertAccessibleWithoutOverflow(page)

  await submitButton.click()
  await expect(emailInput).toBeFocused()
  await expect(emailInput).toHaveAttribute('aria-invalid', 'true')
  await expect(emailInput).toHaveAttribute('aria-describedby', 'login-email-error')
  await expect(page.getByText('Email is required.', { exact: true })).toBeVisible()

  await emailInput.fill('browser.magic-link@example.test')
  await submitButton.click()
  await expect(page.locator('#login-form-status[role="status"]')).toHaveText(
    'If you can receive email at that address, a sign-in link is on its way.'
  )
  await expect(page.getByText('Security check complete.', { exact: true })).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.locator('.mode-tabs')).toHaveCount(0)
  await assertAccessibleWithoutOverflow(page)
  await assertCleanPage(page, observations)
})

test('identity and account journeys stay accessible', async ({ context, page }) => {
  test.setTimeout(60_000)
  await assertIdentityAccountJourney(context, {
    assertAccessibleWithoutOverflow,
    assertCleanPage,
    fulfillJson,
    observePage
  })
  const retiredAuthResponse = await page.goto('/auth')
  expect(retiredAuthResponse?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page).toHaveTitle(`Page not found | ${runtimeName}`)
  await expect(page.getByText('Browser Social User', { exact: true })).toHaveCount(0)
})

test('signed-out private routes reach login before private data is requested', async ({ page }) => {
  const observations = observePage(page)

  for (const path of ['/app', '/account']) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await page.waitForLoadState('networkidle')
  }

  expect(observations.sameOriginRequests.some((request) => request.includes('/api/me'))).toBe(false)
  expect(observations.sameOriginRequests.some((request) => request.includes('/w/'))).toBe(false)
  expect(observations.sameOriginRequests.some((request) => request.includes('/api/workspaces'))).toBe(false)
  await assertAccessibleWithoutOverflow(page)
  await assertCleanPage(page, observations)
})

const privateBrowserTest = test.extend({ screenshot: 'off', trace: 'off', video: 'off' })

privateBrowserTest(
  'real email-only signup keeps account profile fields optional and editable later',
  async ({ page }, testInfo) => {
    testInfo.setTimeout(60_000)
    const observations = observePage(page)
    const project = testInfo.project.name.replaceAll(/[^a-z0-9]/gi, '-').toLowerCase()
    const email = `browser.login+${project}.${authEmailMarker}@example.test`
    const firstName = `Given ${project}`
    const lastName = `Surname ${project}`
    const displayName = `Browser ${testInfo.project.name} member`
    const clientAddress = testInfo.project.name === 'desktop-chromium' ? '192.0.2.10' : '192.0.2.11'

    await page.setExtraHTTPHeaders({ 'cf-connecting-ip': clientAddress })

    await page.goto('/signup')
    await page.waitForLoadState('networkidle')
    const manifestUrl = await nuxtManifestUrl(page)
    await expect(page.getByRole('textbox', { name: /(?:first|last|display) name/i })).toHaveCount(0)
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
    await expect(page.getByText('Security check complete.', { exact: true })).toBeVisible()
    const sendEmailLink = page.getByRole('button', { name: 'Send email link' })
    await expect(sendEmailLink).toBeEnabled()
    const magicLinkRequestPromise = page.waitForRequest(
      (request) => new URL(request.url()).pathname === '/api/auth/sign-in/magic-link'
    )
    await sendEmailLink.click()
    const magicLinkRequest = await magicLinkRequestPromise
    expect(magicLinkRequest.postDataJSON()).toEqual({
      email,
      callbackURL: '/app',
      newUserCallbackURL: '/app',
      errorCallbackURL: '/signup'
    })
    await expect(page.locator('#signup-form-status[role="status"]')).toBeVisible()
    await expect(page.getByText('Security check complete.', { exact: true })).toBeVisible()

    let magicLink
    await expect
      .poll(() => {
        magicLink = capturedMagicLink(email)
        return Boolean(magicLink)
      })
      .toBe(true)

    const appResponse = await gotoForInitialResponse(page, magicLink.href, manifestUrl)
    if (!appResponse) throw new Error('Magic-link navigation did not return a personal-app document response')
    const appHtml = await appResponse.text()
    expect(appResponse.status()).toBe(200)
    expect(appResponse.url()).toBe(`${runtimeUrl}/app`)
    expect(appResponse.headers()['cache-control']).toBe('private, no-store')
    expect(appHtml.includes('Your WCU account is ready.'), 'initial app HTML contains the WCU shell').toBe(true)
    expect(appHtml.includes(email), 'initial app HTML contains the authenticated identity').toBe(true)
    expect(appHtml.includes(displayName), 'initial app HTML excludes profile data that was never collected').toBe(false)
    expect(appHtml.includes('/w/'), 'initial app HTML excludes visible workspace navigation').toBe(false)
    expect(appHtml.includes('activeOrganizationId'), 'initial app HTML excludes active-organization state').toBe(false)
    await expect(page.getByText('Your WCU account is ready.', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
    await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible()
    await openMobileNavigationIfNeeded(page)
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible()
    await expect(page.getByText(/workspace/i)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /workspace/i })).toHaveCount(0)
    const topbar = page.getByRole('banner', { name: 'Application' })
    await expect(topbar.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(topbar.getByRole('link', { name: 'App', exact: true })).toHaveAttribute('aria-current', 'page')
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/workspaces'))).toBe(false)
    await page.waitForLoadState('networkidle')
    await assertAccountMenuContract(page, email, email, observations)

    if (testInfo.project.name === 'desktop-chromium') {
      const signedInHomeResponse = await gotoForInitialResponse(page, '/', manifestUrl)
      if (!signedInHomeResponse) throw new Error('Signed-in home navigation did not return a document response')
      const signedInHomeHtml = await signedInHomeResponse.text()
      expect(signedInHomeResponse.status()).toBe(200)
      expect(signedInHomeResponse.headers()['cache-control']).toBe('private, no-store')
      expect(signedInHomeHtml.includes(email), 'signed-in public HTML contains only a non-cacheable identity').toBe(
        true
      )
      await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible()
      await page.waitForLoadState('networkidle')
    }

    for (const signedInEntry of ['/login', '/signup']) {
      const entryResponse = await gotoForInitialResponse(page, signedInEntry, manifestUrl)
      if (!entryResponse) throw new Error(`Signed-in ${signedInEntry} navigation did not return a document response`)
      expect(entryResponse.status()).toBe(200)
      expect(entryResponse.url()).toBe(`${runtimeUrl}/app`)
      expect(
        (await entryResponse.text()).includes('Your WCU account is ready.'),
        `signed-in ${signedInEntry} continues to the WCU app`
      ).toBe(true)
      await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
    }

    const accountResponse = await gotoForInitialResponse(page, '/account?checkout=success', manifestUrl)
    if (!accountResponse) throw new Error('Account navigation did not return a document response')
    const accountHtml = await accountResponse.text()
    expect(accountResponse.status()).toBe(200)
    expect(accountResponse.url()).toBe(`${runtimeUrl}/account?checkout=success`)
    expect(accountResponse.headers()['cache-control']).toBe('private, no-store')
    expect(
      {
        identity: accountHtml.includes(email),
        sessionError: accountHtml.includes('Account unavailable'),
        sessionPending: accountHtml.includes('Continuing to log in')
      },
      'initial account HTML contains the authenticated identity'
    ).toEqual({ identity: true, sessionError: false, sessionPending: false })
    expect(
      accountHtml.includes('activeOrganizationId'),
      'initial account HTML excludes active-organization state'
    ).toBe(false)
    await expect(page.getByRole('heading', { name: 'Account', exact: true, level: 1 })).toBeVisible()
    await expect(page.getByText(email, { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await openMobileNavigationIfNeeded(page)

    const firstNameInput = page.getByRole('textbox', { name: 'First name', exact: true })
    const lastNameInput = page.getByRole('textbox', { name: 'Last name', exact: true })
    const displayNameInput = page.getByRole('textbox', { name: 'Display name', exact: true })
    await expect(firstNameInput).toHaveValue('')
    await expect(lastNameInput).toHaveValue('')
    await expect(displayNameInput).toHaveValue('')
    await expect(page.getByText('They are not required to use your account.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: `Account menu for ${email}` })).toBeVisible()

    await firstNameInput.fill(`  ${firstName}  `)
    await lastNameInput.fill(`  ${lastName}  `)
    await displayNameInput.fill(`  ${displayName}  `)
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible()
    await expect(firstNameInput).toHaveValue(firstName)
    await expect(lastNameInput).toHaveValue(lastName)
    await expect(displayNameInput).toHaveValue(displayName)

    const namedMenuTrigger = page.getByRole('button', { name: `Account menu for ${displayName}` })
    await expect(namedMenuTrigger).toBeVisible()
    await namedMenuTrigger.click()
    await expect(page.getByRole('menu').getByText(displayName, { exact: true })).toBeVisible()
    await expect(page.getByRole('menu').getByText(email, { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.waitForLoadState('networkidle')

    const namedAppResponse = await gotoForInitialResponse(page, '/app', manifestUrl)
    if (!namedAppResponse) throw new Error('Named-profile navigation did not return a personal-app response')
    const namedAppHtml = await namedAppResponse.text()
    expect(namedAppResponse.status()).toBe(200)
    expect(namedAppHtml.includes(displayName), 'named app HTML contains the explicit display name').toBe(true)
    expect(namedAppHtml.includes(firstName), 'named app HTML excludes the private first name').toBe(false)
    expect(namedAppHtml.includes(lastName), 'named app HTML excludes the private last name').toBe(false)
    await expect(page.getByRole('heading', { name: `Welcome back, ${displayName}` })).toBeVisible()
    await expect(page.getByText(firstName, { exact: true })).toHaveCount(0)
    await expect(page.getByText(lastName, { exact: true })).toHaveCount(0)
    await page.waitForLoadState('networkidle')

    const savedAccountResponse = await gotoForInitialResponse(page, '/account', manifestUrl)
    if (!savedAccountResponse) throw new Error('Saved-profile navigation did not return an account response')
    expect(savedAccountResponse.status()).toBe(200)
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await expect(page.getByRole('textbox', { name: 'First name', exact: true })).toHaveValue(firstName)
    await expect(page.getByRole('textbox', { name: 'Last name', exact: true })).toHaveValue(lastName)
    await expect(page.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue(displayName)
    await page.getByRole('textbox', { name: 'First name', exact: true }).fill('')
    await page.getByRole('textbox', { name: 'Last name', exact: true }).fill('')
    await page.getByRole('textbox', { name: 'Display name', exact: true }).fill('')
    await page.getByRole('button', { name: 'Save profile', exact: true }).click()
    await expect(page.getByText('Profile saved.', { exact: true })).toBeVisible()
    await openMobileNavigationIfNeeded(page)
    await expect(page.getByRole('button', { name: `Account menu for ${email}` })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const clearedAppResponse = await gotoForInitialResponse(page, '/app', manifestUrl)
    if (!clearedAppResponse) throw new Error('Cleared-profile navigation did not return a personal-app response')
    expect(clearedAppResponse.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
    await openMobileNavigationIfNeeded(page)
    await expect(page.getByRole('button', { name: `Account menu for ${email}` })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const deletionAccountResponse = await gotoForInitialResponse(page, '/account', manifestUrl)
    if (!deletionAccountResponse) throw new Error('Deletion navigation did not return an account document response')
    expect(deletionAccountResponse.status()).toBe(200)
    expect(deletionAccountResponse.url()).toBe(`${runtimeUrl}/account`)
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await page.getByRole('textbox', { name: 'Type DELETE to confirm' }).fill('DELETE')
    const deleteAccount = page.getByRole('button', { name: 'Delete account', exact: true })
    await expect(deleteAccount).toBeEnabled()
    await deleteAccount.click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByText(email, { exact: true })).toHaveCount(0)

    const deletedAppResponse = await gotoForInitialResponse(page, '/app', manifestUrl)
    if (!deletedAppResponse) throw new Error('Deleted-account navigation did not return a document response')
    expect(deletedAppResponse.status()).toBe(200)
    expect(deletedAppResponse.url()).toBe(`${runtimeUrl}/login`)
    expect((await deletedAppResponse.text()).includes(email), 'deleted identity is absent from signed-out HTML').toBe(
      false
    )
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await assertAccessibleWithoutOverflow(page)
    await assertCleanPage(page, observations)
  }
)

test('observability route is active without sending a missing token', async ({ page }) => {
  const observations = observePage(page)
  const observabilityResponse = await page.goto('/observability-client-test')
  expect(observabilityResponse?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Client Event Test' })).toBeVisible()
  await expect(page.getByText('Missing token hash.', { exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Observability test')
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  await assertAccessibleWithoutOverflow(page)
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/auth'))).toEqual([
    `GET ${runtimeUrl}/api/auth/get-session`
  ])
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/account/billing'))).toEqual([])
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/observability'))).toEqual([])
  await assertCleanPage(page, observations)
})

async function openMobileNavigationIfNeeded(page) {
  const menuToggle = page.getByRole('button', { name: 'Menu', exact: true })
  if (!(await menuToggle.isVisible())) return
  if ((await menuToggle.getAttribute('aria-expanded')) === 'true') return
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  await menuToggle.click()
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true')
}

async function assertAccountMenuContract(page, displayName, email, observations) {
  const trigger = page.getByRole('button', { name: `Account menu for ${displayName}` })
  const menu = page.getByRole('menu')

  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(menu).toBeVisible()
  await expect(menu.getByText(displayName, { exact: true })).toBeVisible()
  await expect(menu.getByText(email, { exact: true })).toBeVisible()
  await page.mouse.click(1, 1)
  await expect(menu).toBeHidden()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.focus()
  await page.keyboard.press('Enter')
  const accountItem = page.getByRole('menuitem', { name: 'Account', exact: true })
  const signOutItem = page.getByRole('menuitem', { name: 'Sign out', exact: true })
  await expect(accountItem).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(signOutItem).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(accountItem).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(signOutItem).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Space')
  await expect(menu).toBeVisible()
  await expect(accountItem).toBeFocused()
  await page.keyboard.press('s')
  await expect(signOutItem).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()

  const previousViewport = page.viewportSize()
  await page.setViewportSize({ width: 320, height: 800 })
  await openMobileNavigationIfNeeded(page)
  await trigger.click()
  await expect(menu).toBeVisible()
  await assertNoHorizontalOverflow(page)
  const menuBox = await menu.boundingBox()
  expect(menuBox, 'account menu has a rendered box').not.toBeNull()
  expect(menuBox.x, 'account menu stays inside the narrow viewport').toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width, 'account menu stays inside the narrow viewport').toBeLessThanOrEqual(320)
  await page.keyboard.press('Escape')
  if (previousViewport) await page.setViewportSize(previousViewport)

  let signOutRequested = false
  let releaseSignOutResponse = () => {}
  const signOutResponseReady = new Promise((resolve) => {
    releaseSignOutResponse = resolve
  })
  await page.route('**/api/auth/sign-out', async (route) => {
    signOutRequested = true
    await signOutResponseReady
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'SIGN_OUT_UNAVAILABLE', message: 'Sign out unavailable' })
    })
  })
  await trigger.click()
  await signOutItem.click()
  await expect.poll(() => signOutRequested).toBe(true)
  const pendingSignOut = page.getByRole('menuitem', { name: 'Signing out...', exact: true })
  await expect(pendingSignOut).toBeDisabled()
  await expect(pendingSignOut).toHaveAttribute('aria-busy', 'true')
  await expect(pendingSignOut).toHaveAttribute('data-disabled', '')
  await accountItem.focus()
  await page.keyboard.press('ArrowDown')
  await expect(accountItem).toBeFocused()
  releaseSignOutResponse()
  await expect(page.getByRole('alert')).toHaveText(
    'We could not confirm that you were signed out. Your session may still be active. Please try again.'
  )
  await page.unroute('**/api/auth/sign-out')
  observations.errorResponses = observations.errorResponses.filter(
    (entry) => !(entry.includes('503') && entry.includes('/api/auth/sign-out'))
  )
  observations.console = observations.console.filter(
    (entry) => !/Failed to load resource: the server responded with a status of 503/.test(entry)
  )
  await page.keyboard.press('Escape')

  await trigger.click()
  await page.evaluate(() => window.useNuxtApp?.().$router.push('/account'))
  await expect(page).toHaveURL(/\/account$/)
  await expect(menu).toBeHidden()
  await expect(page.locator('.nuxt-route-announcer [role="status"]')).toHaveText('Account')
}

function capturedMagicLink(email) {
  if (!existsSync(emailCaptureDirectory)) return undefined
  const entries = readdirSync(emailCaptureDirectory, { withFileTypes: true })
  if (entries.length > maxCaptureFiles) throw new Error('Too many passwordless capture envelopes were present')
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    let capture
    try {
      const path = join(emailCaptureDirectory, entry.name)
      const expectedSize = statSync(path).size
      if (expectedSize > maxCaptureFileBytes) throw new Error()
      const bytes = readFileSync(path)
      if (bytes.length !== expectedSize) throw new Error()
      capture = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new Error('The passwordless capture envelope was unreadable')
    }
    if (capture.version !== 1 || capture.transport !== 'capture') {
      throw new Error('The passwordless capture envelope had an unsupported format')
    }
    if (capture?.message?.to !== email) continue
    const match = capture?.message?.text?.match(/https?:\/\/\S+/)
    let url
    try {
      url = match ? new URL(match[0]) : undefined
    } catch {
      throw new Error('The passwordless capture envelope contained an invalid link')
    }
    if (
      !url ||
      url.origin !== new URL(runtimeUrl).origin ||
      url.pathname !== '/api/auth/magic-link/verify' ||
      !url.searchParams.get('token')
    ) {
      throw new Error('The passwordless capture envelope did not contain the expected private link')
    }
    return url
  }
  return undefined
}

async function assertContentSecurityPolicy(page, response, observations) {
  if (!response) throw new Error('The home navigation did not return a document response')
  const headers = response.headers()
  const policy = headers['content-security-policy'] ?? ''
  const nonce = contentSecurityPolicyNonce(policy)

  expect(headers['content-security-policy-report-only']).toBeUndefined()
  expect(normalizedContentSecurityPolicy(policy)).toEqual({
    'base-uri': ["'none'"],
    'connect-src': ["'self'", runtimeSentryOrigin].sort(),
    'default-src': ["'none'"],
    'font-src': ["'self'", 'data:'].sort(),
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': [turnstileOrigin],
    'img-src': ["'self'", 'data:'].sort(),
    'manifest-src': ["'self'"],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'script-src': ["'self'", "'strict-dynamic'", `'nonce-${nonce}'`, turnstileOrigin].sort(),
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", `'nonce-${nonce}'`].sort(),
    'style-src-attr': ["'unsafe-inline'"],
    'upgrade-insecure-requests': [],
    'worker-src': ["'self'"]
  })

  const initialHtml = await response.text()
  const initialDocument = await page.evaluate((html) => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    return {
      assets: [
        ...document.querySelectorAll(
          'script[src], link[rel~="stylesheet"][href], link[rel~="preload"][href], link[rel~="modulepreload"][href]'
        )
      ].map((element) => ({
        integrity: element.getAttribute('integrity'),
        rel: element.getAttribute('rel'),
        resource: element.getAttribute('src') ?? element.getAttribute('href'),
        tag: element.tagName.toLowerCase()
      })),
      noncedElements: [...document.querySelectorAll('script:not(#csp-unapproved-inline-script-probe), style')].map(
        (element) => ({ nonce: element.getAttribute('nonce'), tag: element.tagName.toLowerCase() })
      )
    }
  }, initialHtml)
  expect(initialDocument.noncedElements.length).toBeGreaterThan(0)
  expect(initialDocument.noncedElements).toEqual(initialDocument.noncedElements.map(({ tag }) => ({ nonce, tag })))
  expect(await page.locator('#csp-unapproved-inline-script-probe').getAttribute('nonce')).toBeNull()

  const bundledAssets = initialDocument.assets.filter((asset) => {
    const resource = new URL(asset.resource, runtimeUrl)
    return resource.origin === new URL(runtimeUrl).origin && /^\/_nuxt\//.test(resource.pathname)
  })
  expect(bundledAssets.length).toBeGreaterThan(0)
  expect(bundledAssets.some((asset) => asset.tag === 'script')).toBe(true)
  expect(bundledAssets.some((asset) => asset.rel?.split(/\s+/).includes('stylesheet'))).toBe(true)
  for (const asset of bundledAssets) {
    expect(asset.integrity).toMatch(/^sha384-/)
  }

  const secondResponse = await page.request.get('/login')
  expect(secondResponse.ok()).toBe(true)
  expect(contentSecurityPolicyNonce(secondResponse.headers()['content-security-policy'] ?? '')).not.toBe(nonce)

  const marker = await page.evaluate(() => window.__cspUnapprovedInlineScriptRan === true)
  expect(marker).toBe(false)
  const expectedViolations = observations.console.filter(
    (message) =>
      message.startsWith('error:') &&
      /content security policy/i.test(message) &&
      /inline script/i.test(message) &&
      /script-src/i.test(message)
  )
  expect(expectedViolations).toHaveLength(1)
  observations.console = observations.console.filter((message) => !expectedViolations.includes(message))
}

function contentSecurityPolicyNonce(policy) {
  const nonce = policy.match(/(?:^|;)\s*script-src\s[^;]*'nonce-([^']+)'/)?.[1]
  if (!nonce) throw new Error('The enforced script policy did not contain a request nonce')
  return nonce
}

function normalizedContentSecurityPolicy(policy) {
  const directives = {}
  for (const segment of policy.split(';')) {
    const [name, ...sources] = segment.trim().split(/\s+/)
    if (!name) continue
    if (Object.hasOwn(directives, name)) throw new Error(`The enforced policy repeated ${name}`)
    directives[name] = sources.sort()
  }
  return directives
}

async function assertRuntimePublicConfig(page) {
  const configSource = await runtimeConfigSource(page)

  expect(configSource).toContain(`appName:${JSON.stringify(runtimeName)}`)
  expect(configSource).toContain(`appUrl:${JSON.stringify(runtimeUrl)}`)
  expect(configSource).toContain('sentryEnvironment:"runtime-browser"')
  expect(configSource).toContain(`sentryRelease:${JSON.stringify(runtimeSentryRelease)}`)
  expect(configSource).toMatch(/sentryTracesSampleRate:(?:0?\.125|"0\.125")/)
  expect(configSource).not.toContain(buildName)
  expect(configSource).not.toContain(buildUrl)
  expect(configSource).not.toContain(buildSentryRelease)
  expect(configSource).not.toContain(runtimeAuthSecret)
  expect(configSource).not.toContain(runtimeReadinessToken)
  expect(configSource).not.toContain(buildReadinessToken)
  expect(configSource).not.toContain(runtimeDatabase)
  expect(configSource).not.toContain(runtimeStripeSecret)
  expect(configSource).not.toContain(runtimeStripeWebhookSecret)
  expect(configSource).not.toContain('moduleStates')
}

async function runtimeConfigSource(page) {
  const configSource = await page
    .locator('script:not([src])')
    .evaluateAll((scripts) =>
      scripts.map((script) => script.textContent ?? '').find((text) => text.includes('window.__NUXT__.config='))
    )
  expect(configSource).toBeDefined()
  return configSource
}

async function nuxtManifestUrl(page) {
  const buildId = await page.evaluate(() => window.useNuxtApp?.()?.$config?.app?.buildId)
  expect(buildId, 'Nuxt runtime config exposes its build ID').toBeTruthy()
  return new URL(`/_nuxt/builds/meta/${encodeURIComponent(buildId)}.json`, runtimeUrl).href
}

async function fulfillJson(route, value, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value)
  })
}

async function assertAccessibleWithoutOverflow(page) {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])

  await assertNoHorizontalOverflow(page)
}

async function assertNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    bodyClient: document.body.clientWidth,
    bodyScroll: document.body.scrollWidth,
    documentClient: document.documentElement.clientWidth,
    documentScroll: document.documentElement.scrollWidth
  }))
  expect(dimensions.bodyScroll).toBeLessThanOrEqual(dimensions.bodyClient)
  expect(dimensions.documentScroll).toBeLessThanOrEqual(dimensions.documentClient)
}

async function assertMinimumTargetSize(locator) {
  const box = await locator.boundingBox()
  expect(box, 'interactive target has a rendered bounding box').not.toBeNull()
  expect(box.width, 'interactive target is at least 44 CSS pixels wide').toBeGreaterThanOrEqual(44)
  expect(box.height, 'interactive target is at least 44 CSS pixels tall').toBeGreaterThanOrEqual(44)
}

async function assertVisibleFocusIndicator(page, locator) {
  const appearance = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth)
    }
  })
  const canvas = await page.locator('html').evaluate((element) => getComputedStyle(element).backgroundColor)

  expect(appearance.style).toBe('solid')
  expect(appearance.width).toBeGreaterThanOrEqual(2)
  expect(contrastRatio(appearance.color, canvas), 'focus ring contrast against the canvas').toBeGreaterThanOrEqual(3)
}

async function assertControlBoundaryContrast(locator) {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return { border: style.borderTopColor, background: style.backgroundColor }
  })

  expect(contrastRatio(colors.border, colors.background), 'control boundary contrast').toBeGreaterThanOrEqual(3)
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left)
  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

function relativeLuminance(color) {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  if (!channels || channels.length !== 3) throw new Error(`Unsupported computed color: ${color}`)
  const linear = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function observePage(page) {
  const observations = {
    allConsole: [],
    console: [],
    crashes: 0,
    errorResponses: [],
    externalRequests: [],
    failedRequests: [],
    pageErrors: [],
    sameOriginRequests: []
  }
  const allowedOrigin = new URL(runtimeUrl).origin

  page.on('console', (message) => {
    observations.allConsole.push(`${message.type()}: ${message.text()}`)
    if (message.type() === 'warning' || message.type() === 'error') {
      observations.console.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('crash', () => {
    observations.crashes += 1
  })
  page.on('pageerror', (error) => {
    observations.pageErrors.push(error.message)
  })
  page.on('requestfailed', (request) => {
    if (isIsolatedBrowserProviderRequest(request)) return
    if (isExpectedManifestNavigationAbort(page, request)) return
    observations.failedRequests.push(
      `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`
    )
  })
  page.on('response', (response) => {
    const url = response.url()
    if (new URL(url).origin === allowedOrigin && response.status() >= 400) {
      observations.errorResponses.push(`${response.request().method()} ${response.status()} ${url}`)
    }
  })
  page.on('request', (request) => {
    const url = request.url()
    if (isIsolatedBrowserProviderRequest(request)) return
    if (/^(?:data|blob|about):/i.test(url)) {
      return
    }
    try {
      if (new URL(url).origin !== allowedOrigin) {
        observations.externalRequests.push(`${request.method()} ${url}`)
      } else {
        observations.sameOriginRequests.push(`${request.method()} ${url}`)
      }
    } catch {
      observations.externalRequests.push(`${request.method()} ${url}`)
    }
  })

  return observations
}

function isIsolatedBrowserProviderRequest(request) {
  if (request.method() === 'GET' && request.url() === turnstileScriptUrl) return true
  if (request.method() !== 'POST') return false

  const url = new URL(request.url())
  return url.origin === runtimeSentryOrigin && url.pathname === sentryEnvelopePath
}

async function gotoForInitialResponse(page, url, manifestUrl) {
  intentionalManifestNavigations.set(page, manifestUrl)
  try {
    return await page.goto(url)
  } finally {
    intentionalManifestNavigations.delete(page)
  }
}

function isExpectedManifestNavigationAbort(page, request) {
  return (
    request.failure()?.errorText === 'net::ERR_ABORTED' &&
    request.url() === intentionalManifestNavigations.get(page) &&
    request.method() === 'GET' &&
    request.resourceType() === 'fetch' &&
    !request.isNavigationRequest()
  )
}

async function assertCleanPage(page, observations) {
  const hydrationWarnings = observations.allConsole.filter((message) =>
    /hydration|mismatch|\[?vue warn\]?/i.test(message)
  )
  const excludedCapabilityRequests = observations.sameOriginRequests.filter((request) =>
    /\/api\/(?:ai|files)(?:[/?]|$)/.test(request)
  )
  expect(observations.console, 'console warning/error output').toEqual([])
  expect(hydrationWarnings, 'hydration warning output').toEqual([])
  expect(observations.pageErrors, 'uncaught page errors').toEqual([])
  expect(observations.failedRequests, 'failed browser requests').toEqual([])
  expect(observations.errorResponses, 'same-origin HTTP error responses').toEqual([])
  expect(observations.externalRequests, 'external browser requests').toEqual([])
  expect(excludedCapabilityRequests, 'AI/Files browser requests').toEqual([])
  expect(observations.crashes, 'page crashes').toBe(0)
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required; run this spec through npm run test:browser`)
  }
  return value
}
