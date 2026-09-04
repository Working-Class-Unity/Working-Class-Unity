<script setup lang="ts">
import {
  ConfigProvider,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { appUserIdentity, type AppSessionUser } from '~/composables/useAppSession'
import { authClient } from '~/lib/auth-client'

const props = defineProps<{
  user: AppSessionUser
}>()

const emit = defineEmits<{
  signedOut: []
}>()

const route = useRoute()
const { t } = useI18n()
const open = ref(false)
const isSigningOut = ref(false)
const signOutError = ref('')
const identity = computed(() => appUserIdentity(props.user))
const secondaryIdentity = computed(() => {
  if (!props.user.displayName) return null
  return props.user.email ?? props.user.phoneNumber
})
const triggerLabel = computed(() => t('account.menu.triggerLabel', { identity: identity.value }))
const nuxtUseId = () => useId()

watch(
  () => route.fullPath,
  () => {
    open.value = false
  }
)

async function signOut(event: Event) {
  event.preventDefault()
  if (isSigningOut.value) return

  signOutError.value = ''
  isSigningOut.value = true

  try {
    const result = await authClient.signOut()

    if (result.error) {
      signOutError.value = 'account.menu.signOutError'
      return
    }

    open.value = false
    emit('signedOut')
    await navigateTo({ path: '/login', query: { status: 'signed-out' } })
  } catch {
    signOutError.value = 'account.menu.signOutError'
  } finally {
    isSigningOut.value = false
  }
}
</script>

<template>
  <ConfigProvider :use-id="nuxtUseId">
    <DropdownMenuRoot v-model:open="open" :modal="false">
      <DropdownMenuTrigger as-child>
        <button class="account-menu-trigger" type="button" :aria-label="triggerLabel">
          <span>{{ t('account.menu.account') }}</span>
          <span aria-hidden="true">&#9662;</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuPortal>
        <DropdownMenuContent
          class="account-menu-content"
          align="end"
          :side-offset="8"
          :collision-padding="10"
          :prioritize-position="true"
        >
          <DropdownMenuLabel class="account-menu-identity">
            <strong>{{ identity }}</strong>
            <span v-if="secondaryIdentity">{{ secondaryIdentity }}</span>
          </DropdownMenuLabel>

          <DropdownMenuSeparator class="account-menu-separator" />

          <DropdownMenuItem as-child>
            <NuxtLink class="account-menu-item" to="/account">{{ t('account.menu.account') }}</NuxtLink>
          </DropdownMenuItem>

          <DropdownMenuSeparator class="account-menu-separator" />

          <DropdownMenuItem as-child :disabled="isSigningOut" @select="signOut">
            <button
              class="account-menu-item account-menu-command"
              type="button"
              :disabled="isSigningOut"
              :aria-busy="isSigningOut ? 'true' : undefined"
            >
              {{ isSigningOut ? t('account.menu.signingOut') : t('account.menu.signOut') }}
            </button>
          </DropdownMenuItem>

          <DropdownMenuLabel v-if="signOutError" class="account-menu-error" role="alert">
            {{ t(signOutError) }}
          </DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </ConfigProvider>
</template>

<style scoped>
@layer components {
  .account-menu-trigger,
  :deep(.account-menu-item) {
    display: inline-flex;
    min-block-size: var(--control-min-block-size);
    min-inline-size: var(--control-min-inline-size);
    align-items: center;
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-2);
    color: var(--color-text-muted);
    background: transparent;
    font: inherit;
    font-weight: var(--font-weight-strong);
  }

  .account-menu-trigger {
    justify-content: center;
    gap: var(--space-1);
    padding: 7px 10px;
  }

  .account-menu-trigger:hover,
  .account-menu-trigger[data-state='open'] {
    border-color: var(--color-border);
    color: var(--color-text);
    background: var(--color-surface-subtle);
  }

  :deep(.account-menu-content) {
    z-index: var(--z-menu);
    display: grid;
    min-inline-size: 0;
    inline-size: min(19rem, var(--reka-dropdown-menu-content-available-width));
    max-inline-size: var(--reka-dropdown-menu-content-available-width);
    max-block-size: min(24rem, var(--reka-dropdown-menu-content-available-height));
    overflow: auto;
    border: var(--border-width) solid var(--color-control-border);
    border-radius: var(--radius-2);
    padding: var(--space-2);
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
  }

  :deep(.account-menu-identity),
  :deep(.account-menu-error) {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    overflow-wrap: anywhere;
  }

  :deep(.account-menu-identity) {
    display: grid;
    gap: var(--space-1);
  }

  :deep(.account-menu-identity strong),
  :deep(.account-menu-identity span) {
    min-inline-size: 0;
  }

  :deep(.account-menu-identity span) {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
  }

  :deep(.account-menu-separator) {
    block-size: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--color-border);
  }

  :deep(.account-menu-item) {
    inline-size: 100%;
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    text-align: start;
    text-decoration: none;
  }

  :deep(.account-menu-item[data-highlighted]),
  :deep(.account-menu-item:focus-visible) {
    border-color: var(--color-action);
    color: var(--color-text);
    background: var(--color-action-soft);
  }

  :deep(.account-menu-command:disabled),
  :deep(.account-menu-item[data-disabled]) {
    cursor: progress;
    opacity: 0.62;
  }

  :deep(.account-menu-command) {
    cursor: pointer;
  }

  :deep(.account-menu-error) {
    margin-block-start: var(--space-1);
    border-inline-start: var(--border-width-accent) solid var(--color-status-error-text);
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-strong);
  }
}
</style>
