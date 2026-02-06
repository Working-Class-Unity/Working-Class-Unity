export default defineEventHandler((event) => {
  const url = getRequestURL(event)
  const { pathname, search } = url

  if (pathname.startsWith('/_nuxt/') || pathname.startsWith('/api/')) {
    return
  }

  let normalizedPath = pathname.replace(/\/\/{2,}/g, '/')

  if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1)
  }

  if (normalizedPath !== pathname) {
    return sendRedirect(event, `${normalizedPath}${search}`, 301)
  }
})
