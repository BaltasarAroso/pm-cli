#!/usr/bin/env tsx
/**
 * coder - AI-powered code review and Linear ticket management CLI
 *
 * Usage:
 *   coder review [pr]              # AI code review
 *   coder review [pr] --post       # Review + post comments to GitHub
 *   coder linear list [status]     # List Linear tickets
 *   coder linear read <issue-id>   # Read ticket details
 *   coder config init              # Set up config profiles
 *
 * See: coder --help
 */

import { Command } from 'commander'
import { registerReviewCommand } from '../src/commands/review.js'
import { registerLinearCommand } from '../src/commands/linear.js'
import { registerConfigCommand } from '../src/commands/config.js'

const program = new Command()

program
  .name('coder')
  .description('AI-powered code review and Linear ticket management CLI')
  .version('1.0.0')

registerReviewCommand(program)
registerLinearCommand(program)
registerConfigCommand(program)

program.parse()
