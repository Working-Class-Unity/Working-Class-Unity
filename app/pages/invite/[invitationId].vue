<script setup lang="ts">
import { invitationLocation, isInvitationId } from '#shared/invitation-path'

type InvitationView = {
  workspace: { name: string }
  expiresAt: string
}

const route = useRoute()
const { d, t } = useI18n()
const rawInvitationId = Array.isArray(route.params.invitationId)
  ? route.params.invitationId[0]
  : route.params.invitationId
const invitationId = isInvitationId(rawInvitationId) ? rawInvitationId : ''
const returnPath = invitationId ? invitationLocation(invitationId) : '/login'
const { data: session, error: sessionError } = await useAppSession()
const sessionUserId = computed(() => session.value?.user.id ?? null)
const signedIn = computed(() => Boolean(sessionUserId.value))
const invitationUrl = `/api/invitations/${encodeURIComponent(invitationId || 'invalid')}`
const {
  data: invitationResponse,
  error: invitationError,
  status: invitationStatus,
  refresh: refreshInvitation,
  clear: clearInvitationRequest
} = await useFetch<{ invitation: InvitationView }>(invitationUrl, {
  enabled: () => Boolean(invitationId && sessionUserId.value),
  watch: false
})
const invitation = computed(() => invitationResponse.value?.invitation ?? null)
const invitationLoading = computed(() => signedIn.value && invitationStatus.value === 'pending')
const invitationUnavailable = computed(
  () => signedIn.value && (!invitationId || Boolean(invitationError.value) || !invitation.value)
)
const actionError = ref('')
const rejected = ref(false)
const isAccepting = ref(false)
const isRejecting = ref(false)
const signInTarget = computed(() => ({ path: '/login', query: { returnTo: returnPath } }))

watch(sessionUserId, async (userId, previousUserId) => {
  if (userId === previousUserId) return

  clearInvitationRequest()
  if (userId && invitationId) await refreshInvitation()
})

useHead(() => ({
  title: t('metadata.invitation.title'),
  meta: [
    { name: 'robots', content: 'noindex, nofollow, noarchive' },
    { name: 'referrer', content: 'no-referrer' }
  ]
}))

async function acceptInvitation() {
  if (!invitationId || isAccepting.value || isRejecting.value) return

  actionError.value = ''
  isAccepting.value = true
  try {
    const result = await $fetch<{ status: 'accepted'; location: string }>(
      `/api/invitations/${encodeURIComponent(invitationId)}/accept`,
      { method: 'POST' }
    )
    await navigateTo(result.location)
  } catch {
    actionError.value = t('invitations.redemption.noLongerAvailable')
  } finally {
    isAccepting.value = false
  }
}

async function rejectInvitation() {
  if (!invitationId || isAccepting.value || isRejecting.value) return

  actionError.value = ''
  isRejecting.value = true
  try {
    await $fetch(`/api/invitations/${encodeURIComponent(invitationId)}/reject`, { method: 'POST' })
    rejected.value = true
  } catch {
    actionError.value = t('invitations.redemption.noLongerAvailable')
  } finally {
    isRejecting.value = false
  }
}
</script>

<template>
  <AppPage class="invitation-page">
    <section class="panel invitation-panel" aria-labelledby="invitation-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('invitations.redemption.eyebrow') }}</p>
        <h1 id="invitation-title">{{ t('invitations.redemption.title') }}</h1>
      </div>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('invitations.redemption.unavailable.title')"
        :description="t('invitations.redemption.unavailable.sessionDescription')"
      />

      <div v-else-if="!signedIn" class="invitation-state">
        <p>{{ t('invitations.redemption.signInDescription') }}</p>
        <NuxtLink class="primary-button invitation-link" :to="signInTarget">
          {{ t('invitations.redemption.signIn') }}
        </NuxtLink>
      </div>

      <UiStateBlock
        v-else-if="invitationLoading"
        tone="loading"
        :title="t('invitations.redemption.checking.title')"
        :description="t('invitations.redemption.checking.description')"
      />

      <UiStateBlock
        v-else-if="invitationUnavailable"
        tone="empty"
        :title="t('invitations.redemption.unavailable.title')"
        :description="t('invitations.redemption.unavailable.invitationDescription')"
      />

      <UiStateBlock
        v-else-if="rejected"
        tone="success"
        :title="t('invitations.redemption.declined.title')"
        :description="t('invitations.redemption.declined.description')"
      />

      <div v-else-if="invitation" class="invitation-details">
        <i18n-t keypath="invitations.redemption.details" tag="p">
          <template #workspace>
            <strong>{{ invitation.workspace.name }}</strong>
          </template>
        </i18n-t>
        <i18n-t keypath="invitations.redemption.expiry" tag="p" class="invitation-expiry">
          <template #date>
            <time :datetime="invitation.expiresAt">{{ d(new Date(invitation.expiresAt), 'invitationUtc') }}</time>
          </template>
        </i18n-t>

        <AppStatusMessage v-if="actionError" tone="error">{{ actionError }}</AppStatusMessage>

        <div class="invitation-actions">
          <button class="primary-button" type="button" :disabled="isAccepting || isRejecting" @click="acceptInvitation">
            {{ isAccepting ? t('invitations.redemption.joining') : t('invitations.redemption.accept') }}
          </button>
          <button
            class="secondary-button"
            type="button"
            :disabled="isAccepting || isRejecting"
            @click="rejectInvitation"
          >
            {{ isRejecting ? t('invitations.redemption.declining') : t('invitations.redemption.decline') }}
          </button>
        </div>
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .invitation-page {
    display: grid;
    place-items: start center;
    padding-block: var(--space-6);
  }

  .invitation-panel {
    display: grid;
    gap: var(--space-4);
    width: min(100%, 680px);
  }

  .invitation-state,
  .invitation-details {
    display: grid;
    gap: var(--space-3);
  }

  .invitation-link {
    width: fit-content;
    text-decoration: none;
  }

  .invitation-expiry {
    color: var(--color-text-muted);
  }

  .invitation-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  @media (width <= 520px) {
    .invitation-actions > * {
      width: 100%;
    }
  }
}
</style>
