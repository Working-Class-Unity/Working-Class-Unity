<script setup lang="ts">
import {
  campaignFacts,
  campaignLandingPage,
  citedTextParts,
  citedTextPlainText,
  petitionDemand,
  type CampaignSection,
  type CampaignSource,
  type CitedText
} from '~/content/remove-flock-stockton'

const landingSections: readonly CampaignSection[] = campaignLandingPage.sections
const sectionById = new Map<string, CampaignSection>(landingSections.map((section) => [section.id, section]))
const whyRemove = sectionById.get('why-remove')!
const system = sectionById.get('system')!
const safeguards = sectionById.get('safeguards')!
const realSafety = sectionById.get('real-safety')!
const participate = sectionById.get('participate')!
const petitionUrl = 'https://tech.workingclassunity.com/deflock-stockton'
const updatesUrl = 'https://tech.workingclassunity.com/deflock-stockton-updates'
const caseLabels = ['Safety is a public good', 'The risk is unequal', 'The public should hold power'] as const
const systemLabels = ['Collect', 'Connect', 'Observe', 'Depend'] as const
const safetyLabels = ['Stable homes', 'Safe work and public space', 'Care and prevention', 'Public control'] as const
const recordValues = ['April 14, 2031', '$5,416,700', 'A connected system'] as const
const sourcesById = new Map<string, CampaignSource>(campaignLandingPage.sources.map((source) => [source.id, source]))

function sourcesForIds(sourceIds: readonly string[]) {
  return sourceIds.map((sourceId) => {
    const source = sourcesById.get(sourceId)
    if (!source) throw new Error(`Unknown campaign source: ${sourceId}`)
    return source
  })
}

function sourcesFor(content: CitedText): readonly CampaignSource[] {
  const ids = new Set(citedTextParts(content).flatMap((part) => (part.citations ?? []).map(({ sourceId }) => sourceId)))
  return sourcesForIds([...ids])
}

function pointDetail(text: string) {
  const separator = text.indexOf(':')
  return separator === -1 ? text : text.slice(separator + 1).trim()
}
</script>

