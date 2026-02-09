# MCP Server

pm-cli includes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that exposes its GitHub and Linear integrations as tools any MCP-compatible AI client can use — Cursor, Claude Desktop, Windsurf, custom agents, etc.

The existing CLI commands are unchanged. The MCP server is an additional mode that runs alongside them.

## Quick start

```bash
pm mcp
```

This starts the MCP server over **stdio**. You don't run this directly — your AI client launches it.

## Configuring your AI client

### Cursor

Create `.cursor/mcp.json` in your project (or global config):

```json
{
  "mcpServers": {
    "pm-cli": {
      "command": "npx",
      "args": ["tsx", "<path-to>/coder-cli/bin/mcp.ts"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pm-cli": {
      "command": "npx",
      "args": ["tsx", "<path-to>/coder-cli/bin/mcp.ts"]
    }
  }
}
```

### If installed globally via `npm link`

You can use the `pm-mcp` binary directly:

```json
{
  "mcpServers": {
    "pm-cli": {
      "command": "pm-mcp"
    }
  }
}
```

## Configuration

The MCP server uses the same config resolution as the CLI:

1. Loads `.env` from the current working directory
2. Named profiles from `~/.config/pm-cli/profiles/<name>.env` (pass `profile` param to tools)
3. Shell environment variables take precedence

You can pass environment variables in the MCP client config:

```json
{
  "mcpServers": {
    "pm-cli": {
      "command": "pm-mcp",
      "env": {
        "LINEAR_API_KEY": "lin_api_...",
        "LINEAR_TEAM_ID": "...",
        "GITHUB_REPO": "owner/repo"
      }
    }
  }
}
```

## Available tools

### GitHub

| Tool | Description |
|------|-------------|
| `github_detect_pr` | Detect the PR associated with the current git branch |
| `github_list_prs` | List open pull requests in the repository |
| `github_get_pr_info` | Get detailed info about a specific PR by number |
| `github_get_pr_diff` | Get the full git diff for a PR |
| `github_get_changed_files` | Get a `--stat` summary of files changed in a PR |
| `github_post_review` | Post structured review findings as inline PR comments |
| `github_detect_repo` | Detect `owner/repo` from the git remote |

### Linear

| Tool | Description |
|------|-------------|
| `linear_list_issues` | List issues, optionally filtered by status, team, or project |
| `linear_read_issue` | Read full details of a specific issue |
| `linear_create_issue` | Create a new issue with title and description |
| `linear_update_issue` | Update status, add comment, change title/description |
| `linear_link_pr` | Link a PR URL to an issue (adds a comment) |
| `linear_list_teams` | List all teams with their IDs and keys |
| `linear_get_active_issues` | Get active (non-completed) issues for context (optional project/team filter) |

## Available prompts

The server also exposes prompt templates that AI clients can use:

| Prompt | Description |
|--------|-------------|
| `code_review` | Structured code review prompt — pass a diff and optional guidelines, get severity-scored findings |
| `create_ticket` | Linear ticket generation prompt — supports `tldr`, `descriptive`, and `detailed` styles |

## Example workflows

### AI-powered code review via Cursor

With the MCP server configured in Cursor, you can ask the AI:

> "Review the current PR and post your findings to GitHub"

The AI will chain the tools: `github_detect_pr` → `github_get_pr_info` → `github_get_pr_diff` → analyze with the `code_review` prompt → `github_post_review`.

### Ticket management via chat

> "List my in-progress Linear tickets"

> "Create a ticket for adding rate limiting to the API — detailed style"

> "Move ENG-123 to Done and link PR #456"

The AI calls the appropriate `linear_*` tools directly.

## Architecture

```
┌─────────────────────┐     stdio      ┌──────────────────┐
│   AI Client         │◄──────────────►│   pm mcp         │
│  (Cursor, Claude)   │                │   MCP Server     │
└─────────────────────┘                └────────┬─────────┘
                                                │
                                    ┌───────────┼───────────┐
                                    │           │           │
                              ┌─────▼──────┐ ┌──▼──┐ ┌──────▼──────┐
                              │ GitHub CLI │ │ Git │ │ Linear API  │
                              │   (gh)     │ │     │ │  (GraphQL)  │
                              └────────────┘ └─────┘ └─────────────┘
```

The MCP server wraps the same `src/lib/github.ts` and `src/lib/linear-api.ts` modules used by the CLI commands. No duplication — just a different transport.
