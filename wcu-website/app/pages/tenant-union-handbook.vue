<script setup lang="ts">
const { t } = useI18n()

// =============================================================================
// SEO Meta Tags
// =============================================================================
useHead({
  title: 'Tenant Union Handbook',
})

useSeoMeta({
  description: 'Complete guide for tenants in San Joaquin County covering your rights, paying rent, reporting violations, evictions, and more.',
  ogType: 'website',
  ogTitle: 'Tenant Union Handbook | Working Class Unity',
  ogDescription: 'Complete guide for tenants in San Joaquin County covering your rights, paying rent, reporting violations, evictions, and more.',
  ogImage: 'https://workingclassunity.com/logo_dark.svg',
  ogUrl: 'https://workingclassunity.com/tenant-union-handbook',
  twitterCard: 'summary_large_image',
  twitterTitle: 'Tenant Union Handbook | Working Class Unity',
  twitterDescription: 'Complete guide for tenants in San Joaquin County covering your rights, paying rent, reporting violations, evictions, and more.',
})

// =============================================================================
// Schema.org Structured Data
// =============================================================================
useSchemaOrg([
  defineWebPage({
    name: 'Tenant Union Handbook',
    description: 'Complete guide for tenants in San Joaquin County covering your rights, paying rent, reporting violations, evictions, and more.',
    url: 'https://workingclassunity.com/tenant-union-handbook',
  }),
  defineBreadcrumb({
    itemListElement: [
      { name: 'Home', item: '/' },
      { name: 'Tenant Union Handbook' },
    ],
  }),
])

// =============================================================================
// Table of Contents Data
// =============================================================================
interface Section {
  id: string
  title: string
}

interface Chapter {
  id: string
  title: string
  sections: Section[]
}

const chapters: Chapter[] = [
  {
    id: 'chapter-1',
    title: 'Chapter 1: Know Your Rights',
    sections: [
      { id: 'tenant-protections', title: 'Tenant Protections & Rent Increases' },
      { id: 'know-your-rights', title: 'Know Your Rights' },
      { id: 'repairs', title: 'Repairs, Damage, or Infestation' },
      { id: 'harassment', title: 'Harassment' },
      { id: 'utilities', title: 'Utilities' },
      { id: 'dos-donts', title: "Dos and Don'ts" },
    ],
  },
  {
    id: 'chapter-2',
    title: 'Chapter 2: Paying Rent',
    sections: [
      { id: 'paying-rent', title: 'Easy Steps to Protect Yourself' },
      { id: 'notice-to-pay', title: 'Notice to Pay Rent' },
    ],
  },
  {
    id: 'chapter-3',
    title: 'Chapter 3: Reporting Violations',
    sections: [
      { id: 'code-enforcement', title: 'Stockton Code Enforcement' },
      { id: 'filing-tips', title: 'Tips for Filing Complaints' },
      { id: 'health-violations', title: 'Health Code Violations' },
      { id: 'building-violations', title: 'Building Code Violations' },
    ],
  },
  {
    id: 'chapter-4',
    title: 'Chapter 4: Evictions',
    sections: [
      { id: 'legal-reasons', title: 'Legal Reasons for Evictions' },
      { id: 'at-fault', title: 'At-Fault Evictions' },
      { id: 'no-fault', title: 'No-Fault Evictions' },
      { id: 'no-rent-stabilization', title: 'If You DO NOT Live in Rent Stabilization' },
      { id: 'eviction-process', title: 'Eviction Process' },
      { id: 'voluntary-vacate', title: 'Voluntary Vacate Agreements' },
      { id: 'estoppel', title: 'Estoppel Certificate' },
    ],
  },
  {
    id: 'chapter-5',
    title: 'Chapter 5: Legal Entry & Security Deposit',
    sections: [
      { id: 'legal-entry', title: 'Legal Entry' },
      { id: 'security-deposits', title: 'Security Deposits' },
    ],
  },
]

// =============================================================================
// Search & Filtering
// =============================================================================
const searchQuery = ref('')
const searchInputRef = ref<HTMLInputElement | null>(null)
const mobileDrawerOpen = ref(false)
const mobileDrawerButtonRef = ref<HTMLButtonElement | null>(null)
const mobileDrawerPanelRef = ref<HTMLElement | null>(null)
const mobileDrawerCloseButtonRef = ref<HTMLButtonElement | null>(null)

const prefersReducedMotion = ref(false)

const drawerReturnFocusEl = ref<HTMLElement | null>(null)
const drawerPendingSectionId = ref<string | null>(null)

const openMobileDrawer = () => {
  if (process.client) {
    drawerReturnFocusEl.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  drawerPendingSectionId.value = null
  mobileDrawerOpen.value = true
}

const closeMobileDrawer = () => {
  mobileDrawerOpen.value = false
}

// Filter chapters and sections based on search query
const filteredChapters = computed(() => {
  const query = searchQuery.value.toLowerCase().trim()
  if (!query) return chapters

  return chapters
    .map((chapter) => {
      // Check if chapter title matches
      const chapterMatches = chapter.title.toLowerCase().includes(query)
      
      // Filter sections that match
      const matchingSections = chapter.sections.filter((section) =>
        section.title.toLowerCase().includes(query)
      )

      // Include chapter if title matches or has matching sections
      if (chapterMatches || matchingSections.length > 0) {
        return {
          ...chapter,
          // If chapter matches, show all sections; otherwise show only matching
          sections: chapterMatches ? chapter.sections : matchingSections,
        }
      }
      return null
    })
    .filter((chapter): chapter is Chapter => chapter !== null)
})

// Track which chapters are expanded (all expanded by default, or when searching)
const expandedChapters = ref<Set<string>>(new Set(chapters.map((c) => c.id)))

const toggleChapter = (chapterId: string) => {
  if (expandedChapters.value.has(chapterId)) {
    expandedChapters.value.delete(chapterId)
  } else {
    expandedChapters.value.add(chapterId)
  }
}

// Expand all chapters when searching
watch(searchQuery, (query) => {
  if (query) {
    expandedChapters.value = new Set(chapters.map((c) => c.id))
  }
})

// Keyboard shortcut: Ctrl+K or Cmd+K to focus search
onMounted(() => {
  const handleKeydown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      searchInputRef.value?.focus()
    }
    // Escape to close drawer or clear search
    if (e.key === 'Escape') {
      if (mobileDrawerOpen.value) {
        closeMobileDrawer()
        return
      }
      if (searchQuery.value) {
        searchQuery.value = ''
        searchInputRef.value?.blur()
      }
    }
  }
  window.addEventListener('keydown', handleKeydown)
  
  // Cleanup
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })
})

