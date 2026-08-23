import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  BRAND_COLORS,
  CONTRAST_STEPS,
  GENERATED_FILE,
  SCALE_SEEDS,
  buildColorPrimitives
} from './generate-color-tokens.mjs'

const semanticTokensFile = fileURLToPath(new URL('../app/assets/css/tokens.css', import.meta.url))

function customProperties(source) {
  return new Map([...source.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]))
}

function resolveColor(name, properties, seen = new Set()) {
  if (seen.has(name)) {
    throw new Error(`Circular color token reference: ${name}`)
  }

  seen.add(name)
  const value = properties.get(name)
  const reference = value?.match(/^var\((--[\w-]+)\)$/)?.[1]

  if (!value) {
    throw new Error(`Missing color token: ${name}`)
  }

  return reference ? resolveColor(reference, properties, seen) : value
}

function relativeLuminance(hex) {
  let channels = hex.replace('#', '')

  if (channels.length === 3) {
    channels = [...channels].map((channel) => channel.repeat(2)).join('')
  }

  assert.match(channels, /^[\da-f]{6}$/i)

  const linearChannels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(channels.slice(offset, offset + 2), 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })

  return linearChannels[0] * 0.2126 + linearChannels[1] * 0.7152 + linearChannels[2] * 0.0722
}

function contrastRatio(first, second) {
  const luminances = [relativeLuminance(first), relativeLuminance(second)].sort((left, right) => right - left)
  return (luminances[0] + 0.05) / (luminances[1] + 0.05)
}

test('the checked-in color primitives match Leonardo output', () => {
  assert.equal(readFileSync(GENERATED_FILE, 'utf8'), buildColorPrimitives())
})

test('the exact brand anchors are preserved', () => {
  const properties = customProperties(readFileSync(GENERATED_FILE, 'utf8'))

  for (const [name, value] of Object.entries(BRAND_COLORS)) {
    assert.equal(properties.get(`--primitive-brand-${name}`), value)
  }
})

test('each generated scale step meets its named canvas contrast minimum', () => {
  const properties = customProperties(readFileSync(GENERATED_FILE, 'utf8'))
  const canvas = properties.get('--primitive-brand-canvas')

  assert.ok(canvas)

  for (const family of Object.keys(SCALE_SEEDS)) {
    for (const [step, minimum] of Object.entries(CONTRAST_STEPS)) {
      const name = `--primitive-${family}-${step}`
      const value = properties.get(name)

      assert.ok(value, `${name} must be generated`)
      assert.ok(contrastRatio(value, canvas) >= minimum, `${name} must have at least ${minimum}:1 contrast on canvas`)
    }
  }
})

test('semantic foreground and background pairs meet their accessibility contracts', () => {
  const properties = new Map([
    ...customProperties(readFileSync(GENERATED_FILE, 'utf8')),
    ...customProperties(readFileSync(semanticTokensFile, 'utf8'))
  ])
  const pairs = [
    ['--color-text', '--color-canvas', 4.5],
    ['--color-text-muted', '--color-canvas', 4.5],
    ['--color-control-border', '--color-canvas', 3],
    ['--color-action', '--color-action-contrast', 4.5],
    ['--color-accent-action', '--color-accent-action-contrast', 4.5],
    ['--color-status-success-text', '--color-status-success-surface', 4.5],
    ['--color-status-warning-text', '--color-status-warning-surface', 4.5],
    ['--color-status-error-text', '--color-status-error-surface', 4.5],
    ['--color-highlight-contrast', '--color-brand-highlight', 4.5]
  ]

  for (const [foreground, background, minimum] of pairs) {
    const ratio = contrastRatio(resolveColor(foreground, properties), resolveColor(background, properties))
    assert.ok(ratio >= minimum, `${foreground} on ${background} must have at least ${minimum}:1 contrast`)
  }
})
