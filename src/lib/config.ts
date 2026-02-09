import { config as dotenvConfig } from 'dotenv'
import { existsSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { homedir } from 'os'
import type { PmConfig } from './types.js'

const PROFILES_DIR = join(homedir(), '.config', 'pm-cli', 'profiles')

/**
 * Load configuration from .env files and environment variables.
 *
 * Resolution order (later wins):
 * 1. Project .env from current working directory
 * 2. Named profile from ~/.config/pm-cli/profiles/<name>.env
 * 3. Shell environment variables
 */
export function loadConfig(profileName?: string): PmConfig {
  // 1. Load project .env from cwd
  const projectEnv = resolve(process.cwd(), '.env')
  if (existsSync(projectEnv)) {
    dotenvConfig({ path: projectEnv })
  }

  // 2. Overlay with named profile if specified
  if (profileName) {
    const profilePath = join(PROFILES_DIR, `${profileName}.env`)
    if (!existsSync(profilePath)) {
      console.error(`Profile "${profileName}" not found at: ${profilePath}`)
      console.error(`Run "pm config init" to create the profiles directory.`)
      process.exit(1)
    }
    dotenvConfig({ path: profilePath, override: true })
  }

  // 3. Shell env vars already take precedence via process.env
  return {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    linearApiKey: process.env.LINEAR_API_KEY,
    linearTeamId: process.env.LINEAR_TEAM_ID,
    linearProjectId: process.env.LINEAR_PROJECT_ID,
    githubRepo: process.env.GITHUB_REPO,
    guidelinesPath: process.env.GUIDELINES_PATH,
  }
}

export function getProfilesDir(): string {
  return PROFILES_DIR
}

export function listProfiles(): string[] {
  if (!existsSync(PROFILES_DIR)) return []
  return readdirSync(PROFILES_DIR)
    .filter((f: string) => f.endsWith('.env'))
    .map((f: string) => f.replace('.env', ''))
}
