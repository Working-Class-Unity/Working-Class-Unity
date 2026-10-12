import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Private cookie jar for the Solidarity dashboard session.
 * Only the named authentication cookies are accepted; values are never logged.
 * The file must live outside Git worktrees and carry mode 0600.
 */
const maximumBytes = 64 * 1024
const maximumCookies = 8

export function isAllowedCookieName(name) {
  return name === 'remember_user_token' || /^_.*_session_production$/.test(name)
}

export function readCookieJar(path) {
  let info
  try {
    info = statSync(path)
  } catch {
    throw new Error('Solidarity cookie file is missing; run the cookie refresh automation')
  }
  if (!info.isFile()) throw new Error('Solidarity cookie file is not a regular file')
  if (info.mode & 0o077) throw new Error('Solidarity cookie file must be private (mode 0600)')
  if (info.size === 0 || info.size > maximumBytes) throw new Error('Solidarity cookie file has an invalid size')
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new Error('Solidarity cookie file is not valid JSON')
  }
  return validateCookieJar(raw)
}

export function writeCookieJar(path, jar) {
  const validated = validateCookieJar({ version: 1, updatedAt: jar?.updatedAt, cookies: jar?.cookies })
  const payload = JSON.stringify({ ...validated, updatedAt: new Date().toISOString() })
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.tmp-${randomUUID()}`
  try {
    writeFileSync(temporary, payload, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

export function cookieHeader(jar) {
  return validateCookieJar(jar)
    .cookies.map(({ name, value }) => `${name}=${value}`)
    .join('; ')
}

export function mergeSetCookies(jar, values) {
  const cookies = new Map(jar.cookies.map(({ name, value }) => [name, value]))
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue
    const [pair, ...attributes] = value.split(';')
    const index = pair.indexOf('=')
    if (index <= 0) continue
    const name = pair.slice(0, index).trim()
    const cookieValue = pair.slice(index + 1).trim()
    if (!isAllowedCookieName(name)) continue
    const expired = attributes.some((attribute) => {
      const [rawKey, ...rest] = attribute.trim().split('=')
      const key = rawKey.toLowerCase()
      const attributeValue = rest.join('=')
      if (key === 'max-age') return Number(attributeValue) <= 0
      if (key === 'expires') {
        const time = Date.parse(attributeValue)
        return Number.isFinite(time) && time <= Date.now()
      }
      return false
    })
    if (expired || !cookieValue) cookies.delete(name)
    else cookies.set(name, cookieValue)
  }
  return { version: 1, updatedAt: jar.updatedAt, cookies: [...cookies].map(([name, value]) => ({ name, value })) }
}

export function validateCookieJar(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Solidarity cookie file is invalid')
  if (raw.version !== 1) throw new Error('Unsupported Solidarity cookie file version')
  if (!Array.isArray(raw.cookies) || raw.cookies.length === 0 || raw.cookies.length > maximumCookies) {
    throw new Error('Solidarity cookie file is missing the session cookies')
  }
  const names = new Set()
  const cookies = raw.cookies.map((cookie) => {
    if (!cookie || typeof cookie !== 'object' || Array.isArray(cookie)) {
      throw new Error('Solidarity cookie file contains an invalid entry')
    }
    if (Object.keys(cookie).some((key) => !['name', 'value'].includes(key))) {
      throw new Error('Solidarity cookie file contains unexpected fields')
    }
    const { name, value } = cookie
    if (typeof name !== 'string' || !isAllowedCookieName(name) || names.has(name)) {
      throw new Error('Solidarity cookie file contains an unexpected cookie')
    }
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\r\n;]/.test(value)) {
      throw new Error('Solidarity cookie file contains an invalid cookie value')
    }
    names.add(name)
    return { name, value }
  })
  return { version: 1, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null, cookies }
}
