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
  listTeams,
  getActiveIssues,
} from '../lib/linear-api.js'
import { generateTicketWithAI, editTicketWithAI } from '../lib/anthropic.js'
import type { TicketStyle } from '../prompts/ticket.js'
import { formatTicketsForContext } from '../prompts/ticket.js'

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
    .description('List issues, optionally filtered by status, team, or project')
    .option('--team <teamId>', 'Filter by team ID (overrides LINEAR_TEAM_ID from config)')
    .option('--project <projectId>', 'Filter by Linear project ID (overrides LINEAR_PROJECT_ID from config)')
    .option('--all-teams', 'List issues from all teams (ignores LINEAR_TEAM_ID)')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (status: string | undefined, opts: { team?: string; project?: string; allTeams?: boolean; env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      // Determine which team ID to use: explicit --team flag, or LINEAR_TEAM_ID from config, or none
      const teamId = opts.team || (opts.allTeams ? undefined : config.linearTeamId)
      const projectId = opts.project || config.linearProjectId

      if (status) console.log(`Filtering by status: "${status}"`)
      if (teamId) console.log(`Filtering by team: ${teamId}`)
      if (projectId) console.log(`Filtering by project: ${projectId}`)
      if (!status && !teamId && !projectId) console.log('Listing all issues')

      const issues = await listIssues(apiKey, status, teamId, projectId)

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

  // --- teams ---
  linear
    .command('teams')
    .description('List all teams with their IDs (useful for finding LINEAR_TEAM_ID)')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (opts: { env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      console.log(chalk.bold('Fetching teams...'))
      try {
        const teams = await listTeams(apiKey)

        if (teams.length === 0) {
          console.log(chalk.yellow('\nNo teams found.'))
          return
        }

        console.log(`\nFound ${teams.length} team(s):\n`)
        for (const team of teams) {
          console.log(`  ${chalk.bold(team.name)}`)
          console.log(`    Key: ${chalk.dim(team.key)}`)
          console.log(`    ID:  ${chalk.green(team.id)}`)
          console.log('')
        }
        console.log(chalk.dim('Copy the ID above and set it as LINEAR_TEAM_ID in your .env file.'))
      } catch (error) {
        console.error(chalk.red(`Failed to fetch teams: ${error instanceof Error ? error.message : String(error)}`))
        process.exit(1)
      }
    })

  // --- create ---
  linear
    .command('create [title]')
    .description('Create a new issue')
    .option('--description <text>', 'Issue description')
    .option('--ai <prompt>', 'Use AI to generate ticket from a prompt (requires ANTHROPIC_API_KEY)')
    .option('--style <style>', 'Ticket style: tldr, descriptive (default), or detailed', 'descriptive')
    .option('--with-context', 'Include active tickets as context to avoid duplicates (requires --ai)')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (title: string | undefined, opts: { description?: string; ai?: string; style?: string; withContext?: boolean; env?: string }) => {
      const config = loadConfig(opts.env)
      const apiKey = requireLinearKey(config.linearApiKey)

      if (!config.linearTeamId) {
        console.error(chalk.red('LINEAR_TEAM_ID is not set. Required for creating issues.'))
        process.exit(1)
      }

      if (opts.withContext && !opts.ai) {
        console.error(chalk.red('--with-context requires --ai flag'))
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

        let activeTicketsContext: string | undefined
        if (opts.withContext) {
          console.log(chalk.bold('Fetching active tickets for context...'))
          try {
            const activeIssues = await getActiveIssues(apiKey, config.linearTeamId, config.linearProjectId)
            activeTicketsContext = formatTicketsForContext(activeIssues)
            console.log(chalk.green(`✓ Found ${activeIssues.length} active ticket(s) for context`))
          } catch (error) {
            console.warn(chalk.yellow(`Warning: Failed to fetch active tickets: ${error instanceof Error ? error.message : String(error)}`))
            console.warn(chalk.yellow('Continuing without context...'))
          }
        }

        const styleLabel = ticketStyle === 'tldr' ? 'TLDR' : ticketStyle === 'detailed' ? 'Detailed' : 'Descriptive'
        const contextLabel = opts.withContext ? ' (with context)' : ''
        console.log(chalk.bold(`Generating ticket with AI (${styleLabel} style${contextLabel})...`))
        try {
          const ticket = await generateTicketWithAI(config.anthropicApiKey, opts.ai, ticketStyle, title, activeTicketsContext)
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
    .option('--with-context', 'Include other active tickets as context (requires --ai)')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(
      async (
        issueId: string,
        opts: { status?: string; comment?: string; ai?: string; style?: string; withContext?: boolean; env?: string }
      ) => {
        const config = loadConfig(opts.env)
        const apiKey = requireLinearKey(config.linearApiKey)

        if (!opts.status && !opts.comment && !opts.ai) {
          console.error(chalk.red('At least one of --status, --comment, or --ai required.'))
          process.exit(1)
        }

        if (opts.withContext && !opts.ai) {
          console.error(chalk.red('--with-context requires --ai flag'))
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

          let activeTicketsContext: string | undefined
          if (opts.withContext) {
            console.log(chalk.bold('Fetching other active tickets for context...'))
            try {
              const activeIssues = await getActiveIssues(apiKey, config.linearTeamId, config.linearProjectId)
              // Exclude the current ticket from context
              const otherActiveIssues = activeIssues.filter(issue => issue.id !== currentIssue.id)
              activeTicketsContext = formatTicketsForContext(otherActiveIssues)
              console.log(chalk.green(`✓ Found ${otherActiveIssues.length} other active ticket(s) for context`))
            } catch (error) {
              console.warn(chalk.yellow(`Warning: Failed to fetch active tickets: ${error instanceof Error ? error.message : String(error)}`))
              console.warn(chalk.yellow('Continuing without context...'))
            }
          }
          
          const styleLabel = ticketStyle === 'tldr' ? 'TLDR' : ticketStyle === 'detailed' ? 'Detailed' : 'Descriptive'
          const contextLabel = opts.withContext ? ' (with context)' : ''
          console.log(chalk.bold(`Improving ticket with AI (${styleLabel} style${contextLabel})...`))
          try {
            const improved = await editTicketWithAI(
              config.anthropicApiKey,
              currentIssue.title,
              currentIssue.description || '',
              opts.ai,
              ticketStyle,
              activeTicketsContext
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
