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

  await new Promise((resolve) => setTimeout(resolve, 1500));

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'chatcmpl-slow',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model ?? 'demo-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'slow mock response' },
          finishReason: 'stop',
        },
      ],
    })
  );
});

server.listen(9091, '127.0.0.1', () => {
  console.log('Slow mock upstream ready on http://127.0.0.1:9091');
});
