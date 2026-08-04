const invitationIdPattern = /^[A-Za-z0-9_-]{1,128}$/
const invitationPathPattern = /^\/invite\/([A-Za-z0-9_-]{1,128})$/

export function isInvitationId(value: unknown): value is string {
  return typeof value === 'string' && invitationIdPattern.test(value)
}

export function invitationLocation(invitationId: string): string {
  if (!isInvitationId(invitationId)) {
    throw new Error('Invalid invitation identifier')
  }

  return `/invite/${invitationId}`
}

export function isInvitationReturnPath(value: unknown): value is string {
  return typeof value === 'string' && invitationPathPattern.test(value)
}
