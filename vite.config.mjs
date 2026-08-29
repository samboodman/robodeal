import { defineConfig, loadEnv } from 'vite';
import { handleVoiceApi } from './voice-api-handler.js';
import { createRealtimeTranscriptionClientSecret } from './realtime-transcription.js';

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
        try {
          const result = await createRealtimeTranscriptionClientSecret(apiKey);
          response.statusCode = result.status;
          response.setHeader('Content-Type', result.contentType);
          response.end(result.body);
        } catch (error) {
          console.error('Local Realtime call failed:', error);
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'The local Realtime server failed.' }));
        }
      });
    },
  };
}

function localVoiceApi(apiKey) {
  return {
    name: 'robodeal-local-voice-api',
    configureServer(server) {
      server.middlewares.use('/api/voice', async (request, response) => {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end(JSON.stringify({ error: 'Use POST for voice requests.' }));
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of request) {chunks.push(chunk);}
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const result = await handleVoiceApi(body, apiKey);
          response.statusCode = result.status;
          response.setHeader('Content-Type', result.contentType);
          response.end(result.body);
        } catch (error) {
          console.error('Local voice request failed:', error);
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'The local voice server failed.' }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [localRealtimeApi(env.OPENAI_API_KEY), localVoiceApi(env.OPENAI_API_KEY)] };
});
