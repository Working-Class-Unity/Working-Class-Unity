<script setup lang="ts">
import { isPublicModuleReady } from '#shared/module-states'
import { authClient } from '~/lib/auth-client'

type LinkedAccountSummary = {
  accountId: string
  providerId: string
}

const googleProviderName = 'Google'
const { t } = useI18n()
const { data: session, error: sessionError } = await useAppSession()

if (!sessionError.value && !session.value?.user) {
  await navigateTo('/login', { redirectCode: 302 })
}

const { data: baseline } = await useFetch('/api/baseline')
const linkedAccounts = ref<LinkedAccountSummary[]>([])
const linkedAccountsError = ref('')
const linkedAccountsStatus = ref('')
const linkedAccountsLoaded = ref(false)
const isLoadingLinkedAccounts = ref(false)
const unlinkingGoogleAccountId = ref('')

const user = computed(() => session.value?.user ?? null)
const billingReady = computed(() => isPublicModuleReady(baseline.value?.modules, 'billing'))
const googleReady = computed(() => baseline.value?.socialProviders.google === 'ready')
const googleAccounts = computed(() => linkedAccounts.value.filter((account) => account.providerId === 'google'))
const googleLinked = computed(() => googleAccounts.value.length > 0)

onMounted(() => {
  if (user.value && googleReady.value) void loadLinkedAccounts()
})

useHead(() => ({
  title: t('metadata.account.title')
}))

async function loadLinkedAccounts(): Promise<boolean> {
  if (!user.value || !googleReady.value || isLoadingLinkedAccounts.value) return false

  linkedAccountsError.value = ''
  linkedAccountsStatus.value = ''
  isLoadingLinkedAccounts.value = true

  try {
    const result = await authClient.listAccounts()

    if (result.error) {
      linkedAccountsError.value = t('account.linkedAccounts.loadFailed')
      return false
    }

    linkedAccounts.value = (result.data ?? []).map((account) => ({
      accountId: account.accountId,
      providerId: account.providerId
    }))
    return true
  } catch {
    linkedAccountsError.value = t('account.linkedAccounts.loadFailed')
    return false
  } finally {
    linkedAccountsLoaded.value = true
    isLoadingLinkedAccounts.value = false
  }
}

async function unlinkGoogle(accountId: string) {
  if (!googleAccounts.value.some((account) => account.accountId === accountId) || unlinkingGoogleAccountId.value) {
    return
  }

  linkedAccountsError.value = ''
  linkedAccountsStatus.value = ''
  unlinkingGoogleAccountId.value = accountId

  try {
    const result = await authClient.unlinkAccount({ providerId: 'google', accountId })

    if (result.error) {
      linkedAccountsError.value = t('account.linkedAccounts.removeFailed', { provider: googleProviderName })
      return
    }

    if (await loadLinkedAccounts()) {
      linkedAccountsStatus.value = t('account.linkedAccounts.removed', { provider: googleProviderName })
    }
  } catch {
    linkedAccountsError.value = t('account.linkedAccounts.removeFailed', { provider: googleProviderName })
  } finally {
    unlinkingGoogleAccountId.value = ''
  }
}

function accountDeleted() {
  session.value = null
}
</script>

