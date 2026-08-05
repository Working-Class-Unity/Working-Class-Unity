import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'

const requireFromApp = createRequire(new URL('../package.json', import.meta.url))
const Stripe = requireFromApp('stripe')

let baseUrl = ''
let fixtureId = ''
let fixtureSequence = 0
let stripeWebhookSecret = ''
let emailCaptureDirectory = ''
let clientAddressBook

const checks = [
  {
    name: 'GET /api/live',
    run: async () => {
      const response = await requestWithCookies('/api/live')
      assert(response.status === 204, `expected 204, received ${response.status}`)
      assert((await response.text()) === '', 'expected liveness to have no response body')
      assert(response.headers.get('cache-control') === 'no-store', 'expected liveness to disable caching')
    }
  },
  {
    name: 'retired baseline form API is absent',
    run: async () => {
      const response = await requestWithCookies('/api/forms/baseline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })

      assert(response.status === 404, `expected retired baseline form route 404, received ${response.status}`)
    }
  },
  {
    name: 'retired workspace APIs are absent',
    run: async () => {
      for (const path of [
        '/api/workspaces',
        '/api/workspaces/not-a-workspace',
        '/api/workspaces/not-a-workspace/invitations',
        '/api/workspaces/not-a-workspace/members'
      ]) {
        const response = await requestWithCookies(path)
        assert(response.status === 404, `expected superseded ${path} route 404, received ${response.status}`)
      }

      const invitationPost = await requestWithCookies('/api/workspaces/not-a-workspace/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      })
      assert(
        invitationPost.status === 404,
        `expected superseded invitation POST route 404, received ${invitationPost.status}`
      )
    }
  },
  {
    name: 'private file upload initiation authenticates before parsing',
    run: async () => {
      const response = await requestWithCookies('/api/files/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{malformed'
      })
      assert(response.status === 401, `expected anonymous 401, received ${response.status}`)
    }
  },
  {
    name: 'GET /api/auth/get-session returns anonymous session state',
    run: async () => {
      const response = await requestWithCookies('/api/auth/get-session')

      assert(response.ok, `expected 2xx, received ${response.status}`)
    }
  },
  {
    name: 'private identity route follows the authenticated user',
    run: async () => {
      const ownerJar = new Map()
      const otherJar = new Map()
      const suffix = nextFixtureSuffix('private-identity')
      const ownerEmail = `owner-${suffix}@example.com`
      const owner = await signUpSmokeUser(ownerJar, ownerEmail, 'Smoke Owner')
      const other = await signUpSmokeUser(otherJar, `other-${suffix}@example.com`, 'Smoke Other')

      const anonymousMe = await requestWithCookies('/api/me')
      assert(anonymousMe.status === 401, `expected anonymous identity 401, received ${anonymousMe.status}`)

      const ownerMe = await requestJson('/api/me', {}, ownerJar)
      const otherMe = await requestJson('/api/me', {}, otherJar)
      assertMinimalMeProjection(ownerMe, owner.user)
      assertMinimalMeProjection(otherMe, other.user)
      assert(ownerMe.user.id !== otherMe.user.id, 'expected each authenticated caller to receive its own identity')
      const appEntry = await requestWithCookies('/app', { redirect: 'manual' }, ownerJar)
      assert(appEntry.status === 200, `expected authenticated /app shell 200, received ${appEntry.status}`)
      assert(appEntry.headers.get('cache-control') === 'private, no-store', 'expected /app to disable shared caching')
      const appHtml = await appEntry.text()
      assert(appHtml.includes(owner.user.name), 'expected /app shell to render the authenticated user name')
      assert(appHtml.includes(owner.user.email), 'expected /app shell to render the authenticated user email')
      assert(!appHtml.includes('/w/'), 'expected /app shell to avoid visible workspace routing')
      assert(!/workspace|capabilit(?:y|ies)/i.test(appHtml), 'expected /app shell to omit workspace authority details')

      const signOutResponse = await requestWithCookies(
        '/api/auth/sign-out',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        },
        ownerJar
      )

      assert(signOutResponse.ok, `expected sign out 2xx, received ${signOutResponse.status}`)

      const returning = await signUpSmokeUser(ownerJar, ownerEmail, 'Smoke Owner')
      assert(returning.user.id === owner.user.id, 'expected returning authentication to reuse the user identity')
      const returningMe = await requestJson('/api/me', {}, ownerJar)
      assertMinimalMeProjection(returningMe, owner.user)
    }
  },
  {
    name: 'private AI collection requires authentication',
    run: async () => {
      const response = await requestWithCookies('/api/ai/conversations')
      assert(response.status === 401, `expected anonymous AI collection 401, received ${response.status}`)
    }
  },
  {
    name: 'private file flow stores metadata and protects downloads',
    run: async () => {
      const ownerJar = new Map()
      const otherJar = new Map()
      const suffix = nextFixtureSuffix('files')
      await signUpSmokeUser(ownerJar, `file-owner-${suffix}@example.com`, 'File Owner')
      await signUpSmokeUser(otherJar, `file-other-${suffix}@example.com`, 'File Other')
      const content = 'hello'
      const contentMd5 = createHash('md5').update(content).digest('base64')

      const anonymousUpload = await requestWithCookies('/api/files/uploads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: 'private 🗒️ note.txt',
          contentType: 'text/plain',
          byteSize: 5,
          contentMd5
        })
      })

      assert(anonymousUpload.status === 401, `expected anonymous 401, received ${anonymousUpload.status}`)

      const uploadTarget = await requestJson(
        '/api/files/uploads',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            filename: 'private 🗒️ note.txt',
            contentType: 'text/plain',
            byteSize: 5,
            contentMd5
          })
        },
        ownerJar
      )

      assert(uploadTarget.file?.status === 'pending', 'expected pending file metadata')
      assert(uploadTarget.upload?.method === 'PUT', 'expected upload target')

      const uploadResponse = await requestWithCookies(
        uploadTarget.upload.url,
        {
          method: 'PUT',
          headers: uploadTarget.upload.headers,
          body: content
        },
        ownerJar
      )

      assert(uploadResponse.ok, `expected upload 2xx, received ${uploadResponse.status}`)

      const completed = await requestJson(
        `/api/files/${uploadTarget.file.id}/complete`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        },
        ownerJar
      )

      assert(completed.file?.status === 'ready', 'expected completed file metadata')

      const listed = await requestJson('/api/files?limit=1', {}, ownerJar)
      assert(listed.files?.length === 1, 'expected owner file list to include the completed file')
      assert(listed.files[0].id === uploadTarget.file.id, 'expected owner list to return the immutable file id')
      assert(!('ownerId' in listed.files[0]), 'expected minimized public file metadata')
      assert(!('objectKey' in listed.files[0]), 'expected storage keys to remain private')

      const metadata = await requestJson(`/api/files/${uploadTarget.file.id}`, {}, ownerJar)
      assert(metadata.file?.id === uploadTarget.file.id, 'expected owner metadata read')

      const forbiddenDownload = await requestWithCookies(`/api/files/${uploadTarget.file.id}/download`, {}, otherJar)

      assert(
        forbiddenDownload.status === 404,
        `expected concealed foreign file 404, received ${forbiddenDownload.status}`
      )

      const downloadTarget = await requestJson(`/api/files/${uploadTarget.file.id}/download`, {}, ownerJar)
      assert(downloadTarget.download?.method === 'GET', 'expected a short-lived download capability')
      const download = await requestWithCookies(downloadTarget.download.url, {}, ownerJar)
      const downloadedText = await download.text()

      assert(download.ok, `expected download 2xx, received ${download.status}`)
      assert(download.headers.get('content-disposition') === 'attachment', 'expected a safe attachment response')
      assert(downloadedText === content, 'expected downloaded file content')

      const deleted = await requestWithCookies(`/api/files/${uploadTarget.file.id}`, { method: 'DELETE' }, ownerJar)
      assert(deleted.status === 204, `expected file deletion 204, received ${deleted.status}`)
      const deletedMetadata = await requestWithCookies(`/api/files/${uploadTarget.file.id}`, {}, ownerJar)
      assert(
        deletedMetadata.status === 404,
        `expected deleted file concealment 404, received ${deletedMetadata.status}`
      )
    }
  },
  {
    name: 'packaged Stripe webhook preserves the signed raw body at the canonical route',
    run: async () => {
      const suffix = nextFixtureSuffix('billing')
      const event = {
        id: `evt_packaged_${suffix}`,
        object: 'event',
        api_version: '2026-06-24.dahlia',
        created: Math.floor(Date.now() / 1_000),
        data: {
          object: {
            id: `cs_test_${suffix}`,
            mode: 'subscription',
            object: 'checkout.session',
            status: 'expired'
          }
        },
        livemode: false,
        pending_webhooks: 0,
        request: null,
        type: 'checkout.session.expired'
      }
      const firstWebhook = await requestJson('/api/webhooks/stripe', stripeWebhookInit(event))

      assert(firstWebhook.received === true, 'expected webhook received')
      assert(firstWebhook.duplicate === false, 'expected first webhook to process')

      const duplicateWebhook = await requestJson('/api/webhooks/stripe', stripeWebhookInit(event))

      assert(duplicateWebhook.duplicate === true, 'expected duplicate webhook to be idempotent')
    }
  }
]

