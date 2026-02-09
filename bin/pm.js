#!/usr/bin/env node
// Wrapper that runs the TypeScript entry point via tsx.
// Uses --import flag which is the supported approach for Node 20+.

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tsEntry = join(__dirname, 'pm.ts')
const tsx = join(__dirname, '..', 'node_modules', '.bin', 'tsx')

try {
  execFileSync(tsx, [tsEntry, ...process.argv.slice(2)], { stdio: 'inherit' })
} catch (err) {
  // execFileSync throws on non-zero exit, child's stderr is already printed
  process.exit(err.status ?? 1)
}
