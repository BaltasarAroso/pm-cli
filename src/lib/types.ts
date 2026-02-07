// --- Review Types ---

export interface ReviewFinding {
  id: number
  severity: 'critical' | 'warning' | 'suggestion'
  confidence: number
  title: string
  file: string
  line: number
  why: string
  body: string
  approved: boolean | null
  posted?: boolean
}

export interface ReviewFile {
  pr: number
  repo: string
  baseBranch: string
  headSha: string
  reviewedAt: string
  summary: string
  findings: ReviewFinding[]
}

// --- Linear Types ---

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description?: string
  state: {
    name: string
    type: string
  }
  priority: number
  assignee?: {
    name: string
    email: string
  }
  team: {
    name: string
    key: string
  }
  labels?: {
    nodes: Array<{ name: string }>
  }
  url: string
}

export interface LinearResponse<T> {
  data?: T
  errors?: Array<{ message: string }>
}

// --- Config Types ---

export interface CoderConfig {
  anthropicApiKey?: string
  linearApiKey?: string
  linearTeamId?: string
  githubRepo?: string
  guidelinesPath?: string
}

// --- PR Types ---

export interface PRInfo {
  number: number
  title: string
  state: string
  headRefName: string
  baseRefName: string
  headRefOid: string
  url: string
  author?: string
}
