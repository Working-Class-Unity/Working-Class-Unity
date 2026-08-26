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

export function renderEnglishAccountEmailVerificationEmail(input: { to: string; url: string; appName: string }) {
  const escapedAppName = escapeHtml(input.appName)
  const escapedUrl = escapeHtml(input.url)

  return {
    to: input.to,
    subject: 'Confirm your email for your WCU account',
    text: [
      `Confirm this email for your ${input.appName} account:`,
      '',
      input.url,
      '',
      'This link expires in 5 minutes and can be used once. It enables email login for the same account but does not sign you in.',
      "If you didn't request this change, you can ignore this email."
    ].join('\n'),
    html: [
      `<p>Confirm this email for your ${escapedAppName} account:</p>`,
      `<p><a href="${escapedUrl}">Confirm email for ${escapedAppName}</a></p>`,
      '<p>This link expires in 5 minutes and can be used once. It enables email login for the same account but does not sign you in.</p>',
      "<p>If you didn't request this change, you can ignore this email.</p>"
    ].join('')
  }
}

export function renderEnglishIdentityReviewEmail(input: {
  appName: string
  reason: string
  reviewId: string
  userId: string
}) {
  return {
    to: 'info@workingclassunity.com',
    subject: 'WCU account identity review required',
    text: [
      `${input.appName} requires a manual account identity review.`,
      '',
      `Review ID: ${input.reviewId}`,
      `User ID: ${input.userId}`,
      `Reason: ${input.reason}`,
      '',
      'No membership was granted automatically. Use the admin identity-resolution command after confirming ownership.'
    ].join('\n'),
    html: [
      `<p>${escapeHtml(input.appName)} requires a manual account identity review.</p>`,
      `<p>Review ID: <code>${escapeHtml(input.reviewId)}</code><br>User ID: <code>${escapeHtml(input.userId)}</code><br>Reason: <code>${escapeHtml(input.reason)}</code></p>`,
      '<p>No membership was granted automatically. Use the admin identity-resolution command after confirming ownership.</p>'
    ].join('')
  }
}

export function renderEnglishBillingEmailVerificationEmail(input: { appName: string; to: string; url: string }) {
  const escapedAppName = escapeHtml(input.appName)
  const escapedUrl = escapeHtml(input.url)
  return {
    to: input.to,
    subject: 'Confirm your email for your WCU account',
    text: [
      `Confirm this email for your ${input.appName} account:`,
      '',
      input.url,
      '',
      'This link expires in 24 hours and can be used once. It enables email login for the same account but does not sign you in.',
      "If you didn't enter this email while joining WCU, you can ignore this message."
    ].join('\n'),
    html: [
      `<p>Confirm this email for your ${escapedAppName} account:</p>`,
      `<p><a href="${escapedUrl}">Confirm email for ${escapedAppName}</a></p>`,
      '<p>This link expires in 24 hours and can be used once. It enables email login for the same account but does not sign you in.</p>',
      "<p>If you didn't enter this email while joining WCU, you can ignore this message.</p>"
    ].join('')
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
