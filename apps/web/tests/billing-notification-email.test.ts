import { describe, expect, it } from 'vitest'
import { createBillingNotificationEmail, TransactionalEmailDeliveryError } from '../server/services/email'
import type { EnglishBillingNotificationKind } from '../server/services/email/templates/en'

const notificationKinds = [
  'payment_attention',
  'family_access_at_risk',
  'family_access_ending',
  'member_removed',
  'family_dissolved',
  'deletion_cancellation_pending'
] as const satisfies readonly EnglishBillingNotificationKind[]

describe('English billing notification templates', () => {
  it('renders every approved minimized notification without provider or member details', () => {
    for (const kind of notificationKinds) {
      const message =
        kind === 'family_access_ending'
          ? createBillingNotificationEmail({
              to: 'recipient@example.test',
              appName: 'Baseline App',
              kind,
              effectiveAt: '2026-08-28T00:00:00.000Z'
            })
          : createBillingNotificationEmail({
              to: 'recipient@example.test',
              appName: 'Baseline App',
              kind
            })

      expect(message.to).toBe('recipient@example.test')
      expect(message.subject).toBeTruthy()
      expect(message.text).toContain('Baseline App')
      expect(message.html).toContain('Baseline App')

      const rendered = `${message.subject}\n${message.text}\n${message.html}`
      for (const forbidden of [
        'cus_private',
        'sub_private',
        'si_private',
        'price_private',
        'in_private',
        'pm_private',
        'https://',
        'card ending',
        'amount due'
      ]) {
        expect(rendered).not.toContain(forbidden)
      }
      if (kind === 'family_access_ending') {
        expect(rendered).toContain('August 28, 2026 at 12:00 AM UTC')
      }
    }
  })

  it('escapes display text and rejects header injection', () => {
    const message = createBillingNotificationEmail({
      to: 'recipient@example.test',
      appName: 'Baseline <App>',
      kind: 'member_removed'
    })

    expect(message.text).toContain('Baseline <App>')
    expect(message.html).toContain('Baseline &lt;App&gt;')
    expect(message.html).not.toContain('Baseline <App>')

    expect(() =>
      createBillingNotificationEmail({
        to: 'recipient@example.test\nBcc: hidden@example.test',
        appName: 'Baseline App',
        kind: 'payment_attention'
      })
    ).toThrow(TransactionalEmailDeliveryError)
    expect(() =>
      createBillingNotificationEmail({
        to: 'recipient@example.test',
        appName: 'Baseline App',
        kind: 'family_access_ending',
        effectiveAt: 'not-a-date'
      })
    ).toThrow(TransactionalEmailDeliveryError)
  })
})
