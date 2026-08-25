import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const dockerfile = readFileSync(resolve('Dockerfile'), 'utf8')
const instruction = dockerfile.match(/^HEALTHCHECK ([^\n]+?) CMD (\[.*\])$/m)

test('Docker health probe authenticates, accepts only the exact ready response, and stays silent', async (t) => {
  assert(instruction)
  const [, , canonicalSource] = JSON.parse(instruction[2])
  const token = 'container-health-test-token'
  let response = { status: 200, body: { status: 'ready' } }
  let receivedAuthorization = ''
  let requestCount = 0
  const server = createServer((request, reply) => {
    requestCount += 1
    receivedAuthorization = String(request.headers.authorization || '')
    if (!response) return
    reply.writeHead(response.status, { 'content-type': 'application/json' })
    reply.end(JSON.stringify(response.body))
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const address = server.address()
  assert(address && typeof address === 'object')
  const source = canonicalSource.replace('http://127.0.0.1:3000', `http://127.0.0.1:${address.port}`)

  const ready = await runProbe(source, token)
  assert.equal(ready.code, 0)
  assert.equal(receivedAuthorization, `Bearer ${token}`)
  assert.equal(ready.stdout, '')
  assert.equal(ready.stderr, '')

  response = { status: 200, body: { status: 'ready', database: 'ok' } }
  const topologyLeak = await runProbe(source, token)
  assert.equal(topologyLeak.code, 1)
  assert.equal(topologyLeak.stdout, '')
  assert.equal(topologyLeak.stderr, '')

  response = { status: 503, body: { status: 'not_ready', code: 'SERVICE_NOT_READY' } }
  const dependencyFailure = await runProbe(source, token)
  assert.equal(dependencyFailure.code, 1)
  assert.equal(dependencyFailure.stdout, '')
  assert.equal(dependencyFailure.stderr, '')

  const requestsBeforeMissingToken = requestCount
  const missingToken = await runProbe(source, '')
  assert.equal(missingToken.code, 1)
  assert.equal(requestCount, requestsBeforeMissingToken)
  assert.equal(missingToken.stdout, '')
  assert.equal(missingToken.stderr, '')

  response = null
  const unresponsive = await runProbe(source, token)
  assert.equal(unresponsive.code, 1)
  assert.equal(unresponsive.stdout, '')
  assert.equal(unresponsive.stderr, '')
})

test('container driver rejects unknown options before calling Docker', async () => {
  const result = await runProcess(resolve('scripts/ci-container-health.mjs'), ['--unknown'])
  assert.equal(result.code, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /Usage: node scripts\/ci-container-health\.mjs/)
  assert.doesNotMatch(result.stderr, /Docker availability|docker version/)
})

function runProbe(source, token) {
  return runProcess('-e', [source], { NUXT_READINESS_TOKEN: token })
}

function runProcess(entry, args, environment = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      process.execPath,
      [entry, ...args],
      {
        env: { ...process.env, ...environment },
        timeout: 5_000
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          reject(error)
          return
        }
        resolvePromise({ code: error?.code ?? 0, stdout, stderr })
      }
    )
  })
}
