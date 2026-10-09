import { defineConfig, loadEnv } from 'vite';
import {
  apiError,
  createDecisionsResponse,
  createLiveSession,
  readJsonBody,
  sendJson,
} from './openai-api.js';

function localOpenAIApi(apiKey) {
  return {
    name: 'robodeal-local-openai-api',
    configureServer(server) {
      server.middlewares.use('/api/live-session', async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Use POST to create a GPT-Live session.' });
          return;
        }
        try {
          sendJson(response, 201, await createLiveSession(apiKey, await readJsonBody(request)));
        } catch (error) {
          apiError(response, error, 'Local GPT-Live session creation failed');
        }
      });

      server.middlewares.use('/api/decisions', async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Use POST for a Decisions turn.' });
          return;
        }
        try {
          sendJson(response, 200, await createDecisionsResponse(apiKey, await readJsonBody(request)));
        } catch (error) {
          apiError(response, error, 'Local Decisions turn failed');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return { plugins: [localOpenAIApi(env.OPENAI_API_KEY)] };
});
