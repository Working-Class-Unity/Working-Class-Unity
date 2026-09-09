import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Translation completeness is covered by site-localization.test.ts. Exercise
// each distinct supporting layout once, including translated narrow text.
for (const [slug, locale] of [
  ['what-stockton-bought', 'en'],
  ['why-safeguards-are-not-enough', 'es'],
  ['faq', 'pa']
]) {
  test(`Flock supporting layout ${slug} is accessible in ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${locale === 'en' ? '' : `/${locale}`}/campaigns/remove-flock-stockton/${slug}`)
    await page.waitForFunction(() => window.useNuxtApp?.().isHydrating === false)
    const article = page.locator('main article')
    await expect(article.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', new RegExp(`^${locale}`))
    if (slug === 'faq') {
      await article.locator('summary').first().focus()
      await page.keyboard.press('Enter')
      await expect(article.locator('details').first()).toHaveAttribute('open', '')
      await expect(article.locator('[role="doc-biblioref"]').first()).toBeVisible()
    }
    await assertReflow(page)
    const results = await new AxeBuilder({ page }).include('main article').analyze()
    expect(results.violations).toEqual([])
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
    await assertReflow(page)
  })
}

async function assertReflow(page) {
  const sizes = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }))
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
}
