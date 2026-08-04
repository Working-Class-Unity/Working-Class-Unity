<script setup lang="ts">
import type { BillingAccountState } from '#shared/billing'

type InvitationSummary = Readonly<{
  id: string
  email: string
  expiresAt: string
}>

type InvitationListResponse = Readonly<{
  invitations: InvitationSummary[]
}>

type AcceptedMember = NonNullable<BillingAccountState['members']>[number]
type FamilySurfaceState = 'checking' | 'loading' | 'ready' | 'error' | 'hidden'

const { d, t } = useI18n()
const inviteEmail = ref('')
const inviteEmailInput = ref<HTMLInputElement | null>(null)
const validationError = ref('')
const actionError = ref('')
const actionStatus = ref('')
const activeAction = ref('')
const surfaceState = ref<FamilySurfaceState>('checking')
const billingState = ref<BillingAccountState | null>(null)
const invitations = ref<InvitationSummary[]>([])
const removalTarget = ref<AcceptedMember | null>(null)
let removalTrigger: HTMLButtonElement | null = null

const isBusy = computed(() => Boolean(activeAction.value))
const members = computed(() => billingState.value?.members ?? [])
const seats = computed(() => billingState.value?.seats ?? null)
const canCreateInvitation = computed(() => Boolean(billingState.value?.capabilities.canCreateFamilyInvitation))
const canResendInvitation = computed(() => Boolean(billingState.value?.capabilities.canResendFamilyInvitation))
const canRemoveMember = computed(() => Boolean(billingState.value?.capabilities.canRemoveFamilyMember))

onMounted(() => {
  void loadFamilySurface()
})

async function loadFamilySurface() {
  surfaceState.value = 'checking'
  try {
    const state = await $fetch<BillingAccountState>('/api/account/billing')
    billingState.value = state
    if (state.relationship.kind !== 'manager') {
      invitations.value = []
      surfaceState.value = 'hidden'
      return
    }
    if (!state.seats || !state.members) throw new Error('Invalid manager projection')

    surfaceState.value = 'loading'
    const response = await $fetch<InvitationListResponse>('/api/invitations')
    invitations.value = response.invitations
    surfaceState.value = 'ready'
  } catch {
    surfaceState.value = billingState.value?.relationship.kind === 'manager' ? 'error' : 'hidden'
  }
}

async function sendInvitation() {
  if (isBusy.value || surfaceState.value !== 'ready' || !canCreateInvitation.value) return

  clearActionFeedback()
  const email = inviteEmail.value.trim().toLowerCase()
  if (!email || !inviteEmailInput.value?.validity.valid) {
    validationError.value = t('common.emailInvalid')
    inviteEmailInput.value?.focus()
    return
  }

  activeAction.value = 'create'
  try {
    await $fetch('/api/invitations', {
      method: 'POST',
      body: { email }
    })
    inviteEmail.value = ''
    actionStatus.value = t('invitations.management.sent', { email })
  } catch {
    actionError.value = t('invitations.management.deliveryUnknown')
  } finally {
    await refreshAfterAction()
    activeAction.value = ''
  }
}

async function resendInvitation(invitation: InvitationSummary) {
  if (isBusy.value || surfaceState.value !== 'ready' || !canResendInvitation.value) return

  clearActionFeedback()
  activeAction.value = `resend:${invitation.id}`
  try {
    await $fetch(`/api/invitations/${encodeURIComponent(invitation.id)}/resend`, { method: 'POST' })
    actionStatus.value = t('invitations.management.resent', { email: invitation.email })
  } catch {
    actionError.value = t('invitations.management.resendError')
  } finally {
    await refreshAfterAction()
    activeAction.value = ''
  }
}

async function cancelInvitation(invitation: InvitationSummary) {
  if (isBusy.value || surfaceState.value !== 'ready') return

  clearActionFeedback()
  activeAction.value = `cancel:${invitation.id}`
  try {
    await $fetch(`/api/invitations/${encodeURIComponent(invitation.id)}/cancel`, { method: 'POST' })
    actionStatus.value = t('invitations.management.canceled', { email: invitation.email })
  } catch {
    actionError.value = t('invitations.management.cancelError')
  } finally {
    await refreshAfterAction()
    activeAction.value = ''
  }
}

async function revealRemoval(member: AcceptedMember, event: MouseEvent) {
  if (isBusy.value || !canRemoveMember.value) return
  clearActionFeedback()
  removalTarget.value = member
  removalTrigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null
  await nextTick()
  document.querySelector<HTMLButtonElement>('#family-member-remove-confirmation')?.focus()
}

async function cancelRemoval() {
  removalTarget.value = null
  await nextTick()
  removalTrigger?.focus()
  removalTrigger = null
}

