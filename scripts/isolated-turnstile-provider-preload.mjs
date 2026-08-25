const siteverifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const expectedHostname = readLoopbackHostname(process.env.SWL_ISOLATED_TURNSTILE_HOSTNAME)
const expectedSecret = readExpectedSecret(process.env.NUXT_CLOUDFLARE_TURNSTILE_SECRET_KEY)
const originalFetch = globalThis.fetch

globalThis.fetch = async function isolatedTurnstileFetch(input, init) {
  const url = input instanceof Request ? input.url : String(input)
  if (url !== siteverifyUrl) return Reflect.apply(originalFetch, this, [input, init])

  const body = new URLSearchParams(String(init?.body ?? ''))
  if (
    init?.method !== 'POST' ||
    body.get('secret') !== expectedSecret ||
    !body.get('response')?.startsWith('isolated-turnstile-') ||
    !/^[0-9a-f-]{36}$/.test(body.get('idempotency_key') ?? '')
  ) {
    throw new Error('The isolated Turnstile provider received an invalid request.')
  }

  return Response.json({
    success: true,
    challenge_ts: new Date().toISOString(),
    hostname: expectedHostname,
    action: 'auth_magic_link'
  })
}

function readLoopbackHostname(value) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(value ?? '')) {
    throw new Error('The isolated Turnstile provider preload requires a loopback application hostname.')
  }
  return value
}

function readExpectedSecret(value) {
  if (!value?.startsWith('isolated-turnstile-')) {
    throw new Error('The isolated Turnstile provider preload requires its disposable test secret.')
  }
  return value
}
