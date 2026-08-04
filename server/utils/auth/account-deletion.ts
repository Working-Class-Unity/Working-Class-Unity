import type { BetterAuthOptions } from 'better-auth'
import type { DatabaseConnection } from '../../db/connect'
import { deleteAccountAtomically } from '../../services/account-deletion'

export const disabledAccountDeletionAuthPaths = ['/delete-user', '/delete-user/callback'] as const

export function createAccountDeletionUserOptions(
  connection: DatabaseConnection
): NonNullable<BetterAuthOptions['user']> {
  return {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        deleteAccountAtomically(
          connection,
          {
            id: user.id,
            email: user.email
          },
          {
            requireBillingProof: true
          }
        )
      }
    }
  }
}