export async function runIsolatedApiSmoke(options) {
  assert(!baseUrl, 'The isolated API smoke client does not support concurrent runs.')
  assert(options && typeof options === 'object', 'Isolated API smoke options are required.')
  assert(/^[a-z0-9][a-z0-9-]{7,79}$/.test(options.fixtureId ?? ''), 'A safe isolated fixture id is required.')
  assert(
    typeof options.stripeWebhookSecret === 'string' && options.stripeWebhookSecret.startsWith('whsec_'),
    'An isolated Stripe webhook fixture secret is required.'
  )
  assert(
    typeof options.emailCaptureDirectory === 'string' && isAbsolute(options.emailCaptureDirectory),
    'An absolute isolated email capture directory is required.'
  )

  baseUrl = normalizeLoopbackBaseUrl(options.baseUrl)
  fixtureId = options.fixtureId
  fixtureSequence = 0
  stripeWebhookSecret = options.stripeWebhookSecret
  emailCaptureDirectory = options.emailCaptureDirectory
  clientAddressBook = createIsolatedClientAddressBook()

  try {
    const failures = []

    for (const check of checks) {
      try {
        await check.run()
        console.log(`ok - ${check.name}`)
      } catch (error) {
        failures.push(`${check.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (failures.length) {
      throw new Error(failures.map((failure) => `fail - ${failure}`).join('\n'))
    }

    console.log(`API mutating smoke checks passed for isolated fixture ${fixtureId}`)
    return { fixtureId }
  } finally {
    baseUrl = ''
    fixtureId = ''
    fixtureSequence = 0
    stripeWebhookSecret = ''
    emailCaptureDirectory = ''
    clientAddressBook = undefined
  }
}

function assertMinimalMeProjection(body, expectedUser) {
  assert(
    JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['user']),
    'expected /api/me to expose only user identity'
  )
  assert(
    JSON.stringify(Object.keys(body.user ?? {}).sort()) === JSON.stringify(['email', 'id', 'image', 'name']),
    'expected /api/me to expose only the minimal user identity fields'
  )
  assert(body.user.id === expectedUser.id, 'expected /api/me user id to match the authenticated caller')
  assert(body.user.name === expectedUser.name, 'expected /api/me user name to match the authenticated caller')
  assert(body.user.email === expectedUser.email, 'expected /api/me user email to match the authenticated caller')
  assert(body.user.image === expectedUser.image, 'expected /api/me user image to match the authenticated caller')
}

async function requestJson(path, init, cookieJar) {
  const response = await requestWithCookies(path, init, cookieJar)
  const body = await response.json().catch(() => null)

  assert(response.ok, `expected 2xx, received ${response.status}`)
  assert(body && typeof body === 'object', 'expected JSON object response')

  return body
}

async function signUpSmokeUser(cookieJar, email, name) {
  const requestBody = await requestJson(
    '/api/auth/sign-in/magic-link',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-turnstile-token': `isolated-turnstile-${randomUUID()}`
      },
      body: JSON.stringify({
        name,
        email,
        callbackURL: '/app',
        errorCallbackURL: '/login',
        newUserCallbackURL: '/app'
      })
    },
    cookieJar
  )
  assert(requestBody.status === true, 'expected a neutral magic-link request response')

  const capture = consumeCapturedEmail(email)
  const verificationUrl = capturedMagicLink(capture)
  const response = await requestWithCookies(
    verificationUrl.pathname + verificationUrl.search,
    { redirect: 'manual' },
    cookieJar
  )
  assert(response.status === 302, `expected magic-link redirect, received ${response.status}`)
  const location = new URL(response.headers.get('location'), baseUrl)
  assert(location.origin === new URL(baseUrl).origin, 'expected the isolated application callback origin')
  assert(location.pathname === '/app' && !location.search, 'expected the allowlisted app callback')

  const body = await requestJson('/api/auth/get-session', {}, cookieJar)

  assert(body.user?.id, 'expected signed up user id')
  return body
}

function consumeCapturedEmail(email) {
  const captures = readdirSync(emailCaptureDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => {
      const path = join(emailCaptureDirectory, entry.name)
      return { path, value: JSON.parse(readFileSync(path, 'utf8')) }
    })
    .filter(({ value }) => value?.message?.to === email)

  assert(
    captures.length === 1,
    `expected exactly one isolated capture for the requested address, received ${captures.length}`
  )
  const [capture] = captures
  rmSync(capture.path)
  return capture.value
}

function capturedMagicLink(capture) {
  assert(capture?.version === 1 && capture?.transport === 'capture', 'expected the versioned capture envelope')
  const match = capture.message?.text?.match(/https?:\/\/\S+/)
  assert(match, 'expected the captured plaintext message to contain a magic-link URL')
  const url = new URL(match[0])
  const expectedOrigin = new URL(baseUrl).origin
  assert(url.origin === expectedOrigin, 'captured magic link must use the isolated application origin')
  assert(url.pathname === '/api/auth/magic-link/verify', 'captured URL must target Better Auth verification')
  assert(url.searchParams.get('token'), 'captured magic link must carry a verification token')
  return url
}

async function requestWithCookies(path, init = {}, cookieJar) {
  const headers = new Headers(init.headers ?? {})
  const method = init.method?.toUpperCase() ?? 'GET'

  assert(clientAddressBook, 'The isolated client address book is not initialized.')
  // The application trusts only Cloudflare's edge-to-origin visitor header.
  // This loopback-only fixture owns the server and header, and gives each
  // simulated browser a stable TEST-NET-1 address so auth rate limits remain
  // active without collapsing distinct users into one fallback bucket.
  headers.set('cf-connecting-ip', clientAddressBook.addressFor(cookieJar))

  if (method !== 'GET' && !headers.has('origin')) {
    headers.set('origin', new URL(baseUrl).origin)
  }

  if (cookieJar?.size) {
    headers.set('cookie', serializeCookies(cookieJar))
  }

  const response = await fetch(urlFor(path), {
    ...init,
    headers
  })

  if (cookieJar) {
    rememberCookies(cookieJar, response.headers)
  }

  return response
}

export function createIsolatedClientAddressBook() {
  const addresses = new WeakMap()
  let nextHost = 2

  return {
    addressFor(cookieJar) {
      if (!cookieJar) return '192.0.2.1'

      const existing = addresses.get(cookieJar)
      if (existing) return existing

      assert(nextHost <= 254, 'The isolated API smoke exhausted its simulated client address range.')
      const address = `192.0.2.${nextHost}`
      nextHost += 1
      addresses.set(cookieJar, address)
      return address
    }
  }
}

function rememberCookies(cookieJar, headers) {
  for (const setCookie of getSetCookieHeaders(headers)) {
    const cookiePair = setCookie.split(';')[0]
    const separatorIndex = cookiePair.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    cookieJar.set(cookiePair.slice(0, separatorIndex), cookiePair.slice(separatorIndex + 1))
  }
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }

  const setCookie = headers.get('set-cookie')
  return setCookie ? setCookie.split(/,(?=\s*[^;,]+=)/) : []
}

function serializeCookies(cookieJar) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

function stripeWebhookInit(event) {
  const payload = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: stripeWebhookSecret,
    timestamp
  })

  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature
    },
    body: payload
  }
}

function urlFor(path) {
  return new URL(path, baseUrl)
}

function normalizeLoopbackBaseUrl(value) {
  const url = new URL(value)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  assert(url.protocol === 'http:', 'Isolated API smoke requires an HTTP loopback URL.')
  assert(['127.0.0.1', '::1', 'localhost'].includes(hostname), 'Isolated API smoke refuses non-loopback targets.')
  assert(!url.username && !url.password, 'Isolated API smoke refuses URL credentials.')
  url.pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return url.toString()
}

function nextFixtureSuffix(label) {
  fixtureSequence += 1
  return `${fixtureId}-${label}-${fixtureSequence}`
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
