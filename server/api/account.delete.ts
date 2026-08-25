import { useDatabase } from '../db/client'
import { prepareAccountDeletionBilling, withAccountDeletionBillingProof } from '../services/account-deletion-billing'
import { createAccountDeletionHandler } from '../services/account-deletion-command'
import { billingStripeConfiguration } from '../services/payments/stripe/app-composition'
import { auth } from '../utils/auth'
import { assertFreshAccountDeletionSession } from '../utils/auth/account-deletion-freshness'
import { getBetterAuthRequestHeaders, requireSession } from '../utils/auth/require-session'

const handler = createAccountDeletionHandler({
  requireSession,
  assertFreshSession: assertFreshAccountDeletionSession,
  prepareDeletion: (userId) => prepareAccountDeletionBilling(useDatabase(), userId, billingStripeConfiguration()),
  requestHeaders: getBetterAuthRequestHeaders,
  deleteUser: async (headers, billingProof, userId) => {
    return withAccountDeletionBillingProof(userId, billingProof, () =>
      auth.api.deleteUser({
        body: {},
        headers,
        asResponse: true
      })
    )
  }
})

export default handler
