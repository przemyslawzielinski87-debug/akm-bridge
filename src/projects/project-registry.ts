import { existsSync, readFileSync, writeFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, normalize } from 'node:path'
import { homedir } from 'node:os'
import type {
  ProjectProfile,
  ProjectPermissions,
  ProjectBudgets,
  ProjectAkmScope,
  ProjectEnvironment,
  EnvironmentName,
} from './project-profile-types.js'
import {
  DEFAULT_UNCLASSIFIED_PERMISSIONS,
  DEFAULT_UNCLASSIFIED_BUDGETS,
  DEFAULT_AKM_SCOPE,
} from './project-profile-types.js'

const CONFIG_DIR = join(import.meta.dirname, '..', '..', 'config', 'projects')
const LOCAL_MAP_PATH = join(CONFIG_DIR, 'projects.local.json')

export class ProjectRegistry {
  private profiles = new Map<string, ProjectProfile>()
  private localPathMap = new Map<string, string>()
  private initialized = false

  initialize(): void {
    if (this.initialized) return
    this.loadProfiles()
    this.loadLocalMap()
    this.initialized = true
  }

  getProfile(id: string): ProjectProfile | null {
    this.ensureInitialized()
    return this.profiles.get(id) ?? null
  }

  getAllProfiles(): ProjectProfile[] {
    this.ensureInitialized()
    return Array.from(this.profiles.values())
  }

  getEnabledProfiles(): ProjectProfile[] {
    this.ensureInitialized()
    return this.getAllProfiles().filter((p) => p.enabled)
  }

  resolveProject(pathOrId: string): { profile: ProjectProfile; resolvedPath: string } | null {
    this.ensureInitialized()

    // Try direct profile ID match
    const direct = this.profiles.get(pathOrId)
    if (direct) {
      const rp = this.resolveRepoPath(direct)
      return { profile: direct, resolvedPath: rp }
    }

    // Try local path map
    const mappedId = this.localPathMap.get(pathOrId)
    if (mappedId) {
      const profile = this.profiles.get(mappedId)
      if (profile) {
        return { profile, resolvedPath: pathOrId }
      }
    }

    // Try realpath matching against profile repository paths
    const absPath = this.resolveToAbsolute(pathOrId)
    if (!absPath) return null

    for (const profile of this.profiles.values()) {
      if (!profile.enabled) continue
      const profileRealPath = this.resolveRepoPath(profile)
      if (absPath === profileRealPath || absPath.startsWith(profileRealPath + '/')) {
        return { profile, resolvedPath: absPath }
      }
    }

    return null
  }

  detectProject(cwd?: string): { profile: ProjectProfile; resolvedPath: string } {
    this.ensureInitialized()

    // Try cwd-based detection
    if (cwd) {
      const resolved = this.resolveProject(cwd)
      if (resolved) return resolved
    }

    // Try process.cwd()
    const procCwd = process.cwd()
    const resolved = this.resolveProject(procCwd)
    if (resolved) return resolved

    // Fallback to unclassified
    const unclassified = this.profiles.get('unclassified')
    if (unclassified) {
      return { profile: unclassified, resolvedPath: procCwd }
    }

    throw new Error('No project profile found and unclassified fallback missing')
  }

  isPathAllowed(path: string, profile: ProjectProfile): boolean {
    if (!profile.enabled) return false

    const profileRoot = this.resolveRepoPath(profile)
    if (!profileRoot) return false

    // Resolve real paths to prevent symlink attacks
    let resolvedPath: string
    try {
      resolvedPath = realpathSync(resolve(path))
    } catch {
      resolvedPath = resolve(path)
    }

    const resolvedRoot = this.resolveToAbsolute(profileRoot)
    if (!resolvedRoot) return false

    // Must be within project root
    if (!resolvedPath.startsWith(resolvedRoot)) return false

    // Block path traversal
    if (resolvedPath.includes('..')) return false

    // Block symlink escape (already resolved above via realpathSync)

    return true
  }

  // ── Permission resolution ──

  resolvePermission(
    profile: ProjectProfile,
    environment: EnvironmentName,
    operation: keyof ProjectPermissions
  ): 'allow' | 'ask' | 'deny' {
    const globalLevel = this.getGlobalPermission(operation)

    // Global deny always wins
    if (globalLevel === 'deny') return 'deny'

    const profileLevel = profile.permissions[operation]

    // Environment can further restrict
    const env = profile.environments[environment]
    if (env) {
      if (operation === 'deploy') {
        if (env.writePolicy === 'deny') return 'deny'
        if (env.writePolicy === 'ask') return 'ask'
      }
      // production write always requires ask
      if (environment === 'production' && (operation === 'write' || operation === 'deploy')) {
        if (profileLevel === 'allow') return 'ask' // production forces ask even if profile allows
        return profileLevel
      }
    }

    return profileLevel
  }

  getEffectiveBudgets(profile: ProjectProfile): ProjectBudgets {
    return profile.budgets
  }

  isAgentAllowed(profile: ProjectProfile, agent: string): boolean {
    return profile.agents.length === 0 || profile.agents.includes(agent)
  }

  isCommandAllowed(profile: ProjectProfile, command: string): boolean {
    return profile.commands.length === 0 || profile.commands.includes(command)
  }

