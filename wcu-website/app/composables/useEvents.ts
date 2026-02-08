import type { EventType } from '~/data/events'

/**
 * Composable for shared event formatting logic used across calendar, index, and links pages.
 */
export function useEvents() {
  const { locale } = useI18n()

  // Badge color mapping for event types
  const badgeClasses: Record<EventType, string> = {
    meeting: 'badge-primary',
    action: 'badge-error',
    training: 'badge-info',
    social: 'badge-success',
    canvass: 'badge-warning',
    forum: 'badge-secondary',
    other: 'badge-neutral'
  }

  /**
   * Format a date string to a localized short format (e.g., "Sat, Dec 7, 2025")
   */
  function formatDate(dateString: string): string {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat(locale.value, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date)
  }

  /**
   * Format a date string to a localized time (e.g., "2:00 PM")
   */
  function formatTime(dateString: string): string {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat(locale.value, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).format(date)
  }

  /**
   * Format a date range for display (handles all-day events)
   */
  function formatDateRange(startDateTime: string, endDateTime: string, allDay: boolean): string {
    if (allDay) {
      return formatDate(startDateTime)
    }
    return `${formatDate(startDateTime)} • ${formatTime(startDateTime)} - ${formatTime(endDateTime)}`
  }

  /**
   * Get the badge class for an event type
   */
  function getBadgeClass(eventType: EventType): string {
    return badgeClasses[eventType] || 'badge-neutral'
  }

  return {
    badgeClasses,
    formatDate,
    formatTime,
    formatDateRange,
    getBadgeClass
  }
}

