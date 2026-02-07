import type { LinearIssue, LinearResponse } from './types.js'

const LINEAR_API_URL = 'https://api.linear.app/graphql'

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  state { name type }
  priority
  assignee { name email }
  team { name key }
  labels { nodes { name } }
  url
`

function isIdentifier(input: string): boolean {
  return /^[A-Za-z]+-\d+$/.test(input)
}

async function linearQuery<T>(
  apiKey: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(LINEAR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    throw new Error(`Linear API HTTP error: ${response.status} ${response.statusText}`)
  }

  const result: LinearResponse<T> = await response.json()

  if (result.errors) {
    throw new Error(`Linear API error: ${result.errors.map((e) => e.message).join(', ')}`)
  }
  if (!result.data) {
    throw new Error('No data returned from Linear API')
  }
  return result.data
}

export async function readIssue(apiKey: string, issueId: string): Promise<LinearIssue> {
  if (isIdentifier(issueId)) {
    const [teamKey, numberStr] = issueId.split('-')
    const issueNumber = parseInt(numberStr, 10)

    const query = `
      query($teamKey: String!, $issueNumber: Float!) {
        issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $issueNumber } }, first: 1) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `
    const result = await linearQuery<{ issues: { nodes: LinearIssue[] } }>(apiKey, query, {
      teamKey: teamKey.toUpperCase(),
      issueNumber,
    })
    if (result.issues.nodes.length === 0) {
      throw new Error(`Issue "${issueId}" not found.`)
    }
    return result.issues.nodes[0]
  } else {
    const query = `
      query($id: String!) {
        issue(id: $id) { ${ISSUE_FIELDS} }
      }
    `
    const result = await linearQuery<{ issue: LinearIssue }>(apiKey, query, { id: issueId })
    return result.issue
  }
}

export async function listIssues(
  apiKey: string,
  status?: string,
  teamId?: string
): Promise<LinearIssue[]> {
  const query = `
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 50, orderBy: updatedAt) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `
  const filter: Record<string, unknown> = {}
  if (teamId) filter.team = { id: { eq: teamId } }
  if (status) filter.state = { name: { eq: status } }

  const variables = Object.keys(filter).length > 0 ? { filter } : {}
  const result = await linearQuery<{ issues: { nodes: LinearIssue[] } }>(apiKey, query, variables)
  return result.issues.nodes
}

/**
 * Get active issues (not done, cancelled, or deleted) for context.
 * Used to avoid duplicates and provide context when creating/editing tickets.
 */
export async function getActiveIssues(apiKey: string, teamId?: string): Promise<LinearIssue[]> {
  const query = `
    query($filter: IssueFilter) {
      issues(filter: $filter, first: 100, orderBy: updatedAt) {
        nodes { ${ISSUE_FIELDS} }
      }
    }
  `
  const filter: Record<string, unknown> = {}
  if (teamId) filter.team = { id: { eq: teamId } }
  // Exclude done/cancelled states - only get active tickets
  filter.state = {
    type: { nin: ['completed', 'canceled'] }
  }

  const result = await linearQuery<{ issues: { nodes: LinearIssue[] } }>(apiKey, query, { filter })
  return result.issues.nodes
}

export async function createIssue(
  apiKey: string,
  teamId: string,
  title: string,
  description?: string
): Promise<LinearIssue> {
  const query = `
    mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        issue { ${ISSUE_FIELDS} }
      }
    }
  `
  const result = await linearQuery<{ issueCreate: { issue: LinearIssue } }>(apiKey, query, {
    input: { title, description, teamId },
  })
  return result.issueCreate.issue
}

export async function updateIssue(
  apiKey: string,
  teamId: string,
  issueId: string,
  updates: { status?: string; comment?: string; title?: string; description?: string }
): Promise<LinearIssue> {
  let resolvedId = issueId
  if (isIdentifier(issueId)) {
    const issue = await readIssue(apiKey, issueId)
    resolvedId = issue.id
  }

  if (updates.status) {
    const stateQuery = `
      query($name: String!, $teamId: String!) {
        workflowStates(filter: { name: { eq: $name }, team: { id: { eq: $teamId } } }) {
          nodes { id name }
        }
      }
    `
    const stateResult = await linearQuery<{
      workflowStates: { nodes: Array<{ id: string; name: string }> }
    }>(apiKey, stateQuery, { name: updates.status, teamId })

    if (stateResult.workflowStates.nodes.length === 0) {
      throw new Error(`Workflow state "${updates.status}" not found.`)
    }

    await linearQuery(
      apiKey,
      `mutation($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) { success }
      }`,
      { issueId: resolvedId, stateId: stateResult.workflowStates.nodes[0].id }
    )
  }

  if (updates.title || updates.description !== undefined) {
    const input: Record<string, string> = {}
    if (updates.title) input.title = updates.title
    if (updates.description !== undefined) input.description = updates.description

    await linearQuery(
      apiKey,
      `mutation($issueId: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $issueId, input: $input) { success }
      }`,
      { issueId: resolvedId, input }
    )
  }

  if (updates.comment) {
    await linearQuery(
      apiKey,
      `mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success }
      }`,
      { issueId: resolvedId, body: updates.comment }
    )
  }

  return readIssue(apiKey, resolvedId)
}

export async function linkPR(
  apiKey: string,
  teamId: string,
  issueId: string,
  prUrl: string
): Promise<void> {
  await updateIssue(apiKey, teamId, issueId, { comment: `🔗 Linked PR: ${prUrl}` })
}

export interface LinearTeam {
  id: string
  name: string
  key: string
}

export async function listTeams(apiKey: string): Promise<LinearTeam[]> {
  const query = `
    query {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `
  const result = await linearQuery<{ teams: { nodes: LinearTeam[] } }>(apiKey, query)
  return result.teams.nodes
}

export function formatIssue(issue: LinearIssue): string {
  const labels = issue.labels?.nodes.map((l) => l.name).join(', ') || 'None'
  const assignee = issue.assignee
    ? `${issue.assignee.name} (${issue.assignee.email})`
    : 'Unassigned'

  const lines = [
    `Issue: ${issue.identifier} - ${issue.title}`,
    `URL: ${issue.url}`,
    `Status: ${issue.state.name}`,
    `Priority: ${issue.priority}`,
    `Assignee: ${assignee}`,
    `Team: ${issue.team.name} (${issue.team.key})`,
    `Labels: ${labels}`,
  ]
  if (issue.description) {
    lines.push('', 'Description:', issue.description)
  }
  return lines.join('\n')
}
