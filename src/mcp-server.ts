#!/usr/bin/env node
/**
 * AKM Bridge — MCP stdio server for OpenCode.
 * Implements JSON-RPC over stdin/stdout per the MCP spec.
 * Provides read-only AKM tools: akm_health, akm_status, akm_sources,
 * akm_stats, akm_search, akm_show, akm_capabilities.
 */

import * as readline from 'node:readline'
import {
  checkHealth, getStatus, listSources, getCapabilities,
  getStats, search, showResource,
  submitFeedback, listProposals, showProposal,
  getAgentMode, recordAgentRun, getAgentRuns,
} from './adapter.js'
import { ALLOWED_OPERATIONS, MAX_SEARCH_RESULTS, MAX_QUERY_LENGTH, MAX_REF_LENGTH, type AgentRunRecord } from './types.js'
import { loadConfig } from './config.js'

/* ── JSON-RPC helpers ── */

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string | null
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: number | string | null
  result: unknown
}

interface JsonRpcError {
  jsonrpc: '2.0'
  id: number | string | null
  error: { code: number; message: string; data?: unknown }
}

function success(id: number | string | null, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

function error(id: number | string | null, code: number, message: string, data?: unknown): JsonRpcError {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

function write(msg: unknown) {
  const line = JSON.stringify(msg)
  process.stdout.write(line + '\n')
}

/* ── Tool schemas ── */

const TOOL_DEFINITIONS = [
  {
    name: 'akm_health',
    description: 'Check AKM service health status',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'akm_status',
    description: 'Get AKM version, binary path, health, entry count, and index time',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'akm_sources',
    description: 'List all configured AKM sources with paths and write permissions',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'akm_stats',
    description: 'Get AKM index statistics: entries, embeddings, asset types, search modes',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'akm_capabilities',
    description: 'List all supported AKM capabilities and whether each is functional',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'akm_search',
    description: 'Search AKM indexed knowledge sources. Returns matching resources with refs for use with akm_show.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: `Search query (1-${MAX_QUERY_LENGTH} characters)`,
          minLength: 1,
          maxLength: MAX_QUERY_LENGTH,
        },
        type: {
          type: 'string',
          description: 'Optional asset type filter (skill, command, agent, knowledge, workflow, script, memory, wiki, lesson)',
          enum: ['skill', 'command', 'agent', 'knowledge', 'workflow', 'script', 'memory', 'wiki', 'lesson'],
        },
        limit: {
          type: 'integer',
          description: `Max results (1-${MAX_SEARCH_RESULTS})`,
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'akm_show',
    description: 'Display the full content of an AKM resource by reference. Use refs from akm_search results.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: `AKM resource reference (1-${MAX_REF_LENGTH} characters, e.g. "meridian-docs//knowledge:path/to/doc")`,
          minLength: 1,
          maxLength: MAX_REF_LENGTH,
        },
        max_chars: {
          type: 'integer',
          description: 'Maximum characters to return (default: 500000)',
          minimum: 100,
          maximum: 500000,
        },
      },
      required: ['ref'],
    },
  },
  {
    name: 'akm_feedback',
    description: 'Submit feedback on an AKM search result or resource. Positive or negative.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: 'AKM resource reference',
          minLength: 1,
        },
        positive: {
          type: 'boolean',
          description: 'true for helpful, false for not helpful',
        },
        reason: {
          type: 'string',
          description: 'Optional short reason (max 500 chars)',
          maxLength: 500,
        },
      },
      required: ['ref', 'positive'],
    },
  },
  {
    name: 'akm_proposal_list',
    description: 'List AKM improvement proposals with optional status filter.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status (e.g. "open", "pending", "accepted", "rejected")',
        },
      },
    },
  },
  {
    name: 'akm_proposal_show',
    description: 'View full details of a specific AKM proposal including content and diff.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Proposal ID (from akm_proposal_list)',
          minLength: 1,
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'akm_agent_mode',
    description: 'Get current AKM agent mode (off/manual/supervised). Controls whether the agent automatically uses AKM context.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'akm_agent_run_start',
    description: 'Record the start of a supervised agent run BEFORE a non-trivial task. Reports classification, queries, and selected resources.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          description: 'AKM usage classification: required, optional, or skipped',
          enum: ['required', 'optional', 'skipped'],
        },
        queries_count: {
          type: 'integer',
          description: 'Number of AKM searches performed (0-4)',
          minimum: 0,
          maximum: 4,
        },
        selected_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Resource references selected for review (max 5)',
          maxItems: 5,
        },
        loaded_refs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Resource references whose full content was loaded (max 3)',
          maxItems: 3,
        },
        classification_reason: {
          type: 'string',
          description: 'Short reason for the classification decision',
          maxLength: 500,
        },
      },
      required: ['decision'],
    },
  },
  {
    name: 'akm_agent_run_complete',
    description: 'Record the completion of a supervised agent run. Reports feedback, proposals, and duration.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: {
          type: 'string',
          description: 'Run ID returned by akm_agent_run_start',
        },
        feedback_count: {
          type: 'integer',
          description: 'Number of feedback submissions made during this run',
          minimum: 0,
        },
        lesson_proposal_created: {
          type: 'boolean',
          description: 'Whether a lesson proposal was created',
        },
        memory_proposal_created: {
          type: 'boolean',
          description: 'Whether a memory proposal was created',
        },
        fallback_used: {
          type: 'boolean',
          description: 'Whether AKM was unavailable and the agent fell back',
        },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'akm_agent_runs',
    description: 'List recent agent run records with metadata. Does not include prompts, responses, or resource content.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max records to return (1-50)',
          minimum: 1,
          maximum: 50,
        },
      },
    },
  },
]

