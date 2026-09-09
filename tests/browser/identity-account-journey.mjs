import { expect } from '@playwright/test'

export async function assertIdentityAccountJourney(context, helpers) {
  const page = await context.newPage()
  const observations = helpers.observePage(page)
  try {
    await page.goto('/join')
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await expect(page.getByRole('heading', { name: 'Join Working Class Unity' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue to Stripe' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Code of Conduct/i })).toBeVisible()
    await expect(page.locator('script[src*="challenges.cloudflare.com/turnstile"]')).toHaveCount(0)
    await helpers.assertAccessibleWithoutOverflow(page)
    await page.getByRole('link', { name: 'Member Login', exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('button', { name: 'Send email link' })).toBeEnabled()
    await page.getByRole('link', { name: 'Privacy Policy', exact: true }).click()
    await expect(page).toHaveURL(/\/legal\/privacy$/)
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible()
    await helpers.assertAccessibleWithoutOverflow(page)
    await page.goto('/legal/terms')
    await expect(page.getByRole('heading', { name: 'Terms', exact: true })).toBeVisible()
    await helpers.assertCleanPage(page, observations)
  } finally {
    await page.close()
  }

  const recoveryPage = await context.newPage()
  const recoveryObservations = helpers.observePage(recoveryPage)
  try {
    const response = await recoveryPage.goto('/missing-personal-app-page')
    expect(response?.status()).toBe(404)
    await expect(recoveryPage.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(recoveryPage.getByText(/stack|exception|internal server/i)).toHaveCount(0)
    await recoveryPage.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    await helpers.assertAccessibleWithoutOverflow(recoveryPage)
    const recovery = recoveryPage.getByRole('button', { name: 'Return home' })
    await recovery.focus()
    await expect(recovery).toBeFocused()
    await recoveryPage.keyboard.press('Enter')
    await expect(recoveryPage).toHaveURL(/\/$/)
    await expect(recoveryPage.getByRole('heading', { level: 1 })).toBeVisible()
    recoveryObservations.errorResponses = recoveryObservations.errorResponses.filter(
      (entry) => !(entry.includes('GET 404') && entry.includes('/missing-personal-app-page'))
    )
    recoveryObservations.console = recoveryObservations.console.filter(
      (entry) => !/Failed to load resource: the server responded with a status of 404/.test(entry)
    )
    await helpers.assertCleanPage(recoveryPage, recoveryObservations)
  } finally {
    await recoveryPage.close()
  }
}
