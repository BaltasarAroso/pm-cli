import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import chalk from 'chalk'
import { input, select, confirm } from '@inquirer/prompts'
import type { Command } from 'commander'
import { loadConfig } from '../lib/config.js'
import { reviewWithAI } from '../lib/anthropic.js'
import {
  checkGhCli,
  detectPR,
  listOpenPRs,
  getPRDiff,
  getPRInfo,
  getChangedFiles,
  postReview,
  detectRepoFromGit,
} from '../lib/github.js'
import type { ReviewFinding, ReviewFile, CoderConfig } from '../lib/types.js'

const SEVERITY_COLORS = {
  critical: chalk.red,
  warning: chalk.yellow,
  suggestion: chalk.blue,
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, suggestion: 2 }

// --- Helpers ---

function loadGuidelines(config: CoderConfig): string {
  const paths = [
    config.guidelinesPath,
    'CLAUDE.md',
    '.claude/CLAUDE.md',
    'CODING_GUIDELINES.md',
  ].filter(Boolean) as string[]

  for (const p of paths) {
    const abs = resolve(process.cwd(), p)
    if (existsSync(abs)) {
      return readFileSync(abs, 'utf-8')
    }
  }

  console.warn(chalk.yellow('No coding guidelines file found. Review will use general best practices.'))
  return 'No project-specific guidelines provided. Use general TypeScript/React best practices.'
}

