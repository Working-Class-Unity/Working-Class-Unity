import { readdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const defaultOutputDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)), '.output')

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw new Error('Usage: node source-map-cleanup.mjs')
  const removedCount = await removeSourceMapsFromDeployableOutput(defaultOutputDirectory)
  console.log(`Removed and verified ${removedCount} source-map artifact(s) from the Nuxt output.`)
}

export async function removeSourceMapsFromDeployableOutput(outputDirectory) {
  const outputRoot = resolve(outputDirectory)
  const generatedMaps = await findSourceMaps(outputRoot)

  for (const mapPath of generatedMaps) await rm(mapPath)

  const remainingMaps = await findSourceMaps(outputRoot)
  if (remainingMaps.length) {
    throw new Error(`Source-map cleanup left ${remainingMaps.length} artifact(s) in the Nuxt output`)
  }

  return generatedMaps.length
}

async function findSourceMaps(directory) {
  const sourceMaps = []

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name)

    if (entry.name.endsWith('.map')) {
      sourceMaps.push(entryPath)
    } else if (entry.isDirectory()) {
      sourceMaps.push(...(await findSourceMaps(entryPath)))
    }
  }

  return sourceMaps.sort((left, right) => left.localeCompare(right))
}
