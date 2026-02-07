export default defineEventHandler(() => {
  return {
    service: 'wcu-api',
    version: 'v1',
    timestamp: new Date().toISOString(),
  }
})
