import { defineEventHandler, getQuery, sendRedirect, setHeader } from 'h3'
import { getAppRuntimeConfig } from '../../../utils/runtime'
import { consumeBillingEmailVerification } from '../../../services/payments/stripe/billing-email-verification'
import { requireBillingStripeReady } from '../../../services/payments/stripe/composition'

export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const query = getQuery(event)
  const verificationId = singleQueryValue(query.id)
  const token = singleQueryValue(query.token)

  if (verificationId && token) {
    const ready = requireBillingStripeReady()
    consumeBillingEmailVerification(ready.composition.connection(), {
      secret: getAppRuntimeConfig().betterAuth.secret,
      stripePrices: ready.config.stripe.prices,
      token,
      verificationId
    })
  }

  return sendRedirect(event, '/login?status=billing-email-checked', 302)
})

function singleQueryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
