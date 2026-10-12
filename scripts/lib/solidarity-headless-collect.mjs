import { Window } from 'happy-dom'
import { cookieHeader, mergeSetCookies } from './solidarity-cookies.mjs'
import { collectSolidarityDashboardEvents, collectSolidarityEventDescriptions } from './solidarity-dashboard.mjs'

/**
 * Runs the same collector sources used in the browser inside happy-dom with a cookie jar.
 * Dashboard requests carry only the private jar's authentication cookies; the public
 * event-site requests stay credentialless. Response Set-Cookie values are returned so the
 * caller can persist rotated session cookies.
 */
const dashboardOrigin = 'https://dashboard.solidarity.tech'
const publicOrigin = 'https://tech.workingclassunity.com'
const requestTimeout = 30000

export async function collectSolidarityCapture({ jar, from, to, timezone, eventIds, fetchImpl = fetch }) {
  const setCookieValues = []
  let activeJar = jar
  const dashboardFetch = async (input, init = {}) => {
    const url = requestUrl(input)
    if (url.origin !== dashboardOrigin) throw new Error('Solidarity dashboard: unexpected request origin')
    const headers = new Headers(init.headers)
    if (init.credentials !== 'omit') headers.set('cookie', cookieHeader(activeJar))
    const response = await fetchImpl(url.href, {
      ...init,
      headers,
      signal: AbortSignal.timeout(requestTimeout)
    })
    const rotated = response.headers.getSetCookie?.() ?? []
    setCookieValues.push(...rotated)
    activeJar = mergeSetCookies(activeJar, rotated)
    return response
  }
  const window = openWindow(dashboardOrigin, dashboardFetch)
  let captured
  try {
    const options = { from, to, timezone, ...(eventIds ? { eventIds } : {}) }
    captured = await window.eval(`(${collectSolidarityDashboardEvents.toString()})(${JSON.stringify(options)})`)
  } finally {
    await window.happyDOM.close()
  }
  if (!captured?.dataset?.events || !captured?.dataset?.sessions || !captured?.scope || !captured?.observedAt) {
    throw new Error('Solidarity dashboard: collector returned an incomplete capture')
  }
  if (captured.eventPageUrls.length) {
    const publicFetch = async (input, init = {}) => {
      const url = requestUrl(input)
      if (url.origin !== publicOrigin) throw new Error('Solidarity descriptions: unexpected request origin')
      return fetchImpl(url.href, {
        ...init,
        headers: new Headers(init.headers),
        signal: AbortSignal.timeout(requestTimeout)
      })
    }
    const publicWindow = openWindow(publicOrigin, publicFetch)
    try {
      const descriptions = await publicWindow.eval(
        `(${collectSolidarityEventDescriptions.toString()})(${JSON.stringify({ urls: captured.eventPageUrls })})`
      )
      for (const event of captured.dataset.events) {
        if (event.eventPageUrl) event.description = descriptions[event.eventPageUrl]
      }
    } finally {
      await publicWindow.happyDOM.close()
    }
  }
  return {
    capture: {
      dataset: captured.dataset,
      scope: { ...captured.scope, completeInventory: eventIds === undefined },
      observedAt: captured.observedAt
    },
    setCookieValues
  }
}

function openWindow(origin, fetchImpl) {
  const window = new Window({
    url: origin,
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true }
  })
  Object.assign(window, { fetch: fetchImpl })
  return window
}

function requestUrl(input) {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  if (input && typeof input === 'object' && typeof input.url === 'string') return new URL(input.url)
  throw new Error('Solidarity dashboard: collector requested an invalid URL')
}
