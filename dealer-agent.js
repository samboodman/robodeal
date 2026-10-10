export class DealerAgent {
  constructor({
    getGameState,
    executeTool,
    onStatus = () => {},
    onTiming = () => {},
    fetchImplementation = (...args) => fetch(...args),
    dealerPath = '/api/dealer',
  }) {
    this.getGameState = getGameState;
    this.executeTool = executeTool;
    this.onStatus = onStatus;
    this.onTiming = onTiming;
    this.fetchImplementation = fetchImplementation;
    this.dealerPath = dealerPath;
    this.queue = Promise.resolve();
  }

  run(sourceEvent, recentConversation = [], preparedTurn = null) {
    const queuedAt = Date.now();
    const turn = this.queue.then(() => this.runTurn(sourceEvent, recentConversation, queuedAt, preparedTurn));
    this.queue = turn.catch(() => {});
    return turn;
  }

  prepare(sourceEvent, recentConversation = []) {
    if (sourceEvent.type !== 'voice_utterance') return null;
    const gameState = this.getGameState();
    const preparedAt = Date.now();
    const request = this.post({ sourceEvent, gameState, transcript: sourceEvent.transcript }).then(
      (response) => ({ response, serverMs: Date.now() - preparedAt }),
      (error) => ({ error, serverMs: Date.now() - preparedAt }),
    );
    return {
      sourceEventKey: JSON.stringify(sourceEvent),
      stateFingerprint: JSON.stringify(gameState),
      preparedAt,
      request,
    };
  }

  async post(body) {
    const response = await this.fetchImplementation(this.dealerPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!response.ok) throw new Error(data?.error || text || 'The dealer backend failed.');
    return data;
  }

  async runTurn(sourceEvent, recentConversation, queuedAt = Date.now(), preparedTurn = null) {
    const startedAt = Date.now();
    const timing = { queueMs: startedAt - queuedAt, serverMs: 0, javascriptMs: 0 };

    const finish = (result) => {
      timing.totalBackendMs = Date.now() - startedAt;
      this.onTiming(timing);
      return { ...result, timing };
    };

    if (sourceEvent.type !== 'voice_utterance') {
      const response = await this.post({ sourceEvent });
      return finish({ speak: response.speak, kind: response.kind, utterance: response.utterance });
    }

    this.onStatus('Processing…');
    const gameState = this.getGameState();
    const stateFingerprint = JSON.stringify(gameState);
    const preparedMatches = preparedTurn
      && preparedTurn.sourceEventKey === JSON.stringify(sourceEvent)
      && preparedTurn.stateFingerprint === stateFingerprint;

    let response;
    if (preparedMatches) {
      const prepared = await preparedTurn.request;
      timing.serverMs = prepared.serverMs;
      timing.speculativeLeadMs = Math.max(0, startedAt - preparedTurn.preparedAt);
      if (prepared.error) throw prepared.error;
      response = prepared.response;
    } else {
      const requestedAt = Date.now();
      response = await this.post({ sourceEvent, gameState, transcript: sourceEvent.transcript });
      timing.serverMs = Date.now() - requestedAt;
    }

    if (JSON.stringify(this.getGameState()) !== stateFingerprint) {
      timing.staleStateIgnored = true;
      return finish({ speak: false, kind: 'ignored', utterance: '' });
    }

    if (!response.speak) return finish({ speak: false, kind: 'ignored', utterance: '' });
    if (!response.toolName) {
      return finish({ speak: true, kind: response.kind, utterance: response.utterance });
    }

    this.onStatus('Applying action…');
    const toolStartedAt = Date.now();
    let output;
    try {
      output = await this.executeTool(response.toolName, response.toolArgs || {});
    } catch (error) {
      output = { ok: false, errorCode: 'TOOL_EXECUTION_FAILED', details: { reason: error.message } };
    }
    timing.javascriptMs = Date.now() - toolStartedAt;

    if (output?.ok) {
      return finish({ speak: true, kind: 'action_result', utterance: response.utterance });
    }

    const rejection = await this.post({
      sourceEvent,
      gameState: this.getGameState(),
      transcript: sourceEvent.transcript,
      toolName: response.toolName,
      toolOutput: output,
    });
    return finish({ speak: true, kind: 'clarification', utterance: rejection.utterance });
  }
}
