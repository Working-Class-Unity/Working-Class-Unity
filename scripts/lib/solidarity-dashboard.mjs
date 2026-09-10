/**
 * Runs in the authenticated dashboard tab. Keep all dependencies inside this
 * function: the CLI sends its source, not this module, to the browser.
 * Captures the full event/session metadata inventory, never activity records.
 * from/to describe the approved planner scope, not a capture filter: a session
 * moved outside that window must remain available for comparison with local data.
 * Resolves only after every selected/discovered event and session is captured.
 * Inventory presence maps to locally active; provider archival state is unknown.
 * Absence/retirement requires separate review, never inference from past dates.
 * @param {{from: string, to: string, timezone: string, eventIds?: string[]}} options
 */
export async function collectSolidarityDashboardEvents({ from, to, timezone, eventIds }) {
  const origin = 'https://dashboard.solidarity.tech'
  const publicOrigin = 'https://tech.workingclassunity.com'
  const fail = (message) => {
    throw new Error(`Solidarity dashboard: ${message}`)
  }
  if (location.origin !== origin) fail('run in the dashboard tab')
  const utc = (value) => {
    const date = new Date(value)
    if (typeof value !== 'string' || !Number.isFinite(date.getTime()) || date.toISOString() !== value) {
      fail('expected a canonical UTC timestamp')
    }
  }
  utc(from)
  utc(to)
  if (from >= to) fail('from must precede to')
  try {
    if (typeof timezone !== 'string' || !timezone.trim()) throw new Error()
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
  } catch {
    fail('timezone must be an explicit valid Intl timezone')
  }
  const idPattern = /^[0-9]+$/
  if (
    eventIds !== undefined &&
    (!Array.isArray(eventIds) || !eventIds.every((id) => typeof id === 'string' && idPattern.test(id)))
  ) {
    fail('eventIds must contain provider numeric ID strings')
  }
  const required = (root, selector, label) => {
    const elements = root.querySelectorAll(selector)
    if (elements.length !== 1) fail(`missing or ambiguous ${label}`)
    return elements[0]
  }
  const text = (element) => element.textContent.replace(/\s+/g, ' ').trim()
  const urlFor = (href, base, expectedOrigin = origin) => {
    let url
    try {
      url = new URL(href, base)
    } catch {
      fail('invalid source URL')
    }
    if (url.origin !== expectedOrigin || url.username || url.password)
      fail('unexpected source URL origin or credentials')
    url.hash = ''
    return url
  }
  const get = async (url) => {
    url = urlFor(url, origin)
    let response
    try {
      response = await fetch(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        redirect: 'error',
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(30000)
      })
    } catch {
      fail('GET failed or redirected; check dashboard sign-in')
    }
    if (!response.ok) fail(`GET returned HTTP ${response.status}; check dashboard sign-in`)
    if (response.url && response.url !== url.href) fail('GET redirected; check dashboard sign-in')
    if (!response.headers.get('content-type')?.includes('text/html')) fail('GET did not return HTML')
    let html
    try {
      html = await response.text()
    } catch {
      fail('could not read complete HTML')
    }
    if (!/<\/body>\s*<\/html>\s*$/i.test(html)) fail('incomplete HTML document')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (doc.querySelector('input[type="password"], form[action*="sign_in"], form[action*="login"]')) {
      fail('login page returned; sign in again')
    }
    return doc
  }
  const pages = async (initial, inspect) => {
    const pending = [urlFor(initial, origin)]
    const visited = new Set()
    while (pending.length) {
      const url = pending.shift()
      if (visited.has(url.href)) continue
      if (visited.size >= 100) fail('pagination limit reached; inventory is incomplete')
      visited.add(url.href)
      const doc = await get(url.href)
      const root = inspect(doc)
      for (const link of root.querySelectorAll(
        'a[rel~="next"], .pagination a[href], nav[aria-label*="pagination" i] a[href]'
      )) {
        const next = urlFor(link.getAttribute('href'), url)
        if (next.pathname !== url.pathname || next.searchParams.get('state') !== url.searchParams.get('state')) {
          fail('pagination left the selected inventory')
        }
        if (visited.has(next.href) && link.rel.split(/\s+/).includes('next')) fail('pagination did not advance')
        if (!visited.has(next.href)) pending.push(next)
      }
    }
  }
  const listedIds = new Set()
  for (const path of ['/events', '/events?state=past']) {
    await pages(path, (doc) => {
      const listing = required(doc, 'table[data-data-table-target="dataTable"].st-table', 'events inventory')
      const body = required(listing, 'tbody', 'events inventory rows')
      // DataTables paginates client-side; every server-rendered row is inventory.
      for (const row of body.querySelectorAll(':scope > tr')) {
        let found = 0
        for (const link of row.querySelectorAll('a[href]')) {
          let url
          try {
            url = new URL(link.getAttribute('href'), origin)
          } catch {
            fail('invalid events inventory link')
          }
          const match = /^\/events\/([0-9]+)$/.exec(url.pathname)
          if (match && url.origin === origin && !url.username && !url.password) {
            listedIds.add(match[1])
            found++
          }
        }
        if (!found) fail('event inventory row has no provider event link')
      }
      return doc
    })
  }
  const ids = eventIds === undefined ? listedIds : new Set(eventIds)
  if ([...ids].some((id) => !listedIds.has(id))) fail('selected event is absent from the source inventory')
  if (ids.size > 500) fail('event limit reached; inventory is incomplete')
  const events = []
  const sessions = []
  const allSessionIds = new Set()
  for (const eventId of ids) {
    const path = `/events/${eventId}`
    const inventory = new Map()
    let title
    let eventPageUrl
    await pages(path, (doc) => {
      const currentTitle = required(doc, 'h2[data-event-name]', 'event title').getAttribute('data-event-name').trim()
      if (!currentTitle || (title !== undefined && title !== currentTitle)) fail('missing or inconsistent event title')
      title = currentTitle
      const allLinks = [...doc.querySelectorAll('a[href]')]
      const links = allLinks.filter((link) => text(link).endsWith('View event page'))
      if (links.length > 1) fail('ambiguous View event page link')
      let currentUrl = null
      if (links.length) {
        currentUrl = urlFor(links[0].getAttribute('href'), origin, publicOrigin).href
      } else {
        const calendar = required(doc, '#calendar', 'event calendar')
        for (const link of allLinks) {
          let url
          try {
            url = new URL(link.getAttribute('href'), origin)
          } catch {
            fail('invalid event page link')
          }
          if (
            /^\/sites\/[^/]+\/pages\/[^/]+(?:\/|$)/.test(url.pathname) ||
            (calendar.contains(link) && url.hostname === 'tech.workingclassunity.com')
          )
            fail('event page link is present with an unrecognized label')
        }
      }
      if (eventPageUrl !== undefined && eventPageUrl !== currentUrl) fail('inconsistent event page URL')
      eventPageUrl = currentUrl
      const schedule = required(doc, '#event_schedule', 'event schedule')
      if (schedule.hasAttribute('src') || schedule.querySelector('turbo-frame[src]'))
        fail('event schedule has unloaded content')
      const frames = schedule.querySelectorAll('turbo-frame[id^="edit_calendar_item_"]')
      for (const frame of frames) {
        const id = frame.id.slice('edit_calendar_item_'.length)
        if (!idPattern.test(id) || frame.hasAttribute('src')) fail('invalid or unloaded session')
        const times = [...frame.querySelectorAll('time[datetime]')].map((time) => {
          const value = time.getAttribute('datetime')
          if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|\+00:00)$/.test(value)) {
            fail('schedule time is not exact UTC')
          }
          const date = new Date(value)
          if (!Number.isFinite(date.getTime())) fail('invalid schedule time')
          const normalized = value.replace(/\+00:00$/, 'Z')
          if (date.toISOString() !== (normalized.includes('.') ? normalized : normalized.replace(/Z$/, '.000Z'))) {
            fail('invalid schedule calendar date')
          }
          return date.toISOString()
        })
        if (times.length !== 2 || times[1] < times[0]) fail('missing or inconsistent schedule times')
        const locationLabel = text(required(frame, '.calendar_item_location', 'session location type'))
        if (!locationLabel) fail('missing session location type')
        const editPath = `${path}/calendars/${id}/edit`
        const edit = [...frame.querySelectorAll('a[href]')].find((link) =>
          [editPath, origin + editPath].includes(link.getAttribute('href'))
        )
        if (!edit) fail('missing session edit link')
        const entry = {
          id,
          times,
          virtual: locationLabel === 'Virtual Event',
          edit: urlFor(edit.getAttribute('href'), origin).href
        }
        if (inventory.has(id) && JSON.stringify(inventory.get(id)) !== JSON.stringify(entry))
          fail('conflicting schedule entries')
        inventory.set(id, entry)
        if (inventory.size > 1000) fail('session limit reached; inventory is incomplete')
      }
      return schedule
    })
    const settings = await get(`${path}/settings`)
    const form = required(settings, `form[action="${path}/settings"]`, 'event settings form')
    const tagSelect = required(form, 'select[name="tags[]"]', 'event tags')
    const tags = (select) =>
      [...select.selectedOptions].map((option) => {
        const value = option.value
        if (!value || value !== text(option)) fail('selected tag value does not match its label')
        return value
      })
    const campaignSelect = required(form, 'select[name="campaign_tags[]"]', 'campaign tags')
    events.push({
      id: eventId,
      title,
      description: null,
      eventPageUrl,
      eventTags: tags(tagSelect),
      campaignTags: tags(campaignSelect),
      status: 'active',
      timezone,
      primaryEventId: null
    })
    const eventSessions = new Map()
    for (const entry of inventory.values()) {
      const { id } = entry
      const edit = await get(entry.edit)
      const titleInput = required(edit, '[name="meci[title]"]', 'session title field')
      const form = titleInput.closest('form')
      if (!form) fail('missing session edit form')
      const field = (name) => required(form, `[name="${name}"]`, `session ${name} field`)
      const nullable = (name) => field(name).value.trim() || null
      const timestamp = (name, expected) => {
        const value = field(name).getAttribute('data-flatpickr-default-date')
        if (!value || !/^\d+$/.test(value) || !Number.isFinite(new Date(Number(value)).getTime()))
          fail('missing or invalid session epoch time')
        const result = new Date(Number(value)).toISOString()
        if (result !== expected) fail('edit form and schedule times disagree')
        return result
      }
      const pairFields = form.querySelectorAll('[name="meci[paired_meci_id]"]')
      const pairSelect = pairFields[0]
      if (
        pairFields.length > 1 ||
        (pairSelect && (pairSelect.tagName !== 'SELECT' || pairSelect.selectedOptions.length !== 1))
      )
        fail('missing or ambiguous paired session selection')
      // Standalone edit forms omit the pairing selector.
      const pairedSessionId = pairSelect?.value.trim() || null
      if (pairedSessionId && (!idPattern.test(pairedSessionId) || pairedSessionId === id))
        fail('invalid paired session ID')
      const sessionState = form.querySelector('[name="meci[status]"], [name="meci[state]"]')
      const rawStatus = sessionState?.value ?? 'scheduled'
      if (!['scheduled', 'canceled', 'cancelled'].includes(rawStatus)) fail('unrecognized session cancellation state')
      if (!sessionState && form.querySelector('[name*="cancel"], [data-canceled], [data-cancelled]'))
        fail('unrecognized session cancellation rendering')
      const locationName = entry.virtual ? null : nullable('meci[location_name]')
      const locationAddress = entry.virtual ? null : nullable('address[full_address]')
      const virtualUrl = entry.virtual ? nullable('meci[location_address]') : null
      if (virtualUrl) {
        let url
        try {
          url = new URL(virtualUrl)
        } catch {
          fail('invalid virtual session URL')
        }
        if (url.protocol !== 'https:' || url.username || url.password) fail('invalid virtual session URL')
      }
      if (allSessionIds.has(id)) fail('session ID appears in multiple events')
      allSessionIds.add(id)
      eventSessions.set(id, {
        id,
        eventId,
        title: titleInput.value.trim() || null,
        startsAt: timestamp('meci[start_time]', entry.times[0]),
        endsAt: timestamp('meci[end_time]', entry.times[1]),
        timezone,
        eventType: entry.virtual ? 'virtual' : 'in_person',
        status: rawStatus === 'scheduled' ? 'scheduled' : 'canceled',
        locationName,
        locationAddress,
        virtualUrl,
        rsvpUrl: eventPageUrl,
        pairedSessionId,
        primarySessionId: null
      })
    }
    for (const session of eventSessions.values()) {
      if (session.pairedSessionId) {
        const pair = eventSessions.get(session.pairedSessionId)
        if (
          !pair ||
          pair.pairedSessionId !== session.id ||
          pair.eventType === session.eventType ||
          pair.startsAt !== session.startsAt ||
          pair.endsAt !== session.endsAt
        ) {
          fail('paired sessions must be reciprocal, opposite types, and have identical start and end times')
        }
      }
      sessions.push(session)
    }
  }
  return {
    dataset: { events, sessions, people: [], rsvps: [], attendance: [] },
    scope: { from, to, eventIds: [...ids] },
    observedAt: new Date().toISOString(),
    eventPageUrls: [...new Set(events.map((event) => event.eventPageUrl).filter((url) => url !== null))]
  }
}

