import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { petitionDemand } from '../../app/content/remove-flock-stockton/petition.ts'

const runtimeName = requiredEnvironment('BROWSER_RUNTIME_APP_NAME')
const runtimeUrl = requiredEnvironment('BROWSER_RUNTIME_APP_URL')
const runtimeDatabase = requiredEnvironment('BROWSER_RUNTIME_DATABASE_PATH')
const runtimeReadinessToken = requiredEnvironment('BROWSER_RUNTIME_READINESS_TOKEN')
const buildName = requiredEnvironment('BROWSER_BUILD_APP_NAME')
const buildUrl = requiredEnvironment('BROWSER_BUILD_APP_URL')
const buildReadinessToken = requiredEnvironment('BROWSER_BUILD_READINESS_TOKEN')
const buildSentryRelease = requiredEnvironment('BROWSER_BUILD_SENTRY_RELEASE')
const runtimeSentryRelease = requiredEnvironment('BROWSER_RUNTIME_SENTRY_RELEASE')
const runtimeSentryOrigin = requiredEnvironment('BROWSER_RUNTIME_SENTRY_ORIGIN')
const spanishMessages = readLocaleMessages('es')
const punjabiMessages = readLocaleMessages('pa')
const forumUrl = 'https://chat.workingclassunity.com/'
const sentryEnvelopePath = '/api/1/envelope/'
const intentionalManifestNavigations = new WeakMap()

if (new URL(runtimeSentryOrigin).origin !== runtimeSentryOrigin) {
  throw new Error('BROWSER_RUNTIME_SENTRY_ORIGIN must be an exact origin')
}

