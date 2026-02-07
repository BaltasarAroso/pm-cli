import { execSync } from 'child_process'
import type { ReviewFinding, ReviewFile, PRInfo } from './types.js'

// --- Severity formatting ---

const SEVERITY_LABELS: Record<string, string> = {
  critical: '🔴 **[Critical]**',
  warning: '🟡 **[Warning]**',
  suggestion: '🔵 **[Suggestion]**',
}

// --- GitHub CLI helpers ---

export function checkGhCli(): void {
  try {
    execSync('gh auth status', { stdio: 'pipe' })
  } catch {
    console.error('Error: GitHub CLI (gh) is not installed or not authenticated.')
    console.error('Install:  sudo apt install gh  (Linux) or brew install gh (macOS)')
    console.error('Auth:     gh auth login')
    process.exit(1)
  }
}

export function detectPR(): PRInfo | null {
  try {
    const raw = execSync(
      'gh pr view --json number,title,state,headRefName,baseRefName,headRefOid,url',
      { stdio: 'pipe' }
    ).toString()
    return JSON.parse(raw) as PRInfo
  } catch {
    return null
  }
}

export function listOpenPRs(limit = 15): PRInfo[] {
  try {
    const raw = execSync(
      `gh pr list --state open --limit ${limit} --json number,title,headRefName,url`,
      { stdio: 'pipe' }
    ).toString()
    return JSON.parse(raw) as PRInfo[]
  } catch {
    return []
  }
}

export function getPRDiff(prNumber: number, baseBranch: string): string {
  // Fetch the PR branch
  execSync(`git fetch origin pull/${prNumber}/head:pr-${prNumber}-review 2>/dev/null || true`, {
    stdio: 'pipe',
  })
  return execSync(`git diff ${baseBranch}...pr-${prNumber}-review`, { stdio: 'pipe' }).toString()
}

export function getPRInfo(prNumber: number): PRInfo {
  const raw = execSync(
    `gh pr view ${prNumber} --json number,title,state,headRefName,baseRefName,headRefOid,url`,
    { stdio: 'pipe' }
  ).toString()
  return JSON.parse(raw) as PRInfo
}

export function getChangedFiles(prNumber: number, baseBranch: string): string {
  return execSync(`git diff ${baseBranch}...pr-${prNumber}-review --stat`, {
    stdio: 'pipe',
  }).toString()
}

// --- Comment formatting ---

function formatCommentBody(finding: ReviewFinding): string {
  const label = SEVERITY_LABELS[finding.severity] || finding.severity
  return `${label} ${finding.title} (Confidence: ${finding.confidence}/100)\n\n${finding.body}`
}

function formatSummaryBody(review: ReviewFile, approved: ReviewFinding[]): string {
  const lines = ['## Code Review Summary', '', review.summary, '']

  if (approved.length === 0) {
    lines.push('No issues to report. Looks good!')
    return lines.join('\n')
  }

  lines.push('| # | Severity | File | Issue | Confidence |')
  lines.push('|---|----------|------|-------|------------|')

  for (const f of approved) {
    const sev = f.severity.charAt(0).toUpperCase() + f.severity.slice(1)
    lines.push(`| ${f.id} | ${sev} | \`${f.file}:${f.line}\` | ${f.title} | ${f.confidence}/100 |`)
  }

  lines.push('', 'See inline comments for details.')
  return lines.join('\n')
}

// --- Posting ---

export function postReview(review: ReviewFile, approvedFindings: ReviewFinding[]): void {
  const [owner, repo] = review.repo.split('/')

  const comments = approvedFindings.map((f) => ({
    path: f.file,
    line: f.line,
    side: 'RIGHT',
    body: formatCommentBody(f),
  }))

  const payload = {
    event: 'COMMENT',
    body: formatSummaryBody(review, approvedFindings),
    comments,
  }

  try {
    execSync(
      `gh api repos/${owner}/${repo}/pulls/${review.pr}/reviews --method POST --input -`,
      { input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'] }
    )
    console.log(`Posted review with ${comments.length} inline comment(s) on PR #${review.pr}.`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)

    // Fallback: if inline comments fail, post as individual PR comments
    if (msg.includes('pull_request_review_thread') || msg.includes('Validation Failed')) {
      console.warn('Inline comments failed (lines may not be in diff). Falling back to PR comments...')

      const summaryBody = formatSummaryBody(review, approvedFindings)
      try {
        execSync(
          `gh pr comment ${review.pr} --repo ${owner}/${repo} --body ${JSON.stringify(summaryBody)}`,
          { stdio: 'pipe' }
        )
        console.log('Posted summary comment.')
      } catch {
        console.error('Failed to post summary comment.')
      }

      for (const f of approvedFindings) {
        const body = formatCommentBody(f) + `\n\n> File: \`${f.file}:${f.line}\``
        try {
          execSync(
            `gh pr comment ${review.pr} --repo ${owner}/${repo} --body ${JSON.stringify(body)}`,
            { stdio: 'pipe' }
          )
          console.log(`  Posted comment #${f.id}: ${f.title}`)
        } catch {
          console.error(`  Failed to post comment #${f.id}`)
        }
      }
      return
    }

    console.error(`Error posting review: ${msg}`)
    process.exit(1)
  }
}

export function detectRepoFromGit(): string | null {
  try {
    const remote = execSync('git remote get-url origin', { stdio: 'pipe' }).toString().trim()
    // Parse: git@github.com:owner/repo.git or https://github.com/owner/repo.git
    const sshMatch = remote.match(/github\.com[:/](.+?)(?:\.git)?$/)
    if (sshMatch) return sshMatch[1]
    return null
  } catch {
    return null
  }
}
