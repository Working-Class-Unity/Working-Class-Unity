import type { ComputedRef } from 'vue'

function mergeLocalizedContent(source: unknown, translation: unknown): unknown {
  if (translation === undefined) return source

  if (Array.isArray(source)) {
    if (!Array.isArray(translation)) return source
    return source.map((value, index) => mergeLocalizedContent(value, translation[index]))
  }

  if (source && typeof source === 'object') {
    if (!translation || typeof translation !== 'object' || Array.isArray(translation)) return source
    return Object.fromEntries(
      Object.entries(source).map(([key, value]) => [
        key,
        mergeLocalizedContent(value, (translation as Record<string, unknown>)[key])
      ])
    )
  }

  return typeof source === 'string' && typeof translation === 'string' ? translation : source
}

function isCompiledMessage(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'body' in value && 'type' in value)
}

function messageAt(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[key]
  }, messages)
}

function resolveLocaleMessages(value: unknown, resolve: (message: unknown) => string): unknown {
  if (typeof value === 'string' || typeof value === 'function' || isCompiledMessage(value)) return resolve(value)
  if (Array.isArray(value)) return value.map((item) => resolveLocaleMessages(item, resolve))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveLocaleMessages(item, resolve)]))
  }
  return value
}

export function useLocalizedContent<T>(source: T, messageKey: string): ComputedRef<T> {
  const { getLocaleMessage, locale, rt } = useI18n()

  return computed(() => {
    const activeLocale = locale.value
    const messages = messageAt(getLocaleMessage(activeLocale), messageKey)
    if (messages === undefined) return source

    const translation = resolveLocaleMessages(messages, (message) => rt(message as Parameters<typeof rt>[0]))
    return mergeLocalizedContent(source, translation) as T
  })
}
