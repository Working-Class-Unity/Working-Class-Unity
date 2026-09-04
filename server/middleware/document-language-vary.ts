import { appendResponseHeader, getRequestHeader, getRequestURL } from 'h3'

export default defineEventHandler((event) => {
  const pathname = getRequestURL(event).pathname
  if (pathname.startsWith('/api/') || pathname.startsWith('/_nuxt/') || /\/[^/]+\.[a-z0-9]+$/i.test(pathname)) return

  const acceptedTypes = getRequestHeader(event, 'accept') ?? ''
  if (acceptedTypes && !acceptedTypes.includes('text/html') && !acceptedTypes.includes('*/*')) return

  appendResponseHeader(event, 'vary', 'Cookie, Accept-Language')
})
