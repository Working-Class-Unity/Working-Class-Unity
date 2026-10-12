import { sendResendEmail } from './lib/solidarity-alerts.mjs'
import { runAutoSync } from './lib/solidarity-auto.mjs'
import { mergeSetCookies, readCookieJar, writeCookieJar } from './lib/solidarity-cookies.mjs'
import { collectSolidarityCapture } from './lib/solidarity-headless-collect.mjs'

// Full reconciliation window: every locally stored session is covered so drift in either
// direction is corrected. Collection completeness, not the window, guards retirement.
const windowFrom = '1970-01-01T00:00:00.000Z'
const windowTo = '9999-12-31T00:00:00.000Z'
const usage = `Usage: solidarity-event-auto.mjs --database-url file:/absolute/path.db --cookies /absolute/cookies.json [--timezone America/Los_Angeles] [--dry-run]

Runs the unattended Solidarity event sync against the local events database: collect the
complete dashboard inventory with the private cookie jar, plan, and apply every validated
change. A session missing from a complete inventory retires immediately. Email alerts need
EVENT_SYNC_RESEND_API_KEY, EVENT_SYNC_ALERT_FROM, and EVENT_SYNC_ALERT_TO. The --database-url
and --cookies values may come from NUXT_DATABASE_URL and EVENT_SYNC_COOKIES_PATH instead.
--dry-run collects and plans without changing the database or sending email.
`

process.umask(0o077)
try {
  const options = parse(process.argv.slice(2))
  if (options.help) console.log(usage)
  else await main(options)
} catch (error) {
  console.error(`Event auto-sync failed: ${safe(error)}`)
  process.exitCode = 1
}

async function main(options) {
  const databaseUrl = options['database-url'] ?? process.env.NUXT_DATABASE_URL
  const cookiesPath = options.cookies ?? process.env.EVENT_SYNC_COOKIES_PATH
  if (!databaseUrl) throw new Error('--database-url or NUXT_DATABASE_URL is required')
  if (!cookiesPath) throw new Error('--cookies or EVENT_SYNC_COOKIES_PATH is required')
  const alert = (message) =>
    options.dryRun
      ? Promise.resolve({ status: 'skipped', reason: 'dry run' })
      : sendResendEmail({
          apiKey: process.env.EVENT_SYNC_RESEND_API_KEY,
          from: process.env.EVENT_SYNC_ALERT_FROM,
          to: process.env.EVENT_SYNC_ALERT_TO,
          ...message
        })
  if (
    !options.dryRun &&
    (!process.env.EVENT_SYNC_RESEND_API_KEY || !process.env.EVENT_SYNC_ALERT_FROM || !process.env.EVENT_SYNC_ALERT_TO)
  ) {
    console.error('Event auto-sync: email alerts skipped; configure the EVENT_SYNC_ Resend settings')
  }
  let jar
  try {
    jar = readCookieJar(cookiesPath)
  } catch (error) {
    await alert({
      subject: 'WCU events auto-sync failed (cookies)',
      text: [
        `Failure: ${safe(error)}`,
        '',
        'Run the Solidarity cookie refresh automation to replace the cookie file, then check the next scheduled run.'
      ].join('\n')
    })
    throw error
  }
  const collect = async () => {
    const collected = await collectSolidarityCapture({
      jar,
      from: windowFrom,
      to: windowTo,
      timezone: options.timezone ?? 'America/Los_Angeles'
    })
    writeCookieJar(cookiesPath, mergeSetCookies(jar, collected.setCookieValues))
    return { capture: collected.capture }
  }
  const result = await runAutoSync({ collect, databaseUrl, alert, dryRun: options.dryRun === true })
  console.log(JSON.stringify(result))
  if (result.status === 'failed') process.exitCode = 1
}

function parse(args) {
  const options = {}
  const valued = new Set(['--database-url', '--cookies', '--timezone'])
  for (let index = 0; index < args.length; index++) {
    const token = args[index]
    if (token === '--help') return { help: true }
    if (token === '--dry-run') {
      if (options.dryRun !== undefined) throw new Error('Repeated --dry-run')
      options.dryRun = true
      continue
    }
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
  const message = error && typeof error === 'object' && typeof error.message === 'string' ? error.message : ''
  return message.slice(0, 500) || 'unexpected failure'
}