// Reduced motion preference
onMounted(() => {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  prefersReducedMotion.value = media.matches

  const onChange = (event: MediaQueryListEvent) => {
    prefersReducedMotion.value = event.matches
  }

  media.addEventListener('change', onChange)
  onUnmounted(() => {
    media.removeEventListener('change', onChange)
  })
})

// =============================================================================
// Active Section Tracking
// =============================================================================
const activeSection = ref('')

onMounted(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          activeSection.value = entry.target.id
        }
      })
    },
    { rootMargin: '-20% 0px -70% 0px' }
  )

  // Observe all section headings
  document.querySelectorAll('[data-section]').forEach((section) => {
    observer.observe(section)
  })
})

// =============================================================================
// Navigation
// =============================================================================
const scrollAndFocusSection = (id: string) => {
  const element = document.getElementById(id)
  if (!element) return

  const behavior: ScrollBehavior = prefersReducedMotion.value ? 'auto' : 'smooth'
  element.scrollIntoView({ behavior, block: 'start' })

  if (!element.hasAttribute('tabindex')) {
    element.setAttribute('tabindex', '-1')
  }

  if (element instanceof HTMLElement) {
    element.focus({ preventScroll: true })
  }
}

const scrollToSection = (id: string) => {
  // If drawer is open, close it first and then scroll/focus.
  if (mobileDrawerOpen.value) {
    drawerPendingSectionId.value = id
    closeMobileDrawer()
    return
  }

  scrollAndFocusSection(id)
}

useFocusTrap({
  active: mobileDrawerOpen,
  container: mobileDrawerPanelRef,
  initialFocus: mobileDrawerCloseButtonRef,
  onEscape: closeMobileDrawer,
  restoreFocus: false,
})

watch(mobileDrawerOpen, async (open) => {
  if (open) return

  await nextTick()

  const pendingId = drawerPendingSectionId.value
  drawerPendingSectionId.value = null

  if (pendingId) {
    scrollAndFocusSection(pendingId)
    return
  }

  const fallback = drawerReturnFocusEl.value
  drawerReturnFocusEl.value = null

  if (fallback) {
    fallback.focus()
    return
  }

  mobileDrawerButtonRef.value?.focus()
})

// Highlight matching text in search results
const highlightMatch = (text: string): string => {
  const query = searchQuery.value.trim()
  if (!query) return text
  
  const regex = new RegExp(`(${query})`, 'gi')
  return text.replace(regex, '<mark class="bg-primary/30 text-base-content rounded px-0.5">$1</mark>')
}
</script>

