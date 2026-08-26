import { z } from 'zod'
import { profileNameMaxLength, profileUserFields } from '../../../shared/profile'
import type { DatabaseConnection } from '../../db/connect'
import { createAccountDeletionUserOptions } from './account-deletion'

const optionalProfileName = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  const normalized = value.trim()
  return normalized || null
}, z.string().max(profileNameMaxLength).nullable())

const profileInputValidator = { input: optionalProfileName }

export function createAuthenticationUserOptions(connection: DatabaseConnection) {
  const accountDeletionOptions = createAccountDeletionUserOptions(connection)

  return {
    ...accountDeletionOptions,
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: false
    },
    additionalFields: {
      ...accountDeletionOptions.additionalFields,
      firstName: {
        ...profileUserFields.firstName,
        validator: profileInputValidator
      },
      lastName: {
        ...profileUserFields.lastName,
        validator: profileInputValidator
      },
      displayName: {
        ...profileUserFields.displayName,
        validator: profileInputValidator
      }
    }
  }
}
