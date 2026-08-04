export const moduleDisabledCode = 'MODULE_DISABLED' as const

export type ModuleState = 'disabled' | 'incomplete' | 'ready'
export type LiveModuleState = Exclude<ModuleState, 'incomplete'>
export type PublicModuleStates<ModuleId extends string = string> = Readonly<Record<ModuleId, LiveModuleState>>

export function isPublicModuleReady(states: unknown, id: string): boolean {
  return isRecord(states) && states[id] === 'ready'
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
