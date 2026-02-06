<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'

const { locale, locales } = useI18n()
const switchLocalePath = useSwitchLocalePath()
const logoSrc = ref('/logo_dark.svg')

const route = useRoute()

const mobileMenuOpen = ref(false)
const kyrMenuOpen = ref(false)
const languageMenuOpen = ref(false)

const mobileDropdownRef = ref<HTMLElement | null>(null)
const mobileMenuButtonRef = ref<HTMLButtonElement | null>(null)
const kyrDropdownRef = ref<HTMLElement | null>(null)
const kyrMenuButtonRef = ref<HTMLButtonElement | null>(null)
const languageDropdownRef = ref<HTMLElement | null>(null)
const languageMenuButtonRef = ref<HTMLButtonElement | null>(null)

const normalizePath = (path: string) => path.replace(/\/+$/, '')

const isRouteMatch = (target: string) => {
  const current = normalizePath(route.path)
  const normalizedTarget = normalizePath(target.startsWith('/') ? target : `/${target}`)

  return current === normalizedTarget || current.endsWith(normalizedTarget)
}

const isKyrRoute = computed(() => (
  route.path.includes('/kyr') ||
  route.path.includes('/know-your-rights') ||
  route.path.includes('/check-in-coverage') ||
  route.path.endsWith('/checkinsupport')
))

const desktopLinkClass = (target: string) => [
  'font-semibold px-3 py-2 rounded-md border transition-colors duration-150',
  isRouteMatch(target)
    ? 'border-primary/40 bg-primary/20 text-secondary'
    : 'border-transparent text-base-content hover:text-base-content hover:bg-primary/10',
]

const mobileLinkClass = (target: string) => [
  'font-semibold rounded-md border transition-colors duration-150',
  isRouteMatch(target)
    ? 'border-primary/40 bg-primary/20 text-secondary'
    : 'border-transparent text-base-content hover:text-base-content hover:bg-primary/10',
]

// Function to update logo based on theme
const updateLogo = () => {
  // Check for data-theme attribute or system preference
  // Note: DaisyUI v5 themes might just use CSS variables, but manual toggle usually sets data-theme.
  // We check if the active theme is wcudark to decide which logo to show.
  const theme = document.documentElement.getAttribute('data-theme') || 
                (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'wcudark' : 'wculight')
  
  // wcudark theme (dark background) -> use logo_light.svg
  // wculight theme (light background) -> use logo_dark.svg
  logoSrc.value = theme === 'wcudark'
    ? '/logo_light.svg'
    : '/logo_dark.svg'
}

let observer: MutationObserver | null = null

const closeAllMenus = () => {
  mobileMenuOpen.value = false
  kyrMenuOpen.value = false
  languageMenuOpen.value = false
}

const toggleMobileMenu = () => {
  const next = !mobileMenuOpen.value
  closeAllMenus()
  mobileMenuOpen.value = next
}

const toggleKyrMenu = () => {
  const next = !kyrMenuOpen.value
  closeAllMenus()
  kyrMenuOpen.value = next
}

const toggleLanguageMenu = () => {
  const next = !languageMenuOpen.value
  closeAllMenus()
  languageMenuOpen.value = next
}

watch(
  () => route.fullPath,
  () => {
    closeAllMenus()
  }
)

const onDocumentClick = (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Node)) return

  if (mobileMenuOpen.value && mobileDropdownRef.value && !mobileDropdownRef.value.contains(target)) {
    mobileMenuOpen.value = false
  }

  if (kyrMenuOpen.value && kyrDropdownRef.value && !kyrDropdownRef.value.contains(target)) {
    kyrMenuOpen.value = false
  }

  if (languageMenuOpen.value && languageDropdownRef.value && !languageDropdownRef.value.contains(target)) {
    languageMenuOpen.value = false
  }
}

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return

  if (mobileMenuOpen.value) {
    mobileMenuOpen.value = false
    mobileMenuButtonRef.value?.focus()
    return
  }

  if (kyrMenuOpen.value) {
    kyrMenuOpen.value = false
    kyrMenuButtonRef.value?.focus()
    return
  }

  if (languageMenuOpen.value) {
    languageMenuOpen.value = false
    languageMenuButtonRef.value?.focus()
  }
}

onMounted(() => {
  updateLogo()
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateLogo)
  
  // Listen for manual theme changes on html element
  observer = new MutationObserver(updateLogo)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onDocumentKeydown)
})

