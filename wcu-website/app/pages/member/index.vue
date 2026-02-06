<script setup lang="ts">
import type { AuthMagicLinkRequestResponse, AuthSessionResponse, Role } from '~~/shared/types/auth'
import type { MemberOverviewResponse } from '~~/shared/types/membership'

useHead({
  title: 'Member Dashboard',
})

const roleLabels: Record<Role, string> = {
  member: 'Member',
  organizer: 'Organizer',
  treasurer: 'Treasurer',
  admin: 'Admin',
}

const email = ref('')
const isRequestingLink = ref(false)
const requestError = ref<string | null>(null)
const requestMessage = ref<string | null>(null)
const debugMagicLink = ref<string | null>(null)
const isLoggingOut = ref(false)

const { data: authState, pending: authPending, refresh: refreshAuth } = await useFetch<AuthSessionResponse>('/api/v1/auth/me', {
  key: 'auth-session',
})
const { data: memberOverview, pending: memberOverviewPending, error: memberOverviewError, refresh: refreshMemberOverview } = await useFetch<MemberOverviewResponse>('/api/v1/member/overview', {
  key: 'member-overview',
  immediate: false,
})

const authenticatedSession = computed(() => authState.value?.session ?? null)
const isAuthenticated = computed(() => authState.value?.authenticated === true)

const canAccessOrganizing = computed(() => {
  const role = authenticatedSession.value?.role
  return role === 'organizer' || role === 'treasurer' || role === 'admin'
})

const canAccessFinance = computed(() => {
  const role = authenticatedSession.value?.role
  return role === 'treasurer' || role === 'admin'
})

const duesCurrentLabel = computed(() => {
  return authenticatedSession.value?.duesCurrent ? 'Current' : 'Needs renewal'
})

const memberProfile = computed(() => memberOverview.value?.profile ?? null)
const duesRecords = computed(() => memberOverview.value?.duesRecords ?? [])

const roleLabel = computed(() => {
  const role = authenticatedSession.value?.role ?? 'member'
  return roleLabels[role]
})

watch(isAuthenticated, async (value) => {
  if (value) {
    await refreshMemberOverview()
  }
}, { immediate: true })

async function requestMagicLink(): Promise<void> {
  requestError.value = null
  requestMessage.value = null
  debugMagicLink.value = null

  isRequestingLink.value = true

  try {
    const response = await $fetch<AuthMagicLinkRequestResponse>('/api/v1/auth/request-link', {
      method: 'POST',
      body: {
        email: email.value,
        next: '/member',
      },
    })

    requestMessage.value = response.message
    debugMagicLink.value = response.debugMagicLink || null
  } catch {
    requestError.value = 'Unable to send sign-in link right now. Please try again in a moment.'
  } finally {
    isRequestingLink.value = false
  }
}

async function logout(): Promise<void> {
  isLoggingOut.value = true

  try {
    await $fetch('/api/v1/auth/logout', {
      method: 'POST',
    })

    await refreshAuth()
  } finally {
    isLoggingOut.value = false
  }
}
</script>

