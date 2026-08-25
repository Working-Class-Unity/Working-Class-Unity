#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Keep libvips concurrency modest in CI and small production builders. The
// source set is processed sequentially; high native-thread fan-out only adds
// memory pressure and can cause the process to be killed without diagnostics.
sharp.concurrency(2)

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const DEFAULT_ROOT = resolve(dirname(SCRIPT_PATH), '..')

const PHOTO_WIDTHS = [320, 640]
const BACKGROUND_WIDTHS = [768, 1280, 1920]
const SOURCE_EXTENSIONS = new Set(['.avif', '.jpeg', '.jpg', '.png', '.webp'])
const GENERATED_EXTENSIONS = new Set(['.avif', '.webp'])

const BACKGROUND_SOURCES = [
  { id: 'landscape', filename: 'landscape.png' },
  { id: 'portrait', filename: 'portrait.png' },
  { id: 'portrait-tall', filename: 'portrait-tall.png' }
]

const ASSET_GROUPS = {
  backgrounds: {
    sourceDirectory: 'app/assets/images/hero-background/source',
    outputDirectory: 'public/images/hero',
    publicDirectory: '/images/hero',
    widths: BACKGROUND_WIDTHS
  },
  photos: {
    sourceDirectory: 'app/assets/images/hero-wall/source',
    outputDirectory: 'public/images/hero-wall',
    publicDirectory: '/images/hero-wall',
    widths: PHOTO_WIDTHS
  }
}

const OUTPUT_OPTIONS = {
  backgrounds: {
    avif: { quality: 60, effort: 5 },
    webp: { quality: 84, effort: 5, smartSubsample: true }
  },
  photos: {
    avif: { quality: 52, effort: 5 },
    webp: { quality: 80, effort: 5, smartSubsample: true }
  }
}

function digest(value, length = 16) {
  return createHash('sha256').update(value).digest('hex').slice(0, length)
}

function isInside(root, target) {
  const pathFromRoot = relative(root, target)
  return (
    pathFromRoot === '' || (pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  )
}

function resolveRepositoryPath(root, repositoryPath) {
  const target = resolve(root, repositoryPath)
  if (!isInside(root, target)) {
    throw new Error(`Refusing to access a path outside the repository: ${repositoryPath}`)
  }
  return target
}

async function assertSafeDirectory(root, directory) {
  const directoryStats = await lstat(directory)
  if (!directoryStats.isDirectory()) {
    throw new Error(`Expected a regular directory: ${relative(root, directory)}`)
  }

  const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)])
  if (!isInside(realRoot, realDirectory)) {
    throw new Error(`Refusing to access a directory outside the repository: ${relative(root, directory)}`)
  }
}

function orientedDimensions(metadata, sourceName) {
  if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
    throw new Error(`Unable to read dimensions from ${sourceName}`)
  }

  const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation)
  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height }
}

function aspectRatio(width, height) {
  return Number((width / height).toFixed(6))
}

