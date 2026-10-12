/**
 * Sends organizer alerts through the Resend HTTPS API. Missing configuration is a
 * skip, and provider failures never throw: the sync run reports them instead.
 */
const endpoint = 'https://api.resend.com/emails'

export async function sendResendEmail({ apiKey, from, to, subject, text, fetchImpl = fetch }) {
  if (!apiKey || !from || !to) return { status: 'skipped', reason: 'Resend is not configured' }
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10000)
    })
  } catch {
    return { status: 'failed', reason: 'Resend request failed' }
  }
  if (!response.ok) return { status: 'failed', reason: `Resend returned HTTP ${response.status}` }
  return { status: 'sent' }
}
