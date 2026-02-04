import { nextTick, onUnmounted, watch, type Ref } from 'vue'

type UseFocusTrapOptions = {
  active: Ref<boolean>
  container: Ref<HTMLElement | null>
  initialFocus?: Ref<HTMLElement | null>
  onEscape?: () => void
  restoreFocus?: boolean
}

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
  return nodes.filter((el) => {
    if (el.hasAttribute('disabled')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    if (el.getAttribute('tabindex') === '-1') return false
    // Skip elements that are not visible (basic check)
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false
    return true
  })
}

export function useFocusTrap(options: UseFocusTrapOptions) {
  const restoreFocus = options.restoreFocus !== false
  let previousActiveElement: HTMLElement | null = null
  let isListening = false

  const stopListening = () => {
    if (!isListening) return
    document.removeEventListener('keydown', onKeydown, true)
    isListening = false
  }

  const startListening = () => {
    if (isListening) return
    document.addEventListener('keydown', onKeydown, true)
    isListening = true
  }

  const onKeydown = (event: KeyboardEvent) => {
    if (!options.active.value) return
    const container = options.container.value
    if (!container) return

    if (event.key === 'Escape') {
      options.onEscape?.()
      return
    }

    if (event.key !== 'Tab') return

    const focusable = getFocusableElements(container)
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (!(active instanceof HTMLElement) || !container.contains(active)) {
      event.preventDefault()
      first.focus()
      return
    }

    if (event.shiftKey) {
      if (active === first) {
        event.preventDefault()
        last.focus()
      }
      return
    }

    if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const stop = watch(
    () => options.active.value,
    async (active) => {
      if (!process.client) return

      if (active) {
        previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
        await nextTick()

        const container = options.container.value
        if (!container) return

        startListening()

        await nextTick()

        const initial = options.initialFocus?.value
        if (initial) {
          initial.focus()
          return
        }

        const focusable = getFocusableElements(container)
        focusable[0]?.focus()
        return
      }

      stopListening()

      if (restoreFocus && previousActiveElement) {
        previousActiveElement.focus()
      }
    },
    { immediate: true }
  )

  onUnmounted(() => {
    stop()
    stopListening()
  })
}
