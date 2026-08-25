export function useWideSurfaceRoute() {
  const route = useRoute()

  return computed(() => route.path === '/' || route.path.startsWith('/campaigns/remove-flock-stockton'))
}
