import { defineEventHandler, getQuery, setHeader } from 'h3'
import { useDatabase } from '../../db/client'
import { readPublicJoinStatus } from '../../services/membership/public-join'
import { getOptionalSession } from '../../utils/auth/require-session'

export default defineEventHandler(async (event) => {
  setHeader(event, 'cache-control', 'private, no-store')
  const id = singleQueryValue(getQuery(event).id)
  const session = await getOptionalSession(event)
  return readPublicJoinStatus(useDatabase(), id || null, session?.user.id ?? null)
})

function singleQueryValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
