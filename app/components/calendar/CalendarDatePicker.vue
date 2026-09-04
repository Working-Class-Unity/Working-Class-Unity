<script setup lang="ts">
import { CalendarDate, type DateValue } from '@internationalized/date'
import {
  CalendarCell,
  CalendarCellTrigger,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHead,
  CalendarGridRow,
  CalendarHeadCell,
  CalendarHeader,
  CalendarHeading,
  CalendarNext,
  CalendarPrev,
  CalendarRoot,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'

const emit = defineEmits<{ select: [date: string] }>()
const { locale, localeProperties, t } = useI18n()
const languageTag = computed(() => localeProperties.value.language ?? locale.value)
const open = ref(false)
const selectedDate = shallowRef<DateValue>(new CalendarDate(2026, 8, 20))

function selectDate(date: DateValue | undefined) {
  if (!date) return
  selectedDate.value = date
  emit('select', date.toString())
  open.value = false
}
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <AppButton class="wcu-date-trigger" size="compact" variant="secondary">{{ t('calendar.picker.jump') }}</AppButton>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="wcu-date-popover"
        :side-offset="8"
        :collision-padding="10"
        :prioritize-position="true"
        align="end"
      >
        <CalendarRoot
          v-slot="{ weekDays, grid }"
          :model-value="selectedDate"
          :default-placeholder="selectedDate"
          :calendar-label="t('calendar.picker.label')"
          :locale="languageTag"
          fixed-weeks
          @update:model-value="selectDate"
        >
          <CalendarHeader class="wcu-date-header">
            <CalendarPrev class="wcu-date-nav" :aria-label="t('calendar.month.previous')">
              <span class="wcu-date-chevron wcu-date-chevron--previous" aria-hidden="true" />
            </CalendarPrev>
            <CalendarHeading class="wcu-date-heading" />
            <CalendarNext class="wcu-date-nav" :aria-label="t('calendar.month.next')">
              <span class="wcu-date-chevron wcu-date-chevron--next" aria-hidden="true" />
            </CalendarNext>
          </CalendarHeader>
          <CalendarGrid v-for="month in grid" :key="month.value.toString()" class="wcu-date-grid">
            <CalendarGridHead>
              <CalendarGridRow>
                <CalendarHeadCell v-for="day in weekDays" :key="day" class="wcu-date-weekday">{{
                  day
                }}</CalendarHeadCell>
              </CalendarGridRow>
            </CalendarGridHead>
            <CalendarGridBody>
              <CalendarGridRow v-for="(week, index) in month.rows" :key="index">
                <CalendarCell v-for="day in week" :key="day.toString()" :date="day" class="wcu-date-cell">
                  <CalendarCellTrigger :day="day" :month="month.value" class="wcu-date-day" />
                </CalendarCell>
              </CalendarGridRow>
            </CalendarGridBody>
          </CalendarGrid>
        </CalendarRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style>
/* stylelint-disable no-descending-specificity -- focus state intentionally follows hover state */
@layer components {
  .wcu-date-trigger[data-variant='secondary'] {
    min-block-size: var(--control-min-block-size);
    border: 1px solid var(--color-action);
    border-radius: var(--radius-2);
    padding: 0.55rem 0.75rem;
    color: var(--color-action);
    background: transparent;
    font: inherit;
    font-size: 0.875rem;
    font-weight: 650;
    filter: none;
    cursor: pointer;
  }

  .wcu-date-popover {
    z-index: 50;
    inline-size: min(20rem, var(--reka-popover-content-available-width));
    max-block-size: var(--reka-popover-content-available-height);
    overflow: auto;
    border-radius: var(--radius-3);
    padding: var(--space-4);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
    outline: 1px solid var(--color-divider);
  }

  .wcu-date-header {
    display: grid;
    grid-template-columns: 2.75rem 1fr 2.75rem;
    align-items: center;
    margin-block-end: var(--space-3);
  }

  .wcu-date-heading {
    color: var(--color-brand-primary);
    font-weight: 650;
    text-align: center;
  }

  .wcu-date-nav,
  .wcu-date-day {
    border: 0;
    background: transparent;
    color: var(--color-brand-primary);
    font: inherit;
    cursor: pointer;
  }

  .wcu-date-nav {
    display: grid;
    min-block-size: var(--control-min-block-size);
    place-items: center;
    border-radius: var(--radius-2);
  }

  .wcu-date-chevron {
    inline-size: 0.55rem;
    block-size: 0.55rem;
    border-block-end: 1.5px solid currentcolor;
    border-inline-end: 1.5px solid currentcolor;
  }

  .wcu-date-chevron--previous {
    rotate: 135deg;
  }

  .wcu-date-chevron--next {
    rotate: -45deg;
  }

  .wcu-date-grid {
    inline-size: 100%;
    border-spacing: 0.2rem;
    table-layout: fixed;
  }

  .wcu-date-weekday {
    block-size: 2rem;
    color: var(--color-text-muted);
    font-size: 0.8125rem;
    font-weight: 650;
  }

  .wcu-date-cell {
    padding: 0;
    text-align: center;
  }

  .wcu-date-day {
    inline-size: 100%;
    min-block-size: var(--control-min-block-size);
    border-radius: var(--radius-2);
    font-size: 0.875rem;
  }

  .wcu-date-day[data-outside-view] {
    color: var(--color-text-muted);
    opacity: 0.45;
  }

  .wcu-date-day[data-today] {
    outline: 1px solid var(--color-brand-primary);
  }

  .wcu-date-day[data-selected] {
    background: var(--color-brand-primary);
    color: var(--color-action-contrast);
  }

  .wcu-date-nav:hover,
  .wcu-date-day:hover:not([data-selected]),
  .wcu-date-trigger[data-variant='secondary']:hover {
    background: var(--color-surface-subtle);
  }

  .wcu-date-trigger[data-variant='secondary']:focus-visible,
  .wcu-date-nav:focus-visible,
  .wcu-date-day:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }

  @media (width <= 36rem) {
    .wcu-date-popover {
      padding: var(--space-3);
    }

    .wcu-date-trigger,
    .wcu-date-day {
      font-size: 1rem;
    }
  }
}
/* stylelint-enable no-descending-specificity */
</style>
