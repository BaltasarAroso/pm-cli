/**
 * MCP Server for pm-cli
 *
 * Exposes GitHub PR and Linear ticket management as MCP tools,
 * so any MCP-compatible AI client (Cursor, Claude Desktop, etc.)
 * can use them directly.
 *
 * Tools exposed:
 *   GitHub: detect_pr, list_prs, get_pr_info, get_pr_diff, get_changed_files, post_review
 *   Linear: list_issues, read_issue, create_issue, update_issue, link_pr, list_teams
 *
 * Prompts exposed:
 *   code_review  - structured code review prompt template
 *   create_ticket - Linear ticket creation prompt template
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { loadConfig } from '../lib/config.js'
import {
  checkGhCli,
  detectPR,
  listOpenPRs,
  getPRInfo,
  getPRDiff,
  getChangedFiles,
  postReview,
  detectRepoFromGit,
} from '../lib/github.js'
import {
  readIssue,
  listIssues,
  createIssue,
  updateIssue,
  linkPR,
  listTeams,
  getActiveIssues,
  formatIssue,
} from '../lib/linear-api.js'
import { CODE_REVIEW_SYSTEM_PROMPT, buildUserPrompt } from '../prompts/code-review.js'
import {
  getTicketSystemPrompt,
  buildTicketCreatePrompt,
  type TicketStyle,
} from '../prompts/ticket.js'
import type { ReviewFile, ReviewFinding } from '../lib/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getConfig(profile?: string) {
  return loadConfig(profile)
}

function requireLinearKey(config: ReturnType<typeof loadConfig>): string {
  if (!config.linearApiKey) {
    throw new Error(
      'LINEAR_API_KEY is not configured. Set it in your .env file, a named profile, or as an environment variable.'
    )
  }
  return config.linearApiKey
}

// ---------------------------------------------------------------------------
// Create MCP Server
// ---------------------------------------------------------------------------

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'pm-cli',
    version: '1.0.0',
  })

  // =========================================================================
  // GitHub Tools
  // =========================================================================

  server.tool(
    'github_detect_pr',
    'Detect the pull request associated with the current git branch',
    {},
    async () => {
      try {
        checkGhCli()
      } catch {
        return { content: [{ type: 'text', text: 'GitHub CLI (gh) is not installed or not authenticated. Install with: sudo apt install gh && gh auth login' }] }
      }

      const pr = detectPR()
      if (!pr) {
        return { content: [{ type: 'text', text: 'No pull request found for the current branch.' }] }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(pr, null, 2) }],
      }
    }
  )

  server.tool(
    'github_list_prs',
    'List open pull requests in the current repository',
    {
      limit: z.number().optional().describe('Maximum number of PRs to list (default: 15)'),
    },
    async ({ limit }) => {
      try {
        checkGhCli()
      } catch {
        return { content: [{ type: 'text', text: 'GitHub CLI (gh) is not installed or not authenticated.' }] }
      }

      const prs = listOpenPRs(limit ?? 15)
      if (prs.length === 0) {
        return { content: [{ type: 'text', text: 'No open pull requests found.' }] }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(prs, null, 2) }],
      }
    }
  )

  server.tool(
    'github_get_pr_info',
    'Get detailed information about a specific pull request by number',
    {
      pr_number: z.number().describe('The PR number'),
    },
    async ({ pr_number }) => {
      try {
        checkGhCli()
        const info = getPRInfo(pr_number)
        return {
          content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to get PR info: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'github_get_pr_diff',
    'Get the diff for a pull request. Returns the full git diff of changes in the PR.',
    {
      pr_number: z.number().describe('The PR number'),
      base_branch: z.string().describe('The base branch to diff against (e.g. "main")'),
    },
    async ({ pr_number, base_branch }) => {
      try {
        checkGhCli()
        const diff = getPRDiff(pr_number, base_branch)
        if (!diff.trim()) {
          return { content: [{ type: 'text', text: 'No changes found in PR diff.' }] }
        }

        // Truncate very large diffs
        const maxChars = 100_000
        const truncated =
          diff.length > maxChars
            ? diff.substring(0, maxChars) + '\n\n... (diff truncated due to size)'
            : diff

        return { content: [{ type: 'text', text: truncated }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to get PR diff: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'github_get_changed_files',
    'Get a summary of files changed in a pull request (like git diff --stat)',
    {
      pr_number: z.number().describe('The PR number'),
      base_branch: z.string().describe('The base branch to diff against (e.g. "main")'),
    },
    async ({ pr_number, base_branch }) => {
      try {
        checkGhCli()
        const stats = getChangedFiles(pr_number, base_branch)
        return { content: [{ type: 'text', text: stats }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to get changed files: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'github_post_review',
    'Post a code review with inline comments to a GitHub pull request. Takes structured review findings and posts them as a PR review.',
    {
      pr_number: z.number().describe('The PR number'),
      repo: z.string().describe('Repository in owner/name format (e.g. "octocat/hello-world")'),
      base_branch: z.string().describe('The base branch of the PR'),
      head_sha: z.string().describe('The head commit SHA of the PR'),
      summary: z.string().describe('Overall review summary text'),
      findings: z
        .array(
          z.object({
            id: z.number().describe('Finding ID'),
            severity: z.enum(['critical', 'warning', 'suggestion']),
            confidence: z.number().describe('Confidence score 0-100'),
            title: z.string().describe('Short title of the finding'),
            file: z.string().describe('File path'),
            line: z.number().describe('Line number in the file'),
            why: z.string().describe('One sentence explaining the impact'),
            body: z.string().describe('Full comment text with description and suggestion'),
          })
        )
        .describe('Array of review findings to post as inline comments'),
    },
    async ({ pr_number, repo, base_branch, head_sha, summary, findings }) => {
      try {
        checkGhCli()

        const reviewFindings: ReviewFinding[] = findings.map((f) => ({
          ...f,
          approved: true,
          posted: false,
        }))

        const reviewFile: ReviewFile = {
          pr: pr_number,
          repo,
          baseBranch: base_branch,
          headSha: head_sha,
          reviewedAt: new Date().toISOString(),
          summary,
          findings: reviewFindings,
        }

        postReview(reviewFile, reviewFindings)

        return {
          content: [{ type: 'text', text: `Successfully posted review with ${findings.length} comment(s) on PR #${pr_number}.` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to post review: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'github_detect_repo',
    'Detect the GitHub repository (owner/name) from the current git remote',
    {},
    async () => {
      const repo = detectRepoFromGit()
      if (!repo) {
        return { content: [{ type: 'text', text: 'Could not detect GitHub repository from git remote.' }] }
      }
      return { content: [{ type: 'text', text: repo }] }
    }
  )

  // =========================================================================
  // Linear Tools
  // =========================================================================

  server.tool(
    'linear_list_issues',
    'List Linear issues, optionally filtered by status and/or team',
    {
      status: z.string().optional().describe('Filter by status name (e.g. "In Progress", "Todo")'),
      team_id: z.string().optional().describe('Filter by team ID (overrides LINEAR_TEAM_ID from config)'),
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ status, team_id, profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)
        const teamId = team_id || config.linearTeamId

        const issues = await listIssues(apiKey, status, teamId)
        if (issues.length === 0) {
          return { content: [{ type: 'text', text: 'No issues found.' }] }
        }

        const result = issues.map((issue) => ({
          identifier: issue.identifier,
          title: issue.title,
          status: issue.state.name,
          priority: issue.priority,
          assignee: issue.assignee?.name || 'Unassigned',
          team: `${issue.team.name} (${issue.team.key})`,
          url: issue.url,
        }))

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to list issues: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'linear_read_issue',
    'Read detailed information about a specific Linear issue',
    {
      issue_id: z.string().describe('Issue identifier (e.g. "ENG-123") or UUID'),
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ issue_id, profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)

        const issue = await readIssue(apiKey, issue_id)
        return { content: [{ type: 'text', text: formatIssue(issue) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to read issue: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'linear_create_issue',
    'Create a new Linear issue',
    {
      title: z.string().describe('Issue title'),
      description: z.string().optional().describe('Issue description (markdown)'),
      team_id: z.string().optional().describe('Team ID (overrides LINEAR_TEAM_ID from config)'),
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ title, description, team_id, profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)
        const teamId = team_id || config.linearTeamId

        if (!teamId) {
          return {
            content: [{ type: 'text', text: 'LINEAR_TEAM_ID is not configured and no team_id was provided. Run `pm linear teams` to find your team ID.' }],
            isError: true,
          }
        }

        const issue = await createIssue(apiKey, teamId, title, description)
        return {
          content: [{ type: 'text', text: `Created issue: ${issue.identifier}\n\n${formatIssue(issue)}` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to create issue: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'linear_update_issue',
    'Update an existing Linear issue (change status, add comment, update title/description)',
    {
      issue_id: z.string().describe('Issue identifier (e.g. "ENG-123") or UUID'),
      status: z.string().optional().describe('New status name (e.g. "In Progress", "Done")'),
      comment: z.string().optional().describe('Comment to add to the issue'),
      title: z.string().optional().describe('New title for the issue'),
      description: z.string().optional().describe('New description for the issue (markdown)'),
      team_id: z.string().optional().describe('Team ID (overrides LINEAR_TEAM_ID from config)'),
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ issue_id, status, comment, title, description, team_id, profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)
        const teamId = team_id || config.linearTeamId

        if (!teamId) {
          return {
            content: [{ type: 'text', text: 'LINEAR_TEAM_ID is not configured and no team_id was provided.' }],
            isError: true,
          }
        }

        if (!status && !comment && !title && description === undefined) {
          return {
            content: [{ type: 'text', text: 'At least one update field is required (status, comment, title, or description).' }],
            isError: true,
          }
        }

        const issue = await updateIssue(apiKey, teamId, issue_id, {
          status,
          comment,
          title,
          description,
        })
        return {
          content: [{ type: 'text', text: `Updated issue: ${issue.identifier}\n\n${formatIssue(issue)}` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to update issue: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'linear_link_pr',
    'Link a pull request URL to a Linear issue (adds a comment with the PR link)',
    {
      issue_id: z.string().describe('Issue identifier (e.g. "ENG-123") or UUID'),
      pr_url: z.string().describe('Full URL of the pull request'),
      team_id: z.string().optional().describe('Team ID (overrides LINEAR_TEAM_ID from config)'),
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ issue_id, pr_url, team_id, profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)
        const teamId = team_id || config.linearTeamId

        if (!teamId) {
          return {
            content: [{ type: 'text', text: 'LINEAR_TEAM_ID is not configured and no team_id was provided.' }],
            isError: true,
          }
        }

        await linkPR(apiKey, teamId, issue_id, pr_url)
        return {
          content: [{ type: 'text', text: `Linked PR to issue ${issue_id}: ${pr_url}` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to link PR: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'linear_list_teams',
    'List all Linear teams with their IDs and keys',
    {
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)

        const teams = await listTeams(apiKey)
        if (teams.length === 0) {
          return { content: [{ type: 'text', text: 'No teams found.' }] }
        }

        return { content: [{ type: 'text', text: JSON.stringify(teams, null, 2) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to list teams: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  server.tool(
    'linear_get_active_issues',
    'Get active (non-completed, non-cancelled) Linear issues for context. Useful when creating or editing tickets to avoid duplicates.',
    {
      team_id: z.string().optional().describe('Filter by team ID (overrides LINEAR_TEAM_ID from config)'),
      profile: z.string().optional().describe('Named configuration profile to use'),
    },
    async ({ team_id, profile }) => {
      try {
        const config = getConfig(profile)
        const apiKey = requireLinearKey(config)
        const teamId = team_id || config.linearTeamId

        const issues = await getActiveIssues(apiKey, teamId)
        if (issues.length === 0) {
          return { content: [{ type: 'text', text: 'No active issues found.' }] }
        }

        const result = issues.map((issue) => ({
          identifier: issue.identifier,
          title: issue.title,
          status: issue.state.name,
          description: issue.description
            ? issue.description.length > 300
              ? issue.description.substring(0, 300) + '...'
              : issue.description
            : undefined,
          assignee: issue.assignee?.name || 'Unassigned',
          url: issue.url,
        }))

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Failed to get active issues: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        }
      }
    }
  )

  // =========================================================================
  // MCP Prompts - expose the review and ticket prompt templates
  // =========================================================================

  server.prompt(
    'code_review',
    'Structured code review prompt - analyzes a PR diff against project coding guidelines and produces findings with severity and confidence scores',
    {
      diff: z.string().describe('The git diff to review'),
      guidelines: z.string().optional().describe('Project coding guidelines (if not provided, general best practices are used)'),
      changed_files: z.string().optional().describe('Output of git diff --stat showing which files changed'),
    },
    ({ diff, guidelines, changed_files }) => {
      const effectiveGuidelines =
        guidelines || 'No project-specific guidelines provided. Use general best practices.'
      const effectiveChangedFiles = changed_files || '(not provided)'

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: buildUserPrompt(effectiveGuidelines, diff, effectiveChangedFiles),
            },
          },
        ],
        description: CODE_REVIEW_SYSTEM_PROMPT,
      }
    }
  )

  server.prompt(
    'create_ticket',
    'Generate a well-structured Linear ticket from a description. Supports different detail levels.',
    {
      description: z.string().describe('What the ticket should be about'),
      style: z
        .string()
        .optional()
        .describe('Ticket style: "tldr" (brief), "descriptive" (default), or "detailed" (comprehensive)'),
      context: z.string().optional().describe('Additional context to include'),
      active_tickets: z
        .string()
        .optional()
        .describe('Summary of active tickets to avoid duplicates'),
    },
    ({ description, style, context, active_tickets }) => {
      const ticketStyle: TicketStyle =
        style === 'tldr' || style === 'detailed' ? style : 'descriptive'

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: buildTicketCreatePrompt(description, ticketStyle, context, active_tickets),
            },
          },
        ],
        description: getTicketSystemPrompt(ticketStyle),
      }
    }
  )

  return server
}

// ---------------------------------------------------------------------------
// Server metadata – keeps tool & prompt lists in sync automatically
// ---------------------------------------------------------------------------

export const MCP_TOOLS = [
  { name: 'github_detect_pr', description: 'Detect the PR for the current git branch' },
  { name: 'github_list_prs', description: 'List open pull requests' },
  { name: 'github_get_pr_info', description: 'Get detailed info about a PR' },
  { name: 'github_get_pr_diff', description: 'Get the full diff for a PR' },
  { name: 'github_get_changed_files', description: 'Get changed files summary for a PR' },
  { name: 'github_post_review', description: 'Post a code review to a PR' },
  { name: 'github_detect_repo', description: 'Detect owner/repo from git remote' },
  { name: 'linear_list_issues', description: 'List Linear issues' },
  { name: 'linear_read_issue', description: 'Read a specific Linear issue' },
  { name: 'linear_create_issue', description: 'Create a new Linear issue' },
  { name: 'linear_update_issue', description: 'Update an existing Linear issue' },
  { name: 'linear_link_pr', description: 'Link a PR to a Linear issue' },
  { name: 'linear_list_teams', description: 'List Linear teams' },
  { name: 'linear_get_active_issues', description: 'Get active (non-completed) issues' },
] as const

export const MCP_PROMPTS = [
  { name: 'code_review', description: 'Structured code review prompt template' },
  { name: 'create_ticket', description: 'Linear ticket creation prompt template' },
] as const

// ---------------------------------------------------------------------------
// Logging helper – always writes to stderr to avoid corrupting stdio transport
// ---------------------------------------------------------------------------

function log(message: string): void {
  process.stderr.write(`${message}\n`)
}

// ---------------------------------------------------------------------------
// Standalone entry point - run the MCP server over stdio
// ---------------------------------------------------------------------------

export async function startMcpServer(): Promise<void> {
  log('')
  log('╔══════════════════════════════════════════════════════════╗')
  log('║              pm-cli MCP Server v1.0.0                    ║')
  log('╚══════════════════════════════════════════════════════════╝')
  log('')
  log(`  Tools registered:  ${MCP_TOOLS.length}`)
  log(`  Prompts registered: ${MCP_PROMPTS.length}`)
  log(`  Transport:         stdio`)
  log('')
  log('  GitHub tools:')
  for (const t of MCP_TOOLS.filter((t) => t.name.startsWith('github_'))) {
    log(`    • ${t.name} — ${t.description}`)
  }
  log('')
  log('  Linear tools:')
  for (const t of MCP_TOOLS.filter((t) => t.name.startsWith('linear_'))) {
    log(`    • ${t.name} — ${t.description}`)
  }
  log('')
  log('  Prompts:')
  for (const p of MCP_PROMPTS) {
    log(`    • ${p.name} — ${p.description}`)
  }
  log('')
  log('  Waiting for MCP client connection on stdio...')
  log('  (This process is meant to be launched by an AI client like Cursor or Claude Desktop)')
  log('  Press Ctrl+C to stop.')
  log('')

  const server = createMcpServer()
  const transport = new StdioServerTransport()

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('\n  Shutting down MCP server...')
    server.close().then(() => {
      log('  Server stopped.')
      process.exit(0)
    })
  })

  process.on('SIGTERM', () => {
    log('\n  Shutting down MCP server...')
    server.close().then(() => {
      log('  Server stopped.')
      process.exit(0)
    })
  })

  await server.connect(transport)
  log('  MCP client connected.')
}
