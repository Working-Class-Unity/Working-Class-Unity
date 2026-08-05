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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
