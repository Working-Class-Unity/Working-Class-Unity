import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'

import { parseDeploymentSmokeTarget, readOnlyFetch, runDeploymentSmoke } from './deployment-smoke.mjs'

const retiredApiPaths = [
  '/api/me',
  '/api/auth/get-session',
  '/api/account/billing',
  '/api/account/membership',
  '/api/join/checkout',
  '/api/ai/conversations',
  '/api/files'
]
const openServers = new Set()

after(async () => {
  await Promise.all([...openServers].map((server) => closeServer(server)))
})

test('public-site checks produce only anonymous GET probes with no provider credentials', async (t) => {
  const fixture = await startRecorder()
  t.after(() => fixture.close())
  const logger = recordingLogger()

  const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger })

  assert.equal(result.ok, true)
  assert.deepEqual(result.failures, [])
  assert.equal(logger.errors.length, 0)

  const expectedAccept = new Map([
    ['/', 'text/html'],
    ['/join', 'text/html'],
    ['/api/events', 'application/json'],
    ['/api/live', 'application/json'],
    ...retiredApiPaths.map((path) => [path, 'application/json'])
  ])
  const forbiddenHeaders = [
    'authorization',
    'baggage',
    'cf-access-client-id',
    'cf-access-client-secret',
    'cookie',
    'proxy-authorization',
    'sentry-trace',
    'stripe-signature',
    'x-api-key'
  ]
  for (const request of fixture.requests) {
    assert.equal(request.method, 'GET', request.url)
    assert.equal(expectedAccept.has(request.url), true, `unexpected deployment probe ${request.url}`)
    assert.equal(request.headers.accept, expectedAccept.get(request.url), request.url)
    for (const header of forbiddenHeaders) {
      assert.equal(request.headers[header], undefined, `${request.url} must omit ${header}`)
    }
  }
  for (const path of expectedAccept.keys()) {
    assert.equal(
      fixture.requests.some((request) => request.url === path),
      true,
      `missing deployment probe ${path}`
    )
  }
})

test('a retired account API fails when it still responds with authentication or account data', async (t) => {
  for (const status of [200, 401]) {
    const fixture = await startRecorder({ '/api/account/billing': { body: '{}', status } })
    t.after(() => fixture.close())
    const logger = recordingLogger()

    const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger })

    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0], new RegExp(`expected retired API 404, received ${status}`))
    assert.equal(logger.errors.length, 1)
    assert.match(logger.errors[0], /^fail - GET \/api\/account\/billing/)
  }
})

test('retired API error pages may set only the public language preference cookie', async (t) => {
  for (const [cookies, expected] of [
    [['wcu_locale=en; Path=/; SameSite=Lax'], true],
    [['better-auth.session_token=unexpected; Path=/'], false],
    [['wcu_locale=es; Path=/', 'session=unexpected; Path=/'], false],
    [['unrecognized_id=unexpected; Path=/'], false]
  ]) {
    const fixture = await startRecorder({
      '/api/account/billing': { status: 404, body: '{}', headers: { 'set-cookie': cookies } }
    })
    t.after(() => fixture.close())
    const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger: recordingLogger() })
    assert.equal(result.ok, expected)
    if (!expected) assert.match(result.failures[0], /created a non-locale cookie/)
  }
})

test('the public calendar fails when unavailable or creating an account session', async (t) => {
  for (const override of [
    { status: 401, body: '{}' },
    { status: 200, body: '{}' },
    { status: 200, body: '{"events":[]}', headers: { 'set-cookie': 'session=unexpected' } }
  ]) {
    const fixture = await startRecorder({ '/api/events': override })
    t.after(() => fixture.close())

    const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger: recordingLogger() })

    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 1)
    assert.match(result.failures[0], /^GET \/api\/events/)
  }
})

test('Join must expose both hosted checkout links as actual anchors', async (t) => {
  const fixture = await startRecorder({
    '/join': { status: 200, body: '<p>https://pay.workingclassunity.com/b/7sI4hF1hc9IIepq4gh</p>' }
  })
  t.after(() => fixture.close())

  const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger: recordingLogger() })

  assert.equal(result.ok, false)
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0], /expected hosted checkout link/)
})

