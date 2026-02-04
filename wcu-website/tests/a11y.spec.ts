import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@nuxt/test-utils/playwright'

const routes = [
  '/',
  '/about',
  '/calendar',
  '/campaigns',
  '/join',
  '/kyr',
  '/links',
  '/tenant-union-handbook',
  '/unitedfront',
  '/check-in-coverage',
]

test.describe('WCAG 2.1 AA', () => {
  test('axe: key routes', async ({ page, goto }) => {
    const failures: Array<{ route: string; violations: string[] }> = []

    for (const route of routes) {
      await test.step(route, async () => {
        await goto(route, { waitUntil: 'hydration' })

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          // Ignore third-party frames (Cal.com embeds, etc.)
          .exclude('iframe')
          .analyze()

        if (results.violations.length === 0) return

        failures.push({
          route,
          violations: results.violations.map((v) => {
            const samples = v.nodes
              .slice(0, 3)
              .flatMap((n) => n.target)
              .filter(Boolean)
              .join(' | ')
            const sampleText = samples ? ` e.g. ${samples}` : ''
            return `${v.id}: ${v.help} (${v.nodes.length} node(s))${sampleText}`
          }),
        })
      })
    }

    expect(failures).toEqual([])
  })
})
