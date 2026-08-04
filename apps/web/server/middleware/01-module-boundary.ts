import { getPublicModuleStates, moduleForExclusiveRoute, requireModuleReady } from '../utils/module-state'
import { getCanonicalRequestPathname } from '../utils/request-path'

export default defineEventHandler((event) => {
  const pathname = getCanonicalRequestPathname(event)

  // App-owned policy: process liveness must not depend on runtime config or
  // module evaluation. nuxt-security applies response headers independently.
  if (pathname === '/api/live') return

  const states = getPublicModuleStates()
  const runtimeConfig = useRuntimeConfig(event)

  // Pinned Nitro/Nuxt publication sources provide this mutable per-request
  // clone-to-payload chain; public Nuxt docs do not expose mutation as an API.
  // The private validated flags overwrite every public default or env attempt.
  runtimeConfig.public.moduleStates = { ...states }

  const moduleId = moduleForExclusiveRoute(pathname)
  if (moduleId) requireModuleReady(moduleId)
})
