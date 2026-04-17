import { createServer } from 'node:http';

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  let body = '';
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body || '{}');

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'chatcmpl-local',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model ?? 'demo-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'mock response' },
          finishReason: 'stop',
        },
      ],
    })
  );
});

server.listen(9090, '127.0.0.1', () => {
  console.log('Mock upstream ready on http://127.0.0.1:9090');
});