onUnmounted(() => {
  window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', updateLogo)
  if (observer) observer.disconnect()

  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <nav class="sticky top-0 z-50 border-b border-base-content/15 bg-base-100/95 backdrop-blur-md">
    <div class="h-1 solidarity-stripe" aria-hidden="true"></div>
    <div class="navbar max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">
      <div class="navbar-start">
        <!-- Mobile Dropdown -->
        <div ref="mobileDropdownRef" class="dropdown" :class="{ 'dropdown-open': mobileMenuOpen }">
          <button
            ref="mobileMenuButtonRef"
            type="button"
            :aria-label="mobileMenuOpen ? $t('nav.a11y.close_menu') : $t('nav.a11y.open_menu')"
            aria-haspopup="true"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-nav-menu"
            class="btn btn-ghost lg:hidden text-base-content hover:text-secondary hover:bg-primary/10"
            @click="toggleMobileMenu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16" />
            </svg>
          </button>
          <ul id="mobile-nav-menu" class="menu menu-sm dropdown-content mt-3 z-50 p-2 shadow-lg bg-base-100 rounded-box w-60 text-base-content border border-secondary/25">
            <li>
              <NuxtLinkLocale
                to="calendar"
                :class="mobileLinkClass('/calendar')"
                :aria-current="isRouteMatch('/calendar') ? 'page' : undefined"
                @click="mobileMenuOpen = false"
              >
                {{ $t('nav.calendar') }}
              </NuxtLinkLocale>
            </li>
            <li>
              <details>
                <summary
                  class="font-semibold rounded-md border transition-colors duration-150"
                  :class="isKyrRoute ? 'border-primary/40 bg-primary/20 text-secondary' : 'border-transparent text-base-content hover:text-base-content hover:bg-primary/10'"
                >
                  {{ $t('nav.kyr') }}
                </summary>
                <ul class="p-2">
                  <li>
                    <NuxtLinkLocale
                      to="kyr"
                      :class="mobileLinkClass('/kyr')"
                      :aria-current="isRouteMatch('/kyr') ? 'page' : undefined"
                      @click="mobileMenuOpen = false"
                    >
                      {{ $t('nav.resources') }}
                    </NuxtLinkLocale>
                  </li>
                  <li>
                    <NuxtLinkLocale
                      to="check-in-coverage"
                      :class="mobileLinkClass('/check-in-coverage')"
                      :aria-current="isRouteMatch('/check-in-coverage') ? 'page' : undefined"
                      @click="mobileMenuOpen = false"
                    >
                      {{ $t('nav.coverage') }}
                    </NuxtLinkLocale>
                  </li>
                </ul>
              </details>
            </li>
            <li>
              <NuxtLinkLocale
                to="campaigns"
                :class="mobileLinkClass('/campaigns')"
                :aria-current="isRouteMatch('/campaigns') ? 'page' : undefined"
                @click="mobileMenuOpen = false"
              >
                {{ $t('nav.campaigns') }}
              </NuxtLinkLocale>
            </li>
            <li>
              <a
                href="https://chat.workingclassunity.com/"
                target="_blank"
                rel="noopener noreferrer"
                class="font-semibold rounded-md border border-transparent text-base-content hover:text-base-content hover:bg-primary/10 transition-colors duration-150"
                @click="mobileMenuOpen = false"
              >
                {{ $t('nav.forum') }}
              </a>
            </li>
            <li>
              <NuxtLinkLocale
                to="about"
                :class="mobileLinkClass('/about')"
                :aria-current="isRouteMatch('/about') ? 'page' : undefined"
                @click="mobileMenuOpen = false"
              >
                {{ $t('nav.about') }}
              </NuxtLinkLocale>
            </li>
          </ul>
        </div>
        <!-- Logo -->
        <NuxtLinkLocale to="/" class="h-auto py-2" @click="closeAllMenus">
          <ClientOnly>
            <img :src="logoSrc" :alt="$t('logo_alt')" class="h-16 w-auto" />
            <template #fallback>
              <!-- Placeholder during SSR to prevent hydration mismatch -->
              <div class="h-16 w-32 bg-base-content/10 rounded animate-pulse"></div>
            </template>
          </ClientOnly>
        </NuxtLinkLocale>
      </div>
      
      <!-- Desktop Menu -->
      <div class="navbar-center hidden lg:flex">
        <ul class="menu menu-horizontal gap-1 items-center">
          <li>
            <NuxtLinkLocale
              to="calendar"
              :class="desktopLinkClass('/calendar')"
              :aria-current="isRouteMatch('/calendar') ? 'page' : undefined"
            >
              {{ $t('nav.calendar') }}
            </NuxtLinkLocale>
          </li>
          <li>
            <div ref="kyrDropdownRef" class="dropdown dropdown-bottom bg-transparent! hover:bg-transparent!" :class="{ 'dropdown-open': kyrMenuOpen }">
              <button
                ref="kyrMenuButtonRef"
                type="button"
                aria-haspopup="true"
                :aria-expanded="kyrMenuOpen"
                aria-controls="kyr-nav-menu"
                class="font-semibold px-3 py-2 rounded-md border transition-colors duration-150"
                :class="isKyrRoute ? 'border-primary/40 bg-primary/20 text-secondary' : 'border-transparent text-base-content hover:text-base-content hover:bg-primary/10'"
                @click="toggleKyrMenu"
              >
                {{ $t('nav.kyr') }}
              </button>
              <ul id="kyr-nav-menu" class="dropdown-content menu bg-base-100 text-base-content rounded-box z-50 w-60 p-2 shadow-lg border border-secondary/25">
                <li>
                  <NuxtLinkLocale
                    to="kyr"
                    :class="mobileLinkClass('/kyr')"
                    :aria-current="isRouteMatch('/kyr') ? 'page' : undefined"
                    @click="kyrMenuOpen = false"
                  >
                    {{ $t('nav.resources') }}
                  </NuxtLinkLocale>
                </li>
                <li>
                  <NuxtLinkLocale
                    to="check-in-coverage"
                    :class="mobileLinkClass('/check-in-coverage')"
                    :aria-current="isRouteMatch('/check-in-coverage') ? 'page' : undefined"
                    @click="kyrMenuOpen = false"
                  >
                    {{ $t('nav.coverage') }}
                  </NuxtLinkLocale>
                </li>
              </ul>
            </div>
          </li>
          <li>
            <NuxtLinkLocale
              to="campaigns"
              :class="desktopLinkClass('/campaigns')"
              :aria-current="isRouteMatch('/campaigns') ? 'page' : undefined"
            >
              {{ $t('nav.campaigns') }}
            </NuxtLinkLocale>
          </li>
          <li>
            <a
              href="https://chat.workingclassunity.com/"
              target="_blank"
              rel="noopener noreferrer"
              class="font-semibold px-3 py-2 rounded-md border border-transparent text-base-content hover:text-base-content hover:bg-primary/10 transition-colors duration-150"
            >
              {{ $t('nav.forum') }}
            </a>
          </li>
          <li>
            <NuxtLinkLocale
              to="about"
              :class="desktopLinkClass('/about')"
              :aria-current="isRouteMatch('/about') ? 'page' : undefined"
            >
              {{ $t('nav.about') }}
            </NuxtLinkLocale>
          </li>
        </ul>
      </div>
      
      <div class="navbar-end gap-3">
        <!-- Vertical Divider -->
        <div class="hidden lg:block h-6 w-px bg-secondary/20"></div>
        
        <!-- Language Switcher -->
        <div ref="languageDropdownRef" class="dropdown dropdown-end" :class="{ 'dropdown-open': languageMenuOpen }">
          <button
            ref="languageMenuButtonRef"
            type="button"
            :aria-label="languageMenuOpen ? $t('nav.a11y.close_language') : $t('nav.a11y.select_language')"
            aria-haspopup="true"
            :aria-expanded="languageMenuOpen"
            aria-controls="language-menu"
            class="btn btn-ghost btn-circle text-base-content hover:text-secondary hover:bg-primary/10 transition-colors duration-150"
            @click="toggleLanguageMenu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
          </button>
          <ul id="language-menu" class="menu menu-sm dropdown-content mt-3 z-50 p-2 shadow-lg bg-base-100 rounded-box w-52 text-base-content border border-secondary/25">
            <li v-for="l in locales" :key="l.code">
              <NuxtLink
                :to="switchLocalePath(l.code)"
                :class="[
                  'font-semibold rounded-md border transition-colors duration-150',
                  locale === l.code
                    ? 'border-primary/40 bg-primary/20 text-secondary'
                    : 'border-transparent text-base-content hover:text-base-content hover:bg-primary/10',
                ]"
                @click="languageMenuOpen = false"
              >
                {{ l.name }}
              </NuxtLink>
            </li>
          </ul>
        </div>

        <NuxtLinkLocale to="join" class="btn btn-accent btn-sm border border-accent/80 text-sm font-semibold tracking-tight hover:brightness-110 transition-colors duration-150">
          {{ $t('nav.join') }}
        </NuxtLinkLocale>
      </div>
    </div>
  </nav>
</template>