test.beforeEach(async ({ context }) => {
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

test('home presents the WCU foundation and preserves client navigation', async ({ page }) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
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
  await expect(page.getByRole('heading', { name: 'Working people need an organization of our own' })).toBeVisible()
  await expect(page.locator('.brand')).toHaveAccessibleName(`${runtimeName} home`)
  await expect(page.locator('.brand')).toHaveAttribute('aria-current', 'page')
  await expect(page).toHaveTitle('Working Class Unity')
  const updatesLink = page.getByRole('link', { name: 'Get WCU updates', exact: true })
  await expect(updatesLink).toHaveAttribute('href', 'https://tech.workingclassunity.com/wcu-updates')
  await expect(page.locator('.home-participation form')).toHaveCount(0)
  await expect(page.locator('.home-participation input')).toHaveCount(0)
  await expect(page.locator('.home-participation iframe')).toHaveCount(0)
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  await assertRuntimePublicConfig(page)
  await assertAccessibleWithoutOverflow(page)

  const skipLink = page.getByRole('link', { name: 'Skip to main content' })
  const topbar = page.getByRole('banner', { name: 'Working Class Unity site header' })
  const hero = page.locator('.home-hero')
  await assertMinimumTargetSize(page.locator('.brand'))
  await assertMinimumTargetSize(topbar.getByRole('link', { name: 'Manage dues', exact: true }))
  await assertMinimumTargetSize(topbar.getByRole('link', { name: 'Get Involved', exact: true }))
  await assertMinimumTargetSize(hero.getByRole('link', { name: 'See upcoming events', exact: true }))
  await assertMinimumTargetSize(updatesLink)
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

  await page.setViewportSize({ width: 320, height: 800 })
  await assertNoHorizontalOverflow(page)
  await page.setViewportSize({ width: 640, height: 900 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await assertNoHorizontalOverflow(page)

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = ''
  })
  const timeOrigin = await page.evaluate(() => performance.timeOrigin)
  await topbar.getByRole('link', { name: 'Get Involved', exact: true }).click()
  await expect(page).toHaveURL(/\/#get-involved$/)
  await expect(page.getByRole('heading', { name: 'Start by showing up', exact: true })).toBeVisible()
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)

  await assertCleanPage(page, observations)
})

test('global public navigation exposes current routes and a route-closing mobile disclosure', async ({
  page,
  request
}) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.context().route(forumUrl, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Forum fixture</title>' })
  })

  const forumRedirect = await request.get('/forum', { maxRedirects: 0 })
  expect(forumRedirect.status()).toBe(302)
  expect(forumRedirect.headers().location).toBe(forumUrl)

  for (const destination of [
    {
      path: '/about',
      label: 'Who We Are',
      heading: 'They Have Their Parties. We Need Our Own Organization',
      title: 'About'
    },
    {
      path: '/calendar',
      label: 'All events',
      heading: 'Find your place in the work',
      title: 'Calendar',
      menu: 'Events'
    }
  ]) {
    await page.goto(destination.path)
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    const primaryNavigation = page.getByRole('navigation', { name: 'Primary' })
    if (destination.menu) await primaryNavigation.getByRole('button', { name: destination.menu, exact: true }).click()
    const currentLink = primaryNavigation.getByRole('link', { name: destination.label, exact: true })

    await expect(page.getByRole('heading', { name: destination.heading, exact: true })).toBeVisible()
    await expect(page).toHaveTitle(destination.title)
    await expect(currentLink).toHaveAttribute('href', destination.path)
    await expect(currentLink).toHaveAttribute('aria-current', 'page')
    await expect(primaryNavigation.locator('[aria-current="page"]')).toHaveCount(1)
    await page.waitForLoadState('networkidle')
    if (destination.menu) await page.keyboard.press('Escape')
  }

  const desktopNavigation = page.locator('[data-reka-navigation-menu]')
  const aboutLink = desktopNavigation.getByRole('link', { name: 'Who We Are', exact: true })
  const currentWorkTrigger = desktopNavigation.getByRole('button', { name: 'Current Work', exact: true })
  const eventsTrigger = desktopNavigation.getByRole('button', { name: 'Events', exact: true })
  const forumLink = page.getByRole('link', { name: /Member Forum.*opens in a new tab/ })

  await expect(desktopNavigation).toHaveRole('navigation')
  await expect(desktopNavigation).toHaveAttribute('data-orientation', 'horizontal')
  await expect(currentWorkTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(forumLink).toHaveAttribute('href', forumUrl)
  await expect(forumLink).toHaveAttribute('target', '_blank')
  await expect(forumLink).toHaveAttribute('rel', 'noopener noreferrer')
  expect(await forumLink.getAttribute('aria-current')).toBeNull()
  await aboutLink.focus()
  await page.keyboard.press('ArrowRight')
  await expect(currentWorkTrigger).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(eventsTrigger).toBeFocused()
  await page.keyboard.press('End')
  await expect(eventsTrigger).toBeFocused()
  await page.keyboard.press('Home')
  await expect(aboutLink).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(currentWorkTrigger).toHaveAttribute('aria-expanded', 'true')
  const allWorkLink = desktopNavigation.getByRole('link', { name: 'All current work', exact: true })
  const flockLink = desktopNavigation.getByRole('link', { name: 'Remove Flock Stockton', exact: true })
  const contractLink = desktopNavigation.getByRole('link', { name: 'What Stockton Bought', exact: true })
  const removalLink = desktopNavigation.getByRole('link', { name: 'Removal, not Reform', exact: true })
  const unitedFrontLink = desktopNavigation.getByRole('link', { name: 'United Front', exact: true })
  await expect(allWorkLink).toHaveAttribute('href', '/#current-work')
  await expect(flockLink).toHaveAttribute('href', '/campaigns/remove-flock-stockton')
  await expect(unitedFrontLink).toHaveAttribute('href', '/campaigns/united-front')
  await page.keyboard.press('ArrowDown')
  await expect(flockLink).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(contractLink).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(removalLink).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(currentWorkTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(currentWorkTrigger).toBeFocused()

  await currentWorkTrigger.click()
  await unitedFrontLink.click()
  await expect(page).toHaveURL(/\/campaigns\/united-front$/)
  await expect(currentWorkTrigger).toHaveAttribute('aria-expanded', 'false')
  await currentWorkTrigger.click()
  await expect(unitedFrontLink).toHaveAttribute('aria-current', 'page')
  await unitedFrontLink.click()
  await expect(currentWorkTrigger).toHaveAttribute('aria-expanded', 'false')
  await currentWorkTrigger.click()
  await flockLink.click()
  await expect(page).toHaveURL(/\/campaigns\/remove-flock-stockton$/)
  await expect(currentWorkTrigger).toHaveAttribute('aria-expanded', 'false')
  await assertForumPopup(page, () => forumLink.click())

  await page.setViewportSize({ width: 320, height: 800 })
  const menuToggle = page.getByRole('button', { name: 'Menu', exact: true })
  const navigationPanel = page.locator('#primary-navigation-panel')

  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await assertMinimumTargetSize(menuToggle)

  await menuToggle.click()
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(navigationPanel).toBeVisible()
  const mobileForumLink = page.getByRole('link', { name: /Member Forum.*opens in a new tab/ })

  const mobileNavigation = page.locator('.mobile-navigation')
  await assertMinimumTargetSize(mobileNavigation.getByRole('link', { name: 'Who We Are', exact: true }))
  await assertMinimumTargetSize(mobileNavigation.getByRole('button', { name: 'Current Work', exact: true }))
  await assertMinimumTargetSize(mobileNavigation.getByRole('link', { name: 'Remove Flock Stockton', exact: true }))
  await assertMinimumTargetSize(mobileNavigation.getByRole('link', { name: 'United Front', exact: true }))
  await assertMinimumTargetSize(mobileNavigation.getByRole('button', { name: 'Events', exact: true }))
  await assertMinimumTargetSize(mobileForumLink)
  await assertMinimumTargetSize(page.getByRole('link', { name: 'Manage dues', exact: true }))
  await assertMinimumTargetSize(page.getByRole('link', { name: 'Get Involved', exact: true }))
  await expect(mobileForumLink).toHaveAttribute('href', forumUrl)
  await expect(mobileForumLink).toHaveAttribute('target', '_blank')
  await expect(mobileForumLink).toHaveAttribute('rel', 'noopener noreferrer')
  expect(await mobileForumLink.getAttribute('aria-current')).toBeNull()
  await assertNoHorizontalOverflow(page)

  await expect(menuToggle).toBeFocused()
  await page.keyboard.press('Tab')
  const firstMobileNavigationLink = mobileNavigation.getByRole('link', { name: 'Who We Are', exact: true })
  await expect(firstMobileNavigationLink).toBeFocused()
  await assertVisibleFocusIndicator(page, firstMobileNavigationLink)
  await page.keyboard.press('Escape')
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await expect(menuToggle).toBeFocused()

  await menuToggle.click()
  await assertForumPopup(page, () => mobileForumLink.click())
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await expect(menuToggle).toBeFocused()

  await menuToggle.click()
  await mobileNavigation.getByRole('link', { name: 'United Front', exact: true }).click()
  await expect(page).toHaveURL(/\/campaigns\/united-front$/)
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()

  await menuToggle.click()
  await mobileNavigation.getByRole('link', { name: 'Who We Are', exact: true }).click()
  await expect(page).toHaveURL(/\/about$/)
  await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(navigationPanel).toBeHidden()
  await assertAccessibleWithoutOverflow(page)
  await assertCleanPage(page, observations)
})

test.describe('localized browsing', () => {
  test.use({ locale: 'es-MX' })

  test('language detection and selection use stable public URLs while preserving English paths', async ({
    page,
    request
  }) => {
    const observations = observePage(page)
    const context = page.context()
    await page.setViewportSize({ width: 1280, height: 900 })

    await page.goto('/')
    await expect(page).toHaveURL(/\/es$/)
    await page.waitForLoadState('networkidle')
    const manifestUrl = await nuxtManifestUrl(page)
    const aboutResponse = await gotoForInitialResponse(page, '/es/about', manifestUrl)
    expect(aboutResponse).not.toBeNull()
    await page.waitForLoadState('networkidle')
    expect(await aboutResponse.text()).toMatch(/<html[^>]*\blang="es"/)
    const vary = aboutResponse.headers().vary?.toLowerCase() ?? ''
    expect(vary).toContain('cookie')
    expect(vary).toContain('accept-language')
    for (const accept of ['', '*/*']) {
      const genericDocumentResponse = await request.get('/about', { headers: { accept } })
      const genericVary = genericDocumentResponse.headers().vary?.toLowerCase() ?? ''
      expect(genericVary).toContain('cookie')
      expect(genericVary).toContain('accept-language')
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    await expect(page.locator('select[name="language"]')).toHaveValue('es')
    await expect(
      page.getByRole('heading', { name: requiredMessage(spanishMessages, 'publicPages.about.title'), exact: true })
    ).toBeVisible()
    await expect(page).toHaveTitle(requiredMessage(spanishMessages, 'metadata.about.title'))
    await expect.poll(() => localeCookie(context)).toBe('es')
    expect(new URL(page.url()).pathname).toBe('/es/about')

    await page.locator('select[name="language"]').selectOption('pa')
    await expect(page.locator('html')).toHaveAttribute('lang', 'pa')
    await expect(page.locator('select[name="language"]')).toHaveValue('pa')
    await expect(
      page.getByRole('heading', { name: requiredMessage(punjabiMessages, 'publicPages.about.title'), exact: true })
    ).toBeVisible()
    await expect(page).toHaveTitle(requiredMessage(punjabiMessages, 'metadata.about.title'))
    await expect.poll(() => localeCookie(context)).toBe('pa')
    await page.waitForLoadState('networkidle')
    expect(new URL(page.url()).pathname).toBe('/pa/about')

    const calendarResponse = await gotoForInitialResponse(page, '/pa/calendar', manifestUrl)
    expect(calendarResponse).not.toBeNull()
    await page.waitForLoadState('networkidle')
    expect(await calendarResponse.text()).toMatch(/<html[^>]*\blang="pa"/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'pa')
    await expect(page.locator('select[name="language"]')).toHaveValue('pa')
    await expect(
      page.getByRole('heading', { name: requiredMessage(punjabiMessages, 'calendar.title'), exact: true })
    ).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/pa/calendar')

    await page.setViewportSize({ width: 320, height: 800 })
    const menuToggle = page.locator('.mobile-menu-toggle')
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'false')
    await menuToggle.click()
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true')
    const languagePicker = page.getByRole('combobox', {
      name: requiredMessage(punjabiMessages, 'common.language'),
      exact: true
    })
    await expect(languagePicker).toBeVisible()
    await assertMinimumTargetSize(page.locator('select[name="language"]'))
    await page.locator('select[name="language"]').focus()
    await assertVisibleFocusIndicator(page, page.locator('select[name="language"]'))
    await assertAccessibleWithoutOverflow(page)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await assertNoHorizontalOverflow(page)

    await page.locator('select[name="language"]').selectOption('en')
    await expect(page).toHaveURL(`${runtimeUrl}/calendar`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US')
    await expect.poll(() => localeCookie(context)).toBe('en')
    await page.waitForLoadState('networkidle')
    intentionalManifestNavigations.set(page, manifestUrl)
    try {
      await page.reload()
    } finally {
      intentionalManifestNavigations.delete(page)
    }
    await page.waitForLoadState('networkidle')
    await expect(page.locator('select[name="language"]')).toHaveValue('en')
    expect(new URL(page.url()).pathname).toBe('/calendar')
    await assertCleanPage(page, observations)
  })
})

test('Flock overview preserves the demands and makes the council record accessible', async ({ page }) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/campaigns/remove-flock-stockton')

  const council = page.getByRole('region', { name: 'Stockton City Council Voted for Mass Surveillance', exact: true })
  await council.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      council.locator('img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))
    )
    .toBe(true)

  const records = council.locator('details')
  await expect(records).not.toHaveAttribute('open')
  await records.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(records).toHaveAttribute('open')
  for (const link of await records.getByRole('link').all()) {
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toHaveAccessibleName(/opens in a new tab/)
  }

  const demands = page.getByRole('region', { name: petitionDemand.title, exact: true })
  await expect(demands.getByRole('listitem')).toHaveText(petitionDemand.demands)
  const signLinks = page.getByRole('link', { name: 'Sign the demand letter', exact: true })
  await expect(signLinks).toHaveCount(2)
  for (const link of await signLinks.all()) {
    await expect(link).toHaveAttribute('href', 'https://tech.workingclassunity.com/deflock-stockton')
    await assertMinimumTargetSize(link)
  }

  await page.setViewportSize({ width: 320, height: 900 })
  await assertAccessibleWithoutOverflow(page, '.campaign-landing')
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await assertNoHorizontalOverflow(page)
  await assertCleanPage(page, observations)
})

test('one mobile menu provides all four Flock destinations and closes on navigation', async ({ page }) => {
  const observations = observePage(page)
  const routes = [
    ['Remove Flock Stockton', '/campaigns/remove-flock-stockton'],
    ['What Stockton Bought', '/campaigns/remove-flock-stockton/what-stockton-bought'],
    ['Removal, not Reform', '/campaigns/remove-flock-stockton/why-safeguards-are-not-enough'],
    ['FAQ', '/campaigns/remove-flock-stockton/faq']
  ]
  await page.goto(routes[0][1])
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const contextNavigation = page.locator('#mobile-current-work .context-navigation').first()
  await page.setViewportSize({ width: 320, height: 844 })
  for (const [label, path] of routes) {
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    await expect(contextNavigation.getByRole('link')).toHaveCount(4)
    await contextNavigation.getByRole('link', { name: label, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await menu.click()
    const current = contextNavigation.getByRole('link', { name: label, exact: true })
    await expect(current).toHaveAttribute('aria-current', 'page')
    await assertMinimumTargetSize(current)
    await current.focus()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveAttribute('aria-expanded', 'false')
    await expect(menu).toBeFocused()
    await assertNoHorizontalOverflow(page)
  }
  await assertCleanPage(page, observations)
})

test('campaign update prompt uses the hosted Deflock form without collecting contact details', async ({ page }) => {
  const observations = observePage(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/campaigns/remove-flock-stockton')

  const updatesLinks = page.getByRole('link', { name: 'Stay informed', exact: true })
  const updatesNotes = page.locator('#campaign-updates-note')
  await expect(page.locator('.campaign-newsletter')).toHaveCount(1)
  await expect(updatesLinks).toHaveCount(1)
  await expect(updatesNotes).toHaveCount(1)
  await expect(page.locator('.campaign-newsletter form')).toHaveCount(0)
  await expect(page.locator('.campaign-newsletter input')).toHaveCount(0)
  await expect(page.locator('.campaign-newsletter iframe')).toHaveCount(0)

  const updatesLink = updatesLinks.first()
  await expect(updatesLink).toHaveAttribute('href', 'https://tech.workingclassunity.com/deflock-stockton-updates')
  await assertMinimumTargetSize(updatesLink)
  const colors = await updatesLink.evaluate((element) => {
    const section = element.closest('.campaign-newsletter')
    return {
      background: getComputedStyle(section ?? element).backgroundColor,
      text: getComputedStyle(element).color
    }
  })
  expect(contrastRatio(colors.text, colors.background), 'signup link text contrast').toBeGreaterThanOrEqual(4.5)
  await expect(updatesNotes).not.toBeEmpty()
  await assertAccessibleWithoutOverflow(page, '.campaign-newsletter')

  await assertCleanPage(page, observations)
})

test('campaign citations preview, navigate, and return at desktop and mobile widths', async ({ page }) => {
  const observations = observePage(page)
  const campaignPath = '/campaigns/remove-flock-stockton/faq'
  const sourceNoteId = 'stockton-flock-faq-title-note-flock-license-plate-readers'

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(campaignPath)
  await page.getByText('What is Flock?', { exact: true }).click()

  const firstCitation = page.locator('[role="doc-biblioref"]').first()
  await expect(firstCitation).toBeVisible()
  await expect(firstCitation).toHaveAccessibleName(
    'Source 1.1: License plate readers, FAQ: What is an automated license plate reader?'
  )
  await expect(firstCitation).toHaveAttribute('href', `#${sourceNoteId}`)
  await expect(firstCitation).toHaveAttribute(
    'id',
    'stockton-flock-faq-title-basics-what-is-flock-answer-1-citation-1-1'
  )

  await firstCitation.hover()
  const sourcePreview = page.locator('.campaign-citation-card')
  await expect(sourcePreview).toBeVisible()
  await expect(sourcePreview.locator('.campaign-citation-label')).toHaveText('SOURCE 1.1')
  await expect(sourcePreview).toContainText('License plate readers')
  await expect(sourcePreview.locator('a, button')).toHaveCount(0)

  await firstCitation.click()
  const sourceNote = page.locator(`#${sourceNoteId}`)
  await expect(page).toHaveURL(new RegExp(`#${sourceNoteId}$`))
  await expect(sourceNote).toBeFocused()
  await expect(sourceNote).toBeInViewport()
  await expect(page.locator('[role="doc-bibliography"]')).toContainText('Reviewed')

  const firstBacklink = sourceNote.locator('[role="doc-backlink"]').first()
  await expect(firstBacklink).toHaveAccessibleName(
    'Return to citation 1.1, FAQ: What is an automated license plate reader?'
  )
  await firstBacklink.click()
  await expect(firstCitation).toBeFocused()

  await page.setViewportSize({ width: 390, height: 844 })

  const mobileCitation = page.locator('[role="doc-biblioref"]').first()
  await expect(mobileCitation).toHaveJSProperty('tagName', 'A')
  const mobileHitTarget = mobileCitation.locator('.campaign-citation-hit-target')
  const mobileHitTargetSize = await mobileHitTarget.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { height: bounds.height, width: bounds.width }
  })
  expect(mobileHitTargetSize.height).toBeGreaterThanOrEqual(48)
  expect(mobileHitTargetSize.width).toBeGreaterThanOrEqual(48)

  const multiSourceCluster = page.locator('.campaign-citation-cluster').nth(1)
  await multiSourceCluster.scrollIntoViewIfNeeded()
  const clusteredCitations = multiSourceCluster.locator('[role="doc-biblioref"]')
  await expect(clusteredCitations).toHaveCount(2)
  const firstClusterTarget = clusteredCitations.nth(0).locator('.campaign-citation-hit-target')
  const secondClusterTarget = clusteredCitations.nth(1).locator('.campaign-citation-hit-target')
  const [firstTargetBounds, secondTargetBounds] = await Promise.all([
    firstClusterTarget.boundingBox(),
    secondClusterTarget.boundingBox()
  ])

  expect(firstTargetBounds).not.toBeNull()
  expect(secondTargetBounds).not.toBeNull()
  expect(firstTargetBounds.x + firstTargetBounds.width).toBeLessThanOrEqual(secondTargetBounds.x)

  const firstTargetPoint = {
    x: firstTargetBounds.x + 6,
    y: firstTargetBounds.y + firstTargetBounds.height / 2
  }
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('campaign-citation-hit-target'),
        firstTargetPoint
      )
    )
    .toBe(true)
  await page.mouse.click(firstTargetPoint.x, firstTargetPoint.y)
  const citationDrawer = page.locator('.campaign-citation-drawer')
  await expect(citationDrawer).toBeVisible()
  await expect(citationDrawer).toContainText('File 26-0269 Amendment A—Agreement and Quote')
  await page.keyboard.press('Escape')
  await expect(citationDrawer).toBeHidden()

  const secondTargetBoundsAfterClose = await secondClusterTarget.boundingBox()
  expect(secondTargetBoundsAfterClose).not.toBeNull()
  const secondTargetPoint = {
    x: secondTargetBoundsAfterClose.x + secondTargetBoundsAfterClose.width - 6,
    y: secondTargetBoundsAfterClose.y + secondTargetBoundsAfterClose.height / 2
  }
  await expect
    .poll(() =>
      page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.classList.contains('campaign-citation-hit-target'),
        secondTargetPoint
      )
    )
    .toBe(true)
  await page.mouse.click(secondTargetPoint.x, secondTargetPoint.y)
  await expect(citationDrawer).toBeVisible()
  await expect(citationDrawer).toContainText('File 24-0561 legislation text')
  await page.keyboard.press('Escape')
  await expect(citationDrawer).toBeHidden()

  await mobileCitation.click()
  await expect(citationDrawer).toBeVisible()
  await expect(citationDrawer.getByRole('link', { name: 'View source' })).toBeVisible()
  await expect(citationDrawer.getByRole('button', { name: 'Go to source note' })).toBeVisible()
  await assertAccessibleWithoutOverflow(page)

  await citationDrawer.getByRole('button', { name: 'Go to source note' }).click()
  await expect(citationDrawer).toBeHidden()
  await expect(page.locator(`#${sourceNoteId}`)).toBeFocused()
  await expect(page).toHaveURL(new RegExp(`#${sourceNoteId}$`))
  await assertNoHorizontalOverflow(page)
  await assertCleanPage(page, observations)
})

