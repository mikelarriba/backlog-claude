export function createEventService() {
  const sseClients = new Set();

  function handleEvents(req, res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  }

  function broadcast(payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) client.write(data);
  }

  return { handleEvents, broadcast };
}
