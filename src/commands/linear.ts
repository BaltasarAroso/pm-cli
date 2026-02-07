import chalk from 'chalk'
import type { Command } from 'commander'
import { loadConfig } from '../lib/config.js'
import {
  readIssue,
  listIssues,
  createIssue,
  updateIssue,
  linkPR,
  formatIssue,
} from '../lib/linear-api.js'
import { generateTicketWithAI, editTicketWithAI } from '../lib/anthropic.js'
import type { TicketStyle } from '../prompts/ticket.js'

function requireLinearKey(apiKey: string | undefined): string {
  if (!apiKey) {
    console.error(chalk.red('LINEAR_API_KEY is not set.'))
    console.error('Add it to your .env file or set it in your shell.')
    process.exit(1)
  }
  return apiKey
}

export function registerLinearCommand(program: Command): void {
  const linear = program.command('linear').description('Linear ticket management')

  // --- list ---
  linear
    .command('list [status]')
    .description('List issues, optionally filtered by status')
    .option('--team <teamId>', 'Filter by team ID')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (status: string | undefined, opts: { team?: string; env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      if (status) console.log(`Filtering by status: "${status}"`)
      if (opts.team) console.log(`Filtering by team: ${opts.team}`)
      if (!status && !opts.team) console.log('Listing all issues')

      const issues = await listIssues(apiKey, status, opts.team)

      if (issues.length === 0) {
        console.log(chalk.yellow('\nNo issues found.'))
        return
      }

      console.log(`\nFound ${issues.length} issues:\n`)
      for (const issue of issues) {
        const assignee = issue.assignee ? chalk.dim(`@${issue.assignee.name}`) : ''
        console.log(
          `  ${issue.identifier.padEnd(10)} ${issue.title.substring(0, 60).padEnd(62)} [${issue.state.name}] ${assignee}`
        )
      }
    })

  // --- read ---
  linear
    .command('read <issueId>')
    .description('Read issue details (supports LAM-123 or UUID)')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (issueId: string, opts: { env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      const issue = await readIssue(apiKey, issueId)
      console.log(formatIssue(issue))
    })

  // --- create ---
  linear
    .command('create [title]')
    .description('Create a new issue')
    .option('--description <text>', 'Issue description')
    .option('--ai <prompt>', 'Use AI to generate ticket from a prompt (requires ANTHROPIC_API_KEY)')
    .option('--style <style>', 'Ticket style: tldr, descriptive (default), or detailed', 'descriptive')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (title: string | undefined, opts: { description?: string; ai?: string; style?: string; env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      if (!config.linearTeamId) {
        console.error(chalk.red('LINEAR_TEAM_ID is not set. Required for creating issues.'))
        process.exit(1)
      }

      // Validate style
      const validStyles: TicketStyle[] = ['tldr', 'descriptive', 'detailed']
      const ticketStyle = (opts.style?.toLowerCase() as TicketStyle) || 'descriptive'
      if (!validStyles.includes(ticketStyle)) {
        console.error(chalk.red(`Invalid style "${opts.style}". Must be one of: ${validStyles.join(', ')}`))
        process.exit(1)
      }

      let finalTitle = title
      let finalDescription = opts.description

      // AI-powered ticket generation
      if (opts.ai) {
        if (!config.anthropicApiKey) {
          console.error(chalk.red('ANTHROPIC_API_KEY is not set. Required for AI ticket generation.'))
          console.error('Add it to your .env file or set it in your shell.')
          process.exit(1)
        }

        const styleLabel = ticketStyle === 'tldr' ? 'TLDR' : ticketStyle === 'detailed' ? 'Detailed' : 'Descriptive'
        console.log(chalk.bold(`Generating ticket with AI (${styleLabel} style)...`))
        try {
          const ticket = await generateTicketWithAI(config.anthropicApiKey, opts.ai, ticketStyle, title)
          finalTitle = ticket.title
          finalDescription = ticket.description
          console.log(chalk.green('✓ AI-generated ticket content'))
        } catch (error) {
          console.error(chalk.red(`Failed to generate ticket with AI: ${error instanceof Error ? error.message : String(error)}`))
          process.exit(1)
        }
      }

      if (!finalTitle) {
        console.error(chalk.red('Title is required. Provide a title or use --ai <prompt>'))
        process.exit(1)
      }

      const issue = await createIssue(apiKey, config.linearTeamId, finalTitle, finalDescription)
      console.log(chalk.green(`\nCreated issue: ${issue.identifier}`))
      console.log(formatIssue(issue))
    })

  // --- update ---
  linear
    .command('update <issueId>')
    .description('Update an issue')
    .option('--status <status>', 'Update issue status')
    .option('--comment <text>', 'Add a comment')
    .option('--ai <prompt>', 'Use AI to improve/edit ticket title and description based on prompt')
    .option('--style <style>', 'Ticket style: tldr, descriptive (default), or detailed', 'descriptive')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(
      async (
        issueId: string,
        opts: { status?: string; comment?: string; ai?: string; style?: string; env?: string }
      ) => {
        const config = loadConfig(opts.env)
        const apiKey = requireLinearKey(config.linearApiKey)

        if (!opts.status && !opts.comment && !opts.ai) {
          console.error(chalk.red('At least one of --status, --comment, or --ai required.'))
          process.exit(1)
        }

        if (!config.linearTeamId) {
          console.error(chalk.red('LINEAR_TEAM_ID is not set. Required for updating issues.'))
          process.exit(1)
        }

        // Validate style
        const validStyles: TicketStyle[] = ['tldr', 'descriptive', 'detailed']
        const ticketStyle = (opts.style?.toLowerCase() as TicketStyle) || 'descriptive'
        if (opts.style && !validStyles.includes(ticketStyle)) {
          console.error(chalk.red(`Invalid style "${opts.style}". Must be one of: ${validStyles.join(', ')}`))
          process.exit(1)
        }

        let titleUpdate: string | undefined
        let descriptionUpdate: string | undefined

        // AI-powered ticket editing
        if (opts.ai) {
          if (!config.anthropicApiKey) {
            console.error(chalk.red('ANTHROPIC_API_KEY is not set. Required for AI ticket editing.'))
            console.error('Add it to your .env file or set it in your shell.')
            process.exit(1)
          }

          console.log(chalk.bold('Fetching current ticket...'))
          const currentIssue = await readIssue(apiKey, issueId)
          
          const styleLabel = ticketStyle === 'tldr' ? 'TLDR' : ticketStyle === 'detailed' ? 'Detailed' : 'Descriptive'
          console.log(chalk.bold(`Improving ticket with AI (${styleLabel} style)...`))
          try {
            const improved = await editTicketWithAI(
              config.anthropicApiKey,
              currentIssue.title,
              currentIssue.description || '',
              opts.ai,
              ticketStyle
            )
            titleUpdate = improved.title
            descriptionUpdate = improved.description
            console.log(chalk.green('✓ AI-improved ticket content'))
          } catch (error) {
            console.error(chalk.red(`Failed to improve ticket with AI: ${error instanceof Error ? error.message : String(error)}`))
            process.exit(1)
          }
        }

        const issue = await updateIssue(apiKey, config.linearTeamId, issueId, {
          status: opts.status,
          comment: opts.comment,
          title: titleUpdate,
          description: descriptionUpdate,
        })
        console.log(chalk.green(`\nUpdated issue: ${issue.identifier}`))
        console.log(formatIssue(issue))
      }
    )

  // --- link ---
  linear
    .command('link <issueId> <prUrl>')
    .description('Link a PR to an issue (adds comment)')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (issueId: string, prUrl: string, opts: { env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      if (!config.linearTeamId) {
        console.error(chalk.red('LINEAR_TEAM_ID is not set.'))
        process.exit(1)
      }

      await linkPR(apiKey, config.linearTeamId, issueId, prUrl)
      console.log(chalk.green(`\nLinked PR to issue ${issueId}: ${prUrl}`))
    })
}