function printFindings(findings: ReviewFinding[]): void {
  const sorted = [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
  )

  console.log('')
  for (const f of sorted) {
    const color = SEVERITY_COLORS[f.severity] || chalk.white
    const tag = color(`[${f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}]`)
    const status =
      f.approved === true
        ? chalk.green(' ✓')
        : f.approved === false
          ? chalk.dim(' ✗')
          : ''

    console.log(`  ${chalk.bold(`#${f.id}`)} ${tag} ${f.title} ${chalk.dim(`(${f.confidence}/100)`)}${status}`)
    console.log(`     ${chalk.dim(`${f.file}:${f.line}`)}`)
    console.log(`     ${chalk.dim(`Why: ${f.why}`)}`)
    console.log('')
  }
}

// --- Resolve PR ---

async function resolvePR(prArg?: string): Promise<{ number: number; baseBranch: string; headSha: string; repo: string }> {
  checkGhCli()

  if (prArg) {
    // Extract number from URL or direct number
    const match = prArg.match(/(\d+)/)
    if (!match) {
      console.error(`Cannot parse PR number from: ${prArg}`)
      process.exit(1)
    }
    const prNumber = parseInt(match[1], 10)
    const info = getPRInfo(prNumber)
    const repo = detectRepoFromGit() || ''
    return { number: prNumber, baseBranch: info.baseRefName, headSha: info.headRefOid, repo }
  }

  // Auto-detect from current branch
  const detected = detectPR()
  if (detected) {
    const shouldUse = await confirm({
      message: `Found PR #${detected.number}: ${detected.title}. Review this one?`,
      default: true,
    })
    if (shouldUse) {
      const repo = detectRepoFromGit() || ''
      return {
        number: detected.number,
        baseBranch: detected.baseRefName,
        headSha: detected.headRefOid,
        repo,
      }
    }
  }

  // List open PRs for selection
  const prs = listOpenPRs()
  if (prs.length === 0) {
    console.error('No open PRs found.')
    process.exit(1)
  }

  const choices = prs.map((pr) => ({
    name: `#${pr.number}  ${pr.title}  ${chalk.dim(pr.headRefName)}`,
    value: pr.number,
  }))

  const selected = await select({
    message: 'Select a PR to review:',
    choices,
  })

  const info = getPRInfo(selected)
  const repo = detectRepoFromGit() || ''
  return { number: selected, baseBranch: info.baseRefName, headSha: info.headRefOid, repo }
}

// --- Interactive Approval ---

async function interactiveApproval(findings: ReviewFinding[]): Promise<ReviewFinding[]> {
  for (const f of findings) {
    const color = SEVERITY_COLORS[f.severity] || chalk.white
    const tag = color(`[${f.severity.charAt(0).toUpperCase() + f.severity.slice(1)}]`)

    const action = await select({
      message: `${tag} #${f.id}: ${f.title}  ${chalk.dim(`(${f.file}:${f.line})`)}`,
      choices: [
        { name: 'Approve', value: 'approve' },
        { name: 'Skip', value: 'skip' },
        { name: 'Edit comment', value: 'edit' },
      ],
    })

    if (action === 'approve') {
      f.approved = true
    } else if (action === 'skip') {
      f.approved = false
    } else if (action === 'edit') {
      const newBody = await input({
        message: 'Enter updated comment (press Enter to keep current):',
        default: f.body,
      })
      f.body = newBody
      f.approved = true
    }
  }

  return findings
}

// --- Main Command ---

export function registerReviewCommand(program: Command): void {
  program
    .command('review [pr]')
    .description('AI-powered code review for a pull request')
    .option('--post', 'Post approved comments to GitHub after review')
    .option('--env <profile>', 'Use a named configuration profile')
    .action(async (prArg: string | undefined, opts: { post?: boolean; env?: string }) => {
      const config = loadConfig(opts.env)

      if (!config.anthropicApiKey) {
        console.error(chalk.red('ANTHROPIC_API_KEY is not set.'))
        console.error('Add it to your .env file or set it in your shell.')
        process.exit(1)
      }

      // Phase 0: Resolve PR
      console.log(chalk.bold('Phase 0: Resolving PR...'))
      const pr = await resolvePR(prArg)
      console.log(chalk.green(`Reviewing PR #${pr.number}`))
      console.log('')

      // Phase 1: Gather context
      console.log(chalk.bold('Phase 1: Gathering context...'))
      const guidelines = loadGuidelines(config)
      const diff = getPRDiff(pr.number, pr.baseBranch)
      const changedFiles = getChangedFiles(pr.number, pr.baseBranch)

      if (!diff.trim()) {
        console.log(chalk.yellow('No changes found in PR diff.'))
        return
      }

      const diffLines = diff.split('\n').length
      console.log(`  Diff: ${diffLines} lines`)
      console.log(`  Guidelines: ${guidelines.length} chars`)
      console.log('')

      // Truncate very large diffs to avoid API limits
      const maxDiffChars = 100_000
      const truncatedDiff =
        diff.length > maxDiffChars
          ? diff.substring(0, maxDiffChars) + '\n\n... (diff truncated due to size)'
          : diff

      // Phase 2: AI review
      console.log(chalk.bold('Phase 2: Analyzing with AI...'))
      let findings: ReviewFinding[]
      try {
        findings = await reviewWithAI(config.anthropicApiKey, truncatedDiff, guidelines, changedFiles)
      } catch (error) {
        console.error(chalk.red('AI review failed:'), error instanceof Error ? error.message : error)
        process.exit(1)
      }

      if (findings.length === 0) {
        console.log(chalk.green('\nNo issues found. Looks good!'))
        return
      }

      // Sort by severity
      findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99))

      const criticals = findings.filter((f) => f.severity === 'critical').length
      const warnings = findings.filter((f) => f.severity === 'warning').length
      const suggestions = findings.filter((f) => f.severity === 'suggestion').length

      console.log(
        chalk.bold(
          `\nFound ${findings.length} issues (${criticals} critical, ${warnings} warning, ${suggestions} suggestion):`
        )
      )

      printFindings(findings)

      // If not posting, just output and exit
      if (!opts.post) {
        console.log(chalk.dim('Add --post to review and post comments to GitHub.'))
        return
      }

      // Phase 3: Interactive approval
      console.log(chalk.bold('Phase 3: Approve findings...\n'))
      findings = await interactiveApproval(findings)

      const approved = findings.filter((f) => f.approved === true)

      if (approved.length === 0) {
        console.log(chalk.yellow('\nNo findings approved. Nothing to post.'))
        return
      }

      // Confirm posting
      console.log(chalk.bold(`\n${approved.length} comment(s) approved:`))
      printFindings(approved)

      const shouldPost = await confirm({
        message: `Post ${approved.length} comment(s) to PR #${pr.number}?`,
        default: true,
      })

      if (!shouldPost) {
        console.log(chalk.yellow('Cancelled.'))
        return
      }

      // Build ReviewFile and post
      const repo = pr.repo || config.githubRepo || detectRepoFromGit() || ''
      if (!repo) {
        console.error(chalk.red('Cannot determine GitHub repo. Set GITHUB_REPO in your .env.'))
        process.exit(1)
      }

      const reviewFile: ReviewFile = {
        pr: pr.number,
        repo,
        baseBranch: pr.baseBranch,
        headSha: pr.headSha,
        reviewedAt: new Date().toISOString(),
        summary: `Found ${findings.length} issues (${criticals} critical, ${warnings} warning, ${suggestions} suggestion)`,
        findings,
      }

      // Save review file
      const reviewsDir = join(process.cwd(), '.coder', 'reviews')
      mkdirSync(reviewsDir, { recursive: true })
      const reviewPath = join(reviewsDir, `pr-${pr.number}-review.json`)
      writeFileSync(reviewPath, JSON.stringify(reviewFile, null, 2) + '\n')
      console.log(chalk.dim(`\nReview saved to ${reviewPath}`))

      // Post to GitHub
      console.log(chalk.bold('\nPosting to GitHub...'))
      postReview(reviewFile, approved)
      console.log(chalk.green('\nDone.'))
    })
}
