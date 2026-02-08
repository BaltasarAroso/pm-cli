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

program.parse()
