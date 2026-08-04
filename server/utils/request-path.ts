import type { H3Event } from 'h3'

/**
 * Mirrors the pinned H3 v1 router input: global middleware receives a decoded
 * event.path, and the router removes the query at the first question mark.
 * Reading originalUrl through getRequestURL would preserve encoded ASCII and
 * can therefore disagree with the route that Nitro ultimately dispatches.
 */
export function getCanonicalRequestPathname(event: H3Event): string {
  const queryIndex = event.path.indexOf('?')
  return queryIndex === -1 ? event.path : event.path.slice(0, queryIndex)
}
