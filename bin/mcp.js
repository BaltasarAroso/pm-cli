#!/usr/bin/env node
// Wrapper that runs the MCP TypeScript entry point via tsx.
// Important: MCP servers communicate over stdio, so we must NOT use
// execFileSync with stdio: 'inherit' – the parent/child pipe must be
// transparent.  We use spawn with stdio: 'inherit' which directly
// connects the child's stdin/stdout/stderr to the parent's.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const tsEntry = join(__dirname, 'mcp.ts')
const tsx = join(__dirname, '..', 'node_modules', '.bin', 'tsx')

const child = spawn(tsx, [tsEntry], { stdio: 'inherit' })

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