test('joining and managing dues use public Stripe links without website account requests', async ({ page }) => {
  const observations = observePage(page)
  await page.goto('/join')
  await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
  await expect(page.getByRole('heading', { name: 'Join Working Class Unity', exact: true })).toBeVisible()
  const joinPage = page.locator('.join-page')
  const options = joinPage.getByRole('list')
  await expect(options.getByRole('listitem')).toHaveCount(2)
  for (const [label, url] of [
    ['$10/month', 'https://pay.workingclassunity.com/b/7sI4hF1hc9IIepq4gh'],
    ['$27/month', 'https://pay.workingclassunity.com/b/bIY4hF4tof325SUaEE']
  ]) {
    const link = options.getByRole('link', { name: label, exact: true })
    await expect(link).toHaveAttribute('href', url)
    await assertMinimumTargetSize(link)
  }
  const portalUrl = 'https://pay.workingclassunity.com/p/login/00g29l9RKespfsI7ss'
  await expect(joinPage.getByRole('link', { name: 'Manage dues', exact: true })).toHaveAttribute('href', portalUrl)
  await expect(page.getByRole('banner').getByRole('link', { name: 'Manage dues', exact: true })).toHaveAttribute(
    'href',
    portalUrl
  )
  await expect(joinPage.locator('form, input, iframe')).toHaveCount(0)
  await assertAccessibleWithoutOverflow(page)
  await page.setViewportSize({ width: 320, height: 800 })
  await assertAccessibleWithoutOverflow(page)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await assertNoHorizontalOverflow(page)
  await assertCleanPage(page, observations)
})

