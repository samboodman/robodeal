import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';
import {
  apiError,
  sendJson,
} from './openai-api.js';
import liveSessionHandler from './api/live-session.js';
import dealerHandler from './api/dealer.js';
import balanceHandler from './api/balance.js';
import topupHandler from './api/topup.js';
import topupStatusHandler from './api/topup-status.js';
import debitHandler from './api/debit.js';
import saveCardHandler from './api/save-card.js';
import claimFreeHandler from './api/claim-free.js';
import { creditTopup, ensurePayerId, zeroBalance } from './payments.js';

const uiPrompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));

function localOpenAIApi(apiKey) {
  return {
    name: 'robodeal-local-openai-api',
    configureServer(server) {
      server.middlewares.use('/api/live-session', async (request, response) => {
        await liveSessionHandler(request, response);
      });

      server.middlewares.use('/api/dealer', async (request, response) => {
        await dealerHandler(request, response);
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

      // Localhost-only: fund the payer so the app (and the latency tests) can
      // start GPT-Live without going through Stripe.
      server.middlewares.use('/api/debug/grant', async (request, response) => {
        try {
          const payerId = ensurePayerId(request, response);
          const ref = `debug-grant:${Date.now()}`;
          sendJson(response, 200, { balanceCents: await creditTopup(payerId, 100_000, ref, 'debug_grant') });
        } catch (error) {
          apiError(response, error, 'Grant balance failed');
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
