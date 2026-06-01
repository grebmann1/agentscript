import { createServer } from 'node:http';

const port = Number.parseInt(process.env.MOCK_LLM_PORT ?? '4010', 10);

function readJson(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/chat/completions') {
    await readJson(req);
    const body = {
      id: 'mock-chatcmpl',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gpt-3.5-turbo',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Mock reply from local LLM.' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method === 'POST' && req.url === '/responses') {
    await readJson(req);
    const body = {
      id: 'resp_mock',
      object: 'response',
      created_at: Math.floor(Date.now() / 1000),
      status: 'completed',
      model: 'gpt-3.5-turbo',
      output: [
        {
          type: 'message',
          id: 'msg_mock',
          role: 'assistant',
          content: [
            { type: 'output_text', text: 'Mock reply from local LLM.' },
          ],
        },
      ],
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => {
  console.log(`MOCK_LLM_READY ${port}`);
});
