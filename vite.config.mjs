import { defineConfig, loadEnv } from 'vite';

function localRealtimeApi(apiKey) {
  return {
    name: 'robodeal-local-realtime-api',
    configureServer(server) {
      server.middlewares.use('/api/realtime-call', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Use POST for a Realtime call.' }));
          return;
        }
        if (!apiKey) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'The local server is missing OPENAI_API_KEY in .env.local.' }));
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const form = new FormData();
          form.append('sdp', requestBody.sdp || '');
          form.append('session', JSON.stringify({ type: 'realtime', model: 'gpt-realtime-2.1-mini' }));
          const openAIResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
          });
          const answer = await openAIResponse.text();
          response.statusCode = openAIResponse.status;
          response.setHeader('Content-Type', openAIResponse.headers.get('content-type') || 'text/plain');
          response.end(answer);
        } catch (error) {
          console.error('Local Realtime call failed:', error);
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'The local Realtime server failed.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [localRealtimeApi(env.OPENAI_API_KEY)] };
});
