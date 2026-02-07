# coder

AI-powered code review and Linear ticket management CLI tool. Automate code reviews using Anthropic's Claude API and manage your Linear tickets directly from the command line.

## Features

- 🤖 **AI-Powered Code Reviews** - Automated PR reviews with severity classification and confidence scores
- ✨ **AI-Powered Ticket Generation** - Generate well-structured Linear tickets from simple prompts
- 📝 **Linear Integration** - Create, update, and manage Linear tickets from your terminal
- 🔧 **Multi-Project Support** - Use named profiles to manage multiple projects
- 💬 **GitHub Integration** - Post review comments directly to GitHub PRs
- ⚙️ **Flexible Configuration** - Support for project-level and global profiles

## Prerequisites

Before installing, ensure you have the following tools installed and configured:

- **Node.js** >= 20 (includes npm)
- **Git** - For repository operations and PR diff fetching
- **GitHub CLI (`gh`)** - Installed and authenticated
  ```bash
  # Install gh CLI
  # macOS: brew install gh
  # Linux: sudo apt install gh  (or your package manager)
  
  # Authenticate
  gh auth login
  ```

## Install

```bash
git clone <repository-url>
cd coder-cli
npm install
npm link    # makes 'coder' available globally
```

## Setup

### Quick start (project-level .env)

Add credentials to your project's `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...       # For code review
LINEAR_API_KEY=lin_api_...         # For Linear commands
LINEAR_TEAM_ID=...                 # For creating/updating issues
```

### Named profiles (multi-project)

Create profiles for different projects or environments:

```bash
coder config init                  # creates ~/.config/coder-cli/profiles/
```

Then create profiles per project:

```bash
cp ~/.config/coder-cli/profiles/default.env ~/.config/coder-cli/profiles/myproject.env
# Edit myproject.env with project-specific credentials
```

Use with `--env`:

```bash
coder review --env myproject
coder linear list --env myproject
```

## Usage

### Code Review

```bash
coder review                    # auto-detect PR on current branch
coder review 430                # review PR #430
coder review 430 --post         # review + approve + post comments to GitHub
coder review 430 --env myproject  # use myproject profile
```

### Linear

```bash
coder linear teams                               # list all teams with their IDs
coder linear list                                # list all tickets
coder linear list "In Progress"                 # filter by status
coder linear read PROJ-123                      # read ticket details
coder linear create "Fix bug" --description "Details here"
coder linear create --ai "Add user authentication with JWT tokens"  # AI-generated ticket
coder linear create --ai "Fix login bug" --style tldr              # Short and sweet
coder linear create --ai "Implement OAuth" --style detailed        # Comprehensive with codebase details
coder linear update PROJ-123 --status "Done"
coder linear update PROJ-123 --comment "Fixed in PR #456"
coder linear update PROJ-123 --ai "Add acceptance criteria" --style descriptive  # AI-improved ticket
coder linear link PROJ-123 https://github.com/owner/repo/pull/456
```

**Ticket Styles** (for `--ai` option):
- `tldr` - Brief, short and sweet (2-4 sentences, essentials only)
- `descriptive` - Balanced with structure, context, and acceptance criteria (default)
- `detailed` - Comprehensive with codebase references, technical details, and thorough requirements

### Config

```bash
coder config init     # create profiles directory + sample
coder config list     # list available profiles
```

## How it works

### Code Review

1. Detects your current PR (or lists open PRs to pick from)
2. Fetches the diff and your project's coding guidelines
3. Sends both to the Anthropic API for analysis
4. Presents findings with severity (Critical/Warning/Suggestion) and confidence scores
5. With `--post`: interactive approval per finding, then posts as GitHub PR inline comments

### AI Ticket Generation

1. **Creating tickets**: Provide a brief description or prompt with `--ai`
2. Choose a style with `--style`:
   - `tldr`: Short and sweet, essentials only (2-4 sentences)
   - `descriptive`: Balanced with structure, context, and acceptance criteria (default)
   - `detailed`: Comprehensive with codebase references, technical details, and thorough requirements
3. AI generates a well-structured title and description matching the selected style
4. **Editing tickets**: Provide improvement instructions with `--ai` on update command
5. AI analyzes current ticket content and applies your requested changes using the selected style

### Config Resolution

1. Loads `.env` from current working directory
2. If `--env <name>` is passed, overlays with `~/.config/coder-cli/profiles/<name>.env`
3. Shell environment variables take precedence over both

## API Keys

You'll need the following API keys to use all features:

- **Anthropic API key** - Required for code review and AI ticket generation
  - Get yours at: https://console.anthropic.com/
- **Linear API key** - Required for Linear ticket management
  - Get yours at: https://linear.app/settings/api
- **Linear Team ID** - Required for creating/updating Linear issues
  - **How to find your Team ID:**
    - **Easy way**: Run `coder linear teams` to list all teams with their IDs
    - **Manual way**: 
      1. Go to your Linear workspace settings: https://linear.app/settings/teams
      2. Click on the team you want to use
      3. The Team ID is in the URL: `https://linear.app/settings/teams/<TEAM_ID>`
      4. Alternatively, you can find it in the team's API settings page
      5. The Team ID is a UUID (e.g., `a1b2c3d4-e5f6-7890-abcd-ef1234567890`)

## License

MIT
