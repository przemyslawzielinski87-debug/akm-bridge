import type { ProjectProfile, ProjectPermissions, PermissionLevel, EnvironmentName } from './project-profile-types.js'
import { DEFAULT_UNCLASSIFIED_PERMISSIONS } from './project-profile-types.js'

export interface PermissionCheck {
  allowed: boolean
  requiresApproval: boolean
  reason?: string
  effectiveLevel: PermissionLevel
}

// Global denies that no profile can override
const GLOBAL_DENY: Set<keyof ProjectPermissions> = new Set([
  'gitForcePush',
])

export function checkPermission(
  profile: ProjectProfile,
  operation: keyof ProjectPermissions,
  environment: EnvironmentName = 'local'
): PermissionCheck {
  // Global deny
  if (GLOBAL_DENY.has(operation)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `${operation} is globally forbidden`,
      effectiveLevel: 'deny',
    }
  }

  const level = resolveEffectiveLevel(profile, operation, environment)

  if (level === 'deny') {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `${operation} is denied for project "${profile.id}" in environment "${environment}"`,
      effectiveLevel: 'deny',
    }
  }

  if (level === 'ask') {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `${operation} requires approval for project "${profile.id}" in environment "${environment}"`,
      effectiveLevel: 'ask',
    }
  }

  return {
    allowed: true,
    requiresApproval: false,
    effectiveLevel: 'allow',
  }
}

export function checkAgentAllowed(
  profile: ProjectProfile,
  agent: string
): { allowed: boolean; reason?: string } {
  if (profile.agents.length === 0) return { allowed: true }
  if (profile.agents.includes(agent)) return { allowed: true }
  return {
    allowed: false,
    reason: `Agent "${agent}" is not allowed in project "${profile.id}". Allowed: ${profile.agents.join(', ')}`,
  }
}

export function checkCommandAllowed(
  profile: ProjectProfile,
  command: string
): { allowed: boolean; reason?: string } {
  if (profile.commands.length === 0) return { allowed: true }
  const normalized = command.startsWith('/') ? command : `/${command}`
  if (profile.commands.includes(normalized)) return { allowed: true }
  return {
    allowed: false,
    reason: `Command "${command}" is not allowed in project "${profile.id}". Allowed: ${profile.commands.join(', ')}`,
  }
}

export function checkSkillAllowed(
  profile: ProjectProfile,
  skill: string
): { allowed: boolean; reason?: string } {
  if (profile.skills.length === 0) return { allowed: true }
  if (profile.skills.includes(skill)) return { allowed: true }
  return {
    allowed: false,
    reason: `Skill "${skill}" is not allowed in project "${profile.id}". Allowed: ${profile.skills.join(', ')}`,
  }
}

function resolveEffectiveLevel(
  profile: ProjectProfile,
  operation: keyof ProjectPermissions,
  environment: EnvironmentName
): PermissionLevel {
  const profileLevel = profile.permissions[operation] ?? 'deny'

  // Production forces ask for write/deploy regardless of profile setting
  if (environment === 'production' && (operation === 'write' || operation === 'deploy')) {
    if (profileLevel === 'allow') return 'ask'
    return profileLevel
  }

  // Environment policy can further restrict
  const env = profile.environments[environment]
  if (env) {
    if (operation === 'deploy' && env.writePolicy === 'deny') return 'deny'
    if (operation === 'deploy' && env.writePolicy === 'ask') return 'ask'
    if (operation === 'admin' && env.writePolicy === 'deny') return 'deny'
  }

  return profileLevel
}

export function isProductionWrite(profile: ProjectProfile, environment: EnvironmentName, operation: keyof ProjectPermissions): boolean {
  return environment === 'production' && (operation === 'write' || operation === 'deploy')
}

export const ALLOWED_GLOBAL_COMMANDS = ['/brainstorm', '/projects', '/review', '/system-check', '/learn']