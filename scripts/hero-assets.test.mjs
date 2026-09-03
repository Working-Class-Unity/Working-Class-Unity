import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import { generateHeroAssets } from './generate-hero-assets.mjs'

async function createImage(path, { width, height, color, orientation }) {
  let image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  })

  if (orientation) image = image.withMetadata({ orientation })
  await image.jpeg({ quality: 90 }).toFile(path)
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'wcu-hero-assets-'))
  const photoSources = join(root, 'app/assets/images/hero-wall/source')
  const backgroundSources = join(root, 'app/assets/images/hero-background/source')
  await mkdir(photoSources, { recursive: true })
  await mkdir(backgroundSources, { recursive: true })

  await createImage(join(photoSources, 'b-photo.jpg'), {
    width: 200,
    height: 100,
    color: '#ef2525'
  })
  await createImage(join(photoSources, 'a-oriented.jpg'), {
    width: 700,
    height: 400,
    color: '#04334f',
    orientation: 6
  })
  await createImage(join(photoSources, 'not-selected.jpg'), {
    width: 800,
    height: 600,
    color: '#232323'
  })
  await writeFile(
    join(root, 'app/assets/images/hero-wall/selection.json'),
    JSON.stringify(['a-oriented.jpg', 'b-photo.jpg'])
  )
  await createImage(join(backgroundSources, 'landscape.png'), {
    width: 900,
    height: 500,
    color: '#ff9f48'
  })
  await createImage(join(backgroundSources, 'portrait.png'), {
    width: 500,
    height: 900,
    color: '#f7f9fc'
  })
  await createImage(join(backgroundSources, 'portrait-tall.png'), {
    width: 420,
    height: 900,
    color: '#232323'
  })

  return root
}

test('generates deterministic, metadata-free assets without upscaling', async () => {
  const root = await createFixture()
  const first = await generateHeroAssets({ root })
  assert.deepEqual(first, { backgrounds: 3, photos: 2, outputs: 14 })

  const manifestPath = join(root, 'app/generated/hero-assets.json')
  const firstManifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(firstManifestBytes)
  assert.equal(manifest.version, 1)
  assert.deepEqual(
    manifest.backgrounds.map(({ id }) => id),
    ['landscape', 'portrait', 'portrait-tall']
  )
  assert.deepEqual(
    manifest.photos.map(({ source }) => source),
    ['a-oriented.jpg', 'b-photo.jpg']
  )

  const oriented = manifest.photos[0]
  assert.equal(oriented.width, 400)
  assert.equal(oriented.height, 700)
  assert.equal(oriented.aspectRatio, 0.571429)

  for (const asset of [...manifest.backgrounds, ...manifest.photos]) {
    for (const variants of Object.values(asset.variants)) {
      for (const variant of variants) {
        assert.ok(variant.width <= asset.width)
        assert.ok(variant.height <= asset.height)
        const metadata = await sharp(join(root, 'public', variant.src)).metadata()
        assert.equal(metadata.orientation, undefined)
        assert.equal(metadata.exif, undefined)
        assert.equal(metadata.icc, undefined)
        assert.equal(metadata.iptc, undefined)
        assert.equal(metadata.xmp, undefined)
      }
    }
  }

  await generateHeroAssets({ root })
  assert.deepEqual(await readFile(manifestPath), firstManifestBytes)
  await generateHeroAssets({ root, check: true })
})

test('check mode reports drift without mutating and generation safely removes stale images', async () => {
  const root = await createFixture()
  await generateHeroAssets({ root })

  const manifest = JSON.parse(await readFile(join(root, 'app/generated/hero-assets.json')))
  const generatedPath = join(root, 'public', manifest.photos[0].variants.webp[0].src)
  await writeFile(generatedPath, 'changed')
  const changedBytes = await readFile(generatedPath)

  await assert.rejects(generateHeroAssets({ root, check: true }), /missing or changed output/)
  assert.deepEqual(await readFile(generatedPath), changedBytes)

  await generateHeroAssets({ root })
  const stalePath = join(root, 'public/images/hero-wall/stale.webp')
  const sentinelPath = join(root, 'public/images/hero-wall/README.txt')
  await writeFile(stalePath, 'stale')
  await writeFile(sentinelPath, 'keep')

  await assert.rejects(generateHeroAssets({ root, check: true }), /stale output/)
  assert.equal(await readFile(stalePath, 'utf8'), 'stale')

  await generateHeroAssets({ root })
  await assert.rejects(readFile(stalePath), { code: 'ENOENT' })
  assert.equal(await readFile(sentinelPath, 'utf8'), 'keep')
})