/* ── Tool dispatch ── */

async function handleToolCall(
  id: number | string | null,
  name: string,
  args: Record<string, unknown> | undefined,
): Promise<void> {
  try {
    switch (name) {
      case 'akm_health': {
        const result = await checkHealth()
        write(success(id, result))
        return
      }
      case 'akm_status': {
        const result = await getStatus()
        write(success(id, result))
        return
      }
      case 'akm_sources': {
        const result = await listSources()
        write(success(id, result))
        return
      }
      case 'akm_capabilities': {
        const result = await getCapabilities()
        write(success(id, result))
        return
      }
      case 'akm_stats': {
        const result = await getStats()
        write(success(id, result))
        return
      }
      case 'akm_search': {
        const query = String(args?.query ?? '').trim()
        if (!query) {
          write(error(id, -32602, 'query is required'))
          return
        }
        if (query.length > MAX_QUERY_LENGTH) {
          write(error(id, -32602, `query exceeds ${MAX_QUERY_LENGTH} characters`))
          return
        }
        const rawType = args?.type
        const limit = typeof args?.limit === 'number' ? args.limit : undefined
        const result = await search({ query, type: typeof rawType === 'string' ? rawType : undefined, limit })
        write(success(id, result))
        return
      }
      case 'akm_show': {
        const ref = String(args?.ref ?? '').trim()
        if (!ref) {
          write(error(id, -32602, 'ref is required'))
          return
        }
        if (ref.length > MAX_REF_LENGTH) {
          write(error(id, -32602, `ref exceeds ${MAX_REF_LENGTH} characters`))
          return
        }
        const maxChars = typeof args?.max_chars === 'number' ? args.max_chars : undefined
        const result = await showResource({ ref, maxChars })
        write(success(id, result))
        return
      }
      case 'akm_feedback': {
        const refFb = String(args?.ref ?? '').trim()
        if (!refFb) { write(error(id, -32602, 'ref is required')); return }
        const positive = args?.positive === true
        const reason = typeof args?.reason === 'string' ? args.reason.slice(0, 500) : undefined
        const result = await submitFeedback(refFb, positive, reason)
        write(success(id, result))
        return
      }
      case 'akm_proposal_list': {
        const status = typeof args?.status === 'string' ? args.status.trim() : undefined
        const result = await listProposals(status)
        write(success(id, result))
        return
      }
      case 'akm_proposal_show': {
        const pid = String(args?.id ?? '').trim()
        if (!pid) { write(error(id, -32602, 'id is required')); return }
        const result = await showProposal(pid)
        write(success(id, result))
        return
      }
      case 'akm_agent_mode': {
        const mode = getAgentMode()
        write(success(id, { ok: true, data: { mode } }))
        return
      }
      case 'akm_agent_run_start': {
        const decision = String(args?.decision ?? '').trim()
        if (!['required', 'optional', 'skipped'].includes(decision)) {
          write(error(id, -32602, 'decision must be required, optional, or skipped'))
          return
        }
        const queriesCount = typeof args?.queries_count === 'number' ? Math.min(Math.max(0, args.queries_count), 4) : 0
        const selectedRefs: string[] = Array.isArray(args?.selected_refs) ? (args.selected_refs as string[]).slice(0, 5) : []
        const loadedRefs: string[] = Array.isArray(args?.loaded_refs) ? (args.loaded_refs as string[]).slice(0, 3) : []
        const runId = crypto.randomUUID()
        recordAgentRun({
          run_id: runId,
          timestamp: new Date().toISOString(),
          akm_decision: decision as 'required' | 'optional' | 'skipped',
          queries_count: queriesCount,
          selected_refs: selectedRefs,
          loaded_refs: loadedRefs,
          feedback_count: 0,
          lesson_proposal_created: false,
          memory_proposal_created: false,
          fallback_used: false,
          duration_ms: 0,
        })
        write(success(id, { ok: true, data: { run_id: runId } }))
        return
      }
      case 'akm_agent_run_complete': {
        const runId = String(args?.run_id ?? '').trim()
        if (!runId) { write(error(id, -32602, 'run_id is required')); return }
        const feedbackCount = typeof args?.feedback_count === 'number' ? Math.max(0, args.feedback_count) : 0
        const lessonCreated = args?.lesson_proposal_created === true
        const memoryCreated = args?.memory_proposal_created === true
        const fallbackUsed = args?.fallback_used === true
        const runs = getAgentRuns(50)
        const existing = runs.find(r => r.run_id === runId)
        if (existing) {
          const completedAt = new Date().toISOString()
          const durationMs = completedAt && existing.timestamp
            ? new Date(completedAt).getTime() - new Date(existing.timestamp).getTime()
            : 0
          recordAgentRun({
            ...existing,
            feedback_count: feedbackCount,
            lesson_proposal_created: lessonCreated || existing.lesson_proposal_created,
            memory_proposal_created: memoryCreated || existing.memory_proposal_created,
            fallback_used: fallbackUsed || existing.fallback_used,
            duration_ms: durationMs > 0 ? durationMs : existing.duration_ms,
            completed_at: completedAt,
          })
        }
        write(success(id, { ok: true, data: { run_id: runId } }))
        return
      }
      case 'akm_agent_runs': {
        const limit = typeof args?.limit === 'number' ? Math.min(Math.max(1, args.limit), 50) : 50
        const allRuns = getAgentRuns(limit)
        const safe = allRuns.map(r => ({
          run_id: r.run_id,
          timestamp: r.timestamp,
          akm_decision: r.akm_decision,
          queries_count: r.queries_count,
          selected_refs: r.selected_refs,
          loaded_refs: r.loaded_refs,
          feedback_count: r.feedback_count,
          lesson_proposal_created: r.lesson_proposal_created,
          memory_proposal_created: r.memory_proposal_created,
          fallback_used: r.fallback_used,
          duration_ms: r.duration_ms,
          completed_at: r.completed_at ?? null,
        }))
        write(success(id, { ok: true, data: safe }))
        return
      }
      default:
        write(error(id, -32601, `Unknown tool: ${name}`))
    }
  } catch (e) {
    write(error(id, -32603, `Internal error: ${(e as Error).message}`))
  }
}

/* ── Main loop ── */

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // diagnostics go to stderr
    terminal: false,
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let req: JsonRpcRequest
    try {
      req = JSON.parse(line) as JsonRpcRequest
    } catch {
      write(error(null, -32700, 'Parse error'))
      continue
    }

    const { id, method, params } = req

    switch (method) {
      case 'initialize': {
        write(success(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'akm-bridge', version: '0.1.0' },
        }))
        break
      }
      case 'notifications/initialized':
        // no response needed
        break
      case 'tools/list':
        write(success(id, { tools: TOOL_DEFINITIONS }))
        break
      case 'tools/call': {
        const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined
        await handleToolCall(id, p?.name ?? '', p?.arguments ?? {})
        break
      }
      case 'ping':
        write(success(id, {}))
        break
      default:
        write(error(id, -32601, `Method not found: ${method}`))
    }
  }
}

main().catch((e) => {
  process.stderr.write(`[akm-bridge] Fatal: ${e.message}\n`)
  process.exit(1)
})
