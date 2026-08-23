const excludedCapabilities = new Set(['ai', 'files'])
const excludedApiPrefixes = Object.freeze(['/api/ai', '/api/files'])

/** @typedef {'ai' | 'files'} BasicReleaseCapability */

/** @param {BasicReleaseCapability} capability */
export function assertBasicReleaseCapabilityAvailable(capability) {
  if (!excludedCapabilities.has(capability)) return
  throw Object.assign(new Error('Not Found'), { statusCode: 404, statusMessage: 'Not Found' })
}

/** @param {string} pathname */
export function isBasicReleaseExcludedPathname(pathname) {
  return excludedApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
