import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { assertFamilyAccountActionsJourney } from '../../apps/web/tests/browser/family-account-actions-journey.mjs'
import { assertFamilyBillingJourney } from '../../apps/web/tests/browser/family-billing-journey.mjs'
import { assertIdentityAccountJourney } from '../../apps/web/tests/browser/identity-account-journey.mjs'
import { assertWorkspaceInvitationJourney } from '../../apps/web/tests/browser/invitation-journey.mjs'
import {
  assertPrivateProjectJourney,
  assertRealProjectSuccessJourney
} from '../../apps/web/tests/browser/private-project-journey.mjs'
import { assertProjectBoundaryJourney } from '../../apps/web/tests/browser/project-boundary-journey.mjs'

const runtimeName = requiredEnvironment('BROWSER_RUNTIME_APP_NAME')
const runtimeUrl = requiredEnvironment('BROWSER_RUNTIME_APP_URL')
const runtimeAuthSecret = requiredEnvironment('BROWSER_RUNTIME_AUTH_SECRET')
const runtimeDatabase = requiredEnvironment('BROWSER_RUNTIME_DATABASE_PATH')
const runtimeGoogleClientId = requiredEnvironment('BROWSER_RUNTIME_GOOGLE_CLIENT_ID')
const runtimeGoogleClientSecret = requiredEnvironment('BROWSER_RUNTIME_GOOGLE_CLIENT_SECRET')
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
const maxCaptureFileBytes = 65_536
const maxCaptureFiles = 64
const intentionalManifestNavigations = new WeakMap()
const expectedModuleStates = {
  ai: 'disabled',
  billing: 'ready',
  files: 'disabled',
  jobs: 'ready',
  observability: 'disabled',
  turnstile: 'disabled'
}

test('home presents the personal foundation and preserves client navigation', async ({ page }) => {
  const observations = observePage(page)
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
  await expect(page.getByRole('heading', { name: 'A simple, private place to begin.' })).toBeVisible()
  await expect(page.getByText('Your data stays yours', { exact: true })).toBeVisible()
  await expect(page.locator('.brand')).toContainText(runtimeName)
  await expect(page.locator('.brand')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle('Home')
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  await assertRuntimePublicConfig(page)
  await assertAccessibleWithoutOverflow(page)

  const skipLink = page.getByRole('link', { name: 'Skip to main content' })
  await assertMinimumTargetSize(page.locator('.brand'))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'App', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'Get started', exact: true }))
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
  await page.getByRole('link', { name: 'Get started', exact: true }).click()
  await expect(page).toHaveURL(/\/signup$/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign up', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle('Sign up')
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

test('login is accessible before and after requesting a magic link', async ({ page }, testInfo) => {
  test.setTimeout(35_000)
  const observations = observePage(page)
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
  await expect(page.locator('.brand')).toContainText(runtimeName)
  await expect(page).toHaveTitle('Log in')
  await assertRuntimePublicConfig(page)
  const emailInput = page.getByRole('textbox', { name: 'Email', exact: true })
  await expect(emailInput).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.locator('.mode-tabs')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0)
  await expect(page.getByLabel('Security check')).toHaveCount(0)
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  const submitButton = page.getByRole('button', { name: 'Send email link' })
  await expect(submitButton).toBeEnabled()
  await assertMinimumTargetSize(emailInput)
  await assertMinimumTargetSize(submitButton)
  await assertControlBoundaryContrast(emailInput)
  await assertAccessibleWithoutOverflow(page)

  await emailInput.fill('browser.magic-link@example.test')
  await submitButton.click()
  await expect(page.locator('#login-form-status[role="status"]')).toHaveText(
    'If you can receive email at that address, a sign-in link is on its way.'
  )
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.locator('.mode-tabs')).toHaveCount(0)
  await assertAccessibleWithoutOverflow(page)
  await assertCleanPage(page, observations)

  await assertEnabledGoogleSignInHandoff(page.context())
  await assertSignedInAccountMenuAndGoogleUnlink(page.context(), testInfo.project.name)
})

