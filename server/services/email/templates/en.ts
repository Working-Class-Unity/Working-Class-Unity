export function renderEnglishMagicLinkEmail(input: { to: string; url: string; appName: string }) {
  const escapedAppName = escapeHtml(input.appName)
  const escapedUrl = escapeHtml(input.url)

  return {
    to: input.to,
    subject: 'Your sign-in link',
    text: [
      `Use this link to sign in to ${input.appName}:`,
      '',
      input.url,
      '',
      'This link expires in 5 minutes and can be used once.',
      "If you didn't request this link, you can ignore this email."
    ].join('\n'),
    html: [
      `<p>Use this link to sign in to ${escapedAppName}:</p>`,
      `<p><a href="${escapedUrl}">Sign in to ${escapedAppName}</a></p>`,
      '<p>This link expires in 5 minutes and can be used once.</p>',
      "<p>If you didn't request this link, you can ignore this email.</p>"
    ].join('')
  }
}

export function renderEnglishWorkspaceInvitationEmail(input: {
  to: string
  url: string
  appName: string
  workspaceName: string
}) {
  const escapedAppName = escapeHtml(input.appName)
  const escapedWorkspaceName = escapeHtml(input.workspaceName)
  const escapedUrl = escapeHtml(input.url)

  return {
    to: input.to,
    subject: 'Workspace invitation',
    text: [
      `You have been invited to join ${input.workspaceName} on ${input.appName} as a member.`,
      '',
      'Review this invitation:',
      input.url,
      '',
      'This invitation expires in 48 hours.',
      "If you weren't expecting this invitation, you can ignore this email."
    ].join('\n'),
    html: [
      `<p>You have been invited to join <strong>${escapedWorkspaceName}</strong> on ${escapedAppName} as a member.</p>`,
      `<p><a href="${escapedUrl}">Review invitation</a></p>`,
      '<p>This invitation expires in 48 hours.</p>',
      "<p>If you weren't expecting this invitation, you can ignore this email.</p>"
    ].join('')
  }
}

export type EnglishBillingNotificationKind =
  | 'payment_attention'
  | 'family_access_at_risk'
  | 'family_access_ending'
  | 'member_removed'
  | 'family_dissolved'
  | 'deletion_cancellation_pending'

type EnglishBillingNotificationInput =
  | Readonly<{
      to: string
      appName: string
      kind: Exclude<EnglishBillingNotificationKind, 'family_access_ending'>
    }>
  | Readonly<{
      to: string
      appName: string
      kind: 'family_access_ending'
      effectiveAt: string
    }>

export function renderEnglishBillingNotificationEmail(input: EnglishBillingNotificationInput) {
  const escapedAppName = escapeHtml(input.appName)
  const content = englishBillingNotificationContent(
    input.kind,
    input.kind === 'family_access_ending' ? formatEnglishUtcDate(input.effectiveAt) : null
  )

  return {
    to: input.to,
    subject: content.subject,
    text: [content.lead, '', content.next.replace('{appName}', input.appName), '', content.privacy].join('\n'),
    html: [
      `<p>${content.htmlLead}</p>`,
      `<p>${content.htmlNext.replace('{appName}', escapedAppName)}</p>`,
      `<p>${content.htmlPrivacy}</p>`
    ].join('')
  }
}

function englishBillingNotificationContent(kind: EnglishBillingNotificationKind, effectiveAt: string | null) {
  const privacy = 'This message contains no payment, invoice, or other member details.'
  const htmlPrivacy = 'This message contains no payment, invoice, or other member details.'

  switch (kind) {
    case 'payment_attention':
      return {
        subject: 'Your subscription payment needs attention',
        lead: 'Your Stripe subscription payment needs attention.',
        next: 'Sign in to {appName} and use Manage billing to review it.',
        privacy,
        htmlLead: 'Your Stripe subscription payment needs attention.',
        htmlNext: 'Sign in to {appName} and use <strong>Manage billing</strong> to review it.',
        htmlPrivacy
      }
    case 'family_access_at_risk':
      return {
        subject: 'Family access may change',
        lead: 'Your Family access remains available for now, but it may change.',
        next: 'The Family manager needs to review billing in {appName}.',
        privacy,
        htmlLead: 'Your Family access remains available for now, but it may change.',
        htmlNext: 'The Family manager needs to review billing in {appName}.',
        htmlPrivacy
      }
    case 'family_access_ending':
      if (!effectiveAt) throw new TypeError('Family access end time is required')
      return {
        subject: 'Family access is scheduled to end',
        lead: `Your Family access is scheduled to end on ${effectiveAt}.`,
        next: 'Sign in to {appName} to see your current access status.',
        privacy,
        htmlLead: `Your Family access is scheduled to end on ${escapeHtml(effectiveAt)}.`,
        htmlNext: 'Sign in to {appName} to see your current access status.',
        htmlPrivacy
      }
    case 'member_removed':
      return {
        subject: 'Your Family membership ended',
        lead: 'The Family manager removed your membership.',
        next: 'Your {appName} account and private data remain yours.',
        privacy,
        htmlLead: 'The Family manager removed your membership.',
        htmlNext: 'Your {appName} account and private data remain yours.',
        htmlPrivacy
      }
    case 'family_dissolved':
      return {
        subject: 'Your Family membership ended',
        lead: 'The Family membership that supplied your premium access ended.',
        next: 'Your {appName} account and private data remain yours.',
        privacy,
        htmlLead: 'The Family membership that supplied your premium access ended.',
        htmlNext: 'Your {appName} account and private data remain yours.',
        htmlPrivacy
      }
    case 'deletion_cancellation_pending':
      return {
        subject: 'Account deletion is waiting for billing cancellation',
        lead: 'We could not yet confirm that your Stripe subscription is canceled.',
        next: 'Your {appName} account and private data were not deleted. Sign in again to check the status.',
        privacy,
        htmlLead: 'We could not yet confirm that your Stripe subscription is canceled.',
        htmlNext: 'Your {appName} account and private data were not deleted. Sign in again to check the status.',
        htmlPrivacy
      }
  }
}

function formatEnglishUtcDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(new Date(value))
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
