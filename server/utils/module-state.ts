import {
  moduleManifest,
  runtimeModuleIds,
  type LiveModuleState,
  type PublicModuleStates,
  type RuntimeModuleId
} from '../../shared/modules'
import { moduleDisabledCode } from '../../shared/module-states'
import { createError } from 'h3'
import { getAppRuntimeConfig, type AppRuntimeConfig } from './runtime'

export { moduleDisabledCode } from '../../shared/module-states'

export function getModuleState(
  moduleId: RuntimeModuleId,
  config: AppRuntimeConfig = getAppRuntimeConfig()
): LiveModuleState {
  return config.modules[moduleId].enabled ? 'ready' : 'disabled'
}

export function isModuleReady(moduleId: RuntimeModuleId, config: AppRuntimeConfig = getAppRuntimeConfig()): boolean {
  return getModuleState(moduleId, config) === 'ready'
}

export function requireModuleReady(moduleId: RuntimeModuleId, config: AppRuntimeConfig = getAppRuntimeConfig()): void {
  if (isModuleReady(moduleId, config)) return

  throw createError({
    statusCode: 404,
    statusMessage: 'Module disabled',
    data: {
      code: moduleDisabledCode,
      module: moduleId
    }
  })
}

export function getPublicModuleStates(config: AppRuntimeConfig = getAppRuntimeConfig()): PublicModuleStates {
  return freezeStates(
    Object.fromEntries(runtimeModuleIds.map((moduleId) => [moduleId, getModuleState(moduleId, config)])) as Record<
      RuntimeModuleId,
      LiveModuleState
    >
  )
}

export function moduleForExclusiveRoute(pathname: string): RuntimeModuleId | undefined {
  return runtimeModuleIds.find(
    (moduleId) =>
      moduleManifest[moduleId].uiRoutes.some((route) => route === pathname) ||
      moduleManifest[moduleId].exclusiveRoutePrefixes.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
      )
  )
}

function freezeStates<State extends LiveModuleState>(
  states: Record<RuntimeModuleId, State>
): Readonly<Record<RuntimeModuleId, State>> {
  return Object.freeze(states)
}
