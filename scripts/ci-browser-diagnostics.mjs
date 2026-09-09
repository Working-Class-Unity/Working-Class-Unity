import fs from 'node:fs'
import { join } from 'node:path'

export function createOutputMonitor(label, values) {
  const forbiddenValues = [...values]
  let forbiddenBuffers = forbiddenValues.map((value) => Buffer.from(value))
  let detected = false
  let overflow = false
  let output = Buffer.alloc(0)

  function inspect(bytes) {
    if (forbiddenBuffers.some((value) => bytes.includes(value))) detected = true
  }

  return {
    label,
    consume(chunk) {
      if (overflow) return
      const bytes = Buffer.from(chunk)
      const remaining = 1_048_576 - output.length
      output = Buffer.concat([output, bytes.subarray(0, Math.max(0, remaining))])
      if (bytes.length > remaining) overflow = true
      inspect(output)
    },
    inspect,
    registerForbidden(values) {
      const additions = values.filter(Boolean).map((value) => Buffer.from(value))
      forbiddenValues.push(...values.filter(Boolean))
      forbiddenBuffers = [...forbiddenBuffers, ...additions]
      inspect(output)
    },
    assertNoForbidden() {
      if (overflow) throw new Error(`${label} exceeded the bounded private-output observation limit`)
      if (detected) throw new Error(`${label} contained a forbidden private value`)
    },
    redactedDiagnostic() {
      if (overflow) return `${label} output omitted after bounded observation overflow`
      const redactionOverlap = Math.max(...forbiddenValues.map((value) => Buffer.byteLength(value)))
      let diagnostic = output.subarray(-(32_768 + redactionOverlap)).toString()
      for (const value of [...forbiddenValues].sort((left, right) => right.length - left.length)) {
        diagnostic = diagnostic.replaceAll(value, '[redacted]')
      }
      return diagnostic.slice(-32_768)
    }
  }
}

export function reportBrowserDiagnostics(monitors, safe) {
  if (safe) {
    for (const monitor of monitors) {
      const diagnostic = monitor.redactedDiagnostic().trim()
      if (diagnostic) {
        console.error(`${monitor.label} output (redacted):`)
        console.error(diagnostic)
      }
    }
  } else {
    console.error('Browser diagnostics withheld because private-output validation did not complete safely.')
  }
}

export function scanArtifactTree(directory, outputMonitor) {
  const maxBytes = 16_777_216
  let observedBytes = 0
  let observedFiles = 0
  // Only controlled operation names and counters may escape a failed inspection.
  let reason = 'directory-read'
  try {
    const pending = [directory]
    while (pending.length) {
      const current = pending.pop()
      reason = 'directory-read'
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name)
        reason = 'inspection'
        outputMonitor.inspect(Buffer.from(path))
        if (entry.isDirectory()) pending.push(path)
        else if (entry.isFile()) {
          reason = 'stat'
          const expectedSize = fs.statSync(path).size
          observedBytes += expectedSize
          observedFiles += 1
          reason = 'aggregate-budget'
          if (observedBytes > maxBytes) throw new Error()
          reason = 'file-read'
          const bytes = fs.readFileSync(path)
          reason = 'size-changed'
          if (bytes.length !== expectedSize) throw new Error()
          reason = 'inspection'
          outputMonitor.inspect(bytes)
        } else {
          reason = 'unsupported-entry'
          throw new Error()
        }
      }
    }
  } catch {
    const detail =
      reason === 'aggregate-budget'
        ? ` (observed ${observedBytes} bytes across ${observedFiles} files; limit ${maxBytes} bytes)`
        : ''
    throw new Error(`Playwright artifact secrecy scan failed closed: ${reason}${detail}`)
  }
}
