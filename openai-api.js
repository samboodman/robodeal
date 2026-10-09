import { readFileSync } from 'node:fs';
import { DECISIONS_MODEL } from './decisions.js';

const prompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));

function fillPrompt(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : placeholder
  ));
}

export function buildLiveSessionRequest({ sdp, voice = 'marin', accent = 'neutral', pace = 'natural', preview = false }) {
  if (typeof sdp !== 'string' || sdp.length === 0) throw new Error('A WebRTC offer is required.');
  const instructions = preview
    ? prompts.voicePreviewInstructions
    : fillPrompt(prompts.liveInstructions, { ACCENT: accent, PACE: pace });

  return {
    session: {
      model: 'gpt-live-1',
      instructions,
      delegation: { type: 'client' },
      audio: { output: { voice } },
    },
    transport: { type: 'webrtc', sdp },
  };
}

export function buildDecisionsRequest({ input, questions }) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('A Decisions input is required.');
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('At least one Decisions question is required.');
  }
  return {
    model: DECISIONS_MODEL,
    input,
    questions,
  };
}

export function parseDecisionsResponse(response) {
  if (!response || !Array.isArray(response.answers)) {
    throw new Error('The Decisions API returned no answers.');
  }
  return { answers: response.answers };
}

export async function callOpenAI(apiKey, path, body, fetchImplementation = fetch) {
  if (!apiKey) throw new Error('The server is missing OPENAI_API_KEY.');
  const openAIResponse = await fetchImplementation(`https://api.openai.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await openAIResponse.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!openAIResponse.ok) {
    throw new Error(data?.error?.message || text || `OpenAI request failed with ${openAIResponse.status}.`);
  }
  return data;
}

export async function createLiveSession(apiKey, requestBody, fetchImplementation = fetch) {
  return callOpenAI(apiKey, 'live/sessions', buildLiveSessionRequest(requestBody), fetchImplementation);
}

export async function createDecisionsResponse(apiKey, requestBody, fetchImplementation = fetch) {
  const response = await callOpenAI(
    apiKey,
    'decisions',
    buildDecisionsRequest(requestBody),
    fetchImplementation,
  );
  return parseDecisionsResponse(response);
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function sendJson(response, statusCode, value) {
  const json = JSON.stringify(value);
  if (typeof response.status === 'function' && typeof response.json === 'function') {
    response.status(statusCode).json(value);
    return;
  }
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(json);
}

export function apiError(response, error, label) {
  console.error(`${label}:`, error);
  const statusCode = /missing OPENAI_API_KEY/.test(error.message) ? 500 : 502;
  sendJson(response, statusCode, { error: error.message || label });
}
