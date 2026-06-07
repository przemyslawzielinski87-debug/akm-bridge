import { AKM_BINARY, PROCESS_TIMEOUT, type AgentMode } from './types.js'

export const AGENT_MODES: AgentMode[] = ['off', 'manual', 'supervised']

export interface BridgeConfig {
  akmBinary: string
  processTimeout: number
  writeTimeout: number
  maxSearchResults: number
  maxQueryLength: number
  maxRefLength: number
  maxContentLength: number
  maxActivityRecords: number
  maxAuditRecords: number
  maxAgentRuns: number
  confirmationTokenExpiryMs: number
  writeEnabled: boolean
  agentMode: AgentMode
  httpPort: number
  httpHost: string
  dataDir: string
}

function parseAgentMode(raw: string | undefined, fallback: AgentMode): AgentMode {
  if (!raw) return fallback
  const v = raw.trim().toLowerCase() as AgentMode
  return AGENT_MODES.includes(v) ? v : fallback
}

export function loadConfig(): BridgeConfig {
  return {
    akmBinary: process.env.AKM_BINARY ?? AKM_BINARY,
    processTimeout: Number(process.env.AKM_TIMEOUT) || PROCESS_TIMEOUT,
    writeTimeout: Number(process.env.AKM_WRITE_TIMEOUT) || 120_000,
    maxSearchResults: 25,
    maxQueryLength: 300,
    maxRefLength: 500,
    maxContentLength: 500_000,
    maxActivityRecords: 50,
    maxAuditRecords: 500,
    maxAgentRuns: 50,
    confirmationTokenExpiryMs: 60_000,
    writeEnabled: process.env.AKM_WRITE_ENABLED === 'true',
    agentMode: parseAgentMode(process.env.AKM_AGENT_MODE, 'supervised'),
    httpPort: 4199,
    httpHost: '127.0.0.1',
    dataDir: process.env.AKM_DATA_DIR ?? '/root/projekt/akm-bridge/data',
  }
}
