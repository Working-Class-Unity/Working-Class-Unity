import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'

import { parseDeploymentSmokeTarget, readOnlyFetch, runDeploymentSmoke } from './deployment-smoke.mjs'

const openServers = new Set()

after(async () => {
  await Promise.all([...openServers].map((server) => closeServer(server)))
})

test('mixed deployed module states produce only anonymous GET probes with no provider credentials', async (t) => {
  const fixture = await startRecorder({
    ai: 'disabled',
    billing: 'ready',
    files: 'disabled',
    observability: 'disabled'
  })
  t.after(() => fixture.close())
  const logger = recordingLogger()

  const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger })

  assert.equal(result.ok, true)
  assert.deepEqual(result.failures, [])
  assert.equal(logger.errors.length, 0)

  const expectedAccept = new Map([
    ['/api/baseline', 'application/json'],
    ['/', 'text/html'],
    ['/api/live', 'application/json'],
    ['/observability-client-test', 'application/json'],
    ['/api/ai/conversations', 'application/json'],
    ['/api/account/billing', 'application/json'],
    ['/api/files', 'application/json']
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

test('an advertised ready module fails closed when its anonymous response is not 401', async (t) => {
  const fixture = await startRecorder(
    {
      ai: 'disabled',
      billing: 'ready',
      files: 'disabled',
      observability: 'disabled'
    },
    { '/api/account/billing': { body: '{}', status: 200 } }
  )
  t.after(() => fixture.close())
  const logger = recordingLogger()

  const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger })

  assert.equal(result.ok, false)
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0], /expected anonymous 401 for ready billing, received 200/)
  assert.equal(logger.errors.length, 1)
  assert.match(logger.errors[0], /^fail - GET \/api\/account\/billing/)
})

test('observability page follows its advertised ready state with a GET-only probe', async (t) => {
  const fixture = await startRecorder({
    ai: 'disabled',
    billing: 'disabled',
    files: 'disabled',
    observability: 'ready'
  })
  t.after(() => fixture.close())

  const result = await runDeploymentSmoke({ baseUrl: fixture.baseUrl, logger: recordingLogger() })

  assert.equal(result.ok, true)
  assert.deepEqual(
    fixture.requests.filter(({ url }) => url === '/observability-client-test').map(({ method, url }) => [method, url]),
    [['GET', '/observability-client-test']]
  )
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

async function startRecorder(moduleStates, overrides = {}) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ headers: request.headers, method: request.method, url: request.url })
    const override = overrides[request.url]
    if (override) {
      send(response, override.status, override.body, override.headers)
      return
    }

    if (request.url === '/api/baseline') {
      sendJson(response, 200, { modules: moduleStates, stack: ['Nuxt'] })
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
    const moduleEntry = Object.entries({
      ai: '/api/ai/conversations',
      billing: '/api/account/billing',
      files: '/api/files',
      observability: '/observability-client-test'
    }).find(([, path]) => path === request.url)
    if (moduleEntry) {
      const [moduleId] = moduleEntry
      if (moduleStates[moduleId] === 'disabled') {
        sendModuleDisabled(response, moduleId)
      } else if (moduleId === 'observability') {
        send(response, 200, '<h1>Client Event Test</h1>')
      } else {
        sendJson(response, 401, { statusCode: 401 })
      }
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

function sendJson(response, status, body) {
  send(response, status, JSON.stringify(body), { 'content-type': 'application/json' })
}

function sendModuleDisabled(response, moduleId) {
  sendJson(response, 404, { data: { code: 'MODULE_DISABLED', module: moduleId } })
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
