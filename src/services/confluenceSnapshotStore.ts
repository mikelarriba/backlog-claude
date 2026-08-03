// ── In-memory TTL snapshot store for Confluence execute/undo ─────────────────
// Execute (POST /api/confluence/execute) records one SnapshotOperation per
// *successfully* applied change (failed/skipped suggestions are never undone —
// they never happened) and stores them together under a single UUID. Undo
// (POST /api/confluence/undo/:snapshotId) looks the snapshot up once, reverses
// it, and removes it from the store.
//
// This is a plain module-level Map, not a factory tied to Express context —
// there's exactly one process, one user, and no persistence requirement (a
// restart losing in-flight undo windows is acceptable for this tool). TTL is
// enforced lazily on read (checked in getSnapshot) rather than via setTimeout
// eviction, so there's no timer to leak or unref() in tests.
//
// `now` is an optional override on both createSnapshot/getSnapshot (mirroring
// the injected-time style already used for testability elsewhere in this repo,
// e.g. isoDate() callers in transforms.ts) so unit tests can exercise TTL
// expiry without real timers or fake-timer libraries.
import { randomUUID } from 'crypto';

export type SnapshotAction = 'Create' | 'Update' | 'Delete';

export interface SnapshotOperation {
  action: SnapshotAction;
  pageTitle: string;
  // null for a failed/skipped op that shouldn't be undone.
  pageId: string | null;
  // Content before the change (for Update/Delete undo); null for Create.
  previousContent: string | null;
  // Version before the change (for Update undo); null otherwise.
  previousVersion: number | null;
}

export interface Snapshot {
  id: string;
  createdAt: number;
  operations: SnapshotOperation[];
}

export const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

const store = new Map<string, Snapshot>();

// Proactive sweep so snapshots don't accumulate for the life of the process
// when /undo is never called (the common case) — mirrors eventService's
// idle-client sweep. Lazy eviction on read (see getSnapshot) still applies.
const sweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, snapshot] of store) {
    if (now - snapshot.createdAt > SNAPSHOT_TTL_MS) store.delete(id);
  }
}, SWEEP_INTERVAL_MS);
sweepTimer.unref();

export function createSnapshot(operations: SnapshotOperation[], now: number = Date.now()): string {
  const id = randomUUID();
  store.set(id, { id, createdAt: now, operations });
  return id;
}

// Returns null when the snapshot is missing OR expired. An expired snapshot
// is evicted from the store as a side effect of this check.
export function getSnapshot(id: string, now: number = Date.now()): Snapshot | null {
  const snapshot = store.get(id);
  if (!snapshot) return null;
  if (now - snapshot.createdAt > SNAPSHOT_TTL_MS) {
    store.delete(id);
    return null;
  }
  return snapshot;
}

export function deleteSnapshot(id: string): void {
  store.delete(id);
}
