<script setup lang="ts">
import {
  ConfigProvider,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import type { AppSessionUser } from '~/composables/useAppSession'
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
const triggerElement = ref<HTMLButtonElement | null>(null)
const isSigningOut = ref(false)
const signOutError = ref('')
const triggerLabel = computed(() => t('account.menu.triggerLabel', { identity: props.user.name }))
const nuxtUseId = () => useId()
const menuContentStyle = {
  minWidth: '0',
  width: 'min(19rem, calc(100vw - (2 * var(--content-gutter-compact))))',
  maxWidth: 'min(calc(100vw - (2 * var(--content-gutter-compact))), var(--reka-dropdown-menu-content-available-width))'
}

watch(
  () => route.fullPath,
  () => {
    open.value = false
  }
)

function restoreTriggerFocus(event: Event) {
  event.preventDefault()
  requestAnimationFrame(() => triggerElement.value?.focus())
}

async function signOut(event: Event) {
  event.preventDefault()
  if (isSigningOut.value) return

  signOutError.value = ''
  isSigningOut.value = true

  try {
    const result = await authClient.signOut()

    if (result.error) {
      signOutError.value = t('account.menu.signOutError')
      return
    }

    open.value = false
    emit('signedOut')
    await navigateTo({ path: '/login', query: { status: 'signed-out' } })
  } catch {
    signOutError.value = t('account.menu.signOutError')
  } finally {
    isSigningOut.value = false
  }
}
</script>

<template>
  <ConfigProvider :use-id="nuxtUseId">
    <DropdownMenuRoot v-model:open="open" :modal="false">
      <DropdownMenuTrigger as-child>
        <button ref="triggerElement" class="account-menu-trigger" type="button" :aria-label="triggerLabel">
          <span>{{ t('account.menu.account') }}</span>
          <span aria-hidden="true">&#9662;</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        class="account-menu-content"
        align="end"
        :side-offset="8"
        :collision-padding="10"
        :prioritize-position="true"
        :style="menuContentStyle"
        @close-auto-focus="restoreTriggerFocus"
      >
        <DropdownMenuLabel class="account-menu-identity">
          <strong>{{ props.user.name }}</strong>
          <span>{{ props.user.email }}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator class="account-menu-separator" />

        <DropdownMenuItem as-child>
          <NuxtLink class="account-menu-item" to="/account">{{ t('account.menu.account') }}</NuxtLink>
        </DropdownMenuItem>

        <DropdownMenuSeparator class="account-menu-separator" />

        <DropdownMenuItem as-child @select="signOut">
          <button
            class="account-menu-item account-menu-command"
            type="button"
            :aria-disabled="isSigningOut"
            :aria-busy="isSigningOut"
          >
            {{ isSigningOut ? t('account.menu.signingOut') : t('account.menu.signOut') }}
          </button>
        </DropdownMenuItem>

        <DropdownMenuLabel v-if="signOutError" class="account-menu-error" role="alert">
          {{ signOutError }}
        </DropdownMenuLabel>
      </DropdownMenuContent>
    </DropdownMenuRoot>
  </ConfigProvider>
</template>

<style scoped>
@layer components {
  .account-menu-trigger,
  .account-menu-item {
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

  .account-menu-content {
    z-index: 10;
    display: grid;
    min-inline-size: 0;
    inline-size: min(19rem, calc(100vw - (2 * var(--content-gutter-compact))));
    max-inline-size: min(
      calc(100vw - (2 * var(--content-gutter-compact))),
      var(--reka-dropdown-menu-content-available-width)
    );
    max-block-size: min(24rem, var(--reka-dropdown-menu-content-available-height));
    overflow: auto;
    border: var(--border-width) solid var(--color-control-border);
    border-radius: var(--radius-2);
    padding: var(--space-2);
    color: var(--color-text);
    background: var(--color-surface);
    box-shadow: var(--shadow-panel);
  }

  .account-menu-identity,
  .account-menu-error {
    min-width: 0;
    padding: var(--space-2) var(--space-3);
    overflow-wrap: anywhere;
  }

  .account-menu-identity {
    display: grid;
    gap: var(--space-1);
  }

  .account-menu-identity strong,
  .account-menu-identity span {
    min-inline-size: 0;
  }

  .account-menu-identity span {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
  }

  .account-menu-separator {
    block-size: var(--border-width);
    margin: var(--space-1) 0;
    background: var(--color-border);
  }

  .account-menu-item {
    inline-size: 100%;
    justify-content: flex-start;
    padding: var(--space-2) var(--space-3);
    text-align: start;
    text-decoration: none;
  }

  .account-menu-item[data-highlighted],
  .account-menu-item:focus-visible {
    border-color: var(--color-action);
    color: var(--color-text);
    background: var(--color-action-soft);
  }

  .account-menu-command[aria-disabled='true'] {
    cursor: progress;
    opacity: 0.62;
  }

  .account-menu-command {
    cursor: pointer;
  }

  .account-menu-error {
    margin-block-start: var(--space-1);
    border-inline-start: var(--border-width-accent) solid var(--color-status-error-text);
    color: var(--color-status-error-text);
    background: var(--color-status-error-surface);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-strong);
  }
}
</style>
