import assert from 'node:assert/strict'

const retiredRoutes = [
  ['GET', '/api/auth/get-session'],
  ['POST', '/api/auth/sign-in/magic-link'],
  ['GET', '/api/me'],
  ['GET', '/api/account/profile'],
  ['GET', '/api/account/billing'],
  ['GET', '/api/account/membership'],
  ['POST', '/api/account/billing/portal'],
  ['POST', '/api/account/delete'],
  ['POST', '/api/join/checkout'],
  ['POST', '/api/join/claim'],
  ['POST', '/api/webhooks/stripe'],
  ['GET', '/api/workspaces'],
  ['GET', '/api/ai/conversations'],
  ['POST', '/api/ai/conversations'],
  ['GET', '/api/files'],
  ['POST', '/api/files/uploads'],
  ['POST', '/api/forms/baseline']
]

export async function runIsolatedApiSmoke({ baseUrl, fixtureId }) {
  const origin = normalizeLoopbackBaseUrl(baseUrl)
  assert.match(fixtureId ?? '', /^[a-z0-9][a-z0-9-]{7,79}$/, 'A safe isolated fixture id is required.')
  const request = (path, options = {}) => fetch(new URL(path, origin), { redirect: 'manual', ...options })
  const failures = []
  const check = async (name, run) => {
    try {
      await run()
      console.log(`ok - ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  await check('public liveness has no response body or cookies', async () => {
    const response = await request('/api/live')
    assert.equal(response.status, 204)
    assert.equal(await response.text(), '')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('set-cookie'), null)
  })

  await check('calendar exposes only public events even with retired account cookies', async () => {
    const path = '/api/events?from=2030-01-01T00%3A00%3A00.000Z&to=2030-02-01T00%3A00%3A00.000Z'
    let anonymousBody
    for (const cookie of [
      '',
      'better-auth.session_token=retired-session; __Secure-better-auth.session_token=retired-session'
    ]) {
      const response = await request(path, { headers: cookie ? { cookie } : {} })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('set-cookie'), null, 'Public events must not create website sessions.')
      const body = await response.json()
      assert.deepEqual(
        body.events.map((event) => event.id),
        [`${fixtureId}-public`]
      )
      assert.equal(body.events[0].sessions.length, 1)
      assert.equal(body.events[0].sessions[0].id, `${fixtureId}-public-session`)
      assert.equal(body.events[0].sessions[0].rsvpUrl, 'https://solidarity.example.com/event/public')
      const serialized = JSON.stringify(body)
      for (const forbidden of [
        'private-video.invalid',
        `${fixtureId}-members`,
        `${fixtureId}-member-tag`,
        `${fixtureId}-hidden`,
        `${fixtureId}-archived`,
        `${fixtureId}-canceled`
      ]) {
        assert(!serialized.includes(forbidden), `Calendar leaked private or excluded event data: ${forbidden}`)
      }
      assert(!serialized.includes('virtualUrl'), 'Public events must omit private virtual meeting URLs.')
      if (anonymousBody) assert.deepEqual(body, anonymousBody)
      else anonymousBody = body
    }
  })

  await check('invalid calendar bounds fail without disclosing runtime details', async () => {
    const response = await request('/api/events?limit=201')
    assert.equal(response.status, 400)
    const body = await response.text()
    assert(!body.includes('.db') && !body.includes('sqlite'), 'Validation response disclosed database details.')
  })

  await check('retired identity, payment, and storage APIs are unavailable', async () => {
    for (const [method, path] of retiredRoutes) {
      const response = await request(path, {
        method,
        headers: {
          origin: origin.origin,
          cookie: 'better-auth.session_token=retired-session',
          'content-type': 'application/json'
        },
        ...(method === 'POST' ? { body: '{}' } : {})
      })
      assert.equal(response.status, 404, `${method} ${path} must be unavailable`)
      // The public 404 document may remember language, but cannot create identity state.
      for (const cookie of response.headers.getSetCookie()) {
        assert.equal(cookie.split('=', 1)[0].trim(), 'wcu_locale', `${path} created a non-locale cookie`)
      }
    }
  })

  if (failures.length) throw new Error(failures.map((failure) => `fail - ${failure}`).join('\n'))
  console.log(`Public API smoke checks passed for isolated fixture ${fixtureId}`)
  return { fixtureId }
}

function normalizeLoopbackBaseUrl(value) {
  const url = new URL(value)
  assert.equal(url.protocol, 'http:', 'Isolated API smoke requires an HTTP loopback URL.')
  assert(
    ['127.0.0.1', '::1', 'localhost'].includes(url.hostname.replace(/^\[|\]$/g, '')),
    'Isolated API smoke refuses non-loopback targets.'
  )
  assert(!url.username && !url.password, 'Isolated API smoke refuses URL credentials.')
  assert(url.pathname === '/' && !url.search && !url.hash, 'Isolated API smoke requires an origin URL.')
  return url
}
