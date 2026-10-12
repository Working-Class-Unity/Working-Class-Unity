import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { isAllowedCookieName, validateCookieJar, writeCookieJar } from './lib/solidarity-cookies.mjs'

/**
 * Extracts the Solidarity dashboard authentication cookies from the signed-in Agent Browser
 * session and writes the private cookie jar the unattended sync reads. With --connection the
 * jar is streamed into the running web container through the validated SSH flow. Values are
 * never printed, and the jar is refused inside Git worktrees.
 */
const usage = `Usage:
  pnpm events:cookies --output /private/events/solidarity-cookies.json
  pnpm events:cookies --connection /private/events/production.json [--output <path>]

Extracts the dashboard.solidarity.tech authentication cookies from Agent Browser and writes
the private cookie jar (mode 0600). --connection streams the jar into the running web
container at /app/data/solidarity/cookies.json. --session NAME selects a named Agent Browser
session. Sign into dashboard.solidarity.tech in Agent Browser first.

Private connection file:
{
  "host": "root@your-server",
  "identity": "/private/path/existing-ssh-key",
  "applicationUuid": "your-coolify-application-uuid"
}
`

const maximumBytes = 4 * 1024 * 1024
process.umask(0o077)
try {
  const options = parse(process.argv.slice(2))
  if (options.help) console.log(usage)
  else main(options)
} catch (error) {
  console.error(`Cookie refresh: ${safe(error)}`)
  process.exitCode = 1
}

function main(options) {
  if (!options.output && !options.connection) throw new Error('--output or --connection is required')
  const cookies = sessionCookies(options.session)
  if (options.output) writePrivateJar(options.output, cookies)
  if (options.connection) uploadJar(options.connection, cookies)
  console.log(
    JSON.stringify({
      cookies: cookies.map(({ name }) => name),
      savedTo: options.output ? resolve(options.output) : null,
      uploaded: Boolean(options.connection)
    })
  )
}

function sessionCookies(session) {
  const tabs = browser(session, ['tab', 'list']).tabs
  const dashboard = tabs.find((tab) => new URL(tab.url).origin === 'https://dashboard.solidarity.tech')
  if (!dashboard) throw new Error('Open dashboard.solidarity.tech in Agent Browser first')
  const original = tabs.find((tab) => tab.active)
  if (original?.tabId !== dashboard.tabId) browser(session, ['tab', dashboard.tabId])
  let list
  try {
    list = browser(session, ['cookies', 'get']).cookies
  } finally {
    if (original && original.tabId !== dashboard.tabId) {
      try {
        browser(session, ['tab', original.tabId])
      } catch {}
    }
  }
  if (!Array.isArray(list)) throw new Error('Agent Browser did not return the dashboard cookies; sign in first')
  const names = new Set()
  const cookies = []
  for (const cookie of list) {
    if (!cookie || typeof cookie.name !== 'string' || typeof cookie.value !== 'string') continue
    if (cookie.domain !== 'dashboard.solidarity.tech') continue
    if (!isAllowedCookieName(cookie.name) || names.has(cookie.name) || !cookie.value) continue
    names.add(cookie.name)
    cookies.push({ name: cookie.name, value: cookie.value })
  }
  if (!cookies.length) {
    throw new Error('No dashboard.solidarity.tech session cookies found; sign in to the dashboard in Agent Browser')
  }
  return cookies
}

function browser(session, args) {
  const flags = ['--json', ...(session ? ['--session', session] : [])]
  const result = spawnSync('agent-browser', [...flags, ...args], {
    encoding: 'utf8',
    maxBuffer: maximumBytes,
    timeout: 120000
  })
  if (result.error || result.status !== 0) {
    throw new Error('Agent Browser failed; check that it is installed and signed in')
  }
  let reply
  try {
    reply = JSON.parse(result.stdout)
  } catch {
    throw new Error('Agent Browser returned an unexpected response')
  }
  if (!reply.success) throw new Error('Agent Browser failed; check that it is installed and signed in')
  return reply.data
}

function writePrivateJar(output, cookies) {
  const path = resolve(output)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let directory = realpathSync(dirname(path))
  while (true) {
    if (existsSync(resolve(directory, '.git'))) throw new Error('Keep private cookie jars outside Git worktrees')
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  writeCookieJar(path, { version: 1, updatedAt: null, cookies })
}

function uploadJar(connection, cookies) {
  let connectionData
  try {
    connectionData = JSON.parse(readFileSync(resolve(connection), 'utf8'))
  } catch {
    throw new Error('Connection file is not valid JSON')
  }
  const { host, identity, applicationUuid } = connectionData ?? {}
  if (!/^[A-Za-z0-9_.@-]+$/.test(host ?? '') || host.startsWith('-') || !/^[a-z0-9]+$/.test(applicationUuid ?? '')) {
    throw new Error('Connection requires a valid SSH host and Coolify application UUID')
  }
  const ssh = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=yes',
    '-o',
    'ConnectTimeout=10',
    ...(identity ? ['-i', identity, '-o', 'IdentitiesOnly=yes'] : []),
    host
  ]
  const rows = run('ssh', [...ssh, `docker ps --filter 'name=web-${applicationUuid}-' --format '{{.ID}} {{.Names}}'`])
    .trim()
    .split('\n')
    .filter((row) => new RegExp(`^[a-f0-9]+ web-${applicationUuid}-[0-9]+$`).test(row))
  if (rows.length !== 1) throw new Error('Expected exactly one running web container for this application')
  const container = rows[0].split(' ')[0]
  const payload = JSON.stringify(validateCookieJar({ version: 1, updatedAt: new Date().toISOString(), cookies }))
  run(
    'ssh',
    [
      ...ssh,
      `flock -w 60 /var/lock/wcu-event-sync-${applicationUuid}.lock docker exec -i ${container} sh -ec 'umask 077; mkdir -p /app/data/solidarity; temporary=$(mktemp /app/data/solidarity/cookies.json.XXXXXX); trap "rm -f \"$temporary\"" EXIT; cat > "$temporary"; mv -f "$temporary" /app/data/solidarity/cookies.json'`
    ],
    payload
  )
}

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: maximumBytes, timeout: 120000 })
  if (result.error || result.status !== 0) {
    let safe = result.stderr
      ?.split('\n')
      .find((line) => /^(ssh:|Permission denied|Host key verification failed)/.test(line))
    throw new Error(safe || `${command} failed; no automatic retry`)
  }
  return result.stdout
}

function parse(args) {
  const options = {}
  const valued = new Set(['--output', '--connection', '--session'])
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (token === '--help') return { help: true }
    if (!valued.has(token) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Invalid option; use --help')
    }
    const key = token.slice(2)
    if (options[key] !== undefined) throw new Error(`Repeated ${token}`)
    options[key] = args[++index]
  }
  return options
}

function safe(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message) return error.message.slice(0, 500)
  return 'unexpected failure'
}