<template>
  <div class="min-h-screen bg-base-100">
    <!-- Hero Section -->
    <section class="py-8 md:py-14 bg-base-200">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="max-w-4xl">
          <h1 class="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-base-content mb-4 leading-tight">
            Working Class Unity Tenant Union Handbook
          </h1>
          <p class="text-base sm:text-lg text-base-content/80">
            This material is not a replacement for legal assistance or an attorney.
          </p>
        </div>
      </div>
    </section>

    <!-- Mobile TOC Toggle Button - Fixed at bottom -->
    <div class="lg:hidden fixed bottom-4 right-4 z-40">
      <button
        ref="mobileDrawerButtonRef"
        class="btn btn-primary btn-circle shadow-lg"
        :aria-label="mobileDrawerOpen ? $t('common.close') : $t('tenant_handbook.a11y.open_toc')"
        :aria-expanded="mobileDrawerOpen"
        aria-controls="toc-drawer-panel"
        type="button"
        @click="openMobileDrawer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6" aria-hidden="true" focusable="false">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>
    </div>

    <!-- Mobile Drawer -->
    <div class="drawer drawer-end lg:hidden z-50">
      <input 
        id="toc-drawer" 
        type="checkbox" 
        class="drawer-toggle" 
        :checked="mobileDrawerOpen"
        @change="mobileDrawerOpen = ($event.target as HTMLInputElement).checked"
      />
      <div class="drawer-side">
        <label for="toc-drawer" class="drawer-overlay" :aria-label="$t('common.close')" @click="closeMobileDrawer"></label>
        <div
          ref="mobileDrawerPanelRef"
          id="toc-drawer-panel"
          class="menu bg-base-100 min-h-full w-80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="toc-title"
        >
          <!-- Mobile Drawer Header -->
          <div class="flex items-center justify-between mb-4">
            <h2 id="toc-title" class="text-lg font-semibold text-base-content">Contents</h2>
            <button 
              ref="mobileDrawerCloseButtonRef"
              class="btn btn-ghost btn-circle h-10 min-h-10 w-10"
              :aria-label="$t('common.close')"
              type="button"
              @click="closeMobileDrawer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5" aria-hidden="true" focusable="false">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Mobile Search -->
          <div class="form-control mb-4">
            <div class="relative">
              <input
                v-model="searchQuery"
                type="text"
                :placeholder="$t('tenant_handbook.a11y.search_placeholder')"
                class="input input-bordered h-10 min-h-10 w-full pr-8 text-sm"
              />
              <button
                v-if="searchQuery"
                class="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center text-base-content/70 hover:text-base-content"
                :aria-label="$t('tenant_handbook.a11y.clear_search')"
                type="button"
                @click="searchQuery = ''"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4" aria-hidden="true" focusable="false">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Mobile Navigation -->
          <ul class="space-y-1">
            <li v-for="chapter in filteredChapters" :key="chapter.id">
              <button
                class="flex items-center justify-between w-full p-2.5 rounded-lg font-medium text-left text-sm hover:bg-base-200 transition-colors"
                :class="{ 'bg-primary/10 text-secondary': activeSection === chapter.id }"
                @click="scrollToSection(chapter.id)"
              >
                <span v-html="highlightMatch(chapter.title)"></span>
              </button>
              <ul class="ml-4 mt-1 space-y-0.5 border-l-2 border-base-300 pl-3">
                <li v-for="section in chapter.sections" :key="section.id">
                  <button
                    class="w-full text-left text-sm py-2 px-2.5 min-h-10 rounded hover:bg-base-200 transition-colors"
                    :class="{ 
                      'bg-primary/10 text-secondary font-medium': activeSection === section.id,
                      'text-base-content/80': activeSection !== section.id
                    }"
                    @click="scrollToSection(section.id)"
                  >
                    <span v-html="highlightMatch(section.title)"></span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>

          <!-- No results -->
          <div v-if="filteredChapters.length === 0" class="text-center py-8 text-base-content/80">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8 mx-auto mb-2 opacity-50">
              <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            <p class="text-sm">No sections found for "{{ searchQuery }}"</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content with Sidebar TOC -->
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="lg:grid lg:grid-cols-4 lg:gap-8">
        <!-- Desktop Sidebar TOC -->
        <aside class="hidden lg:block lg:col-span-1">
          <nav class="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pb-8">
            <!-- Search Input -->
            <div class="mb-4">
              <label class="input input-bordered input-sm flex items-center gap-2 bg-base-200/50">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 opacity-50">
                  <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
                <input
                  ref="searchInputRef"
                  v-model="searchQuery"
                  type="text"
                  placeholder="Search..."
                  class="grow bg-transparent text-sm"
                />
                <kbd class="kbd kbd-xs opacity-80">⌘K</kbd>
              </label>
            </div>

            <!-- TOC Header -->
            <h2 class="text-xs font-semibold text-base-content/80 uppercase tracking-wider mb-3">
              On This Page
            </h2>

            <!-- TOC Navigation -->
            <ul class="space-y-1">
              <li v-for="chapter in filteredChapters" :key="chapter.id">
                <!-- Chapter Header (Collapsible) -->
                <div class="flex items-center">
                  <button
                    class="flex-1 flex items-center gap-2 py-1.5 px-2 rounded-lg text-left font-medium text-sm hover:bg-base-200 transition-colors"
                    :class="{ 
                      'bg-primary/10 text-secondary': activeSection === chapter.id,
                      'text-base-content': activeSection !== chapter.id
                    }"
                    @click="scrollToSection(chapter.id)"
                  >
                    <span v-html="highlightMatch(chapter.title)"></span>
                  </button>
                  <button
                    class="p-1 hover:bg-base-200 rounded transition-colors"
                    :aria-label="expandedChapters.has(chapter.id) ? 'Collapse chapter' : 'Expand chapter'"
                    @click="toggleChapter(chapter.id)"
                  >
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      fill="none" 
                      viewBox="0 0 24 24" 
                      stroke-width="2" 
                      stroke="currentColor" 
                      class="w-3.5 h-3.5 transition-transform duration-200"
                      :class="{ 'rotate-180': expandedChapters.has(chapter.id) }"
                    >
                      <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                </div>

                <!-- Chapter Sections (Collapsible) -->
                <ul 
                  v-show="expandedChapters.has(chapter.id)"
                  class="ml-2 mt-0.5 space-y-0.5 border-l-2 border-base-300 pl-3 overflow-hidden"
                >
                  <li v-for="section in chapter.sections" :key="section.id">
                    <button
                      class="w-full text-left text-sm py-1 px-2 rounded hover:bg-base-200 transition-colors"
                      :class="{ 
                        'bg-primary/10 text-secondary font-medium border-l-2 border-primary -ml-3.5 pl-5': activeSection === section.id,
                        'text-base-content/80': activeSection !== section.id
                      }"
                      @click="scrollToSection(section.id)"
                    >
                      <span v-html="highlightMatch(section.title)"></span>
                    </button>
                  </li>
                </ul>
              </li>
            </ul>

            <!-- No results -->
            <div v-if="filteredChapters.length === 0" class="text-center py-6 text-base-content/80">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 mx-auto mb-2 opacity-50">
                <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
              <p class="text-xs">No sections match "{{ searchQuery }}"</p>
              <button 
                class="btn btn-xs btn-ghost mt-2"
                @click="searchQuery = ''"
              >
                Clear search
              </button>
            </div>

            <!-- Collapse/Expand All -->
            <div class="mt-4 pt-4 border-t border-base-300">
              <button
                class="text-xs text-base-content/80 hover:text-secondary transition-colors"
                @click="expandedChapters = expandedChapters.size === chapters.length ? new Set() : new Set(chapters.map(c => c.id))"
              >
                {{ expandedChapters.size === chapters.length ? 'Collapse all' : 'Expand all' }}
              </button>
            </div>
          </nav>
        </aside>

        <!-- Main Content -->
        <div class="lg:col-span-3">
          <article class="prose prose-lg max-w-none prose-headings:scroll-mt-24">
            
            <!-- ============================================================= -->
            <!-- CHAPTER 1: KNOW YOUR RIGHTS -->
            <!-- ============================================================= -->
            <h2 id="chapter-1" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2">
              Chapter 1: Know Your Rights
            </h2>

            <!-- Tenant Protections -->
            <section id="tenant-protections" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">Tenant Protections & Rent Increases</h3>
              
              <h4 class="font-semibold mt-4">Tenant Protection</h4>
              <p>
                The California Tenant Protection Act restricts how much a landlord can increase your rent. 
                Everyone in the San Joaquin County is Protected by this Act.
              </p>
              
              <p class="font-semibold">What does this act protect?</p>
              <ul>
                <li>Through January 1, 2030, landlords cannot raise rent more than 8.8% total or 5% plus the Consumer Price Index (CPI)—depending on whichever is lower.
                  <ul>
                    <li>Between 8/1/24 and 7/31/25 in San Joaquin County the maximum for rent increase is 8.8%</li>
                  </ul>
                </li>
                <li>Increases can only occur no more than two times every 12 months.</li>
                <li>Does not limit how much money a landlord can charge at the start of a rental agreement, only how much the rent can increase once the unit is occupied by the same tenant.</li>
                <li>Limits the legal reasons for eviction. You can only be evicted for the reasons listed in the SJCOG, and in some cases you MUST be compensated. (See Chapter 4)</li>
                <li>Rent increases cannot be retaliatory.</li>
              </ul>

              <h4 class="font-semibold mt-6">When can a Landlord increase your rent?</h4>
              <ul>
                <li><strong>Lease of more than month-to-month:</strong>
                  <ul>
                    <li>Landlords CANNOT increase rent during the term of the lease, unless the lease explicitly allows for rent increases.</li>
                    <li>Rent increases cannot be considered within the first year of occupancy.</li>
                  </ul>
                </li>
                <li><strong>Periodic lease agreement (a month-to-month or shorter):</strong>
                  <ul>
                    <li>Landlords can increase your rent as often as they like, but must provide a written notice</li>
                  </ul>
                </li>
              </ul>

              <div class="bg-base-200 p-4 rounded-lg mt-4">
                <p class="font-semibold mb-2">Landlords MUST provide a formal written notice for rent increases at least:</p>
                <ul class="mb-0">
                  <li>30-day notice for all week-to-week leases</li>
                  <li>30-day notice for all month-to-month leases for tenants who have lived there for less than one year</li>
                  <li>60-day notice for all month-to-month or yearly leases with tenants who have lived there for more than one year</li>
                  <li>90-day advance notice if the rent increase is greater than 8.8%</li>
                </ul>
              </div>
            </section>

            <!-- Know Your Rights -->
            <section id="know-your-rights" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Know Your Rights</h3>
              
              <p>
                The WCU Tenants Union knows that many landlords use their failure to make repairs as a way to evict tenants. 
                When tenants complain to their landlords about the lack of repairs, or about the quality of repair, many landlords 
                tell tenants to move out if they are unhappy. <strong>That is illegal.</strong>
              </p>

              <p>
                Under California law, ALL Tenants (with or without Rent Stabilization) have the right to live in a unit that is both safe and sanitary.
              </p>

              <p class="font-semibold">This means that your landlord is legally required to repair or address:</p>
              <ul>
                <li>Water dripping from ceilings and walls (from leaking pipes, bathtubs, or sinks)</li>
                <li>Holes in walls or floors (or missing thresholds at the base of doorways)</li>
                <li>Plaster/paint shedding</li>
                <li>Visible mildew or mold from not having enough air circulation</li>
                <li>Damaged heater</li>
                <li>Bad plumbing (or sewage back up)</li>
                <li>Broken windows</li>
                <li>Missing window screens</li>
                <li>Broken smoke detectors or carbon monoxide detectors</li>
                <li>Large gaps behind kitchen drawers or cupboards where insects can enter</li>
                <li>Inadequate garbage collection</li>
                <li>Unsafe stairs/handrails</li>
                <li>Unsecure/improper doorknobs</li>
                <li>Faulty electrical wiring</li>
                <li>Vermin infestations that violate the Health Code: cockroaches (the small ones), rats, mice, and raccoons (See Chapter 3)</li>
                <li>Infestations that violate the Building Code: termites (See Chapter 3)</li>
              </ul>

              <p class="font-semibold mt-4">Also, tenants have the right to:</p>
              <ul>
                <li>Receive 24-hour advance written notice before the landlord enters your home</li>
                <li>Submit a written list of repairs that you need in your home</li>
                <li>Impartial inspections by a third party</li>
                <li>Pay rent with money order</li>
                <li>Receive a receipt that clearly states the landlord's name, date covered by the rent, and the amount paid</li>
                <li>Organize themselves to fight against bad conditions, harassment, or illegal evictions</li>
              </ul>
            </section>

            <!-- Repairs -->
            <section id="repairs" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Repairs, Damage, or Infestation</h3>
              
              <p>If you have repairs, damage, or infestation:</p>
              <ol>
                <li>Make a list of the damaged or infested areas (if your landlord has provided you with a repairs sheet, fill it out thoroughly).</li>
                <li>Take photographs of the damaged or infested areas, and include the day's newspaper to show the date the photograph was taken.</li>
                <li>Write a letter to the landlord, attach the photos and list (or repairs sheet), and send it by mail with a delivery confirmation receipt, such as certified mail or USPS Priority Mail.
                  <ul>
                    <li>Email and text are also options.</li>
                  </ul>
                </li>
                <li>Keep dated documentation (e.g. receipt from post office, texts, emails, letters, etc.), and copies of all correspondence and photographs sent to the landlord.</li>
                <li>If the landlord does not repair the unit in a timely manner, you can file a complaint.</li>
              </ol>

              <p>
                Depending on the specific city or problem, you can request an inspection, and the landlord will be REQUIRED to repair the problem. 
                In some cases, landlords have up to 30 days to start the repair work, and then another 60 days to finish it.
              </p>

              <div class="overflow-x-auto mt-4">
                <table class="table table-zebra w-full">
                  <thead>
                    <tr>
                      <th>Department/Service</th>
                      <th>Agency/Office</th>
                      <th>Phone Number</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Housing Abatement</td>
                      <td>Community Development</td>
                      <td>209-468-3141</td>
                    </tr>
                    <tr>
                      <td>Housing Administration</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5084</td>
                    </tr>
                    <tr>
                      <td>Housing Assistance Applications (Section 8)</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5085</td>
                    </tr>
                    <tr>
                      <td>Housing Assistance Programs</td>
                      <td>Neighborhood Preservation</td>
                      <td>209-468-3065</td>
                    </tr>
                    <tr>
                      <td>Housing Authority Customer Service</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5095</td>
                    </tr>
                    <tr>
                      <td>Housing Discrimination</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>800-994-0999 or 209-460-0999</td>
                    </tr>
                    <tr>
                      <td>Housing General Information</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5000</td>
                    </tr>
                    <tr>
                      <td>Housing Rental Assistance (Section 8)</td>
                      <td>San Joaquin Fair Housing Authority</td>
                      <td>209-460-5088</td>
                    </tr>
                    <tr>
                      <td>Housing Weatherization</td>
                      <td>Human Services Agency</td>
                      <td>209-468-0439</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div class="alert alert-info mt-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span><strong>Remember:</strong> For ALL tenants, landlords must provide at least a 24-hour advance written notice to enter the unit to do repairs and they can enter even when you are not home.</span>
              </div>
            </section>

            <!-- Harassment -->
            <section id="harassment" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Harassment</h3>
              
              <p>To fight back against harassment, you must:</p>
              <ul>
                <li>Document the events. Keep a notebook where you write the date, time, and a detailed description of what happened.</li>
                <li>Send the landlord a letter documenting the harassment and asking for it to stop. Keep a copy of this dated documentation.</li>
                <li>Do not suffer harassment in silence or fear. Come to a Working Class Unity Tenant Union meeting and share your experience.</li>
              </ul>
            </section>

            <!-- Utilities -->
            <section id="utilities" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Utilities</h3>
              
              <h4 class="font-semibold mt-4">Who is responsible?</h4>
              <ul>
                <li>California landlord-tenant laws do not mandate landlords to cover utility costs but require clarity in lease agreements.</li>
                <li>Unpaid utility bills are the responsibility of whoever's name is on the bills.</li>
              </ul>

              <h4 class="font-semibold mt-4">If the utilities are under your Landlord's name:</h4>
              <ul>
                <li>Landlords must ensure tenants can access utilities and cannot charge more than the actual utility cost.</li>
                <li>Tenants have a right to get utilities even if their landlord doesn't pay the bills on time.</li>
                <li>Tenants with medical conditions that require at-home medical equipment have a right to a reduced utility cost.</li>
              </ul>

              <h4 class="font-semibold mt-4">By Law your Landlord cannot:</h4>
              <ul>
                <li>Turn off your utilities just because you are late on rent.</li>
                <li>Increase the price of your utilities (e.g. gas, electricity, trash, etc.) without a 30-day advance notice before the next rent due date
                  <ul>
                    <li>If they do NOT give you advanced written notice of the utilities price increase you should pay the increase AND file a complaint for further investigation. (See Chapter 3)</li>
                    <li>Note: This is only if the utility costs are included in your rent</li>
                  </ul>
                </li>
              </ul>
              
              <p>
                Additional information: 
                <a href="https://rentprep.com/blog/legal/california-landlord-tenant-law-utilities/" target="_blank" rel="noopener noreferrer" class="link link-primary">
                  California Landlord Tenant Law - Utilities
                </a>
              </p>
            </section>

            <!-- Dos and Don'ts -->
            <section id="dos-donts" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Dos and Don'ts</h3>
              
              <h4 class="font-semibold mt-4">Before You Move In:</h4>
              <div class="grid md:grid-cols-2 gap-4 mt-2">
                <div class="bg-success/10 p-4 rounded-lg">
                  <p class="font-semibold text-success mb-2">DO:</p>
                  <ul class="mb-0">
                    <li>Read and understand what you sign.</li>
                    <li>Take pictures to document the condition, especially of things that are already wrong or damaged.</li>
                  </ul>
                </div>
                <div class="bg-error/10 p-4 rounded-lg">
                  <p class="font-semibold text-base-content mb-2">DO NOT:</p>
                  <ul class="mb-0">
                    <li>Sign things that are false.</li>
                    <li>If you have a pet, do not sign that you do not own one.</li>
                    <li>If there are bad conditions, do not sign that the place is in good condition.</li>
                  </ul>
                </div>
              </div>

              <h4 class="font-semibold mt-6">During the Rental:</h4>
              <div class="grid md:grid-cols-2 gap-4 mt-2">
                <div class="bg-success/10 p-4 rounded-lg">
                  <p class="font-semibold text-success mb-2">DO:</p>
                  <ul class="mb-0">
                    <li>Pay rent on time.</li>
                    <li>Ask for receipts for rent payments, which clearly state the landlord's name, date covered, and amount paid.</li>
                    <li>Talk to a lawyer or housing advocate at the first sign of trouble.</li>
                  </ul>
                </div>
                <div class="bg-error/10 p-4 rounded-lg">
                  <p class="font-semibold text-base-content mb-2">DO NOT:</p>
                  <ul class="mb-0">
                    <li>Pay rent in cash.</li>
                    <li>Accept false or incorrect receipts.</li>
                    <li>Violate the lease agreement.</li>
                    <li>Sign anything you do not understand.</li>
                  </ul>
                </div>
              </div>

              <h4 class="font-semibold mt-6">When You Move Out:</h4>
              <div class="bg-success/10 p-4 rounded-lg mt-2">
                <p class="font-semibold text-success mb-2">DO:</p>
                <ul class="mb-0">
                  <li>Give more than 30 days written notice. Mail it with proof of mailing (certified mail or USPS Priority Mail).</li>
                  <li>Ask for a move out inspection, and take pictures of how you left the apartment.</li>
                  <li>Talk to a lawyer or housing advocate at the first sign of trouble.</li>
                </ul>
              </div>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 2: PAYING RENT -->
            <!-- ============================================================= -->
            <h2 id="chapter-2" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              Chapter 2: Paying Rent
            </h2>

            <section id="paying-rent" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">Easy Steps to Protect Yourself and Your Rent Money</h3>

              <h4 class="font-semibold mt-4">Forms of Payment</h4>
              <ol>
                <li>Payment in person is always preferable.</li>
                <li>Never pay with cash or a personal check.</li>
                <li>Always buy a money order or cashier's check with the date of purchase clearly stamped on it.</li>
              </ol>

              <h4 class="font-semibold mt-4">Personal Delivery or Pick-up</h4>
              <ul>
                <li>If you pay someone directly, take a witness with you (preferably not a family member).</li>
                <li>Ask for a receipt or a signed paper to show proof of payment that clearly states the landlord's name, date covered by the rent, and the amount paid.</li>
                <li>To be safe, take a photo of the receipt together with your payment method.</li>
              </ul>

              <h4 class="font-semibold mt-4">By Mail</h4>
              <ul>
                <li>Payment in person is always preferable.</li>
                <li>Never pay your rent via regular mail.</li>
                <li>Make sure you mail it with proof of mailing (certified mail with no signature required, or mail with a delivery confirmation receipt, such as USPS Priority Mail).</li>
                <li>If you mail the rent and it is lost, you are responsible for the lost money. You must have proof that you mailed it (your testimony is not sufficient).</li>
              </ul>

              <h4 class="font-semibold mt-4">When to Pay Rent</h4>
              <p>
                Rent is due on the 1st of the month—unless your contract states a different date. The law does not recognize a grace period unless your contract states that you have one. 
                A term in your lease stating that a late fee will apply if you pay after the 3rd or the 5th of the month, for example, is not a grace period.
              </p>
            </section>

            <section id="notice-to-pay" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Notice to Pay Rent</h3>
              
              <p>If you are served a Notice to Pay Rent, pay attention. Check how the Notice requires payment, and do exactly as it requires.</p>

              <h4 class="font-semibold mt-4">Payment by Mail</h4>
              <p>If the Notice states you must pay by mail OR if the address provided only allows you to pay by mail:</p>
              <ul>
                <li>Mail the rent to the address stated in the Notice.</li>
                <li>Mail it with proof of mailing.</li>
              </ul>

              <h4 class="font-semibold mt-4">Payment in Person</h4>
              <p>If the Notice does not direct you to pay by mail and allows you the option to pay in person OR if it directs you to pay in person:</p>
              <ul>
                <li>Deliver during the hours indicated in the Notice.</li>
                <li>Take a witness with you (preferably not a family member).</li>
                <li>Ask for a receipt or a signed paper to show proof of payment.</li>
              </ul>

              <h4 class="font-semibold mt-4">Payment Pick-up</h4>
              <p>If the Notice states that the landlord/manager will pick up the rent:</p>
              <ul>
                <li>Buy the money order(s) right away and have them ready for pick up. This means that all adults in the household know where they are and can pay the landlord/manager when they come.</li>
                <li>If no one comes to pick it up by 2:00 PM on the final day given to make payment, then mail your rent immediately with proof of mailing, and keep the receipt from the Post Office that shows the time you mailed the rent.</li>
              </ul>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 3: REPORTING VIOLATIONS -->
            <!-- ============================================================= -->
            <h2 id="chapter-3" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              Chapter 3: Reporting Violations
            </h2>

            <p class="mt-4">
              The most important part of reporting code violations is to remember that bad appearances are not necessarily a code violation. 
              <strong>It is a code violation if it should work and does not.</strong>
            </p>

            <div class="alert alert-warning mt-4">
              <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>If you are going to file ANY official complaints, you MUST follow all of the Rent Paying tips in Chapter 2. Hostile landlords will try to claim nonpayment of rent as one of their first methods for retaliation. <strong>DO NOT ATTEMPT TO WITHHOLD RENT WITHOUT LEGAL CONSULTATION.</strong></span>
            </div>

            <section id="code-enforcement" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">Stockton Code Enforcement</h3>
              
              <div class="bg-base-200 p-4 rounded-lg">
                <p><strong>Phone:</strong> 209-468-3141</p>
                <p><strong>Email:</strong> <a href="mailto:NSS@Stocktonca.gov" class="link link-primary">NSS@Stocktonca.gov</a></p>
              </div>

              <p class="mt-4">
                This email address is for submitting information requests, reporting code violations, and requesting payoff demands to remove recorded notices/liens from properties. 
                You can also contact Neighborhood Services at (209) 937-8813 or fax a demand request to (209) 937-7264.
              </p>
            </section>

            <section id="filing-tips" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Tips for Filing Complaints with Code Enforcement</h3>
              
              <ul>
                <li>Code Enforcement inspectors will ONLY write a report of what they see. They will not go under buildings, on roofs, or pull open walls to look for mold.</li>
                <li>You can book an inspection based on one complaint and have them look at any other potential issues while they are in your unit.</li>
                <li>Each separate unit has to place its own complaint(s). You cannot make a complaint for other apartments.</li>
                <li>Overall building inspection can be requested for common areas.</li>
                <li>After filing a complaint, make sure to get the inspector's card with your case number on it. Call and follow up OFTEN to check the status of the case.</li>
                <li>Sometimes they will close the case without notifying you. You can contest the closing of a case and ask that it be reopened if the repairs have not been completed.</li>
                <li>Take photos and videos and either text them to someone or email them to someone to have a time-coded record of the issue.</li>
                <li>Keep copies of all communications with the landlord and with code enforcement.</li>
                <li>Be there for the inspection because sometimes the landlord will be there instead and they will attempt to minimize any issues.</li>
                <li>Ask for copies of any inspection reports.</li>
              </ul>
            </section>

            <section id="health-violations" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Health Code Violations</h3>
              
              <p>
                Health code violations include cockroaches (but not water bugs), rat or mice infestation, visible mold or mildew, and sewage in the bathtub. 
                Contact the Health and Human Services Department for your city of residence.
              </p>

              <div class="bg-base-200 p-4 rounded-lg mt-4">
                <h4 class="font-semibold">San Joaquin County Public Health Services</h4>
                <ul class="mb-0">
                  <li><strong>General Information:</strong> (209) 468-3400</li>
                  <li><strong>Email:</strong> phs-info@sjcphs.org</li>
                  <li><strong>Administration:</strong> 209-468-3411</li>
                  <li><strong>Public Info and Communication:</strong> 209-468-3859</li>
                </ul>
              </div>

              <p class="mt-4">
                Depending on where you live, lodge a complaint with both the city and county. They will ONLY create a report based on what they can see, 
                and only create a file based on health code violations (e.g. rats), not building code violations (e.g. a faulty water faucet).
              </p>
            </section>

            <section id="building-violations" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Building Code Violations</h3>
              
              <div class="bg-base-200 p-4 rounded-lg">
                <h4 class="font-semibold">Stockton Code Enforcement Building Inspections</h4>
                <p class="mb-0"><strong>Phone:</strong> 209-468-3141</p>
              </div>

              <p class="mt-4">
                File complaints with Stockton Code Enforcement regarding issues with the structure of your unit, such as termites or roof damage.
              </p>

              <p>
                Whenever you file a complaint with Stockton Code Enforcement, you can also ask that they inspect all the smoke and carbon monoxide detectors in the building. 
                They can also write up the landlord for any other violations seen on the property.
              </p>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 4: EVICTIONS -->
            <!-- ============================================================= -->
            <h2 id="chapter-4" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              Chapter 4: Evictions
            </h2>

            <section id="legal-reasons" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">Legal Reasons for Evictions</h3>
              <p>
                The Tenant Protection Act of 2019 (AB 1482) introduced statewide rent control and just cause eviction protections for certain residential tenants.
              </p>
            </section>

            <section id="at-fault" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">At-Fault Evictions</h3>
              
              <ol>
                <li>Failure to pay rent as required by the lease agreement.</li>
                <li>Breach of a material lease term: Violating significant terms of the lease, such as unauthorized alterations or prohibited activities.</li>
                <li>Refusal to sign a new lease: declining to sign a lease renewal or extension with similar terms when requested by the landlord.</li>
                <li>Criminal activity: committing crimes on the property or engaging in criminal acts directed at the landlord or their agent.</li>
                <li>Nuisance or waste: engaging in behavior that disturbs other tenants or causes damage.</li>
                <li>Denial of lawful entry: refusing to allow the landlord access to the unit for legitimate reasons, such as repairs or inspections.</li>
                <li>The tenant unreasonably interferes with the landlord's ability to perform major renovation to a unit or the building.</li>
              </ol>
            </section>

            <section id="no-fault" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">No-Fault Evictions</h3>
              
              <div class="alert alert-info mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span>The landlord is required by law to compensate a tenant for relocation costs for the reasons below.</span>
              </div>

              <ol>
                <li>If the landlord needs the apartment to move in their child, spouse, parent, manager, and/or themselves.</li>
                <li>If the landlord is going to demolish the building or wants to remove the apartment from the housing market (Ellis Act).</li>
                <li>If the landlord was told by a government agency to empty the units.</li>
                <li>If the Federal Department of Housing and Urban Development (HUD) owns the building and wants to sell it.</li>
                <li>If the building is a residential hotel that the landlord will convert or demolish.</li>
                <li>If the landlord will convert the building to government certified affordable housing.</li>
              </ol>
            </section>

            <section id="no-rent-stabilization" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">If You DO NOT Live in a Building Under Rent Stabilization</h3>
              
              <p>The landlord may evict you for any reason.</p>
              <p>
                <strong>HOWEVER</strong>, the law requires that advance written notice be given to the tenant, stating that the landlord no longer wants to rent to the tenant.
              </p>

              <ul>
                <li>If the tenant has lived in the unit for <strong>MORE than one year</strong>, then the landlord must give a <strong>60-day notice</strong>.</li>
                <li>If any tenant has lived in the unit for <strong>LESS than one year</strong>, then the landlord only has to give <strong>30-day notice</strong>.</li>
              </ul>

              <h4 class="font-semibold mt-4">3-Day Notice</h4>
              <p>Under California law, a landlord can evict a tenant with only a <strong>3-DAY</strong> advance written notice for any of the following reasons:</p>
              <ul>
                <li>Failure to pay rent.</li>
                <li>A violation of the lease agreement or contract.</li>
                <li>Materially damaging the property.</li>
                <li>Being a nuisance.</li>
                <li>Using the apartment for any illegal activities.</li>
              </ul>

              <p>The tenant has 3 days to correct the violation. If corrected within 3 days, they will not have to move out.</p>

              <div class="alert mt-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-info shrink-0 w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <div>
                  <p class="font-semibold">California Civil Code 1942.4</p>
                  <p class="text-sm">
                    If the landlord has failed to adequately respond to official instructions for over 35 days, the "landlord of a dwelling may not demand rent, collect rent, issue a notice of a rent increase, or issue a 3-day notice to pay rent or quit." 
                    <strong>DO NOT ATTEMPT TO WITHHOLD RENT WITHOUT LEGAL CONSULTATION.</strong>
                  </p>
                </div>
              </div>
            </section>

            <section id="eviction-process" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Eviction Process</h3>
              
              <h4 class="font-semibold mt-4">Landlord Serves Eviction Notice</h4>
              <p>If you receive any of the following documents, respond immediately. If you DO NOT respond, you could lose your home or enter a court process.</p>

              <div class="space-y-4 mt-4">
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">3-Day Notice to Perform or Quit</p>
                  <p class="text-sm mb-0">The written notice must indicate the unit involved and the issue. It also must present an alternative to the tenant about how to resolve the problem.</p>
                </div>
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">30-Day Notice / 60-Day Notice</p>
                  <p class="text-sm mb-0">Advance notice that the landlord no longer wants to rent to you.</p>
                </div>
                <div class="bg-error/10 p-4 rounded-lg border border-error">
                  <p class="font-semibold text-base-content">5-Day Court Summons</p>
                  <p class="text-sm mb-0">When you receive this it means your landlord has filed an eviction case against you in court. <strong>You have 5 days to reply to this notice.</strong> If you don't, then you can lose your case in court. This is the moment in which you need assistance from a lawyer.</p>
                </div>
              </div>

              <h4 class="font-semibold mt-6">If Tenant DOES NOT File Response:</h4>
              <ol>
                <li>Landlord requests entry of default and clerk's judgment for possession.</li>
                <li>Default and judgment are entered.</li>
                <li>Landlord files writ of possession.</li>
                <li>Sheriff posts 5-day notice to vacate.</li>
                <li>Case ends.</li>
              </ol>

              <h4 class="font-semibold mt-4">If Tenant Files Response:</h4>
              <ol>
                <li>Landlord requests trial date.</li>
                <li>Court mails notice of trial date to landlord and tenant.</li>
                <li>Trial within 20 days of request.</li>
              </ol>

              <h4 class="font-semibold mt-4">Four Possible Outcomes:</h4>
              <p class="text-sm text-base-content/80">(The parties can negotiate a settlement at any time during the process.)</p>
              <ol>
                <li><strong>Tenant wins (legal or technical issue):</strong> Tenant can stay.</li>
                <li><strong>Conditional judgment (habitability issue):</strong> Tenant wins if they can pay reduced back-rent within 5 days.</li>
                <li><strong>Stipulated judgment (court-approved settlement):</strong> Tenant must pay back rent and other costs.</li>
                <li><strong>Landlord wins:</strong> Receives judgment for possession.</li>
              </ol>
            </section>

            <section id="voluntary-vacate" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Voluntary Vacate Agreements</h3>
              
              <h4 class="font-semibold mt-4">What is a Voluntary Vacate Agreement or Cash-for-Keys?</h4>
              <p>
                Cash-for-keys is an illegal buyout that happens when a landlord offers money for a tenant to voluntarily end a lease and leave an apartment 
                without informing the tenants of their legal rights regarding eviction.
              </p>

              <div class="alert alert-warning mt-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <div>
                  <p class="font-bold">Tenants have NO legal obligation to sign a voluntary vacate agreement or to accept cash-for-keys under any circumstances.</p>
                  <p class="text-sm mb-0">Never relinquish your rights without consulting with an attorney.</p>
                </div>
              </div>

              <h4 class="font-semibold mt-6">Some things to consider about buyout offers:</h4>
              <ul>
                <li>30% of the buyout offer will be paid to the federal government and still more to the state.</li>
                <li>10-30% of the amount will be used for legal fees.</li>
                <li>The requirements to rent have become more intense. Many landlords require you to earn twice the rental amount in order to qualify.</li>
                <li>When calculating the financial impact of accepting a buyout offer, consider: How much money will you need to move out without hurting financially? How far will you have to move to find a place you can afford?</li>
              </ul>
            </section>

            <section id="estoppel" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Estoppel Certificate</h3>
              
              <h4 class="font-semibold mt-4">What is an Estoppel Certificate?</h4>
              <p>
                An Estoppel Certificate does NOT mean you will be evicted. An estoppel indicates that there will be changes in the building or ownership.
              </p>
              <p>
                An Estoppel Certificate is NOT a lease or new lease. It confirms the terms of occupancy—rental agreement and lease terms—for tenants.
              </p>

              <h4 class="font-semibold mt-4">Estoppel Certificates can be of value to tenants:</h4>
              <ul>
                <li>In the event that there is a dispute between you and a future owner, you can use the estoppel to prove your terms of occupancy.</li>
                <li>The certificate invites you to note informal or verbal agreements outside of your written lease.</li>
                <li>You MUST note any incorrect information on the certificate on the form or a separate letter that is signed and dated.</li>
                <li>Sign and date ALL documents and make two copies (one for yourself).</li>
              </ul>
            </section>

            <!-- ============================================================= -->
            <!-- CHAPTER 5: LEGAL ENTRY & SECURITY DEPOSIT -->
            <!-- ============================================================= -->
            <h2 id="chapter-5" data-section class="text-2xl md:text-3xl font-bold text-secondary border-b-2 border-primary pb-2 mt-16">
              Chapter 5: Legal Entry & Security Deposit
            </h2>

            <section id="legal-entry" data-section class="mt-8">
              <h3 class="text-xl font-bold text-base-content">Legal Entry</h3>
              <p class="text-sm text-base-content/80">For ALL tenants (with or without Rent Stabilization)</p>
              
              <h4 class="font-semibold mt-4">When can the landlord enter?</h4>
              <ul>
                <li>California law states that a landlord can enter a unit with reasonable advance written notice (24 hours or 6 days by mail).</li>
                <li>A landlord can enter only during normal business hours (generally, weekdays 8:00 AM-5:00 PM).</li>
                <li>The notice must state the date, approximate time, and purpose of entry.</li>
                <li>A landlord cannot issue a 24-hour notice that covers multiple days.</li>
              </ul>

              <h4 class="font-semibold mt-4">Reasonable advance written notice IS required for:</h4>
              <ul>
                <li>To make necessary or agreed-upon repairs, decorations, alterations, or improvements</li>
                <li>To show the unit to prospective tenants, purchasers, or lenders</li>
                <li>To provide entry to contractors or workers</li>
                <li>When a court order permits the landlord to enter</li>
              </ul>

              <h4 class="font-semibold mt-4">Advance written notice is NOT required for:</h4>
              <ul>
                <li>An emergency that constitutes a negative impact to property, health, or safety</li>
                <li>When a tenant has moved out or abandoned the unit</li>
                <li>When a tenant is present and consents to entry</li>
                <li>When the tenant and landlord have already agreed on entry for repairs</li>
              </ul>

              <div class="bg-base-200 p-4 rounded-lg mt-4">
                <h4 class="font-semibold">Special rules for showing to prospective buyer:</h4>
                <p class="mb-0">
                  A landlord must give 24-hour advance written notice to show the unit to a prospective buyer. 
                  Alternatively, they can post a 120-day advance written notice one time, but must still give 24-hour advance verbal notice each time.
                </p>
              </div>
            </section>

            <section id="security-deposits" data-section class="mt-10">
              <h3 class="text-xl font-bold text-base-content">Security Deposits</h3>
              <p class="text-sm text-base-content/80">For ALL tenants (with or without Rent Stabilization)</p>
              
              <h4 class="font-semibold mt-4">What is a security deposit?</h4>
              <p>
                The security deposit may also be called: last month's rent, security deposit, pet deposit, key fee, or cleaning fee. 
                Make sure your rental agreement clearly states you have paid a security deposit and the correct amount.
              </p>

              <h4 class="font-semibold mt-4">Under California law, security deposits MUST be refundable. However, the landlord may keep part or all for:</h4>
              <ul>
                <li>Rent is owed</li>
                <li>The unit is less clean than when you first moved in</li>
                <li>The unit is damaged beyond normal wear and tear</li>
                <li>Failure to restore personal property (such as keys or furniture)</li>
              </ul>

              <h4 class="font-semibold mt-4">Legal limit for total security deposit:</h4>
              <div class="grid md:grid-cols-2 gap-4 mt-2">
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">Unfurnished rental unit:</p>
                  <p class="mb-0">Total cannot be more than <strong>one month's rent</strong> (per CA Civil Code 1950.5)</p>
                </div>
                <div class="bg-base-200 p-4 rounded-lg">
                  <p class="font-semibold">Furnished rental unit:</p>
                  <p class="mb-0">Total cannot be more than <strong>three months' rent</strong></p>
                </div>
              </div>

              <p class="mt-4">The landlord can also require you to pay the first month's rent in addition to the security deposit.</p>

              <h4 class="font-semibold mt-4">Can a new landlord increase the security deposit?</h4>
              <p>
                The landlord can only increase the security deposit at the end of your lease period, or if your lease specifically allows for an increase. 
                The new amount cannot exceed the legal limit.
              </p>

              <div class="alert alert-success mt-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <div>
                  <p class="font-bold">After moving out, the landlord has 21 DAYS to:</p>
                  <ul class="mb-0 text-sm">
                    <li>Send a full refund of the security deposit, OR</li>
                    <li>Mail or personally deliver an itemized statement that lists the amounts and reasons for any deductions, together with a refund of any amounts not deducted.</li>
                  </ul>
                </div>
              </div>

              <p class="mt-4 text-sm text-base-content/80">
                It is the tenant's responsibility to provide an address where the security deposit can be mailed.
              </p>
            </section>

            <!-- Back to Top -->
            <div class="mt-16 pt-8 border-t border-base-300 text-center">
              <button 
                class="btn btn-ghost h-10 min-h-10 px-3 text-sm gap-2"
                @click="scrollToSection('chapter-1')"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
                Back to Top
              </button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Smooth scrolling for the whole page */
html {
  scroll-behavior: smooth;
}

/* Custom prose overrides for better readability */
.prose h3 {
  margin-top: 2rem;
}

.prose h4 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
}

.prose ul, .prose ol {
  margin-top: 0.5rem;
  margin-bottom: 0.5rem;
}

.prose p {
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

/* Table styling */
.prose table {
  margin-top: 1rem;
  margin-bottom: 1rem;
}

.prose th, .prose td {
  font-size: 0.875rem;
  line-height: 1.25rem;
}
</style>
