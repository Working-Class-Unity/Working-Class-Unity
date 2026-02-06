<script setup lang="ts">
import type { FinanceSummaryResponse } from '~~/shared/types/finance'

useHead({
  title: 'Finance Dashboard',
})

useSeoMeta({
  robots: 'noindex, nofollow, noarchive',
})

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
})

const formatCurrency = (amountCents: number): string => {
  return formatter.format(amountCents / 100)
}

const { data, pending, error, refresh } = await useFetch<FinanceSummaryResponse>('/api/v1/finance/summary', {
  key: 'finance-summary',
})

const isForbidden = computed(() => {
  return error.value?.statusCode === 401 || error.value?.statusCode === 403
})

const retryLoad = async (): Promise<void> => {
  await refresh()
}
</script>

<template>
  <section class="py-8 md:py-12">
    <div class="wcu-container">
      <article class="wcu-card overflow-hidden border-secondary/30">
        <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
        <div class="card-body p-6 md:p-8 space-y-6">
          <header class="space-y-2">
            <p class="wcu-eyebrow">Finance</p>
            <h1 class="text-2xl md:text-3xl font-bold text-base-content">Finance Dashboard</h1>
            <p class="text-base-content/85">
              Dues-current members can view year-to-date revenue, expenses, and net balance.
            </p>
          </header>

          <p v-if="pending" class="text-sm text-base-content/70">Loading finance data...</p>

          <section v-else-if="isForbidden" class="rounded-box border border-warning/40 bg-warning/10 p-4 space-y-2" aria-live="polite">
            <h2 class="font-semibold text-base-content">Dues-current access required</h2>
            <p class="text-sm text-base-content/80">
              This dashboard is only available when your dues are current (including grace period).
            </p>
            <NuxtLinkLocale to="/member" class="btn btn-primary btn-sm">Return to member dashboard</NuxtLinkLocale>
          </section>

          <section v-else-if="error" class="rounded-box border border-error/40 bg-error/10 p-4 space-y-2" aria-live="polite">
            <h2 class="font-semibold text-base-content">Unable to load finance dashboard</h2>
            <p class="text-sm text-base-content/80">Please try again. If this continues, verify PocketBase finance collections.</p>
            <button class="btn btn-outline btn-sm" type="button" @click="retryLoad">Retry</button>
          </section>

          <section v-else-if="data" class="space-y-5">
            <dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Dues Revenue (YTD)</dt>
                <dd class="mt-1 text-xl font-bold text-base-content">{{ formatCurrency(data.summary.duesRevenueCents) }}</dd>
              </div>

              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Donations (YTD)</dt>
                <dd class="mt-1 text-xl font-bold text-base-content">{{ formatCurrency(data.summary.donationRevenueCents) }}</dd>
              </div>

              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Expenses (YTD)</dt>
                <dd class="mt-1 text-xl font-bold text-base-content">{{ formatCurrency(data.summary.expenseTotalCents) }}</dd>
              </div>

              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Net (YTD)</dt>
                <dd class="mt-1 text-xl font-bold" :class="data.summary.netCents < 0 ? 'text-error' : 'text-success'">
                  {{ formatCurrency(data.summary.netCents) }}
                </dd>
              </div>
            </dl>

            <section class="rounded-box border border-secondary/20 bg-base-100 p-4 space-y-3">
              <h2 class="text-base font-semibold text-base-content">Recent expenses</h2>

              <div v-if="data.recentExpenses.length > 0" class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="expense in data.recentExpenses" :key="expense.id">
                      <td>{{ expense.spentAt }}</td>
                      <td>{{ expense.category }}</td>
                      <td>{{ expense.description || '-' }}</td>
                      <td>{{ formatCurrency(expense.amountCents) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p v-else class="text-sm text-base-content/70">No expenses found yet.</p>
            </section>
          </section>
        </div>
      </article>
    </div>
  </section>
</template>