test('identity, account, billing, invitation, and project journeys stay accessible', async ({
  context,
  page
}, testInfo) => {
  test.setTimeout(120_000)
  await assertIdentityAccountJourney(context, {
    assertAccessibleWithoutOverflow,
    assertCleanPage,
    fulfillJson,
    observePage,
    removeExpectedHttpFailure
  })
  await assertFamilyAccountActionsJourney(context, {
    assertAccessibleWithoutOverflow,
    assertNoHorizontalOverflow,
    assertCleanPage,
    fulfillJson,
    observePage,
    removeExpectedHttpFailure
  })
  await assertFamilyBillingJourney(
    context,
    {
      assertAccessibleWithoutOverflow,
      assertNoHorizontalOverflow,
      assertCleanPage,
      fulfillJson,
      observePage,
      removeExpectedHttpFailure,
      removeExpectedConsoleFailures
    },
    testInfo.project.name
  )
  await assertWorkspaceInvitationJourney(context, {
    assertAccessibleWithoutOverflow,
    assertCleanPage,
    fulfillJson,
    observePage,
    removeExpectedHttpFailure
  })
  if (testInfo.project.name === 'desktop-chromium') {
    await assertPrivateProjectJourney(context, {
      assertAccessibleWithoutOverflow,
      assertNoHorizontalOverflow,
      assertCleanPage,
      fulfillJson,
      observePage,
      removeExpectedHttpFailure
    })
    await assertProjectBoundaryJourney(context, {
      assertAccessibleWithoutOverflow,
      assertCleanPage,
      fulfillJson,
      observePage,
      removeExpectedHttpFailure
    })
  }

  const retiredAuthResponse = await page.goto('/auth')
  expect(retiredAuthResponse?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await expect(page).toHaveTitle(`Page not found | ${runtimeName}`)
  await expect(page.getByText('Browser Social User', { exact: true })).toHaveCount(0)
})

test('signed-out private routes reach login before project data is requested', async ({ page }) => {
  const observations = observePage(page)

  for (const path of ['/app', '/app/projects', '/app/projects/project_private']) {
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await page.waitForLoadState('networkidle')
  }

  expect(observations.sameOriginRequests.some((request) => request.includes('/api/me'))).toBe(false)
  expect(observations.sameOriginRequests.some((request) => request.includes('/api/projects'))).toBe(false)
  await expect(page.getByRole('link', { name: 'Projects', exact: true })).toHaveCount(0)
  expect(observations.sameOriginRequests.some((request) => request.includes('/w/'))).toBe(false)
  expect(observations.sameOriginRequests.some((request) => request.includes('/api/workspaces'))).toBe(false)
  await assertAccessibleWithoutOverflow(page)
  await assertCleanPage(page, observations)
})

const privateBrowserTest = test.extend({ screenshot: 'off', trace: 'off', video: 'off' })

privateBrowserTest(
  'real magic-link login reaches initial and hydrated app and account views',
  async ({ page }, testInfo) => {
    testInfo.setTimeout(45_000)
    const observations = observePage(page)
    const project = testInfo.project.name.replaceAll(/[^a-z0-9]/gi, '-').toLowerCase()
    const email = `browser.login+${project}.${authEmailMarker}@example.test`
    const clientAddress = testInfo.project.name === 'desktop-chromium' ? '192.0.2.10' : '192.0.2.11'

    await page.setExtraHTTPHeaders({ 'cf-connecting-ip': clientAddress })

    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    const manifestUrl = await nuxtManifestUrl(page)
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
    await page.getByRole('button', { name: 'Send email link' }).click()
    await expect(page.locator('#login-form-status[role="status"]')).toBeVisible()

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
    expect(appHtml.includes('Your private app is ready.'), 'initial app HTML contains the personal shell').toBe(true)
    expect(appHtml.includes(email), 'initial app HTML contains the authenticated identity').toBe(true)
    expect(appHtml.includes('/w/'), 'initial app HTML excludes visible workspace navigation').toBe(false)
    expect(appHtml.includes('activeOrganizationId'), 'initial app HTML excludes active-organization state').toBe(false)
    await expect(page.getByText('Your app', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible()
    await expect(page.getByText(/workspace/i)).toHaveCount(0)
    await expect(page.getByRole('link', { name: /workspace/i })).toHaveCount(0)
    const primaryNavigation = page.getByRole('navigation', { name: 'Primary' })
    await expect(primaryNavigation.locator('[aria-current="page"]')).toHaveCount(1)
    await expect(primaryNavigation.getByRole('link', { name: 'App', exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/workspaces'))).toBe(false)
    await page.waitForLoadState('networkidle')

    if (testInfo.project.name === 'desktop-chromium') {
      await assertRealProjectSuccessJourney(page, { assertAccessibleWithoutOverflow }, project)
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
        (await entryResponse.text()).includes('Your private app is ready.'),
        `signed-in ${signedInEntry} continues to the personal app`
      ).toBe(true)
      await expect(page.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
    }

    const accountResponse = await gotoForInitialResponse(page, '/account', manifestUrl)
    if (!accountResponse) throw new Error('Account navigation did not return a document response')
    const accountHtml = await accountResponse.text()
    expect(accountResponse.status()).toBe(200)
    expect(accountResponse.url()).toBe(`${runtimeUrl}/account`)
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
    await expect(page.getByRole('button', { name: /^Account menu for / })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const billingStateResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return response.request().method() === 'GET' && url.pathname === '/api/account/billing'
    })
    const deletionAccountResponse = await gotoForInitialResponse(page, '/account', manifestUrl)
    if (!deletionAccountResponse) throw new Error('Deletion navigation did not return an account document response')
    expect(deletionAccountResponse.status()).toBe(200)
    expect(deletionAccountResponse.url()).toBe(`${runtimeUrl}/account`)
    const billingStateResponse = await billingStateResponsePromise
    expect(billingStateResponse.status()).toBe(200)
    const billingState = await billingStateResponse.json()
    expect(billingState.relationship).toEqual({ kind: 'independent' })
    expect(billingState.seats).toBeNull()
    expect(billingState.members).toBeNull()
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await expect(page.getByRole('heading', { name: 'Billing', exact: true, level: 2 })).toBeVisible()
    await expect(page.getByRole('link', { name: 'View billing', exact: true })).toBeVisible()
    await expect(page.locator('#family-access')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Share access', exact: true })).toHaveCount(0)
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

test('disabled observability route returns a not-found boundary without provider calls', async ({ page }) => {
  const observations = observePage(page)
  const observabilityResponse = await page.goto('/observability-client-test#token=disabled-token-must-not-be-sent')
  expect(observabilityResponse?.status()).toBe(404)
  expect(await observabilityResponse?.text()).toContain('MODULE_DISABLED')
  await expect(page).toHaveURL(/#token=disabled-token-must-not-be-sent$/)
  await expect(page.getByRole('main')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Module unavailable' })).toBeVisible()
  await expect(page.getByText('MODULE_DISABLED', { exact: true })).toBeVisible()
  await expect(page).toHaveTitle(`Module unavailable | ${runtimeName}`)
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  await assertAccessibleWithoutOverflow(page)
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/auth'))).toEqual([])
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/account/billing'))).toEqual([])
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/observability'))).toEqual([])
  const expectedNotFoundResponses = observations.errorResponses.filter(
    (response) => response.includes('GET 404') && response.includes('/observability-client-test')
  )
  expect(expectedNotFoundResponses).toHaveLength(1)
  const expectedNotFoundConsole = observations.console.filter(
    (message) =>
      message === 'error: Failed to load resource: the server responded with a status of 404 (Module disabled)'
  )
  expect(expectedNotFoundConsole).toHaveLength(1)
  observations.errorResponses = observations.errorResponses.filter(
    (response) => !expectedNotFoundResponses.includes(response)
  )
  observations.console = observations.console.filter((message) => !expectedNotFoundConsole.includes(message))
  await assertCleanPage(page, observations)
})

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
    'connect-src': ["'self'"],
    'default-src': ["'none'"],
    'font-src': ["'self'", 'data:'].sort(),
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': ["'none'"],
    'img-src': ["'self'", 'data:'].sort(),
    'manifest-src': ["'self'"],
    'media-src': ["'self'"],
    'object-src': ["'none'"],
    'script-src': ["'self'", "'strict-dynamic'", `'nonce-${nonce}'`].sort(),
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
  expect(configSource).not.toContain(runtimeGoogleClientId)
  expect(configSource).not.toContain(runtimeGoogleClientSecret)
  expect(configSource).not.toContain(runtimeStripeSecret)
  expect(configSource).not.toContain(runtimeStripeWebhookSecret)

  for (const [moduleId, state] of Object.entries(expectedModuleStates)) {
    expect(configSource).toContain(`${moduleId}:${JSON.stringify(state)}`)
  }
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

async function assertEnabledGoogleSignInHandoff(context) {
  const page = await context.newPage()
  const observations = observePage(page)
  let signInBody

  try {
    await page.route('**/api/baseline', (route) =>
      fulfillJson(route, {
        socialProviders: { google: 'ready' }
      })
    )
    await page.route('**/api/auth/get-session', (route) => fulfillJson(route, null))
    await page.route('**/api/auth/sign-in/social', async (route) => {
      signInBody = route.request().postDataJSON()
      await fulfillJson(route, { redirect: false, url: null })
    })

    await page.goto('/')
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Log in', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    const googleButton = page.getByRole('button', { name: 'Continue with Google' })
    await expect(googleButton).toBeVisible()
    await googleButton.click()
    await expect
      .poll(() => signInBody)
      .toEqual({
        provider: 'google',
        callbackURL: '/app',
        newUserCallbackURL: '/app',
        errorCallbackURL: '/login'
      })
    await expect(googleButton).toBeEnabled()
    await assertAccessibleWithoutOverflow(page)
    await assertCleanPage(page, observations)
  } finally {
    await page.close()
  }
}

async function assertSignedInAccountMenuAndGoogleUnlink(context, projectName) {
  const page = await context.newPage()
  const observations = observePage(page)
  const now = new Date().toISOString()
  const userName = 'Browser Social User With A Deliberately Long Personal Name'
  const userEmail = 'browser.social.with.a.long.address@example.test'
  const organizationSentinel = 'joined-family-plan-must-not-enter-hydration'
  const sessionTokenSentinel = 'browser-session-token-must-not-enter-hydration'
  const userFieldSentinel = 'browser-user-image-must-not-enter-hydration'
  let unlinkBody
  let peerPage
  let peerObservations
  const signOutRequests = []
  let accountLinked = true
  let sessionActive = true
  let releaseFailedSignOut
  const failedSignOutGate = new Promise((resolve) => {
    releaseFailedSignOut = resolve
  })
  const fulfillSession = (route) => {
    if (!sessionActive) return fulfillJson(route, null)
    return fulfillJson(route, {
      session: {
        id: 'browser-social-session',
        token: sessionTokenSentinel,
        userId: 'browser-social-user',
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ipAddress: null,
        userAgent: null,
        activeOrganizationId: organizationSentinel
      },
      user: {
        id: 'browser-social-user',
        name: userName,
        email: userEmail,
        emailVerified: true,
        image: userFieldSentinel,
        createdAt: now,
        updatedAt: now
      }
    })
  }

  try {
    await page.route('**/api/baseline', (route) =>
      fulfillJson(route, {
        socialProviders: { google: 'ready' }
      })
    )
    await page.route('**/api/auth/get-session', fulfillSession)
    await page.route('**/api/auth/list-accounts', (route) =>
      fulfillJson(
        route,
        accountLinked
          ? [
              {
                id: 'browser-google-account',
                providerId: 'google',
                accountId: 'browser-google-subject',
                userId: 'browser-social-user',
                scopes: ['openid', 'email'],
                createdAt: now,
                updatedAt: now
              }
            ]
          : []
      )
    )
    await page.route('**/api/invitations', (route) => fulfillJson(route, { invitations: [] }))
    await page.route('**/api/auth/unlink-account', async (route) => {
      unlinkBody = route.request().postDataJSON()
      accountLinked = false
      await fulfillJson(route, { status: true })
    })
    await page.route('**/api/auth/sign-out', async (route) => {
      signOutRequests.push({
        method: route.request().method(),
        body: route.request().postDataJSON()
      })

      if (signOutRequests.length === 1) {
        await failedSignOutGate
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Temporary sign-out failure' })
        })
        return
      }

      sessionActive = false
      await fulfillJson(route, { success: true })
    })

    await page.goto('/')
    const namedTrigger = page.getByRole('button', { name: `Account menu for ${userName}` })
    const trigger = page.locator('.account-menu-trigger')
    const accountItem = page.getByRole('menuitem', { name: 'Account', exact: true })
    const shareItem = page.getByRole('menuitem', { name: 'Share access', exact: true })
    const signOutItem = page.getByRole('menuitem', { name: 'Sign out', exact: true })
    const menu = page.getByRole('menu')

    await expect(namedTrigger).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-label', `Account menu for ${userName}`)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await assertMinimumTargetSize(trigger)
    await trigger.focus()
    await expect(trigger).toBeFocused()
    await assertVisibleFocusIndicator(page, trigger)

    await page.keyboard.press('Enter')
    await expect(menu).toBeVisible()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(accountItem).toBeFocused()
    await expect(accountItem).toHaveAttribute('href', '/account')
    await expect(shareItem).toHaveCount(0)
    expect(await accountItem.evaluate((element) => element.tagName)).toBe('A')
    expect(await signOutItem.evaluate((element) => element.tagName)).toBe('BUTTON')
    await assertMinimumTargetSize(accountItem)
    await assertMinimumTargetSize(signOutItem)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()

    await page.keyboard.press('Space')
    await expect(accountItem).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await expect(accountItem).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(signOutItem).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(accountItem).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()

    await trigger.click()
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(userName)
    await expect(menu).toContainText(userEmail)
    await expect(menu).not.toContainText(/workspace|organization|role|capabilit/i)
    expect((await page.content()).includes(organizationSentinel), 'organization state is absent from hydration').toBe(
      false
    )
    expect((await page.content()).includes('activeOrganizationId'), 'organization field is absent from hydration').toBe(
      false
    )
    expect((await page.content()).includes(sessionTokenSentinel), 'session token is absent from hydration').toBe(false)
    expect((await page.content()).includes(userFieldSentinel), 'unused user fields are absent from hydration').toBe(
      false
    )
    await assertAccountMenuFitsViewport(page, menu)
    await assertAccessibleWithoutOverflow(page)

    const viewport = page.viewportSize()
    expect(viewport, 'browser project has a viewport').not.toBeNull()
    await page.mouse.click(viewport.width - 4, viewport.height - 4)
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()

    if (projectName === 'desktop-chromium') {
      await page.setViewportSize({ width: 640, height: 900 })
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%'
      })
      await trigger.click()
      await expect(menu).toBeVisible()
      await assertAccountMenuFitsViewport(page, menu)
      await assertNoHorizontalOverflow(page)
      await page.keyboard.press('Escape')
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('font-size')
      })
      await page.setViewportSize({ width: 1280, height: 900 })
    }

    await trigger.click()
    await accountItem.click()
    await expect(page).toHaveURL(/\/account$/)
    await expect(menu).toBeHidden()
    await expect(page.getByText(userName, { exact: true })).toBeVisible()

    await expect(page.getByText('Google is linked as a sign-in method for this app.', { exact: true })).toBeVisible()
    const unlinkButton = page.getByRole('button', { name: 'Remove Google sign-in' })
    await expect(unlinkButton).toBeEnabled()
    await unlinkButton.click()
    await expect.poll(() => unlinkBody).toEqual({ providerId: 'google', accountId: 'browser-google-subject' })
    await expect(
      page.getByText('No Google account is linked. Email sign-in remains available.', { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText(
        'Google sign-in removed from this app. Email sign-in remains available. This does not revoke access in Google.',
        { exact: true }
      )
    ).toBeVisible()
    await expect(unlinkButton).toHaveCount(0)
    await expect(
      page.getByText(
        "To add Google, log out and continue with Google using this account's same verified email address.",
        { exact: true }
      )
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Connect Google' })).toHaveCount(0)
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/auth/link-social'))).toBe(false)
    expect(observations.sameOriginRequests.some((request) => request.includes('/api/auth/sign-in/social'))).toBe(false)

    await trigger.click()
    await signOutItem.focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => signOutRequests).toEqual([{ method: 'POST', body: {} }])
    await expect(page.getByRole('menuitem', { name: 'Signing out...' })).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByRole('menuitem', { name: 'Signing out...' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(signOutRequests).toHaveLength(1)
    releaseFailedSignOut()
    await expect(page.getByRole('alert')).toHaveText(
      'We could not confirm that you were signed out. Your session may still be active. Please try again.'
    )
    await expect(menu).toBeVisible()
    await expect(menu.getByText(userName, { exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeEnabled()
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeFocused()

    const expectedFailure = observations.errorResponses.find(
      (response) => response.includes('POST 503') && response.includes('/api/auth/sign-out')
    )
    expect(expectedFailure, 'the deliberate sign-out failure was observed').toBeDefined()
    observations.errorResponses = observations.errorResponses.filter((response) => response !== expectedFailure)
    const expectedConsoleFailure = observations.console.find(
      (message) =>
        message === 'error: Failed to load resource: the server responded with a status of 503 (Service Unavailable)'
    )
    expect(expectedConsoleFailure, 'Chromium reported the deliberate sign-out failure').toBeDefined()
    observations.console = observations.console.filter((message) => message !== expectedConsoleFailure)

    if (projectName === 'desktop-chromium') {
      peerPage = await context.newPage()
      peerObservations = observePage(peerPage)
      await peerPage.route('**/api/auth/get-session', fulfillSession)
      await peerPage.route('**/api/me', (route) =>
        fulfillJson(route, {
          user: { id: 'browser-social-user', name: userName, email: userEmail, image: null },
          modules: expectedModuleStates
        })
      )
      await peerPage.goto('/')
      await expect(peerPage.getByRole('button', { name: `Account menu for ${userName}` })).toBeVisible()
      await peerPage.getByRole('link', { name: 'App', exact: true }).click()
      await expect(peerPage.getByText(`Signed in as ${userEmail}`, { exact: true })).toBeVisible()
      await peerPage.waitForLoadState('networkidle')
    }

    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
    await expect
      .poll(() => signOutRequests)
      .toEqual([
        { method: 'POST', body: {} },
        { method: 'POST', body: {} }
      ])
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('signed-out')
    await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible()
    await expect(page.getByText('You are signed out.', { exact: true })).toBeVisible()
    await expect(page.getByText(userName, { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0)
    if (peerPage) {
      await expect(peerPage).toHaveURL(/\/login$/)
      await expect(peerPage.getByText(userEmail, { exact: true })).toHaveCount(0)
      await expect(peerPage.getByRole('button', { name: /^Account menu for / })).toHaveCount(0)
      await assertAccessibleWithoutOverflow(peerPage)
      await assertCleanPage(peerPage, peerObservations)
    }
    await assertAccessibleWithoutOverflow(page)
    await assertCleanPage(page, observations)
  } finally {
    await peerPage?.close()
    await page.close()
  }
}

async function assertAccountMenuFitsViewport(page, menu) {
  const align = await menu.getAttribute('data-align')
  await expect
    .poll(
      async () => {
        const box = await menu.boundingBox()
        const viewport = page.viewportSize()
        if (!box || !viewport) return null

        return {
          leftOverflow: Math.max(0, -box.x),
          topOverflow: Math.max(0, -box.y),
          rightOverflow: Math.max(0, box.x + box.width - viewport.width),
          bottomOverflow: Math.max(0, box.y + box.height - viewport.height)
        }
      },
      { message: `account menu settles within the viewport (data-align=${align ?? 'unset'})` }
    )
    .toEqual({ leftOverflow: 0, topOverflow: 0, rightOverflow: 0, bottomOverflow: 0 })
}

async function fulfillJson(route, value) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  })
}

function removeExpectedHttpFailure(observations, method, status, path, count = 1, removeConsole = true) {
  const responses = observations.errorResponses.filter(
    (entry) => entry.includes(`${method} ${status}`) && entry.includes(path)
  )
  expect(responses).toHaveLength(count)
  observations.errorResponses = observations.errorResponses.filter((entry) => !responses.includes(entry))

  if (!removeConsole) return
  removeExpectedConsoleFailures(observations, status, count)
}

function removeExpectedConsoleFailures(observations, status, count) {
  for (let index = 0; index < count; index += 1) {
    const consoleFailureIndex = observations.console.findIndex((entry) =>
      new RegExp(`Failed to load resource: the server responded with a status of ${status}\\b`).test(entry)
    )
    expect(consoleFailureIndex).toBeGreaterThanOrEqual(0)
    observations.console.splice(consoleFailureIndex, 1)
  }
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
  expect(observations.console, 'console warning/error output').toEqual([])
  expect(hydrationWarnings, 'hydration warning output').toEqual([])
  expect(observations.pageErrors, 'uncaught page errors').toEqual([])
  expect(observations.failedRequests, 'failed browser requests').toEqual([])
  expect(observations.errorResponses, 'same-origin HTTP error responses').toEqual([])
  expect(observations.externalRequests, 'external browser requests').toEqual([])
  expect(observations.crashes, 'page crashes').toBe(0)
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required; run this spec through npm run test:browser`)
  }
  return value
}