<template>
  <section class="py-8 md:py-12">
    <div class="wcu-container">
      <article class="wcu-card overflow-hidden border-secondary/30">
        <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
        <div class="card-body p-6 md:p-8 space-y-6">
          <header class="space-y-2">
            <p class="wcu-eyebrow">Membership</p>
            <h1 class="text-2xl md:text-3xl font-bold text-base-content">Member Dashboard</h1>
            <p class="text-base-content/85">
              Sign in to view membership status, organizing tools, and finance pages based on your role.
            </p>
          </header>

          <p v-if="authPending" class="text-sm text-base-content/70">Checking your session...</p>

          <section v-else-if="!isAuthenticated" aria-labelledby="member-login-heading" class="space-y-4 max-w-xl">
            <h2 id="member-login-heading" class="text-xl font-semibold text-base-content">Sign in with a secure magic link</h2>

            <form class="space-y-4" @submit.prevent="requestMagicLink">
              <div class="space-y-1.5">
                <label for="member-email" class="label-text font-medium">Email address</label>
                <input
                  id="member-email"
                  v-model="email"
                  class="input input-bordered w-full"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                >
              </div>

              <button class="btn btn-primary" type="submit" :disabled="isRequestingLink">
                {{ isRequestingLink ? 'Sending link...' : 'Email me a sign-in link' }}
              </button>
            </form>

            <p v-if="requestMessage" class="text-sm text-secondary" aria-live="polite">{{ requestMessage }}</p>
            <p v-if="requestError" class="text-sm text-error" aria-live="polite">{{ requestError }}</p>

            <p v-if="debugMagicLink" class="text-xs text-base-content/70">
              Dev preview: <a class="link link-primary" :href="debugMagicLink">open sign-in link</a>
            </p>
          </section>

          <section v-else class="space-y-5" aria-labelledby="member-status-heading">
            <h2 id="member-status-heading" class="text-xl font-semibold text-base-content">Account status</h2>

            <dl class="grid gap-3 sm:grid-cols-2">
              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Role</dt>
                <dd class="mt-1 text-lg font-semibold text-base-content">{{ roleLabel }}</dd>
              </div>

              <div class="rounded-box border border-secondary/20 bg-base-100 p-4">
                <dt class="text-xs font-semibold uppercase tracking-[0.12em] text-base-content/70">Dues</dt>
                <dd class="mt-1 text-lg font-semibold text-base-content">{{ duesCurrentLabel }}</dd>
              </div>
            </dl>

            <div class="rounded-box border border-secondary/20 bg-base-100 p-4 space-y-2">
              <h3 class="text-base font-semibold text-base-content">Member profile</h3>
              <p v-if="memberOverviewPending" class="text-sm text-base-content/70">Loading profile...</p>
              <p v-else-if="memberOverviewError" class="text-sm text-error">Unable to load profile details right now.</p>
              <div v-else-if="memberProfile" class="grid gap-2 sm:grid-cols-2">
                <p class="text-sm text-base-content/80"><strong>Name:</strong> {{ memberProfile.fullName || 'Not set' }}</p>
                <p class="text-sm text-base-content/80"><strong>Committee:</strong> {{ memberProfile.committee || 'Not assigned' }}</p>
                <p class="text-sm text-base-content/80"><strong>Standing:</strong> {{ memberProfile.isInGoodStanding ? 'Good standing' : 'Needs follow-up' }}</p>
                <p class="text-sm text-base-content/80"><strong>Joined:</strong> {{ memberProfile.joinedAt || 'Unknown' }}</p>
              </div>
              <p v-else class="text-sm text-base-content/70">
                No profile record found yet for this account.
              </p>
            </div>

            <div class="rounded-box border border-secondary/20 bg-base-100 p-4 space-y-3">
              <h3 class="text-base font-semibold text-base-content">Recent dues payments</h3>
              <p v-if="memberOverviewPending" class="text-sm text-base-content/70">Loading dues history...</p>
              <p v-else-if="memberOverviewError" class="text-sm text-error">Unable to load dues history right now.</p>
              <div v-else-if="duesRecords.length > 0" class="overflow-x-auto">
                <table class="table table-sm">
                  <thead>
                    <tr>
                      <th>Paid at</th>
                      <th>Amount</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="record in duesRecords" :key="record.id">
                      <td>{{ record.paidAt }}</td>
                      <td>{{ (record.amountCents / 100).toFixed(2) }} {{ record.currency }}</td>
                      <td>{{ record.source }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p v-else class="text-sm text-base-content/70">No dues records found yet.</p>
            </div>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <NuxtLinkLocale to="/member" class="btn btn-outline justify-start">Membership Home</NuxtLinkLocale>
              <NuxtLinkLocale v-if="canAccessOrganizing" to="/organizing" class="btn btn-outline justify-start">Organizing Dashboard</NuxtLinkLocale>
              <NuxtLinkLocale v-if="canAccessFinance" to="/finance" class="btn btn-outline justify-start">Finance Dashboard</NuxtLinkLocale>
            </div>

            <div>
              <button class="btn btn-ghost" type="button" :disabled="isLoggingOut" @click="logout">
                {{ isLoggingOut ? 'Signing out...' : 'Sign out' }}
              </button>
            </div>
          </section>
        </div>
      </article>
    </div>
  </section>
</template>
