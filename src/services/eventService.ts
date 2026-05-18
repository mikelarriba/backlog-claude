import type { Request, Response } from 'express';
import type { BroadcastFn } from '../types.js';

export function createEventService(): { handleEvents: (req: Request, res: Response) => void; broadcast: BroadcastFn } {
  const sseClients = new Set<Response>();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function handleEvents(req: Request, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));

    // Start heartbeat when first client connects
    if (!heartbeatTimer && sseClients.size > 0) {
      heartbeatTimer = setInterval(() => {
        if (sseClients.size === 0) {
          clearInterval(heartbeatTimer!);
          heartbeatTimer = null;
          return;
        }
        for (const client of sseClients) {
          try { client.write(':\n\n'); } catch { sseClients.delete(client); }
        }
      }, 30000);
      heartbeatTimer.unref();
    }
  }

  function broadcast(payload: Record<string, any>): void {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try { client.write(data); } catch { sseClients.delete(client); }
    }
  }

  return { handleEvents, broadcast };
}
