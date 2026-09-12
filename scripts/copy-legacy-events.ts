import { copyLegacyEvents } from '../server/db/copy-legacy-events'

const args = process.argv.slice(2)
try {
  if (args.length !== 4 || args[0] !== '--source' || args[2] !== '--destination' || !args[1] || !args[3]) {
    throw new Error('Usage: copy-legacy-events --source /private/legacy.db --destination /private/events.db')
  }
  console.log(JSON.stringify(copyLegacyEvents(args[1], args[3]), null, 2))
} catch (error) {
  console.error(`Event copy failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
