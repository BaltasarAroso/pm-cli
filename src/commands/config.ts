import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import type { Command } from 'commander'
import { getProfilesDir, listProfiles } from '../lib/config.js'

const SAMPLE_PROFILE = `# Profile: default
# Copy this file and customize per project/environment.

# Anthropic API key (required for code review)
ANTHROPIC_API_KEY=

# Linear API key (required for linear commands)
LINEAR_API_KEY=

# Linear team ID (required for creating/updating issues)
LINEAR_TEAM_ID=

# GitHub repo in owner/name format (auto-detected from git remote if not set)
GITHUB_REPO=

# Path to coding guidelines file relative to project root
GUIDELINES_PATH=
`

export function registerConfigCommand(program: Command): void {
  const cfg = program.command('config').description('Manage configuration profiles')

  cfg
    .command('init')
    .description('Create config directory and sample profile')
    .action(() => {
      const dir = getProfilesDir()
      mkdirSync(dir, { recursive: true })

      const samplePath = join(dir, 'default.env')
      if (!existsSync(samplePath)) {
        writeFileSync(samplePath, SAMPLE_PROFILE)
        console.log(chalk.green(`Created sample profile: ${samplePath}`))
      } else {
        console.log(chalk.yellow(`Profile already exists: ${samplePath}`))
      }

      console.log(`\nProfiles directory: ${dir}`)
      console.log('Create new profiles by adding .env files to this directory.')
      console.log('Example: cp default.env betanet.env && edit betanet.env')
      console.log('\nThen use: pm review --env betanet')
    })

  cfg
    .command('list')
    .description('List available configuration profiles')
    .action(() => {
      const profiles = listProfiles()

      if (profiles.length === 0) {
        console.log(chalk.yellow('No profiles found.'))
        console.log('Run "pm config init" to create the profiles directory.')
        return
      }

      console.log('Available profiles:\n')
      for (const p of profiles) {
        const path = join(getProfilesDir(), `${p}.env`)
        const content = readFileSync(path, 'utf-8')
        const hasAnthropic = content.includes('ANTHROPIC_API_KEY=') && !content.includes('ANTHROPIC_API_KEY=\n') && !content.includes('ANTHROPIC_API_KEY=$')
        const hasLinear = content.includes('LINEAR_API_KEY=') && !content.includes('LINEAR_API_KEY=\n') && !content.includes('LINEAR_API_KEY=$')

        const tags = []
        if (hasAnthropic) tags.push('review')
        if (hasLinear) tags.push('linear')

        console.log(`  ${chalk.bold(p)}  ${chalk.dim(tags.length > 0 ? `[${tags.join(', ')}]` : '[unconfigured]')}`)
      }

      console.log(`\nProfiles directory: ${getProfilesDir()}`)
    })
}
