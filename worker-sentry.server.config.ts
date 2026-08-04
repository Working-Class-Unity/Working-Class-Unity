if (process.env.NUXT_MODULES_JOBS_ENABLED === 'true') {
  await import('./sentry.server.config')
}
