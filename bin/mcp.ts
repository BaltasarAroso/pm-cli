#!/usr/bin/env tsx
/**
 * pm-cli MCP server entry point
 *
 * Runs the MCP server over stdio so AI clients (Cursor, Claude Desktop, etc.)
 * can use GitHub and Linear tools directly.
 *
 * Usage:
 *   tsx bin/mcp.ts          # run directly
 *   pm mcp                  # via the CLI
 *   node bin/mcp.js         # compiled
 */

import { startMcpServer } from '../src/mcp/server.js'

startMcpServer().catch((error) => {
  console.error('MCP server error:', error)
  process.exit(1)
})
