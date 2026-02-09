#!/usr/bin/env tsx
/**
 * pm - AI-powered project management CLI - code reviews and Linear ticket management
 *
 * Usage:
 *   pm review [pr]              # AI code review
 *   pm review [pr] --post       # Review + post comments to GitHub
 *   pm linear list [status]     # List Linear tickets
 *   pm linear read <issue-id>   # Read ticket details
 *   pm config init              # Set up config profiles
 *
 * See: pm --help
 */

import { Command } from 'commander'
import { registerReviewCommand } from '../src/commands/review.js'
import { registerLinearCommand } from '../src/commands/linear.js'
import { registerConfigCommand } from '../src/commands/config.js'

const program = new Command()

program
  .name('pm')
  .description('AI-powered project management CLI - code reviews and Linear ticket management')
  .version('1.0.0')

registerReviewCommand(program)
registerLinearCommand(program)
registerConfigCommand(program)

// MCP server mode
program
  .command('mcp')
  .description('Start the MCP server (stdio transport) for AI client integration')
  .option('-l, --list', 'List available MCP tools and prompts without starting the server')
  .action(async (opts: { list?: boolean }) => {
    if (opts.list) {
      const { MCP_TOOLS, MCP_PROMPTS } = await import('../src/mcp/server.js')
      console.log('\npm-cli MCP Server — Available capabilities\n')
      console.log('GitHub tools:')
      for (const t of MCP_TOOLS.filter((t) => t.name.startsWith('github_'))) {
        console.log(`  • ${t.name} — ${t.description}`)
      }
      console.log('\nLinear tools:')
      for (const t of MCP_TOOLS.filter((t) => t.name.startsWith('linear_'))) {
        console.log(`  • ${t.name} — ${t.description}`)
      }
      console.log('\nPrompts:')
      for (const p of MCP_PROMPTS) {
        console.log(`  • ${p.name} — ${p.description}`)
      }
      console.log(`\nTotal: ${MCP_TOOLS.length} tools, ${MCP_PROMPTS.length} prompts`)
      console.log('\nTo start the server: pm mcp')
      console.log('To configure in Cursor: see pm-cli README or src/mcp/MCP.md\n')
      return
    }
    const { startMcpServer } = await import('../src/mcp/server.js')
    await startMcpServer()
  })

program.parse()
