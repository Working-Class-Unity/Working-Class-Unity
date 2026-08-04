import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, getFileInfo, resolveConfig } from 'prettier'

export function collectChangedFiles({ root = process.cwd(), baseSha, headSha = 'HEAD', all = false } = {}) {
  const files = new Set()

  if (all) {
    addGitFiles(files, root, ['ls-files', '-z'])
  } else if (baseSha) {
    assertCommit(root, headSha)

    if (isZeroSha(baseSha)) {
      addGitFiles(files, root, ['ls-tree', '-r', '--name-only', '-z', headSha])
    } else {
      assertCommit(root, baseSha)
      addGitFiles(files, root, ['diff', '--name-only', '--diff-filter=ACMRT', '-z', `${baseSha}...${headSha}`])
    }
  }

  if (!all) {
    addGitFiles(files, root, ['diff', '--name-only', '--diff-filter=ACMRT', '-z'])
    addGitFiles(files, root, ['diff', '--cached', '--name-only', '--diff-filter=ACMRT', '-z'])
    addGitFiles(files, root, ['ls-files', '--others', '--exclude-standard', '-z'])
  }

  return [...files].filter((file) => isRepositoryFile(root, file)).sort((left, right) => left.localeCompare(right))
}

export async function findUnformattedFiles(root, files) {
  const failures = []

  for (const file of files) {
    const absolutePath = resolve(root, file)
    const info = await getFileInfo(absolutePath, {
      ignorePath: join(root, '.prettierignore')
    })

    if (info.ignored || !info.inferredParser) {
      continue
    }

    const config = (await resolveConfig(absolutePath)) ?? {}
    const source = readFileSync(absolutePath, 'utf8')
    const formatted = await check(source, {
      ...config,
      filepath: absolutePath
    })

    if (!formatted) {
      failures.push(file)
    }
  }

  return failures
}

export async function isSourceFormatted(source, filepath, options = {}) {
  return check(source, { ...options, filepath })
}

async function main() {
  const args = process.argv.slice(2)
  const root = process.cwd()
  const files = collectChangedFiles({
    root,
    baseSha: readOption(args, '--base') ?? process.env.FORMAT_BASE_SHA,
    headSha: readOption(args, '--head') ?? process.env.FORMAT_HEAD_SHA ?? 'HEAD',
    all: args.includes('--all')
  })
  const failures = await findUnformattedFiles(root, files)

  if (failures.length) {
    console.error('Formatting check failed for:')
    console.error(failures.map((file) => `- ${file}`).join('\n'))
    console.error('Run the pinned formatter on those files before committing.')
    process.exit(1)
  }

  console.log(`Formatting check passed: ${files.length} changed file(s) considered.`)
}

function addGitFiles(files, root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed with exit ${result.status}`)
  }

  for (const file of result.stdout.split('\0')) {
    if (file) {
      files.add(file)
    }
  }
}

function assertCommit(root, ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd: root,
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    throw new Error(`Formatting base/head ref is not available as a commit: ${ref}`)
  }
}

function isRepositoryFile(root, file) {
  const absolutePath = resolve(root, file)
  const relativePath = relative(root, absolutePath)

  return !isAbsolute(relativePath) && !relativePath.startsWith('..') && existsSync(absolutePath)
}

function isZeroSha(value) {
  return /^0+$/.test(value)
}

function readOption(args, name) {
  const inlinePrefix = `${name}=`
  const inline = args.find((arg) => arg.startsWith(inlinePrefix))

  if (inline) {
    return inline.slice(inlinePrefix.length)
  }

  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : ''
if (entrypoint === fileURLToPath(import.meta.url)) {
  await main()
}
