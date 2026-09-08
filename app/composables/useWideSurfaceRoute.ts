import { unlocalizedPublicPath } from '#shared/public-site'

export function useWideSurfaceRoute() {
  const route = useRoute()

  return computed(() => {
    const path = unlocalizedPublicPath(route.path)
    return path === '/' || path.startsWith('/campaigns/remove-flock-stockton')
  })
}
