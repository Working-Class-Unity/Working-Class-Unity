import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const usage = 'Usage: node scripts/deployment-smoke.mjs [--base-url <http(s)://host[:port]>]'
const capabilityBoundaryPaths = {
  ai: '/api/ai/conversations',
  billing: '/api/account/billing',
  files: '/api/files',
  observability: '/observability-client-test'
}

export async function runDeploymentSmoke({ baseUrl, fetchImpl = globalThis.fetch, logger = console }) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  const failures = []

  const request = (path, options = {}) =>
    readOnlyFetch(new URL(path, normalizedBaseUrl), {
      accept: options.accept ?? acceptsFor(path),
      fetchImpl,
      method: options.method ?? 'GET'
    })

  const runCheck = async (name, run) => {
    try {
      await run()
      logger.log(`ok - ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const checks = [
    {
      name: 'GET / renders the app shell',
      run: async () => {
        const response = await request('/')
        const html = await response.text()

        assert(response.ok, `expected 2xx, received ${response.status}`)
        assert(/<title>[^<]+<\/title>/.test(html), 'expected a non-empty app title in shell')
        assertHeaderIncludes(response, 'content-security-policy', "default-src 'none'")
        assertHeaderIncludes(response, 'content-security-policy', "'nonce-")
        assertHeaderAbsent(response, 'content-security-policy-report-only')
        assertHeader(response, 'cross-origin-opener-policy', 'same-origin')
        assertHeader(response, 'x-content-type-options', 'nosniff')
        assertHeader(response, 'referrer-policy', 'strict-origin-when-cross-origin')
        assertHeader(response, 'x-frame-options', 'DENY')
        assertHeaderIncludes(response, 'permissions-policy', 'camera=()')
        assertHeaderIncludes(response, 'permissions-policy', 'display-capture=()')
        assertHeaderIncludes(response, 'permissions-policy', 'fullscreen=()')
        assertHeaderIncludes(response, 'permissions-policy', 'geolocation=()')
        assertHeaderIncludes(response, 'permissions-policy', 'microphone=()')
        assertHeaderIncludes(response, 'permissions-policy', 'payment=()')
        assertHeaderIncludes(response, 'permissions-policy', 'usb=()')
        assertHeaderAbsent(response, 'x-powered-by')
      }
    },
    {
      name: 'GET /api/live reports process liveness without topology',
      run: async () => {
        const response = await request('/api/live')
        assert(response.status === 204, `expected 204, received ${response.status}`)
        assert((await response.text()) === '', 'expected liveness to have no response body')
        assertHeader(response, 'cache-control', 'no-store')
      }
    }
  ]

  for (const check of checks) {
    await runCheck(check.name, check.run)
  }

  for (const [capabilityId, path] of Object.entries(capabilityBoundaryPaths)) {
    await runCheck(`GET ${path} reaches the ${capabilityId} release boundary`, async () => {
      const response = await request(path)
      if (capabilityId === 'observability') {
        const html = await response.text()
        assert(response.ok, `expected observability page 2xx, received ${response.status}`)
        assert(/Client Event Test/.test(html), 'expected the observability client-test page')
        return
      }
      if (capabilityId === 'ai' || capabilityId === 'files') {
        assert(response.status === 404, `expected excluded ${capabilityId} 404, received ${response.status}`)
        assertHeader(response, 'cache-control', 'no-store')
        return
      }
      assert(response.status === 401, `expected anonymous 401 for ${capabilityId}, received ${response.status}`)
    })
  }

  if (failures.length) {
    logger.error(failures.map((failure) => `fail - ${failure}`).join('\n'))
  }

  return {
    baseUrl: normalizedBaseUrl,
    failures,
    ok: failures.length === 0
  }
}

export async function readOnlyFetch(target, { accept, fetchImpl = globalThis.fetch, method = 'GET' } = {}) {
  const safeMethod = normalizeReadOnlyMethod(method)
  assert(typeof fetchImpl === 'function', 'expected a fetch implementation')
  assert(typeof accept === 'string' && accept.length > 0, 'read-only request requires an explicit Accept value')

  return fetchImpl(target, {
    credentials: 'omit',
    headers: { accept },
    method: safeMethod,
    redirect: 'manual'
  })
}

export function normalizeReadOnlyMethod(method) {
  assert(typeof method === 'string' && method.length > 0, 'read-only request method must be a non-empty string')
  const normalized = method.toUpperCase()
  assert(normalized === 'GET' || normalized === 'HEAD', `deployment smoke forbids unsafe ${normalized} requests`)
  return normalized
}

export function parseDeploymentSmokeTarget(argv, environment = process.env) {
  let cliValue

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--base-url') {
      assert(cliValue === undefined, '--base-url may be supplied only once')
      const value = argv[index + 1]
      assert(value && !value.startsWith('-'), '--base-url requires an explicit URL')
      cliValue = value
      index += 1
      continue
    }
    if (argument.startsWith('--base-url=')) {
      assert(cliValue === undefined, '--base-url may be supplied only once')
      cliValue = argument.slice('--base-url='.length)
      assert(cliValue.length > 0, '--base-url requires an explicit URL')
      continue
    }
    throw new Error(`unknown deployment-smoke argument: ${argument}`)
  }

  return normalizeBaseUrl(
    cliValue ?? environment.DEPLOYMENT_SMOKE_BASE_URL ?? environment.NUXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  )
}

function acceptsFor(path) {
  if (path.startsWith('/api/')) {
    return 'application/json'
  }

  return 'text/html'
}

function normalizeBaseUrl(value) {
  assert(typeof value === 'string' && value.length > 0, 'base URL must be a non-empty string')

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('base URL must be an absolute HTTP(S) URL')
  }

  assert(url.protocol === 'http:' || url.protocol === 'https:', 'base URL must use HTTP or HTTPS')
  assert(!url.username && !url.password, 'base URL must not contain credentials')
  assert(url.pathname === '/', 'base URL must not contain a path')
  assert(!url.search && !url.hash, 'base URL must not contain a query or fragment')
  return url.href
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertHeader(response, name, expected) {
  const actual = response.headers.get(name)
  assert(actual === expected, `expected ${name}: ${expected}, received ${actual ?? 'missing'}`)
}

function assertHeaderIncludes(response, name, expected) {
  const actual = response.headers.get(name) ?? ''
  assert(actual.includes(expected), `expected ${name} to include ${expected}, received ${actual || 'missing'}`)
}

function assertHeaderAbsent(response, name) {
  const actual = response.headers.get(name)
  assert(actual === null, `expected ${name} to be absent, received ${actual}`)
}

async function main() {
  let baseUrl
  try {
    baseUrl = parseDeploymentSmokeTarget(process.argv.slice(2))
  } catch (error) {
    console.error(`${usage}\n${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
    return
  }

  const result = await runDeploymentSmoke({ baseUrl })
  if (!result.ok) {
    process.exitCode = 1
    return
  }

  console.log(`Deployment smoke checks passed against ${result.baseUrl}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