<template>
  <AppPage class="account-page">
    <section class="panel account-panel" aria-labelledby="account-title">
      <div class="panel-heading">
        <p class="eyebrow">{{ t('account.eyebrow') }}</p>
        <h1 id="account-title">{{ t('account.title') }}</h1>
      </div>

      <UiStateBlock
        v-if="sessionError"
        tone="error"
        :title="t('account.sessionUnavailable.title')"
        :description="t('common.sessionVerificationFailed')"
      />
      <UiStateBlock
        v-else-if="!user"
        tone="loading"
        :title="t('account.loginRequired.title')"
        :description="t('account.loginRequired.description')"
      />

      <div v-else class="account-content">
        <section aria-labelledby="identity-title">
          <h2 id="identity-title">{{ t('account.identity.title') }}</h2>
          <dl class="identity-list">
            <div>
              <dt>{{ t('common.name') }}</dt>
              <dd>{{ user.name || t('account.identity.noName') }}</dd>
            </div>
            <div>
              <dt>{{ t('common.email') }}</dt>
              <dd>{{ user.email }}</dd>
            </div>
          </dl>
        </section>

        <FamilyAccessSection v-if="billingReady" />

        <section v-if="billingReady" class="account-section" aria-labelledby="billing-title">
          <div>
            <h2 id="billing-title">{{ t('account.billing.title') }}</h2>
            <p>{{ t('account.billing.description') }}</p>
          </div>
          <NuxtLink class="secondary-button billing-link" to="/account/billing">
            {{ t('account.billing.view') }}
          </NuxtLink>
        </section>

        <section class="account-section" aria-labelledby="linked-accounts-title">
          <div>
            <h2 id="linked-accounts-title">{{ t('account.linkedAccounts.title') }}</h2>
            <p v-if="!googleReady">
              {{ t('account.linkedAccounts.notConfigured', { provider: googleProviderName }) }}
            </p>
            <p v-else-if="isLoadingLinkedAccounts || !linkedAccountsLoaded">
              {{ t('account.linkedAccounts.loading') }}
            </p>
            <p v-else-if="googleLinked">
              {{ t('account.linkedAccounts.linked', { provider: googleProviderName }) }}
            </p>
            <p v-else>{{ t('account.linkedAccounts.notLinked', { provider: googleProviderName }) }}</p>
          </div>

          <AppStatusMessage v-if="linkedAccountsError" tone="error">
            {{ linkedAccountsError }}
          </AppStatusMessage>
          <AppStatusMessage v-else-if="linkedAccountsStatus" tone="success">
            {{ linkedAccountsStatus }}
          </AppStatusMessage>

          <div v-if="googleReady && googleLinked" class="linked-account-actions">
            <button
              v-for="(account, index) in googleAccounts"
              :key="account.accountId"
              class="secondary-button"
              type="button"
              :disabled="Boolean(unlinkingGoogleAccountId)"
              @click="unlinkGoogle(account.accountId)"
            >
              {{
                unlinkingGoogleAccountId === account.accountId
                  ? t('account.linkedAccounts.removing', { provider: googleProviderName })
                  : googleAccounts.length > 1
                    ? t('account.linkedAccounts.removeNumbered', {
                        provider: googleProviderName,
                        number: index + 1
                      })
                    : t('account.linkedAccounts.removeOne', { provider: googleProviderName })
              }}
            </button>
          </div>

          <p v-else-if="googleReady && linkedAccountsLoaded && !linkedAccountsError" class="account-note">
            {{ t('account.linkedAccounts.addInstructions', { provider: googleProviderName }) }}
          </p>
        </section>

        <AccountDeletionSection @deleted="accountDeleted" />
      </div>
    </section>
  </AppPage>
</template>

<style scoped>
@layer components {
  .account-page {
    place-items: start center;
    padding-bottom: var(--space-6);
  }

  .account-panel {
    display: grid;
    min-width: 0;
    width: min(100%, 760px);
    gap: var(--space-4);
    padding: var(--space-5);
  }

  .account-content,
  .account-section,
  .identity-list,
  .linked-account-actions {
    display: grid;
    min-width: 0;
    gap: var(--space-3);
  }

  .account-content > section + section {
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-4);
  }

  .account-content h2 {
    font-size: 1.2rem;
  }

  .account-content p {
    margin: var(--space-1) 0 0;
    color: var(--color-text-muted);
  }

  .identity-list {
    margin: 0;
  }

  .identity-list div {
    min-width: 0;
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-3);
  }

  .identity-list dt {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
  }

  .identity-list dd {
    overflow-wrap: anywhere;
    margin: var(--space-1) 0 0;
    font-weight: var(--font-weight-strong);
  }

  .account-note {
    font-size: 0.9rem;
  }

  .sign-out-button {
    width: fit-content;
  }

  .billing-link {
    width: fit-content;
  }
}
</style>
