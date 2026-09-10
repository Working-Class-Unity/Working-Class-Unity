import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectSolidarityDashboardEvents, collectSolidarityEventDescriptions } from './lib/solidarity-dashboard.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const maximumBytes = 25 * 1024 * 1024
const usage = `Usage:
  pnpm events:sync preview --from <UTC ISO> --to <UTC ISO> --output <private-preview.json> --connection <private-connection.json> [--event <id>] [--session <browser-session>]
  pnpm events:sync preview --capture <private-capture.json> --output <private-preview.json> --connection <private-connection.json>
  pnpm events:sync apply --preview <private-preview.json> --approve <digest> --connection <private-connection.json> [--retire <local-session-id>]

Use --database-url file:/absolute/local.db instead of --connection for local verification.
Timezone defaults to America/Los_Angeles; --timezone overrides it. Dates must be canonical UTC ISO timestamps.
--event and --retire may repeat. An omitted --event discovers dashboard events.
Sign into dashboard.solidarity.tech in Agent Browser before collection. No credentials are exported.
Preview writes a private capture alongside the preview. No production changes occur without apply.
`

process.umask(0o077)
try {
  const [operation, ...args] = process.argv.slice(2)
  if (!operation || operation === '--help') {
    console.log(usage)
  } else {
    if (!['preview', 'apply'].includes(operation)) throw new Error('Expected preview or apply')
    const options = { event: [], retire: [] }
    const allowed = new Set([
      'from',
      'to',
      'output',
      'connection',
      'database-url',
      'capture',
      'preview',
      'approve',
      'event',
      'retire',
      'session',
      'timezone'
    ])
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--') continue
      const key = args[i].slice(2)
      if (!args[i].startsWith('--') || !allowed.has(key) || !args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error('Invalid option; use --help')
      }
      const value = args[++i]
      if (['event', 'retire'].includes(key)) options[key].push(value)
      else if (options[key] !== undefined) throw new Error(`Repeated --${key}`)
      else options[key] = value
    }
    if (Boolean(options.connection) === Boolean(options['database-url'])) {
      throw new Error('Choose exactly one of --connection or --database-url')
    }
    const connection = options.connection
      ? readPrivateJson(options.connection)
      : { databaseUrl: options['database-url'] }
    if (operation === 'preview') {
      if (!options.output) throw new Error('--output is required')
      const output = resolve(options.output)
      const capturePath = `${output}.capture.json`
      if (existsSync(output) || existsSync(capturePath)) throw new Error('Choose a new private preview output path')
      const capture = options.capture ? readPrivateJson(options.capture) : collect(options)
      savePrivateJson(capturePath, capture)
      const preview = operator(connection, 'preview', capture)
      savePrivateJson(output, { connection, preview })
      console.log(`Preview: ${output}\nCapture: ${capturePath}\nTarget: ${preview.target}\nApproval digest: ${preview.digest}`)
      console.log(`${preview.changes.length} changes; ${preview.retirementCandidates.length} retirement candidates`)
      for (const change of preview.changes) {
        const rows = change.level === 'series' ? preview.plan.projection.events : preview.plan.projection.sessions
        const row = rows.find((row) => row.after.id === change.id).after
        const details =
          change.kind === 'create'
            ? [row.startsAt, row.deliveryMode, row.category].filter(Boolean).join(' | ')
            : change.fields
                .map(({ field, before, after }) =>
                  after === undefined
                    ? `${field}: changed`
                    : `${field}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
                )
                .join('; ')
        console.log(
          `${change.kind.toUpperCase()} ${change.level} ${JSON.stringify(row.title)} [${change.id}] ${details}`
        )
      }
      for (const candidate of preview.retirementCandidates) {
        console.log(
          `REVIEW RETIRE ${JSON.stringify(candidate.title)} ${candidate.startsAt} --retire ${candidate.sessionId}`
        )
      }
      for (const issue of preview.plan.projection.issues)
        console.log(`ISSUE ${issue.code} ${issue.objectType} ${issue.externalId}`)
    } else {
      if (!options.preview || !options.approve) throw new Error('--preview and --approve are required')
      const saved = readPrivateJson(options.preview)
      if (JSON.stringify(saved.connection) !== JSON.stringify(connection))
        throw new Error('Connection differs from the reviewed preview')
      if (saved.preview?.digest !== options.approve)
        throw new Error('Approval digest differs from the reviewed preview')
      const receipt = operator(connection, 'apply', {
        preview: saved.preview,
        approve: options.approve,
        retireSessionIds: options.retire
      })
      const receiptPath = `${resolve(options.preview)}.${Date.now()}.receipt.json`
      savePrivateJson(receiptPath, receipt)
      console.log(
        `${receipt.noOp ? 'No changes' : 'Applied'}: ${receipt.changes.length} changes; ${receipt.retiredSessionIds.length} retired`
      )
      console.log(`Backup: ${receipt.backup ?? 'not needed'}\nReceipt: ${receiptPath}`)
      console.log(JSON.stringify(receipt.report))
    }
  }
} catch (error) {
  console.error(`Event sync: ${error instanceof Error ? error.message : 'operation failed'}`)
  process.exitCode = 1
}

function run(command, args, input, timeout = 120000) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: maximumBytes, timeout })
  if (result.error || result.status !== 0) {
    // Raw subprocess output can contain private event data or signed URLs.
    let safe = result.stderr
      ?.split('\n')
      .find((line) => /^(Event sync failed:|ssh:|Permission denied|Host key verification failed)/.test(line))
    if (command === 'agent-browser') {
      try {
        safe = JSON.stringify(JSON.parse(result.stdout).error).match(
          /Solidarity (?:dashboard|descriptions):[^"\\\n]+/
        )?.[0]
      } catch {
        /* Never print raw browser output. */
      }
    }
    throw new Error(
      safe || `${command} failed${result.error?.code ? ` (${result.error.code})` : ''}; no automatic retry`
    )
  }
  return result.stdout
}

function browser(session, args, input) {
  const flags = ['--json', '--pin-tab', ...(session ? ['--session', session] : [])]
  const reply = JSON.parse(run('agent-browser', [...flags, ...args], input, 300000))
  if (!reply.success) throw new Error('Agent Browser failed; check login and the selected tab')
  return reply.data
}

function collect(options) {
  if (!options.from || !options.to) throw new Error('--from and --to are required when collecting')
  const tabs = browser(options.session, ['tab', 'list']).tabs
  const dashboard = tabs.find((tab) => new URL(tab.url).origin === 'https://dashboard.solidarity.tech')
  if (!dashboard) throw new Error('Open Agent Browser and sign into dashboard.solidarity.tech first')
  const original = tabs.find((tab) => tab.active)
  let createdTab
  try {
    browser(options.session, ['tab', dashboard.tabId])
    const input = {
      from: options.from,
      to: options.to,
      timezone: options.timezone ?? 'America/Los_Angeles',
      ...(options.event.length ? { eventIds: options.event } : {})
    }
    const captured = browser(
      options.session,
      ['eval', '--stdin'],
      `(${collectSolidarityDashboardEvents.toString()})(${JSON.stringify(input)})`
    ).result
    let publicTab = tabs.find((tab) => new URL(tab.url).origin === 'https://tech.workingclassunity.com')
    if (captured.eventPageUrls.length) {
      if (!publicTab) {
        browser(options.session, ['tab', 'new', captured.eventPageUrls[0]])
        publicTab = browser(options.session, ['tab', 'list']).tabs.find((tab) => tab.active)
        createdTab = publicTab.tabId
      } else browser(options.session, ['tab', publicTab.tabId])
      const descriptions = browser(
        options.session,
        ['eval', '--stdin'],
        `(${collectSolidarityEventDescriptions.toString()})(${JSON.stringify({ urls: captured.eventPageUrls })})`
      ).result
      for (const event of captured.dataset.events) {
        if (event.eventPageUrl) event.description = descriptions[event.eventPageUrl]
      }
    }
    return { dataset: captured.dataset, scope: captured.scope, observedAt: captured.observedAt }
  } finally {
    if (createdTab) browser(options.session, ['tab', 'close', createdTab])
    if (original) browser(options.session, ['tab', original.tabId])
  }
}

function operator(connection, operation, payload) {
  const input = JSON.stringify(payload)
  if (Buffer.byteLength(input) > maximumBytes) throw new Error('Sync input exceeds 25 MiB')
  let output
  if (connection.databaseUrl) {
    output = run(
      process.execPath,
      [
        resolve(root, '.output/server/solidarity-event-operator.mjs'),
        operation,
        '--database-url',
        connection.databaseUrl
      ],
      input
    )
  } else {
    const { host, identity, applicationUuid } = connection
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
    output = run(
      'ssh',
      [...ssh, `docker exec -i ${container} node /app/.output/server/solidarity-event-operator.mjs ${operation}`],
      input
    )
  }
  return JSON.parse(output)
}

function readPrivateJson(path) {
  const data = readFileSync(resolve(path))
  if (data.length > maximumBytes) throw new Error('Private JSON input exceeds 25 MiB')
  try {
    return JSON.parse(data.toString('utf8'))
  } catch {
    throw new Error('Private input is not valid JSON')
  }
}

function savePrivateJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let directory = realpathSync(dirname(path))
  while (true) {
    if (existsSync(resolve(directory, '.git'))) throw new Error('Keep private sync artifacts outside Git worktrees')
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  writeFileSync(path, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
}