async function removeMember() {
  const target = removalTarget.value
  if (isBusy.value || !target || !canRemoveMember.value) return

  clearActionFeedback()
  activeAction.value = 'remove'
  try {
    await $fetch('/api/account/family/members/remove', {
      method: 'POST',
      body: { memberReference: target.reference }
    })
    removalTarget.value = null
    removalTrigger = null
    actionStatus.value = t('invitations.management.memberRemoved', {
      name: target.name,
      email: target.email
    })
  } catch {
    actionError.value = t('invitations.management.removeError')
  } finally {
    await refreshAfterAction()
    activeAction.value = ''
  }
}

async function retryFamilyLoad() {
  clearActionFeedback()
  await loadFamilySurface()
}

async function refreshAfterAction() {
  const preservedError = actionError.value
  const preservedStatus = actionStatus.value
  await loadFamilySurface()
  actionError.value = preservedError
    ? surfaceState.value === 'error'
      ? t('invitations.management.refreshAlsoFailed', { error: preservedError })
      : preservedError
    : surfaceState.value === 'error'
      ? t('invitations.management.refreshFailed')
      : ''
  actionStatus.value = preservedStatus
}

function clearActionFeedback() {
  validationError.value = ''
  actionError.value = ''
  actionStatus.value = ''
}

function invitationExpiry(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return t('invitations.management.expiryUnavailable')
  return t('invitations.management.expires', { date: d(date, 'invitationLocal') })
}
</script>

