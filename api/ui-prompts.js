import { readFileSync } from 'node:fs';
import { sendJson } from '../openai-api.js';

const prompts = JSON.parse(readFileSync(new URL('../Prompts.json', import.meta.url), 'utf8'));

export default function handler(request, response) {
  sendJson(response, 200, {
    thinkingSilence: prompts.thinkingSilence,
    previewGreeting: prompts.previewGreeting,
    voicePreviewText: prompts.voicePreviewText,
  });
}
