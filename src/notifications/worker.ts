#!/usr/bin/env bun
/**
 * Notification delivery worker.
 *
 * Runs a periodic dispatch loop that processes queued notifications.
 * Designed for systemd (Type=simple) — handles SIGTERM/SIGINT gracefully.
 */

import { resolve } from "path";
import { NotificationStore } from "./notification-store.ts";
import { buildManagerFromEnv } from "./notification-manager.ts";

const DISPATCH_INTERVAL_MS = 30_000;

let running = true;
let timer: ReturnType<typeof setInterval> | null = null;

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[notification-worker] ${ts} ${msg}`);
}

async function dispatchOnce(manager: ReturnType<typeof buildManagerFromEnv>) {
  try {
    const dispatched = await manager.dispatchQueued();
    if (dispatched.sent > 0) {
      log(`dispatched ${dispatched.sent} notification(s)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`dispatch error: ${msg.slice(0, 200)}`);
  }
}

async function main() {
  log("starting notification worker");

  const dbPath = process.env.NOTIFICATION_DB_PATH
    ?? resolve(process.cwd(), "data", "notifications.db");

  let store: NotificationStore;
  try {
    store = new NotificationStore(dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`fatal: failed to open store: ${msg.slice(0, 200)}`);
    process.exit(1);
  }

  const manager = buildManagerFromEnv(store);

  // Initial dispatch
  await dispatchOnce(manager);

  // Periodic dispatch
  timer = setInterval(() => {
    if (running) dispatchOnce(manager);
  }, DISPATCH_INTERVAL_MS);

  log(`dispatch loop running (interval ${DISPATCH_INTERVAL_MS / 1000}s)`);
}

function shutdown(signal: string) {
  log(`received ${signal}, shutting down`);
  running = false;
  if (timer) clearInterval(timer);
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[notification-worker] fatal: ${msg.slice(0, 500)}`);
  process.exit(1);
});
