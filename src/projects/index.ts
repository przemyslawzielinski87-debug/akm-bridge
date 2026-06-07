export {
  projectRegistry,
  ProjectRegistry,
} from './project-registry.js'
export {
  validatePathInProject,
  validateTaskPaths,
  isSymlinkEscape,
  validateEnvironmentAccess,
} from './project-scope.js'
export {
  checkPermission,
  checkAgentAllowed,
  checkCommandAllowed,
  checkSkillAllowed,
  isProductionWrite,
  ALLOWED_GLOBAL_COMMANDS,
} from './project-permissions.js'
export {
  checkBudget,
  recordUsage,
  getBudgetStatus,
} from './project-budgets.js'
export {
  acquireLock,
  releaseLock,
  getProjectLocks,
  clearExpiredLocks,
  isProjectLocked,
} from './project-locks.js'
export type {
  ProjectProfile,
  ProjectPermissions,
  ProjectBudgets,
  ProjectEnvironment,
  ProjectAkmScope,
  EnvironmentName,
  PermissionLevel,
} from './project-profile-types.js'