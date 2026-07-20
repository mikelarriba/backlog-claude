import type { Request, Response } from 'express';
import type { BroadcastFn, SSEEvent } from '../types.js';
import { createLogger } from '../utils/logger.js';

const { logDebug } = createLogger('[eventService]');

const SSE_IDLE_TIMEOUT_MS = parseInt(process.env.SSE_IDLE_TIMEOUT_MS || '300000', 10);
const SWEEP_INTERVAL_MS = 60_000;

interface SseClient {
  res: Response;
  lastWriteAt: number;
}

export function createEventService(): {
  handleEvents: (req: Request, res: Response) => void;
  broadcast: BroadcastFn;
} {
  const sseClients = new Set<SseClient>();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function removeClient(client: SseClient): void {
    sseClients.delete(client);
    try {
      client.res.end();
    } catch {
      /* already ended */
    }
  }

  function handleEvents(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write('data: {"type":"connected"}\n\n');
    const client: SseClient = { res, lastWriteAt: Date.now() };
    sseClients.add(client);
    req.on('close', () => sseClients.delete(client));

    // Start heartbeat + idle-sweep when first client connects
    if (!heartbeatTimer && sseClients.size > 0) {
      heartbeatTimer = setInterval(() => {
        if (sseClients.size === 0) {
          clearInterval(heartbeatTimer!);
          heartbeatTimer = null;
          return;
        }

        const now = Date.now();
        for (const c of sseClients) {
          // Idle-timeout eviction — based on the last real broadcast() write,
          // not this heartbeat. Heartbeats fire on every sweep regardless of
          // application activity, so updating lastWriteAt here would make a
          // client that's genuinely idle (no broadcasts, e.g. because nobody
          // else is using the app) never expire.
          if (now - c.lastWriteAt > SSE_IDLE_TIMEOUT_MS) {
            removeClient(c);
            continue;
          }

          // Heartbeat write (does not count as activity — see above)
          try {
            c.res.write(':\n\n');
          } catch {
            sseClients.delete(c);
          }
        }

        logDebug('sweep', `Active SSE clients: ${sseClients.size}`);
      }, SWEEP_INTERVAL_MS);
      heartbeatTimer.unref();
    }
  }

  function broadcast(payload: SSEEvent): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    const now = Date.now();
    for (const client of sseClients) {
      try {
        client.res.write(data);
        client.lastWriteAt = now;
      } catch {
        sseClients.delete(client);
      }
    }
  }

  return { handleEvents, broadcast };
}