async function listImageSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const sources = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    if (entry.name.startsWith('.')) continue
    if (!entry.isFile()) {
      throw new Error(`Hero source directories may contain only regular files: ${join(directory, entry.name)}`)
    }

    const extension = extname(entry.name).toLowerCase()
    if (!SOURCE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported hero image extension ${extension || '(none)'}: ${entry.name}`)
    }
    sources.push({ filename: entry.name, path: join(directory, entry.name) })
  }

  return sources
}

function effectiveWidths(sourceWidth, requestedWidths) {
  return [...new Set(requestedWidths.map((width) => Math.min(width, sourceWidth)))].sort((left, right) => left - right)
}

async function encodeVariant({ input, width, format, options }) {
  let pipeline = sharp(input).autoOrient().resize({
    width,
    fit: 'inside',
    withoutEnlargement: true
  })

  pipeline = format === 'avif' ? pipeline.avif(options) : pipeline.webp(options)
  return pipeline.toBuffer({ resolveWithObject: true })
}

async function buildAsset({ group, id, source, widths, outputDirectory, publicDirectory, expectedFiles }) {
  const input = await readFile(source.path)
  const metadata = await sharp(input).metadata()
  const dimensions = orientedDimensions(metadata, source.filename)
  const variants = { avif: [], webp: [] }
  const encodings = []

  for (const format of ['avif', 'webp']) {
    for (const requestedWidth of effectiveWidths(dimensions.width, widths)) {
      encodings.push({ format, requestedWidth })
    }
  }

  const encodedVariants = await Promise.all(
    encodings.map(async ({ format, requestedWidth }) => ({
      format,
      ...(await encodeVariant({
        input,
        width: requestedWidth,
        format,
        options: OUTPUT_OPTIONS[group][format]
      }))
    }))
  )

  for (const { format, data, info } of encodedVariants) {
    if (info.width > dimensions.width || info.height > dimensions.height) {
      throw new Error(`Generated asset unexpectedly upscaled ${source.filename}`)
    }

    const outputHash = digest(data, 12)
    const filename = `${id}-${info.width}w-${outputHash}.${format}`
    expectedFiles.set(join(outputDirectory, filename), data)
    variants[format].push({
      src: `${publicDirectory}/${filename}`,
      width: info.width,
      height: info.height
    })
  }

  return {
    id,
    source: source.filename,
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio: aspectRatio(dimensions.width, dimensions.height),
    variants
  }
}

async function buildExpectedAssets(root) {
  const expectedFiles = new Map()
  const photoSourceDirectory = resolveRepositoryPath(root, ASSET_GROUPS.photos.sourceDirectory)
  const backgroundSourceDirectory = resolveRepositoryPath(root, ASSET_GROUPS.backgrounds.sourceDirectory)
  const photoOutputDirectory = resolveRepositoryPath(root, ASSET_GROUPS.photos.outputDirectory)
  const backgroundOutputDirectory = resolveRepositoryPath(root, ASSET_GROUPS.backgrounds.outputDirectory)

  await Promise.all([
    assertSafeDirectory(root, photoSourceDirectory),
    assertSafeDirectory(root, backgroundSourceDirectory)
  ])

  const photoSources = await listImageSources(photoSourceDirectory)
  if (photoSources.length === 0) throw new Error('At least one hero-wall photo is required')

  const photos = []
  const seenPhotoHashes = new Set()
  for (const source of photoSources) {
    const input = await readFile(source.path)
    const sourceHash = digest(input, 64)
    if (seenPhotoHashes.has(sourceHash)) continue
    seenPhotoHashes.add(sourceHash)

    photos.push(
      await buildAsset({
        group: 'photos',
        id: `photo-${sourceHash.slice(0, 16)}`,
        source,
        widths: ASSET_GROUPS.photos.widths,
        outputDirectory: photoOutputDirectory,
        publicDirectory: ASSET_GROUPS.photos.publicDirectory,
        expectedFiles
      })
    )
  }

  const backgroundSources = new Map(
    (await listImageSources(backgroundSourceDirectory)).map((source) => [source.filename, source])
  )
  const expectedBackgroundNames = new Set(BACKGROUND_SOURCES.map(({ filename }) => filename))
  for (const filename of backgroundSources.keys()) {
    if (!expectedBackgroundNames.has(filename)) {
      throw new Error(`Unexpected hero background source: ${filename}`)
    }
  }

  const backgrounds = []
  for (const background of BACKGROUND_SOURCES) {
    const source = backgroundSources.get(background.filename)
    if (!source) throw new Error(`Missing hero background source: ${background.filename}`)

    backgrounds.push(
      await buildAsset({
        group: 'backgrounds',
        id: background.id,
        source,
        widths: ASSET_GROUPS.backgrounds.widths,
        outputDirectory: backgroundOutputDirectory,
        publicDirectory: ASSET_GROUPS.backgrounds.publicDirectory,
        expectedFiles
      })
    )
  }

  return {
    expectedFiles,
    manifest: {
      version: 1,
      backgrounds,
      photos
    },
    outputDirectories: [photoOutputDirectory, backgroundOutputDirectory]
  }
}

async function fileMatches(path, expected) {
  try {
    const actual = await readFile(path)
    return actual.equals(expected)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function listGeneratedFiles(directory, { allowMissing }) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (allowMissing && error?.code === 'ENOENT') return []
    throw error
  }

  const paths = []
  for (const entry of entries) {
    if (!entry.isFile()) {
      throw new Error(`Generated hero directories may contain only regular files: ${join(directory, entry.name)}`)
    }
    if (GENERATED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      paths.push(join(directory, entry.name))
    }
  }
  return paths.sort((left, right) => left.localeCompare(right, 'en'))
}

async function writeAtomically(path, data) {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, data)
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function reconcile({ root, check, expectedFiles, outputDirectories, manifest }) {
  const drift = []
  const expectedPaths = new Set(expectedFiles.keys())

  for (const outputDirectory of outputDirectories) {
    if (!check) await mkdir(outputDirectory, { recursive: true })
    try {
      await assertSafeDirectory(root, outputDirectory)
    } catch (error) {
      if (!(check && error?.code === 'ENOENT')) throw error
    }
    const actualFiles = await listGeneratedFiles(outputDirectory, { allowMissing: check })

    for (const actualPath of actualFiles) {
      if (expectedPaths.has(actualPath)) continue
      if (check) drift.push(`stale output: ${relative(root, actualPath)}`)
      else await unlink(actualPath)
    }
  }

  for (const [path, expected] of expectedFiles) {
    if (await fileMatches(path, expected)) continue
    if (check) drift.push(`missing or changed output: ${relative(root, path)}`)
    else await writeAtomically(path, expected)
  }

  const manifestPath = resolveRepositoryPath(root, 'app/generated/hero-assets.json')
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  if (!(await fileMatches(manifestPath, manifestBytes))) {
    if (check) drift.push('missing or changed manifest: app/generated/hero-assets.json')
    else {
      await mkdir(dirname(manifestPath), { recursive: true })
      await assertSafeDirectory(root, dirname(manifestPath))
      await writeAtomically(manifestPath, manifestBytes)
    }
  }

  if (drift.length > 0) {
    throw new Error(`Hero assets are out of date:\n- ${drift.join('\n- ')}`)
  }
}

export async function generateHeroAssets({ root = DEFAULT_ROOT, check = false } = {}) {
  const repositoryRoot = resolve(root)
  const expected = await buildExpectedAssets(repositoryRoot)
  await reconcile({ root: repositoryRoot, check, ...expected })
  return {
    backgrounds: expected.manifest.backgrounds.length,
    photos: expected.manifest.photos.length,
    outputs: expected.expectedFiles.size
  }
}

async function runCli() {
  const arguments_ = process.argv.slice(2)
  const unknownArguments = arguments_.filter((argument) => argument !== '--check')
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown argument${unknownArguments.length === 1 ? '' : 's'}: ${unknownArguments.join(', ')}`)
  }

  const check = arguments_.includes('--check')
  const result = await generateHeroAssets({ check })
  const action = check ? 'Verified' : 'Generated'
  console.log(`${action} ${result.photos} hero photos and ${result.backgrounds} backgrounds (${result.outputs} files).`)
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