test('the request helper rejects unsafe methods before fetch and emits a closed HEAD request shape', async () => {
  let called = false
  await assert.rejects(
    readOnlyFetch('http://127.0.0.1.invalid/', {
      accept: 'application/json',
      fetchImpl: () => {
        called = true
        return new Response(null, { status: 204 })
      },
      method: 'POST'
    }),
    /deployment smoke forbids unsafe POST requests/
  )
  assert.equal(called, false)

  let captured
  const response = await readOnlyFetch('http://127.0.0.1.invalid/', {
    accept: 'text/plain',
    fetchImpl: (_target, init) => {
      captured = init
      return new Response(null, { status: 204 })
    },
    method: 'HEAD'
  })

  assert.equal(response.status, 204)
  assert.deepEqual(captured, {
    credentials: 'omit',
    headers: { accept: 'text/plain' },
    method: 'HEAD',
    redirect: 'manual'
  })
})

test('CLI target parsing rejects ambiguous syntax and never falls back to the mutating-smoke target', () => {
  assert.equal(
    parseDeploymentSmokeTarget([], {
      API_SMOKE_BASE_URL: 'https://mutating.invalid',
      NUXT_PUBLIC_APP_URL: 'https://safe.example'
    }),
    'https://safe.example/'
  )
  assert.equal(
    parseDeploymentSmokeTarget(['--base-url=http://127.0.0.1:4173'], {
      DEPLOYMENT_SMOKE_BASE_URL: 'https://ignored.example'
    }),
    'http://127.0.0.1:4173/'
  )

  for (const args of [
    ['https://positional.example'],
    ['--unknown'],
    ['--base-url'],
    ['--base-url='],
    ['--base-url', 'https://one.example', '--base-url=https://two.example']
  ]) {
    assert.throws(() => parseDeploymentSmokeTarget(args, {}))
  }
  for (const target of [
    'relative.example',
    'file:///tmp/app',
    'https://user:secret@example.com',
    'https://example.com/nested',
    'https://example.com/?target=other',
    'https://example.com/#other'
  ]) {
    assert.throws(() => parseDeploymentSmokeTarget(['--base-url', target], {}))
  }
})

async function startRecorder(overrides = {}) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ headers: request.headers, method: request.method, url: request.url })
    const override = overrides[request.url]
    if (override) {
      send(response, override.status, override.body, override.headers)
      return
    }

    if (request.url === '/') {
      send(response, 200, '<title>Configured Fixture App</title>', {
        'content-security-policy': "default-src 'none'; script-src 'nonce-fixture-nonce'",
        'cross-origin-opener-policy': 'same-origin',
        'permissions-policy':
          'camera=(), display-capture=(), fullscreen=(), geolocation=(), microphone=(), payment=(), usb=()',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY'
      })
      return
    }
    if (request.url === '/api/live') {
      send(response, 204, '', { 'cache-control': 'no-store' })
      return
    }
    if (request.url === '/api/events') {
      sendJson(response, 200, { events: [] })
      return
    }
    if (request.url === '/join') {
      send(
        response,
        200,
        '<a href="https://pay.workingclassunity.com/b/7sI4hF1hc9IIepq4gh">$10/month</a><a href="https://pay.workingclassunity.com/b/bIY4hF4tof325SUaEE">$27/month</a>'
      )
      return
    }
    if (retiredApiPaths.includes(request.url)) {
      sendJson(response, 404, { statusCode: 404 })
      return
    }

    sendJson(response, 500, { unexpected: request.url })
  })

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  openServers.add(server)
  const address = server.address()
  assert(address && typeof address === 'object')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
    requests
  }
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers)
  response.end(body)
}

function sendJson(response, status, body, headers = {}) {
  send(response, status, JSON.stringify(body), { 'content-type': 'application/json', ...headers })
}

function recordingLogger() {
  const errors = []
  return {
    error: (message) => errors.push(message),
    errors,
    log: () => {}
  }
}

function closeServer(server) {
  if (!openServers.delete(server)) return Promise.resolve()
  return new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()))
  })
}
