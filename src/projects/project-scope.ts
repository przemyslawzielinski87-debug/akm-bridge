import { realpathSync, existsSync, statSync } from 'node:fs'
import { resolve, normalize, relative } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectProfile } from './project-profile-types.js'
import { projectRegistry } from './project-registry.js'

export interface ScopeValidation {
  valid: boolean
  error?: string
  resolvedPath?: string
  profile?: ProjectProfile
}

export function validatePathInProject(
  requestedPath: string,
  profile: ProjectProfile | null,
  cwd?: string
): ScopeValidation {
  if (!profile) {
    return { valid: false, error: 'No project profile available' }
  }

  // Resolve the absolute path
  let absPath: string
  try {
    absPath = resolve(cwd ?? process.cwd(), requestedPath)
  } catch {
    return { valid: false, error: `Cannot resolve path: ${requestedPath}` }
  }

  // Check if path is within project
  if (!projectRegistry.isPathAllowed(absPath, profile)) {
    return {
      valid: false,
      error: `Path "${requestedPath}" is outside project "${profile.name}" (${profile.id})`,
    }
  }

  return { valid: true, resolvedPath: absPath, profile }
}

export function validateTaskPaths(
  paths: string[],
  profile: ProjectProfile | null,
  cwd?: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  for (const p of paths) {
    const result = validatePathInProject(p, profile, cwd)
    if (!result.valid) {
      errors.push(result.error!)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function isSymlinkEscape(path: string, projectRoot: string): boolean {
  let resolved: string
  try {
    resolved = realpathSync(path)
  } catch {
    resolved = resolve(path)
  }

  const projectReal = realpathSync(projectRoot)

  // Resolve must be within project
  if (!resolved.startsWith(projectReal)) return true

  // Check intermediate components for symlinks
  const relative_path = relative(projectReal, resolved)
  const parts = relative_path.split('/')
  let current = projectReal
  for (const part of parts) {
    if (part === '..') return true
    current = join(current, part)
    try {
      const real = realpathSync(current)
      if (!real.startsWith(projectReal)) return true
    } catch {
      return true
    }
  }

  return false
}

export function validateEnvironmentAccess(
  profile: ProjectProfile,
  environment: string,
  operation: 'read' | 'write' | 'deploy' | 'admin'
): { allowed: boolean; reason?: string } {
  const env = profile.environments[environment as keyof typeof profile.environments]
  if (!env) {
    return { allowed: false, reason: `Environment "${environment}" not defined in profile "${profile.id}"` }
  }

  if (operation === 'deploy' || operation === 'admin') {
    if (env.writePolicy === 'deny') {
      return { allowed: false, reason: `Environment "${environment}" does not allow ${operation}` }
    }
    if (env.writePolicy === 'ask') {
      return { allowed: true, reason: `Environment "${environment}" requires approval for ${operation}` }
    }
  }

  return { allowed: true }
}