/**
 * Runs separately in the public event-site tab, with no dashboard credentials.
 * @param {{urls: string[]}} options
 * @returns {Promise<Record<string, string | null>>}
 */
export async function collectSolidarityEventDescriptions({ urls }) {
  const origin = 'https://tech.workingclassunity.com'
  const fail = (message) => {
    throw new Error(`Solidarity descriptions: ${message}`)
  }
  if (location.origin !== origin) fail('run in the public event-site tab')
  if (!Array.isArray(urls) || urls.length > 500) fail('expected at most 500 event page URLs')
  const validated = urls.map((value) => {
    let url
    try {
      url = new URL(value)
    } catch {
      fail('invalid event page URL')
    }
    if (url.origin !== origin || url.username || url.password) fail('unexpected event page origin or credentials')
    return { value, url }
  })
  const descriptions = {}
  for (const { value, url } of validated) {
    if (Object.hasOwn(descriptions, value)) continue
    let response
    try {
      response = await fetch(url.href, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        headers: { Accept: 'text/html' },
        signal: AbortSignal.timeout(30000)
      })
    } catch {
      fail('GET failed or redirected')
    }
    if (!response.ok) fail(`GET returned HTTP ${response.status}`)
    if (response.url && response.url !== url.href) fail('GET redirected')
    if (!response.headers.get('content-type')?.includes('text/html')) fail('GET did not return HTML')
    let html
    try {
      html = await response.text()
    } catch {
      fail('could not read complete HTML')
    }
    if (!/<\/body>\s*<\/html>\s*$/i.test(html)) fail('incomplete HTML document')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (doc.querySelector('input[type="password"], form[action*="sign_in"], form[action*="login"]'))
      fail('login page returned')
    const contents = doc.querySelectorAll('div.content')
    if (contents.length !== 1) fail('missing or ambiguous event description')
    const render = (node) => {
      if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ')
      if (node.nodeType !== 1 || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(node.tagName)) return ''
      if (node.tagName === 'BR') return '\n'
      const content = [...node.childNodes].map(render).join('')
      if (['P', 'UL', 'OL', 'DIV'].includes(node.tagName)) return `\n\n${content}\n\n`
      if (node.tagName === 'LI') return `- ${content.trim()}\n`
      return content
    }
    const description = render(contents[0])
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    descriptions[value] = description || null
  }
  return descriptions
}