  isSkillAllowed(profile: ProjectProfile, skill: string): boolean {
    return profile.skills.length === 0 || profile.skills.includes(skill)
  }

  isMcpServerAllowed(profile: ProjectProfile, server: string): boolean {
    return profile.mcpServers.length === 0 || profile.mcpServers.includes(server)
  }

  isMcpToolAllowed(profile: ProjectProfile, tool: string): boolean {
    return profile.mcpTools.length === 0 || profile.mcpTools.includes(tool)
  }

  // ── Private helpers ──

  private ensureInitialized(): void {
    if (!this.initialized) this.initialize()
  }

  private loadProfiles(): void {
    if (!existsSync(CONFIG_DIR)) {
      this.ensureDefaultProfiles()
      return
    }
    const indexFile = join(CONFIG_DIR, 'index.json')
    if (existsSync(indexFile)) {
      try {
        const index: string[] = JSON.parse(readFileSync(indexFile, 'utf-8'))
        for (const id of index) {
          const profilePath = join(CONFIG_DIR, `${id}.json`)
          if (existsSync(profilePath)) {
            const profile: ProjectProfile = JSON.parse(readFileSync(profilePath, 'utf-8'))
            this.profiles.set(profile.id, profile)
          }
        }
      } catch {
        this.ensureDefaultProfiles()
      }
    } else {
      this.ensureDefaultProfiles()
    }
  }

  private ensureDefaultProfiles(): void {
    if (!this.profiles.has('unclassified')) {
      this.profiles.set('unclassified', this.createUnclassifiedProfile())
    }
  }

  private loadLocalMap(): void {
    if (!existsSync(LOCAL_MAP_PATH)) return
    try {
      const map: Record<string, string> = JSON.parse(readFileSync(LOCAL_MAP_PATH, 'utf-8'))
      for (const [path, id] of Object.entries(map)) {
        this.localPathMap.set(path, id)
      }
    } catch {
      // ignore invalid local map
    }
  }

  private resolveRepoPath(profile: ProjectProfile): string {
    // Check local map first
    const mapped = this.localPathMap.get(profile.id)
    if (mapped) return mapped

    // Check if profile path is absolute and valid
    if (profile.repositoryPath && existsSync(profile.repositoryPath)) {
      return profile.repositoryPath
    }

    // Try common locations
    const home = homedir()
    const candidates = [
      join(home, profile.id),
      join(home, 'projekt', profile.id),
      join('/', 'root', 'projekt', profile.id),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }

    return profile.repositoryPath || join(home, profile.id)
  }

  private resolveToAbsolute(path: string): string | null {
    try {
      return realpathSync(resolve(path))
    } catch {
      try {
        return resolve(path)
      } catch {
        return null
      }
    }
  }

  private getGlobalPermission(operation: keyof ProjectPermissions): 'allow' | 'ask' | 'deny' {
    // Global deny list that no profile can override
    const globalDeny: Set<keyof ProjectPermissions> = new Set(['gitForcePush'])
    if (globalDeny.has(operation)) return 'deny'
    return 'allow'
  }

  private createUnclassifiedProfile(): ProjectProfile {
    const now = new Date().toISOString()
    return {
      id: 'unclassified',
      name: 'Unclassified Project',
      description: 'Default fallback — read-only access. No write, deploy, or admin operations.',
      repositoryPath: process.cwd(),
      repositoryRemote: '',
      defaultBranch: 'main',
      allowedBranches: ['main'],
      projectType: 'unknown',
      enabled: true,
      environments: {
        local: {
          writePolicy: 'deny',
          approvalPolicy: 'none',
          healthCheckRequired: false,
          backupRequired: false,
          rollbackRequired: false,
        },
      },
      agents: ['researcher', 'reviewer'],
      commands: ['/brainstorm', '/review'],
      skills: ['brainstorming'],
      mcpServers: [],
      mcpTools: [],
      akm: DEFAULT_AKM_SCOPE,
      permissions: DEFAULT_UNCLASSIFIED_PERMISSIONS,
      budgets: DEFAULT_UNCLASSIFIED_BUDGETS,
      concurrency: {
        maxReadTasks: 1,
        maxWriteTasks: 0,
        queuePolicy: 'fifo',
      },
      gitPolicy: {
        allowedBranches: ['main'],
        requirePullRequest: true,
        requireApproval: true,
        forbidForcePush: true,
        requireUpToDate: true,
        commitSigningRequired: false,
      },
      deploymentPolicy: {
        requireBackup: true,
        requireHealthCheck: true,
        requireApproval: true,
        approvalCount: 2,
        canaryEnabled: false,
        rollbackEnabled: true,
        maxRetries: 0,
      },
      schedules: [],
      observability: {
        metricsRetentionDays: 7,
        alertOnFailure: true,
        alertOnBudgetExceeded: true,
        dailyDigest: false,
        weeklyDigest: false,
        logLevel: 'info',
      },
      backupPolicy: {
        repositoryBackup: false,
        databaseBackup: false,
        uploadsBackup: false,
        secretsBackup: false,
        rtoMinutes: 1440,
        rpoMinutes: 1440,
        backupRetentionDays: 7,
      },
      createdAt: now,
      updatedAt: now,
    }
  }
}

export const projectRegistry = new ProjectRegistry()