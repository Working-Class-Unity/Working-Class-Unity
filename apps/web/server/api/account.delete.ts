import { useDatabase } from '../db/client'
import { createAccountDeletionHandler } from '../services/account-deletion-command'
import {
  activateAccountDeletionBillingProof,
  revokeAccountDeletionBillingProof
} from '../services/payments/account-deletion-billing-proof'
import {
  billingAccountDeletionPendingHttpError,
  prepareBillingAccountDeletionForConnection
} from '../services/payments/billing-account-deletion'
import { createStripeBillingCatalog } from '../services/payments/billing-catalog'
import { getStripeClient } from '../services/payments/stripe-client'
import { auth } from '../utils/auth'
import { assertFreshAccountDeletionSession } from '../utils/auth/account-deletion-freshness'
import { getBetterAuthRequestHeaders, requireSession } from '../utils/auth/require-session'
import { getAppRuntimeConfig } from '../utils/runtime'

const handler = createAccountDeletionHandler({
  requireSession,
  assertFreshSession: assertFreshAccountDeletionSession,
  prepareDeletion: (userId) => {
    const config = getAppRuntimeConfig()
    return prepareBillingAccountDeletionForConnection(
      useDatabase(),
      userId,
      () => getStripeClient(config),
      createStripeBillingCatalog(config.stripe)
    )
  },
  requestHeaders: getBetterAuthRequestHeaders,
  deleteUser: async (headers, billingProof, userId) => {
    if (!activateAccountDeletionBillingProof(userId, billingProof)) {
      throw billingAccountDeletionPendingHttpError()
    }
    try {
      return await auth.api.deleteUser({
        body: {},
        headers,
        asResponse: true
      })
    } finally {
      revokeAccountDeletionBillingProof(billingProof)
    }
  }
})

export default handler
