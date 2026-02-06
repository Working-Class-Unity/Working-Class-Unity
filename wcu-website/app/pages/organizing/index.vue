<script setup lang="ts">
import type { OrganizingSummaryResponse } from '~~/shared/types/tenant-ops'

useHead({
  title: 'Organizing Dashboard',
})

useSeoMeta({
  robots: 'noindex, nofollow, noarchive',
})

const { data, pending, error, refresh } = await useFetch<OrganizingSummaryResponse>('/api/v1/organizing/summary', {
  key: 'organizing-summary',
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
            <p class="wcu-eyebrow">Tenant Operations</p>
            <h1 class="text-2xl md:text-3xl font-bold text-base-content">Organizing Dashboard</h1>
            <p class="text-base-content/85">
              Building outreach and campaign field data from PocketBase.
            </p>
          </header>

          <p v-if="pending" class="text-sm text-base-content/70">Loading organizing data...</p>

          <section v-else-if="isForbidden" class="rounded-box border border-warning/40 bg-warning/10 p-4 space-y-2" aria-live="polite">
            <h2 class="font-semibold text-base-content">Organizer access required</h2>
            <p class="text-sm text-base-content/80">This dashboard is available to organizer, treasurer, and admin roles.</p>
            <NuxtLinkLocale to="/member" class="btn btn-primary btn-sm">Return to member dashboard</NuxtLinkLocale>
          </section>

          <section v-else-if="error" class="rounded-box border border-error/40 bg-error/10 p-4 space-y-2" aria-live="polite">
            <h2 class="font-semibold text-base-content">Unable to load organizing dashboard</h2>
            <p class="text-sm text-base-content/80">Please try again. If this continues, verify PocketBase collection settings.</p>
            <button class="btn btn-outline btn-sm" type="button" @click="retryLoad">Retry</button>
          </section>

          <section v-else-if="data" class="space-y-5">
            <dl class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Total buildings</dt>
                <dd class="mt-1 text-2xl font-bold text-base-content">{{ data.totalBuildings }}</dd>
              </div>

              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Active targets</dt>
                <dd class="mt-1 text-2xl font-bold text-base-content">{{ data.activeBuildings }}</dd>
              </div>

              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Interactions (30 days)</dt>
                <dd class="mt-1 text-2xl font-bold text-base-content">{{ data.outreachLast30Days }}</dd>
              </div>
            </dl>

            <section class="rounded-box border border-secondary/20 bg-base-100 p-4 space-y-3">
              <h2 class="text-base font-semibold text-base-content">Recent outreach</h2>

              <div v-if="data.recentInteractions.length > 0" class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Building</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="interaction in data.recentInteractions" :key="interaction.id">
                      <td>{{ interaction.occurredAt }}</td>
                      <td>{{ interaction.interactionType }}</td>
                      <td>{{ interaction.buildingId }}</td>
                      <td>{{ interaction.notes || '-' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p v-else class="text-sm text-base-content/70">No outreach interactions found.</p>
            </section>
          </section>
        </div>
      </article>
    </div>
  </section>
</template>
