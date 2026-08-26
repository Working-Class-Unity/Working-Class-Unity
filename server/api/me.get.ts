import { setHeader } from 'h3'
import type { AccountProfile } from '../../shared/profile'
import { isTemporaryPhoneEmail } from '../../shared/account-identity'
import { useDatabase } from '../db/client'
import { requireSession } from '../utils/auth/require-session'
import { unauthorizedError } from '../utils/errors'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')

  const session = await requireSession(event)
  const account = useDatabase()
    .sqlite.prepare(
      `select email, email_verified as emailVerified,
              phone_number as phoneNumber, phone_number_verified as phoneNumberVerified,
              first_name as firstName, last_name as lastName, display_name as displayName
       from user where id = ?`
    )
    .get(session.user.id) as
    | (AccountProfile & {
        email: string
        emailVerified: number
        phoneNumber: string | null
        phoneNumberVerified: number
      })
    | undefined

  if (!account) throw unauthorizedError()
  const email = isTemporaryPhoneEmail(account.email) ? null : account.email

  return {
    user: {
      id: session.user.id,
      email,
      emailVerified: email !== null && account.emailVerified === 1,
      phoneNumber: account.phoneNumber,
      phoneNumberVerified: account.phoneNumberVerified === 1,
      image: session.user.image,
      firstName: account.firstName,
      lastName: account.lastName,
      displayName: account.displayName
    }
  }
})
