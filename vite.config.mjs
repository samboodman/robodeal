import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import {
  apiError,
  createLiveSession,
  readJsonBody,
  sendJson,
} from './openai-api.js';
import { runDealerTurn } from './dealer-brain.js';
import balanceHandler from './api/balance.js';
import topupHandler from './api/topup.js';
import topupStatusHandler from './api/topup-status.js';
import debitHandler from './api/debit.js';
import saveCardHandler from './api/save-card.js';
import claimFreeHandler from './api/claim-free.js';
import { ensurePayerId, zeroBalance } from './payments.js';

const uiPrompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));

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

      server.middlewares.use('/api/dealer', async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Use POST for a dealer turn.' });
          return;
        }
        try {
          sendJson(response, 200, await runDealerTurn(apiKey, await readJsonBody(request)));
        } catch (error) {
          apiError(response, error, 'Local dealer turn failed');
        }
      });

      server.middlewares.use('/api/ui-prompts', (request, response) => {
        sendJson(response, 200, {
          thinkingSilence: uiPrompts.thinkingSilence,
          previewGreeting: uiPrompts.previewGreeting,
          voicePreviewText: uiPrompts.voicePreviewText,
        });
      });

      server.middlewares.use('/api/balance', balanceHandler);
      server.middlewares.use('/api/debit', debitHandler);
      server.middlewares.use('/api/save-card', saveCardHandler);
      server.middlewares.use('/api/claim-free', claimFreeHandler);
      server.middlewares.use('/api/topup-status', topupStatusHandler);
      server.middlewares.use('/api/topup', topupHandler);

      server.middlewares.use('/api/debug/zero-balance', async (request, response) => {
        try {
          const payerId = ensurePayerId(request, response);
          sendJson(response, 200, { balanceCents: await zeroBalance(payerId) });
        } catch (error) {
          apiError(response, error, 'Zero balance failed');
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);
  return {
    build: { assetsInlineLimit: 0 },
    plugins: [localOpenAIApi(env.OPENAI_API_KEY)],
  };
});
