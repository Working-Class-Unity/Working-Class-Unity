<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'

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
  <nav class="sticky top-0 z-50 bg-base-100/80 backdrop-blur-md border-b border-base-content/10">
    <div class="navbar max-w-7xl mx-auto w-full">
      <div class="navbar-start">
        <!-- Mobile Dropdown -->
        <div ref="mobileDropdownRef" class="dropdown" :class="{ 'dropdown-open': mobileMenuOpen }">
          <button
            ref="mobileMenuButtonRef"
            type="button"
            aria-label="Open navigation menu"
            aria-haspopup="true"
            :aria-expanded="mobileMenuOpen"
            aria-controls="mobile-nav-menu"
            class="btn btn-ghost lg:hidden text-base-content/70 hover:text-base-content hover:bg-base-content/5"
            @click="toggleMobileMenu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h8m-8 6h16" />
            </svg>
          </button>
          <ul id="mobile-nav-menu" class="menu menu-sm dropdown-content mt-3 z-50 p-2 shadow-lg bg-base-100 rounded-box w-52 text-base-content">
            <li><NuxtLinkLocale to="calendar" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="mobileMenuOpen = false">{{ $t('nav.calendar') }}</NuxtLinkLocale></li>
            <li>
              <details>
                <summary class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300">{{ $t('nav.kyr') }}</summary>
                <ul class="p-2">
                  <li><NuxtLinkLocale to="kyr" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="mobileMenuOpen = false">{{ $t('nav.resources') }}</NuxtLinkLocale></li>
                  <li><NuxtLinkLocale to="check-in-coverage" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="mobileMenuOpen = false">{{ $t('nav.coverage') }}</NuxtLinkLocale></li>
                </ul>
              </details>
            </li>
            <li><NuxtLinkLocale to="campaigns" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="mobileMenuOpen = false">{{ $t('nav.campaigns') }}</NuxtLinkLocale></li>
            <li><a href="https://chat.workingclassunity.com/" target="_blank" rel="noopener noreferrer" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="mobileMenuOpen = false">{{ $t('nav.forum') }}</a></li>
            <li><NuxtLinkLocale to="about" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="mobileMenuOpen = false">{{ $t('nav.about') }}</NuxtLinkLocale></li>
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
          <li><NuxtLinkLocale to="calendar" class="text-base-content/70 font-medium px-3 py-2 rounded-lg hover:text-base-content hover:bg-base-content/5 transition-all duration-300">{{ $t('nav.calendar') }}</NuxtLinkLocale></li>
          <li>
            <div ref="kyrDropdownRef" class="dropdown dropdown-bottom bg-transparent! hover:bg-transparent!" :class="{ 'dropdown-open': kyrMenuOpen }">
              <button
                ref="kyrMenuButtonRef"
                type="button"
                aria-haspopup="true"
                :aria-expanded="kyrMenuOpen"
                aria-controls="kyr-nav-menu"
                class="text-base-content/70 font-medium px-3 py-2 rounded-lg hover:text-base-content hover:bg-base-content/5 transition-all duration-300"
                @click="toggleKyrMenu"
              >
                {{ $t('nav.kyr') }}
              </button>
              <ul id="kyr-nav-menu" class="dropdown-content menu bg-base-100 text-base-content rounded-box z-50 w-52 p-2 shadow-lg border border-base-content/10">
                <li><NuxtLinkLocale to="kyr" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="kyrMenuOpen = false">{{ $t('nav.resources') }}</NuxtLinkLocale></li>
                <li><NuxtLinkLocale to="check-in-coverage" class="text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300" @click="kyrMenuOpen = false">{{ $t('nav.coverage') }}</NuxtLinkLocale></li>
              </ul>
            </div>
          </li>
          <li><NuxtLinkLocale to="campaigns" class="text-base-content/70 font-medium px-3 py-2 rounded-lg hover:text-base-content hover:bg-base-content/5 transition-all duration-300">{{ $t('nav.campaigns') }}</NuxtLinkLocale></li>
          <li><a href="https://chat.workingclassunity.com/" target="_blank" rel="noopener noreferrer" class="text-base-content/70 font-medium px-3 py-2 rounded-lg hover:text-base-content hover:bg-base-content/5 transition-all duration-300">{{ $t('nav.forum') }}</a></li>
          <li><NuxtLinkLocale to="about" class="text-base-content/70 font-medium px-3 py-2 rounded-lg hover:text-base-content hover:bg-base-content/5 transition-all duration-300">{{ $t('nav.about') }}</NuxtLinkLocale></li>
        </ul>
      </div>
      
      <div class="navbar-end gap-3">
        <!-- Vertical Divider -->
        <div class="hidden lg:block h-6 w-px bg-base-content/10"></div>
        
        <!-- Language Switcher -->
        <div ref="languageDropdownRef" class="dropdown dropdown-end" :class="{ 'dropdown-open': languageMenuOpen }">
          <button
            ref="languageMenuButtonRef"
            type="button"
            aria-label="Select language"
            aria-haspopup="true"
            :aria-expanded="languageMenuOpen"
            aria-controls="language-menu"
            class="btn btn-ghost btn-circle text-base-content/70 hover:text-base-content hover:bg-base-content/5 transition-all duration-300"
            @click="toggleLanguageMenu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
            </svg>
          </button>
          <ul id="language-menu" class="menu menu-sm dropdown-content mt-3 z-50 p-2 shadow-lg bg-base-100 rounded-box w-52 text-base-content border border-base-content/10">
            <li v-for="l in locales" :key="l.code">
              <NuxtLink :to="switchLocalePath(l.code)" :class="['text-base-content/70 font-medium hover:text-base-content hover:bg-base-content/5 transition-all duration-300', { 'text-base-content bg-base-content/5': locale === l.code }]" @click="languageMenuOpen = false">
                {{ l.name }}
              </NuxtLink>
            </li>
          </ul>
        </div>

        <NuxtLinkLocale to="join" class="btn btn-accent btn-sm border border-accent/50 hover:shadow-lg hover:shadow-accent/20 text-sm font-semibold tracking-tight transition-all duration-300">{{ $t('nav.join') }}</NuxtLinkLocale>
      </div>
    </div>
  </nav>
</template>
