import { readFileSync } from 'node:fs';

const prompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));
const allowedToolNames = new Set([
  'check',
  'call',
  'bet',
  'raise',
  'fold',
  'allIn',
  'cardsDealt',
  'undo',
]);

function fillPrompt(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : placeholder
  ));
}

function normalizeTool(tool) {
  if (tool?.type !== 'function' || !allowedToolNames.has(tool.name)) return null;
  return {
    type: 'function',
    name: tool.name,
    description: String(tool.description || ''),
    parameters: tool.parameters || { type: 'object', properties: {}, additionalProperties: false },
    strict: true,
  };
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

export function buildDealerResponseRequest({ envelope, previousResponseId = null, toolOutputs = [], tools = [] }) {
  const isContinuation = Boolean(previousResponseId);
  const normalizedTools = isContinuation ? [] : tools.map(normalizeTool).filter(Boolean);
  const input = previousResponseId
    ? toolOutputs.map(({ callId, output }) => ({
      type: 'function_call_output',
      call_id: callId,
      output: JSON.stringify(output),
    }))
    : [{
      role: 'user',
      content: [{ type: 'input_text', text: JSON.stringify(envelope) }],
    }];

  if (previousResponseId && input.length === 0) {
    throw new Error('Tool outputs are required to continue a dealer response.');
  }

  return {
    model: 'gpt-5.6-terra',
    instructions: prompts.terraInstructions,
    input,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    tools: normalizedTools,
    tool_choice: isContinuation || normalizedTools.length === 0 ? 'none' : 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: 'none' },
    text: {
      verbosity: 'low',
      format: {
        type: 'json_schema',
        name: 'dealer_response',
        strict: true,
        schema: prompts.dealerResponseSchema,
      },
    },
    max_output_tokens: isContinuation ? 300 : 800,
    store: true,
  };
}

function responseText(response) {
  return (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text')
    .map((content) => content.text)
    .join('');
}

export function parseDealerResponse(response) {
  if (!response?.id) throw new Error('Terra returned a response without an ID.');
  if (response.status === 'failed') {
    throw new Error(response.error?.message || 'Terra could not complete the dealer turn.');
  }

  const calls = (response.output || [])
    .filter((item) => item.type === 'function_call')
    .map((item) => ({
      callId: item.call_id,
      name: item.name,
      arguments: item.arguments || '{}',
    }));

  if (calls.length > 0) {
    return { type: 'tool_calls', responseId: response.id, calls };
  }

  const text = responseText(response);
  if (!text) throw new Error('Terra returned no dealer response.');
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error('Terra returned an invalid dealer response.');
  }
  if (typeof result.speak !== 'boolean' || typeof result.kind !== 'string' || typeof result.utterance !== 'string') {
    throw new Error('Terra returned an incomplete dealer response.');
  }
  if (!result.speak) result.utterance = '';
  return { type: 'result', responseId: response.id, result };
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

export async function createDealerResponse(apiKey, requestBody, fetchImplementation = fetch) {
  const response = await callOpenAI(
    apiKey,
    'responses',
    buildDealerResponseRequest(requestBody),
    fetchImplementation,
  );
  return parseDealerResponse(response);
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