test('observability route is active without sending a missing token', async ({ page }) => {
  const observations = observePage(page)
  const observabilityResponse = await page.goto('/observability-client-test')
  expect(observabilityResponse?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Client Event Test' })).toBeVisible()
  await expect(page.getByText('Missing token hash.', { exact: true })).toBeVisible()
  await expect(page).toHaveTitle('Observability test')
  await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
  await assertAccessibleWithoutOverflow(page)
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/auth'))).toEqual([])
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/account/billing'))).toEqual([])
  expect(observations.sameOriginRequests.filter((request) => request.includes('/api/observability'))).toEqual([])
  await assertCleanPage(page, observations)
})

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

  const secondResponse = await page.request.get('/join')
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
  expect(configSource).not.toContain(runtimeReadinessToken)
  expect(configSource).not.toContain(buildReadinessToken)
  expect(configSource).not.toContain(runtimeDatabase)
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

async function assertForumPopup(page, activate) {
  const popupPromise = page.waitForEvent('popup')
  await activate()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup).toHaveURL(forumUrl)
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  await popup.close()
}

async function assertAccessibleWithoutOverflow(page, includeSelector) {
  const builder = new AxeBuilder({ page })
  if (includeSelector) {
    builder.include(includeSelector)
  }
  const results = await builder.analyze()
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
  const requestOrders = new WeakMap()
  let requestOrder = 0
  let replacingDocumentOrder = 0
  page.on('domcontentloaded', () => {
    replacingDocumentOrder = 0
  })

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
    const failure = `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? 'failed'}`
    // Keep old-document static asset cancellations as diagnostics. API and
    // unknown fetch cancellations still fail, apart from the exact manifest
    // exception. Non-abort, HTTP, JS, and hydration errors still fail.
    const navigationAbort =
      isExpectedManifestNavigationAbort(page, request) ||
      (replacingDocumentOrder > 0 &&
        requestOrders.has(request) &&
        requestOrders.get(request) < replacingDocumentOrder &&
        request.method() === 'GET' &&
        ['image', 'stylesheet', 'script', 'font', 'media'].includes(request.resourceType()) &&
        !request.isNavigationRequest() &&
        request.failure()?.errorText === 'net::ERR_ABORTED')
    if (navigationAbort) observations.allConsole.push(`navigation cancellation: ${failure}`)
    else observations.failedRequests.push(failure)
  })
  page.on('response', (response) => {
    const url = response.url()
    if (new URL(url).origin === allowedOrigin && response.status() >= 400) {
      observations.errorResponses.push(`${response.request().method()} ${response.status()} ${url}`)
    }
  })
  page.on('request', (request) => {
    requestOrders.set(request, ++requestOrder)
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      replacingDocumentOrder = requestOrder
    }
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
    /\/api\/(?:auth|account|join|membership|ai|files)(?:[/?]|$)/.test(request)
  )
  expect(
    observations.console.filter((message) => message.startsWith('error:')),
    'console errors'
  ).toEqual([])
  expect(hydrationWarnings, 'hydration warning output').toEqual([])
  expect(observations.pageErrors, 'uncaught page errors').toEqual([])
  expect(observations.failedRequests, 'failed browser requests').toEqual([])
  expect(observations.errorResponses, 'same-origin HTTP error responses').toEqual([])
  expect(observations.externalRequests, 'external browser requests').toEqual([])
  expect(excludedCapabilityRequests, 'retired feature browser requests').toEqual([])
  expect(observations.crashes, 'page crashes').toBe(0)
}

function readLocaleMessages(locale) {
  return JSON.parse(readFileSync(new URL(`../../i18n/locales/${locale}.json`, import.meta.url), 'utf8'))
}

function requiredMessage(messages, path) {
  const message = path.split('.').reduce((value, key) => value?.[key], messages)
  if (typeof message !== 'string' || !message.trim()) throw new Error(`Missing translated browser fixture: ${path}`)
  return message
}

async function localeCookie(context) {
  const cookies = await context.cookies(runtimeUrl)
  return cookies.find(({ name }) => name === 'wcu_locale')?.value
}

function requiredEnvironment(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required; run this spec through npm run test:browser`)
  }
  return value
}
