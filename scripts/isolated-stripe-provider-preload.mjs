import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const http = require('node:http')
const https = require('node:https')
const providerUrl = isolatedProviderUrl(process.env.SWL_ISOLATED_STRIPE_PROVIDER_URL)
const originalRequest = https.request

https.request = function isolatedStripeRequest(options, ...args) {
  if (!isStripeApiRequest(options)) {
    return Reflect.apply(originalRequest, this, [options, ...args])
  }

  const redirected = {
    ...options,
    protocol: 'http:',
    hostname: providerUrl.hostname,
    host: providerUrl.hostname,
    port: providerUrl.port,
    agent: undefined
  }
  delete redirected.ciphers
  const request = Reflect.apply(http.request, http, [redirected, ...args])
  // Stripe's HTTPS transport waits for secureConnect before writing. Mirror
  // that signal only for this loopback HTTP request.
  request.once('socket', (socket) => {
    const signalSecureConnection = () => socket.emit('secureConnect')
    if (socket.connecting) socket.once('connect', signalSecureConnection)
    else queueMicrotask(signalSecureConnection)
  })
  return request
}

function isolatedProviderUrl(value) {
  const url = new URL(value ?? '')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '::1', 'localhost'].includes(hostname) ||
    !url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error('The isolated Stripe provider preload requires an HTTP loopback origin.')
  }
  return url
}

function isStripeApiRequest(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false
  const hostname = options.hostname ?? options.host
  const port = String(options.port ?? '443')
  return hostname === 'api.stripe.com' && port === '443'
}