<template>
  <article class="campaign-landing" aria-labelledby="remove-flock-title">
    <section class="campaign-hero" aria-labelledby="remove-flock-title">
      <div class="campaign-hero-copy">
        <p class="campaign-eyebrow">{{ campaignLandingPage.eyebrow }} · STOCKTON</p>
        <h1 id="remove-flock-title">{{ campaignLandingPage.title }}</h1>
        <p class="campaign-hero-description">{{ campaignLandingPage.description }}</p>
        <div class="campaign-action-cluster">
          <a class="campaign-primary-action" :href="petitionUrl">Sign the demand letter</a>
          <NuxtLink class="campaign-text-action" to="/campaigns/remove-flock-stockton/what-stockton-bought">
            Read what Stockton bought <span aria-hidden="true">→</span>
          </NuxtLink>
        </div>
      </div>
      <dl class="campaign-hero-facts">
        <div v-for="fact in campaignFacts.slice(0, 2)" :key="fact.label">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>
    </section>

    <section class="campaign-record" aria-labelledby="campaign-record-title">
      <div class="campaign-field campaign-record-inner">
        <div class="campaign-record-heading">
          <h2 id="campaign-record-title">What the public record shows</h2>
          <p>City of Stockton records · March 31, 2026 · reviewed May 3, 2026</p>
        </div>
        <dl class="campaign-record-list">
          <div v-for="(fact, index) in campaignFacts" :key="fact.label">
            <dt>{{ recordValues[index] }}</dt>
            <dd>{{ fact.detail }}</dd>
            <dd class="campaign-source-line">
              <span>Sources:</span>
              <a
                v-for="source in sourcesForIds(fact.sourceIds)"
                :key="source.id"
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ source.title }}</a
              >
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="campaign-case" aria-labelledby="why-remove-title">
      <div class="campaign-field campaign-case-inner">
        <div class="campaign-section-turn">
          <h2 id="why-remove-title">{{ whyRemove.title }}</h2>
          <p>{{ whyRemove.summary }}</p>
        </div>
        <dl class="campaign-case-list">
          <div v-for="(point, index) in whyRemove.points" :key="citedTextPlainText(point)">
            <dt>
              <span aria-hidden="true">0{{ index + 1 }}</span
              >{{ caseLabels[index] }}
            </dt>
            <dd>{{ citedTextPlainText(point) }}</dd>
            <dd>
              <NuxtLink
                class="campaign-context-link"
                to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough"
              >
                Claim source and context <span aria-hidden="true">→</span>
              </NuxtLink>
            </dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="campaign-system" aria-labelledby="campaign-system-title">
      <div class="campaign-field campaign-system-inner">
        <div class="campaign-section-turn campaign-system-heading">
          <h2 id="campaign-system-title">{{ system.title }}</h2>
          <NuxtLink class="campaign-text-action" to="/campaigns/remove-flock-stockton/what-stockton-bought">
            Explore the full system <span aria-hidden="true">→</span>
          </NuxtLink>
        </div>
        <div
          class="campaign-system-diagram"
          aria-label="Connected system described in the source-linked sequence below"
          role="img"
        >
          <span aria-hidden="true" />
          <p>Connected system · source-linked below</p>
          <div aria-hidden="true">
            <b>Plate readers</b><b>911 + search</b><b>Drones + video</b><b>Vendor platform</b>
          </div>
        </div>
        <dl class="campaign-system-list">
          <div v-for="(point, index) in system.points" :key="citedTextPlainText(point)">
            <dt>
              <span aria-hidden="true">0{{ index + 1 }}</span
              >{{ systemLabels[index] }}
            </dt>
            <dd>{{ pointDetail(citedTextPlainText(point)) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="campaign-removal" aria-labelledby="campaign-safeguards-title">
      <div class="campaign-field campaign-removal-inner">
        <div>
          <p class="campaign-eyebrow">Why removal</p>
          <h2 id="campaign-safeguards-title">{{ safeguards.title }}</h2>
        </div>
        <div class="campaign-removal-copy">
          <p class="campaign-removal-lead">{{ safeguards.summary }}</p>
          <div v-for="paragraph in safeguards.paragraphs" :key="citedTextPlainText(paragraph)">
            <p>{{ citedTextPlainText(paragraph) }}</p>
            <p v-if="sourcesFor(paragraph).length" class="campaign-removal-sources">
              <a
                v-for="source in sourcesFor(paragraph)"
                :key="source.id"
                :href="source.url"
                target="_blank"
                rel="noopener noreferrer"
                >{{ source.title }}</a
              >
            </p>
          </div>
          <NuxtLink class="campaign-inverse-link" to="/campaigns/remove-flock-stockton/why-safeguards-are-not-enough">
            Read the full case for removal <span aria-hidden="true">→</span>
          </NuxtLink>
        </div>
      </div>
    </section>

    <section id="removal-demand" class="campaign-demand" aria-labelledby="campaign-demand-title">
      <div class="campaign-field campaign-demand-inner">
        <div class="campaign-demand-heading">
          <h2 id="campaign-demand-title">{{ petitionDemand.title }}</h2>
          <div>
            <p>{{ petitionDemand.introduction }}</p>
            <p class="campaign-demand-leadin">{{ petitionDemand.leadIn }}</p>
          </div>
        </div>
        <ol class="campaign-demand-list" role="list">
          <li v-for="item in petitionDemand.demands" :key="item">{{ item }}</li>
        </ol>
      </div>
    </section>

    <section class="campaign-safety" aria-labelledby="real-safety-title">
      <div class="campaign-field campaign-safety-inner">
        <div class="campaign-section-turn campaign-safety-heading">
          <h2 id="real-safety-title">{{ realSafety.title }}</h2>
          <p>{{ realSafety.summary }}</p>
        </div>
        <dl class="campaign-safety-list">
          <div v-for="(point, index) in realSafety.points" :key="citedTextPlainText(point)">
            <dt>
              <span aria-hidden="true">0{{ index + 1 }}</span
              >{{ safetyLabels[index] }}
            </dt>
            <dd>{{ pointDetail(citedTextPlainText(point)) }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <section class="campaign-participation" aria-labelledby="campaign-participate-title">
      <div class="campaign-field campaign-participation-inner">
        <div class="campaign-participation-heading">
          <p class="campaign-eyebrow">Organize</p>
          <h2 id="campaign-participate-title">{{ participate.title }}</h2>
          <p>{{ participate.summary }}</p>
        </div>
        <div class="campaign-participation-actions">
          <ol class="campaign-participation-list" role="list">
            <li v-for="point in participate.points" :key="citedTextPlainText(point)">
              <span>{{ citedTextPlainText(point) }}</span
              ><span aria-hidden="true">→</span>
            </li>
          </ol>
          <div class="campaign-action-cluster campaign-participation-links">
            <a class="campaign-outline-action" :href="petitionUrl">Sign the demand letter</a>
            <NuxtLink class="campaign-inverse-link" to="/join">
              Join Working Class Unity <span aria-hidden="true">→</span>
            </NuxtLink>
          </div>
          <div class="campaign-newsletter campaign-updates">
            <h3>Get Deflock Stockton updates by email or text.</h3>
            <a class="campaign-inverse-link" :href="updatesUrl" aria-describedby="campaign-updates-note">
              Stay informed <span aria-hidden="true">→</span>
            </a>
            <p id="campaign-updates-note">Sign up for updates about this campaign and other WCU updates.</p>
          </div>
        </div>
      </div>
    </section>
  </article>
</template>

<style scoped>
/* stylelint-disable no-descending-specificity -- responsive editorial rows intentionally override shared desktop structure. */
@layer components {
  .campaign-landing {
    --campaign-gutter: clamp(1.25rem, 6.667vw, 6rem);
    --campaign-rule: rgb(4 51 79 / 24%);
    --campaign-white-rule: rgb(255 255 255 / 50%);

    position: relative;
    inset-inline-start: 50%;
    inline-size: 100vw;
    min-width: 0;
    margin-inline-start: -50vw;
    overflow: clip;
    color: var(--color-text);
    background: var(--color-surface);
  }

  .campaign-landing :is(p, dl, dd, ol) {
    margin: 0;
  }

  .campaign-field {
    inline-size: min(var(--content-max-width), calc(100% - (2 * var(--campaign-gutter))));
    margin-inline: auto;
  }

  .campaign-eyebrow,
  .campaign-record-heading h2,
  .campaign-demand-leadin {
    font-size: 0.875rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.12em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .campaign-eyebrow {
    color: var(--color-accent-action);
  }

  .campaign-hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 31.25rem;
    background: var(--color-surface);
  }

  .campaign-hero-copy {
    display: grid;
    align-content: center;
    justify-items: start;
    gap: 1.625rem;
    min-width: 0;
    padding-block: 6rem 6.5rem;
    padding-inline: max(var(--campaign-gutter), calc((100vw - var(--content-max-width)) / 2)) 5rem;
  }

  .campaign-hero h1 {
    --font-size-heading-1: clamp(3.5rem, 5vw, 4.5rem);
    --line-height-heading: 1.03;

    max-inline-size: 11ch;
    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-1);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.035em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
  }

  .campaign-hero-description {
    max-inline-size: 43.75rem;
    font-size: 1.25rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-action-cluster {
    display: flex;
    flex-wrap: wrap;
    gap: 0.875rem 1.375rem;
    align-items: center;
  }

  .campaign-primary-action,
  .campaign-outline-action {
    display: inline-flex;
    min-block-size: 3.25rem;
    min-inline-size: 2.75rem;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-1);
    padding-inline: 1.125rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.25;
    text-align: center;
    text-decoration: none;
  }

  .campaign-primary-action {
    --anchor-color: var(--color-accent-action-contrast);

    border: 1px solid var(--color-accent-action);
    color: var(--color-accent-action-contrast);
    background: var(--color-accent-action);
  }

  .campaign-primary-action:hover,
  .campaign-primary-action:focus-visible {
    border-color: var(--color-brand-primary);
    background: var(--color-brand-primary);
  }

  .campaign-text-action,
  .campaign-context-link,
  .campaign-inverse-link {
    display: inline-flex;
    gap: var(--space-2);
    align-items: center;
    min-block-size: 2.75rem;
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
    line-height: 1.4;
    text-decoration: none;
  }

  :is(.campaign-text-action, .campaign-context-link, .campaign-inverse-link):is(:hover, :focus-visible) {
    text-decoration: underline;
    text-underline-offset: 0.22em;
  }

  .campaign-hero-facts {
    display: grid;
    align-content: end;
    gap: 2.625rem;
    padding: 5.5rem 3.75rem 6rem;
    color: var(--color-surface);
    background: var(--color-accent-action);
  }

  .campaign-hero-facts > div {
    display: grid;
    gap: var(--space-2);
  }

  .campaign-hero-facts > div + div {
    border-block-start: 1px solid rgb(255 255 255 / 45%);
    padding-block-start: 1.875rem;
  }

  .campaign-hero-facts dt {
    font-size: 0.8125rem;
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.1em;
    line-height: 1.4;
    text-transform: uppercase;
  }

  .campaign-hero-facts dd {
    color: var(--color-surface);
    font-family: var(--font-family-statement);
    font-size: clamp(3rem, 4.72vw, 4.25rem);
    line-height: 1.03;
  }

  .campaign-record {
    padding-block: 4.5rem 4.75rem;
    background: var(--color-canvas);
  }

  .campaign-record-inner,
  .campaign-case-inner,
  .campaign-system-inner,
  .campaign-demand-inner,
  .campaign-safety-inner {
    display: grid;
  }

  .campaign-record-inner {
    gap: 2.125rem;
  }

  .campaign-record-heading {
    display: flex;
    gap: var(--space-5);
    align-items: center;
    justify-content: space-between;
  }

  .campaign-record-heading h2 {
    --font-size-heading-2: 0.875rem;
    --line-height-heading: 1.4;

    margin: 0;
    color: var(--color-brand-primary);
    font-size: var(--font-size-heading-2);
    line-height: var(--line-height-heading);
  }

  .campaign-record-heading p {
    color: var(--color-text-muted);
    font-size: 0.8125rem;
  }

  .campaign-record-list,
  .campaign-system-list,
  .campaign-safety-list {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid var(--campaign-rule);
  }

  .campaign-record-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div {
    display: grid;
    align-content: start;
    gap: 0.625rem;
    min-width: 0;
    padding: 1.875rem 2rem 2rem;
  }

  :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div:first-child {
    padding-inline-start: 0;
  }

  :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div + div {
    border-inline-start: 1px solid var(--campaign-rule);
  }

  :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div:last-child {
    padding-inline-end: 0;
  }

  .campaign-record-list dt {
    color: var(--color-brand-primary);
    font-family: var(--font-family-statement);
    font-size: 2.125rem;
    line-height: 1.12;
  }

  .campaign-record-list dd,
  .campaign-system-list dd,
  .campaign-safety-list dd {
    color: var(--color-text-muted);
    font-size: 0.9375rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-source-line,
  .campaign-removal-sources {
    display: flex;
    flex-wrap: wrap;
    gap: 0 var(--space-2);
  }

  .campaign-source-line a,
  .campaign-removal-sources a {
    display: inline-flex;
    min-block-size: 2.75rem;
    align-items: center;
    color: var(--color-brand-primary);
    font-weight: var(--font-weight-bold);
  }

  .campaign-case,
  .campaign-demand {
    padding-block: 8.25rem 7.75rem;
    background: var(--color-surface);
  }

  .campaign-case-inner {
    gap: 3.75rem;
  }

  .campaign-section-turn {
    display: grid;
    grid-template-columns: minmax(0, 43.75rem) minmax(18rem, 1fr);
    gap: 5rem;
    align-items: end;
    justify-content: space-between;
  }

  :is(.campaign-section-turn, .campaign-removal, .campaign-demand, .campaign-participation) h2 {
    --font-size-heading-2: clamp(3.375rem, 4.17vw, 3.75rem);
    --line-height-heading: 1.05;

    margin: 0;
    color: var(--color-brand-primary);
    font-family: var(--font-family-heading);
    font-size: var(--font-size-heading-2);
    font-weight: var(--font-weight-bold);
    letter-spacing: -0.03em;
    line-height: var(--line-height-heading);
    text-wrap: balance;
  }

  .campaign-section-turn > p {
    max-inline-size: 39rem;
    font-size: 1.125rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-case-list {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 2.5rem;
  }

  .campaign-case-list > div {
    display: grid;
    align-content: start;
    gap: 0.875rem;
    min-width: 0;
    border-block-start: 2px solid var(--color-brand-accent);
    padding-block-start: 1.75rem;
  }

  .campaign-case-list > div:nth-child(2) {
    border-color: var(--color-brand-highlight);
  }

  .campaign-case-list > div:nth-child(3) {
    border-color: var(--color-brand-primary);
  }

  .campaign-case-list dt {
    display: grid;
    gap: 0.875rem;
    color: var(--color-brand-primary);
    font-size: 1.75rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.2;
  }

  .campaign-case-list dt span {
    color: var(--color-accent-action);
    font-size: 0.8125rem;
    letter-spacing: 0.08em;
    line-height: 1.4;
  }

  .campaign-case-list dd {
    font-size: 1rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-context-link {
    color: var(--color-text-muted);
    font-size: 0.875rem;
    font-weight: 400;
  }

  .campaign-system {
    padding-block: 7rem;
    background: var(--color-canvas);
  }

  .campaign-system-inner {
    gap: 2.875rem;
  }

  .campaign-system-heading {
    grid-template-columns: minmax(0, 47.5rem) auto;
    gap: 4rem;
  }

  .campaign-system-diagram {
    position: relative;
    display: grid;
    place-content: center;
    gap: 2.25rem;
    min-block-size: 22.5rem;
    padding: var(--space-7);
    overflow: hidden;
    color: var(--color-text-muted);
    background: var(--color-placeholder);
    text-align: center;
  }

  .campaign-system-diagram > span {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    inline-size: 9.75rem;
    block-size: 1.125rem;
    background: var(--color-brand-highlight);
  }

  .campaign-system-diagram > p {
    font-size: 0.875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .campaign-system-diagram > div {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    justify-content: center;
  }

  .campaign-system-diagram b {
    border-block: 1px solid rgb(4 51 79 / 32%);
    padding: var(--space-3);
    color: var(--color-brand-primary);
    font-size: 0.8125rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .campaign-system-list dt,
  .campaign-safety-list dt {
    display: grid;
    gap: var(--space-2);
    color: var(--color-brand-primary);
    font-size: 1.5rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.25;
  }

  :is(.campaign-system-list, .campaign-safety-list) dt span {
    color: var(--color-accent-action);
    font-size: 0.8125rem;
    font-weight: 400;
    line-height: 1.4;
  }

  .campaign-removal {
    padding-block: 7.375rem 7rem;
    color: var(--color-surface);
    background: var(--color-brand-primary);
  }

  .campaign-removal-inner {
    display: grid;
    grid-template-columns: minmax(0, 47.5rem) minmax(18rem, 24.375rem);
    gap: 6rem;
    align-items: end;
    justify-content: space-between;
  }

  .campaign-removal-inner > div:first-child,
  .campaign-removal-copy,
  .campaign-demand-heading > div,
  .campaign-participation-heading,
  .campaign-participation-actions,
  .campaign-updates {
    display: grid;
  }

  .campaign-removal-inner > div:first-child {
    gap: var(--space-5);
  }

  .campaign-removal .campaign-eyebrow {
    color: var(--color-brand-highlight);
  }

  .campaign-removal h2 {
    --color-brand-primary: var(--color-surface);
    --font-size-heading-2: 3.375rem;
    --line-height-heading: 1.075;

    color: var(--color-brand-primary);
  }

  .campaign-removal-copy {
    gap: var(--space-5);
    padding-block-end: var(--space-2);
  }

  .campaign-removal-copy p {
    color: rgb(255 255 255 / 82%);
    font-size: 1rem;
    line-height: 1.55;
    text-wrap: pretty;
  }

  .campaign-removal-copy .campaign-removal-lead {
    color: var(--color-surface);
    font-size: 1.1875rem;
  }

  .campaign-removal-sources {
    gap: var(--space-2) var(--space-3);
  }

  .campaign-removal-sources a,
  .campaign-inverse-link {
    --anchor-color: var(--color-surface);

    color: var(--color-surface);
  }

  .campaign-removal-sources a {
    font-size: 0.875rem;
  }

  .campaign-demand-inner {
    gap: 3.625rem;
  }

  .campaign-demand-heading {
    display: grid;
    grid-template-columns: minmax(0, 36.875rem) minmax(20rem, 31.25rem);
    gap: 6rem;
    justify-content: space-between;
  }

  .campaign-demand h2 {
    --font-size-heading-2: 3.625rem;
  }

  .campaign-demand-heading > div {
    align-content: start;
    gap: 1.125rem;
    padding-block-start: 0.625rem;
  }

  .campaign-demand-heading > div > p:first-child {
    font-size: 1.125rem;
    line-height: 1.6;
    text-wrap: pretty;
  }

  .campaign-demand-leadin {
    color: var(--color-accent-action);
  }

  .campaign-demand-list {
    border-block-start: 1px solid var(--campaign-rule);
    padding: 0;
    list-style: none;
    counter-reset: demand;
  }

  .campaign-demand-list li {
    display: grid;
    grid-template-columns: 6rem minmax(0, 1fr);
    gap: 2.25rem;
    padding-block: 1.875rem 2rem;
    border-block-end: 1px solid var(--campaign-rule);
    font-size: 1.0625rem;
    line-height: 1.6;
    text-wrap: pretty;
    counter-increment: demand;
  }

  .campaign-demand-list li::before {
    color: var(--color-brand-highlight);
    font-family: var(--font-family-statement);
    font-size: 2.25rem;
    line-height: 1.1;
    content: counter(demand, decimal-leading-zero);
  }

  .campaign-demand-list li:nth-child(2)::before,
  .campaign-demand-list li:nth-child(5)::before {
    color: var(--color-brand-accent);
  }

  .campaign-demand-list li:nth-child(3)::before {
    color: var(--color-brand-primary);
  }

  .campaign-safety {
    padding-block: 7rem 6.875rem;
    background: var(--color-canvas);
  }

  .campaign-safety-inner {
    gap: 3.25rem;
  }

  .campaign-safety-heading {
    grid-template-columns: minmax(0, 51.25rem) minmax(17rem, 21.25rem);
    gap: 4.5rem;
  }

  .campaign-safety-heading h2 {
    --font-size-heading-2: 3.375rem;
    --line-height-heading: 1.075;
  }

  .campaign-safety-list dt {
    font-size: 1.375rem;
  }

  .campaign-participation {
    padding-block: 7.375rem 6.875rem;
    color: var(--color-surface);
    background: var(--color-accent-action);
  }

  .campaign-participation-inner {
    display: grid;
    grid-template-columns: minmax(0, 35.625rem) minmax(20rem, 35.375rem);
    gap: 7rem;
    align-items: start;
    justify-content: space-between;
  }

  .campaign-participation-heading {
    gap: var(--space-5);
  }

  .campaign-participation :is(.campaign-eyebrow, h2),
  .campaign-participation-heading > p:last-child {
    color: var(--color-surface);
  }

  .campaign-participation h2 {
    --color-brand-primary: var(--color-surface);
    --font-size-heading-2: 3.625rem;

    color: var(--color-brand-primary);
  }

  .campaign-participation-heading > p:last-child {
    max-inline-size: 30rem;
    font-size: 1.1875rem;
    line-height: 1.58;
  }

  .campaign-participation-actions {
    gap: 1.75rem;
    min-width: 0;
  }

  .campaign-participation-list {
    border-block-start: 1px solid var(--campaign-white-rule);
    padding: 0;
    list-style: none;
  }

  .campaign-participation-list li {
    display: flex;
    gap: var(--space-4);
    align-items: center;
    justify-content: space-between;
    min-block-size: 4rem;
    border-block-end: 1px solid var(--campaign-white-rule);
    padding-block: var(--space-3);
    color: var(--color-surface);
    font-size: 1.0625rem;
    line-height: 1.4;
  }

  .campaign-participation-list li span:first-child {
    min-width: 0;
  }

  .campaign-participation-list li span:last-child {
    flex: 0 0 auto;
  }

  .campaign-outline-action {
    --anchor-color: var(--color-surface);

    border: 1px solid var(--color-surface);
    color: var(--color-surface);
  }

  .campaign-outline-action:hover,
  .campaign-outline-action:focus-visible {
    color: var(--color-accent-action);
    background: var(--color-surface);
  }

  .campaign-updates {
    justify-items: start;
    gap: var(--space-2);
    border-block-start: 1px solid var(--campaign-white-rule);
    padding-block-start: var(--space-5);
  }

  .campaign-updates h3 {
    --font-size-heading-3: 1rem;

    margin: 0;
    color: var(--color-surface);
    font-family: var(--font-family-body);
    font-size: var(--font-size-heading-3);
    font-weight: var(--font-weight-bold);
    line-height: 1.4;
  }

  .campaign-updates p {
    color: rgb(255 255 255 / 78%);
    font-size: 0.875rem;
  }

  :is(
    .campaign-primary-action,
    .campaign-outline-action,
    .campaign-participation .campaign-inverse-link,
    .campaign-removal a
  ):focus-visible {
    outline-color: var(--color-surface);
  }

  @media (width <= 64rem) {
    .campaign-hero,
    .campaign-section-turn,
    .campaign-removal-inner,
    .campaign-demand-heading,
    .campaign-participation-inner {
      grid-template-columns: minmax(0, 1fr);
    }

    .campaign-hero-copy {
      padding-inline: var(--campaign-gutter);
    }

    .campaign-hero-facts {
      padding-inline: var(--campaign-gutter);
    }

    .campaign-case-list {
      gap: var(--space-5);
    }

    .campaign-record-list,
    .campaign-system-list,
    .campaign-safety-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div:nth-child(3) {
      border-inline-start: 0;
      padding-inline-start: 0;
    }

    :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div:nth-child(n + 3) {
      border-block-start: 1px solid var(--campaign-rule);
    }

    :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div:nth-child(2) {
      padding-inline-end: 0;
    }
  }

  @media (width <= 46rem) {
    .campaign-eyebrow {
      font-size: 0.75rem;
      letter-spacing: 0.09em;
    }

    .campaign-hero-copy {
      gap: 1.25rem;
      padding-block: 3.375rem 3.875rem;
    }

    .campaign-hero h1 {
      --font-size-heading-1: clamp(2.5rem, 10.77vw, 2.625rem);
      --line-height-heading: 1.05;

      max-inline-size: none;
      font-size: var(--font-size-heading-1);
      line-height: var(--line-height-heading);
    }

    .campaign-hero-description,
    .campaign-section-turn > p,
    .campaign-demand-heading > div > p:first-child,
    .campaign-participation-heading > p:last-child {
      font-size: 1.0625rem;
      line-height: 1.6;
    }

    .campaign-action-cluster {
      align-items: flex-start;
      flex-direction: column;
    }

    .campaign-hero-facts {
      gap: 1.875rem;
      padding-block: 3.875rem 4rem;
    }

    .campaign-hero-facts dd {
      font-size: clamp(2.5rem, 13.33vw, 3.25rem);
    }

    .campaign-record {
      padding-block: 3.75rem 3.875rem;
    }

    .campaign-record-inner {
      gap: 1.375rem;
    }

    .campaign-record-heading {
      align-items: flex-start;
      flex-direction: column;
      gap: var(--space-2);
    }

    .campaign-record-heading h2 {
      --font-size-heading-2: 0.75rem;
    }

    .campaign-record-heading p {
      font-size: 0.8125rem;
      line-height: 1.55;
    }

    .campaign-record-list,
    .campaign-case-list,
    .campaign-system-list,
    .campaign-safety-list {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) {
      border-block-end: 0;
    }

    :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) > div {
      border-inline-start: 0;
      border-block-end: 1px solid var(--campaign-rule);
      padding: 1.25rem 0;
    }

    .campaign-record-list dt {
      font-family: var(--font-family-heading);
      font-size: 1.5rem;
      font-weight: var(--font-weight-bold);
    }

    :is(.campaign-record-list, .campaign-system-list, .campaign-safety-list) dd,
    .campaign-source-line a {
      font-size: 1rem;
    }

    .campaign-case,
    .campaign-demand {
      padding-block: 4.75rem 4.5rem;
    }

    .campaign-case-inner,
    .campaign-system-inner,
    .campaign-demand-inner,
    .campaign-safety-inner {
      gap: 1.75rem;
    }

    .campaign-section-turn,
    .campaign-safety-heading {
      gap: 0.875rem;
    }

    :is(.campaign-section-turn, .campaign-removal, .campaign-demand, .campaign-participation) h2 {
      --font-size-heading-2: clamp(2.25rem, 9.74vw, 2.375rem);
      --line-height-heading: 1.08;

      font-size: var(--font-size-heading-2);
      line-height: var(--line-height-heading);
    }

    .campaign-case-list {
      border-block-start: 1px solid var(--campaign-rule);
    }

    .campaign-case-list > div {
      gap: 0.5625rem;
      border-block-start: 0;
      border-block-end: 1px solid var(--campaign-rule);
      padding-block: 1.375rem 1.5rem;
    }

    .campaign-case-list dt {
      gap: 0.5625rem;
      font-size: 1.4375rem;
    }

    .campaign-case-list dt span {
      color: var(--color-brand-accent);
      font-family: var(--font-family-statement);
      font-size: 1.625rem;
      letter-spacing: 0;
    }

    .campaign-case-list > div:nth-child(2) dt span {
      color: var(--color-brand-highlight);
    }

    .campaign-case-list > div:nth-child(3) dt span {
      color: var(--color-brand-primary);
    }

    .campaign-context-link,
    .campaign-removal-sources a {
      font-size: 1rem;
    }

    .campaign-system,
    .campaign-safety,
    .campaign-removal,
    .campaign-participation {
      padding-block: 4.375rem 4.25rem;
    }

    .campaign-system-diagram {
      gap: var(--space-5);
      min-block-size: 14.375rem;
      padding: var(--space-5);
    }

    .campaign-system-diagram > span {
      inline-size: 5.5rem;
      block-size: 0.75rem;
    }

    .campaign-system-diagram > p {
      font-size: 0.75rem;
    }

    .campaign-system-diagram > div {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      inline-size: 100%;
    }

    .campaign-system-list dt,
    .campaign-safety-list dt {
      grid-template-columns: 2.25rem minmax(0, 1fr);
      align-items: start;
      font-size: 1.3125rem;
    }

    :is(.campaign-system-list, .campaign-safety-list) dt span {
      padding-block-start: var(--space-1);
    }

    .campaign-removal-inner {
      gap: 1.25rem;
    }

    .campaign-removal-copy {
      gap: var(--space-4);
    }

    .campaign-removal-copy p,
    .campaign-removal-copy .campaign-removal-lead {
      font-size: 1.0625rem;
      line-height: 1.6;
    }

    .campaign-demand-heading {
      gap: 1.75rem;
    }

    .campaign-demand-heading > div {
      gap: 1.125rem;
      padding-block-start: 0;
    }

    .campaign-demand-list li {
      grid-template-columns: minmax(0, 1fr);
      gap: 0.625rem;
      padding-block: 1.375rem 1.5rem;
      font-size: 1rem;
      line-height: 1.55;
    }

    .campaign-demand-list li::before {
      font-size: 1.875rem;
    }

    .campaign-participation-inner {
      gap: 1.375rem;
    }

    .campaign-participation-heading {
      gap: 1.25rem;
    }

    .campaign-participation-actions {
      gap: 1.375rem;
    }

    .campaign-participation-list li {
      min-block-size: 3.625rem;
      font-size: 1rem;
    }

    .campaign-participation-links {
      align-items: flex-start;
      flex-direction: column;
    }

    .campaign-updates p {
      font-size: 1rem;
    }
  }

  @media (width <= 22rem) {
    :is(.campaign-primary-action, .campaign-outline-action) {
      inline-size: 100%;
    }

    .campaign-system-diagram > div {
      grid-template-columns: minmax(0, 1fr);
    }
  }
}
</style>