<template>
  <section
    v-if="surfaceState !== 'hidden' && surfaceState !== 'checking'"
    id="family-access"
    class="account-section family-access-section"
    aria-labelledby="family-access-title"
  >
    <div>
      <h2 id="family-access-title">{{ t('invitations.management.title') }}</h2>
      <p>{{ t('invitations.management.description') }}</p>
    </div>

    <UiStateBlock
      v-if="surfaceState === 'loading'"
      tone="loading"
      :title="t('invitations.management.loading.title')"
      :description="t('invitations.management.loading.description')"
    />
    <UiStateBlock
      v-else-if="surfaceState === 'error'"
      tone="error"
      :title="t('invitations.management.unavailable.title')"
      :description="t('invitations.management.unavailable.description')"
      :action-label="t('common.tryAgain')"
      @action="retryFamilyLoad"
    />

    <template v-else>
      <dl v-if="seats" class="seat-summary">
        <div>
          <dt>{{ t('invitations.management.acceptedSeats') }}</dt>
          <dd>
            {{
              t('invitations.management.seatValue', {
                count: seats.accepted,
                capacity: seats.capacity
              })
            }}
          </dd>
        </div>
        <div>
          <dt>{{ t('invitations.management.reservedSeats') }}</dt>
          <dd>{{ seats.reserved }}</dd>
        </div>
      </dl>

      <AppStatusMessage v-if="!canCreateInvitation" tone="info">
        {{ t('invitations.management.creationUnavailable') }}
      </AppStatusMessage>

      <form v-if="canCreateInvitation" class="invite-form" novalidate @submit.prevent="sendInvitation">
        <label class="form-field" for="family-invite-email">
          <span>{{ t('invitations.management.emailLabel') }}</span>
          <input
            id="family-invite-email"
            ref="inviteEmailInput"
            v-model="inviteEmail"
            name="email"
            type="email"
            inputmode="email"
            autocomplete="email"
            required
            :aria-invalid="Boolean(validationError)"
            :aria-describedby="validationError ? 'family-invite-help family-invite-error' : 'family-invite-help'"
            :disabled="isBusy"
            @input="validationError = ''"
          />
        </label>
        <button class="primary-button invite-submit" type="submit" :disabled="isBusy">
          {{ activeAction === 'create' ? t('invitations.management.sending') : t('invitations.management.send') }}
        </button>
        <p id="family-invite-help" class="invite-help">
          {{ t('invitations.management.help') }}
        </p>
        <p v-if="validationError" id="family-invite-error" class="field-error" role="alert">
          {{ validationError }}
        </p>
      </form>

      <AppStatusMessage v-if="actionError" tone="error">{{ actionError }}</AppStatusMessage>
      <AppStatusMessage v-else-if="actionStatus" tone="success">{{ actionStatus }}</AppStatusMessage>

      <div class="accepted-members" aria-labelledby="accepted-members-title">
        <h3 id="accepted-members-title">{{ t('invitations.management.acceptedTitle') }}</h3>
        <UiStateBlock
          v-if="members.length === 0"
          tone="empty"
          :title="t('invitations.management.membersEmpty.title')"
          :description="t('invitations.management.membersEmpty.description')"
        />
        <ul v-else class="person-list">
          <li v-for="member in members" :key="member.reference" class="person-row">
            <div class="person-summary">
              <strong>{{ member.name }}</strong>
              <span>{{ member.email }}</span>
            </div>
            <button
              v-if="canRemoveMember && removalTarget?.reference !== member.reference"
              class="secondary-button"
              type="button"
              :aria-label="
                t('invitations.management.removeAriaLabel', {
                  name: member.name,
                  email: member.email
                })
              "
              :disabled="isBusy"
              @click="revealRemoval(member, $event)"
            >
              {{ t('invitations.management.remove') }}
            </button>
            <div
              v-else-if="removalTarget?.reference === member.reference"
              class="removal-confirmation"
              role="group"
              aria-labelledby="remove-member-title"
            >
              <p id="remove-member-title">
                {{ t('invitations.management.removeConfirmation', { name: member.name, email: member.email }) }}
              </p>
              <div class="person-actions">
                <button
                  id="family-member-remove-confirmation"
                  class="primary-button"
                  type="button"
                  :disabled="isBusy"
                  @click="removeMember"
                >
                  {{
                    activeAction === 'remove'
                      ? t('invitations.management.removing')
                      : t('invitations.management.confirmRemove')
                  }}
                </button>
                <button class="secondary-button" type="button" :disabled="isBusy" @click="cancelRemoval">
                  {{ t('common.cancel') }}
                </button>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <div class="pending-invitations" aria-labelledby="pending-invitations-title">
        <h3 id="pending-invitations-title">{{ t('invitations.management.pendingTitle') }}</h3>
        <UiStateBlock
          v-if="invitations.length === 0"
          tone="empty"
          :title="t('invitations.management.empty.title')"
          :description="t('invitations.management.empty.description')"
        />
        <ul v-else class="person-list">
          <li v-for="invitation in invitations" :key="invitation.id" class="person-row">
            <div class="person-summary">
              <strong>{{ invitation.email }}</strong>
              <time :datetime="invitation.expiresAt">{{ invitationExpiry(invitation.expiresAt) }}</time>
            </div>
            <div class="person-actions">
              <button
                v-if="canResendInvitation"
                class="secondary-button"
                type="button"
                :aria-label="t('invitations.management.resendAriaLabel', { email: invitation.email })"
                :disabled="isBusy"
                @click="resendInvitation(invitation)"
              >
                {{
                  activeAction === `resend:${invitation.id}`
                    ? t('invitations.management.resending')
                    : t('invitations.management.resend')
                }}
              </button>
              <button
                class="secondary-button"
                type="button"
                :aria-label="t('invitations.management.cancelAriaLabel', { email: invitation.email })"
                :disabled="isBusy"
                @click="cancelInvitation(invitation)"
              >
                {{
                  activeAction === `cancel:${invitation.id}`
                    ? t('invitations.management.canceling')
                    : t('common.cancel')
                }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>

<style scoped>
@layer components {
  .family-access-section,
  .accepted-members,
  .pending-invitations,
  .person-summary,
  .removal-confirmation,
  .seat-summary {
    display: grid;
    gap: var(--space-3);
  }

  .family-access-section,
  .invite-form,
  .accepted-members,
  .pending-invitations,
  .person-list,
  .person-row,
  .person-summary,
  .person-actions,
  .removal-confirmation,
  .seat-summary {
    min-width: 0;
  }

  .family-access-section {
    overflow-wrap: anywhere;
  }

  .seat-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
  }

  .seat-summary div {
    border-top: var(--border-width) solid var(--color-border);
    padding-top: var(--space-3);
  }

  .seat-summary dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .seat-summary dd {
    margin: var(--space-1) 0 0;
    font-weight: var(--font-weight-strong);
  }

  .invite-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: var(--space-2) var(--space-3);
  }

  .invite-submit {
    width: fit-content;
  }

  .invite-help,
  .invite-form .field-error {
    grid-column: 1 / -1;
    margin: 0;
    font-size: var(--font-size-small);
  }

  .invite-help,
  .person-summary span,
  .person-summary time {
    color: var(--color-text-muted);
  }

  .accepted-members h3,
  .pending-invitations h3 {
    margin: 0;
  }

  .person-list {
    display: grid;
    gap: var(--space-2);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .person-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    border: var(--border-width) solid var(--color-border);
    border-radius: var(--radius-2);
    padding: var(--space-3);
    background: var(--color-surface);
  }

  .person-summary {
    min-width: 0;
    gap: var(--space-1);
  }

  .person-summary strong,
  .person-summary span {
    overflow-wrap: anywhere;
  }

  .person-summary span,
  .person-summary time {
    font-size: var(--font-size-small);
  }

  .person-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .removal-confirmation {
    max-width: 24rem;
    border-inline-start: var(--border-width-accent) solid var(--color-status-warning-text);
    padding-inline-start: var(--space-3);
  }

  .removal-confirmation p {
    margin: 0;
  }

  @media (width <= 620px) {
    .seat-summary,
    .invite-form,
    .person-row {
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
    }

    .invite-submit,
    .person-actions,
    .person-actions .secondary-button,
    .person-row > .secondary-button {
      width: 100%;
    }

    .person-actions {
      justify-content: stretch;
    }
  }
}
</style>
