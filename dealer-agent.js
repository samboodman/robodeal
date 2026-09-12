export class DealerAgent {
  constructor({
    getGameState,
    tools,
    executeTool,
    onStatus = () => {},
    onTiming = () => {},
    fetchImplementation = (...args) => fetch(...args),
    maxToolRounds = 3,
  }) {
    this.getGameState = getGameState;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onStatus = onStatus;
    this.onTiming = onTiming;
    this.fetchImplementation = fetchImplementation;
    this.maxToolRounds = maxToolRounds;
    this.queue = Promise.resolve();
  }

  run(sourceEvent, recentConversation = [], preparedTurn = null) {
    const queuedAt = Date.now();
    const turn = this.queue.then(() => this.runTurn(
      sourceEvent,
      recentConversation,
      queuedAt,
      preparedTurn,
    ));
    this.queue = turn.catch(() => {});
    return turn;
  }

  prepare(sourceEvent, recentConversation = []) {
    const stateSentToDealer = this.getGameState();
    const preparedAt = Date.now();
    const request = this.request({
      envelope: {
        sourceEvent,
        gameState: stateSentToDealer,
        recentConversation: recentConversation.slice(-12),
      },
      tools: this.tools,
    }).then(
      (response) => ({ response, initialTerraMs: Date.now() - preparedAt }),
      (error) => ({ error, initialTerraMs: Date.now() - preparedAt }),
    );
    return {
      sourceEvent: JSON.stringify(sourceEvent),
      recentConversation: JSON.stringify(recentConversation.slice(-12)),
      stateSentToDealer,
      stateFingerprint: JSON.stringify(stateSentToDealer),
      preparedAt,
      request,
    };
  }

  async request(body) {
    const response = await this.fetchImplementation('/api/dealer-turn', {
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
    const timing = {
      queueMs: startedAt - queuedAt,
      initialTerraMs: 0,
      javascriptMs: 0,
      postToolTerraMs: 0,
    };
    this.onStatus('Processing…');
    const initialRequestAt = Date.now();
    const sourceEventKey = JSON.stringify(sourceEvent);
    const recentConversationKey = JSON.stringify(recentConversation.slice(-12));
    const preparedMatches = preparedTurn
      && preparedTurn.sourceEvent === sourceEventKey
      && preparedTurn.recentConversation === recentConversationKey;
    let stateSentToDealer;
    let stateFingerprint;
    let response;

    if (preparedMatches) {
      stateSentToDealer = preparedTurn.stateSentToDealer;
      stateFingerprint = preparedTurn.stateFingerprint;
      timing.speculativeTerraLeadMs = Math.max(0, startedAt - preparedTurn.preparedAt);
      if (JSON.stringify(this.getGameState()) !== stateFingerprint) {
        timing.initialTerraMs = 0;
        timing.initialTerraWaitMs = 0;
        timing.totalBackendMs = Date.now() - startedAt;
        timing.staleStateIgnored = true;
        this.onTiming(timing);
        return { speak: false, kind: 'ignored', utterance: '', timing };
      }
      const preparedResult = await preparedTurn.request;
      timing.initialTerraMs = preparedResult.initialTerraMs;
      timing.initialTerraWaitMs = Date.now() - initialRequestAt;
      if (preparedResult.error) throw preparedResult.error;
      response = preparedResult.response;
    } else {
      stateSentToDealer = this.getGameState();
      stateFingerprint = JSON.stringify(stateSentToDealer);
      response = await this.request({
        envelope: {
          sourceEvent,
          gameState: stateSentToDealer,
          recentConversation: recentConversation.slice(-12),
        },
        tools: this.tools,
      });
      timing.initialTerraMs = Date.now() - initialRequestAt;
      timing.initialTerraWaitMs = timing.initialTerraMs;
    }
    timing.serviceTier = response.serviceTier || null;

    for (let round = 0; response.type === 'tool_calls' && round < this.maxToolRounds; round += 1) {
      this.onStatus('Applying action…');
      const toolOutputs = [];
      const toolStartedAt = Date.now();
      for (const [index, call] of response.calls.entries()) {
        let output;
        let args = {};
        try {
          args = JSON.parse(call.arguments || '{}');
        } catch {
          output = {
            ok: false,
            errorCode: 'INVALID_TOOL_ARGUMENTS',
            stateAfter: this.getGameState(),
          };
        }
        const optimisticNarration = typeof args.narration === 'string'
          ? args.narration.trim()
          : '';
        delete args.narration;

        if (index > 0) {
          output = {
            ok: false,
            errorCode: 'MULTIPLE_ACTIONS_NOT_ALLOWED',
            stateAfter: this.getGameState(),
          };
        } else if (!output && JSON.stringify(this.getGameState()) !== stateFingerprint) {
          output = {
            ok: false,
            errorCode: 'STALE_GAME_STATE',
            details: { reason: 'The game changed while the spoken action was being interpreted.' },
            stateAfter: this.getGameState(),
          };
        } else if (!output) {
          try {
            output = await this.executeTool(call.name, args);
          } catch (error) {
            output = {
              ok: false,
              errorCode: 'TOOL_EXECUTION_FAILED',
              details: { reason: error.message },
              stateAfter: this.getGameState(),
            };
          }
        }
        toolOutputs.push({ callId: call.callId, output, optimisticNarration });
      }
      timing.javascriptMs += Date.now() - toolStartedAt;

      const staleState = response.calls.length === 1
        && toolOutputs[0].output?.errorCode === 'STALE_GAME_STATE';
      if (staleState) {
        timing.totalBackendMs = Date.now() - startedAt;
        timing.staleStateIgnored = true;
        this.onTiming(timing);
        return {
          speak: false,
          kind: 'ignored',
          utterance: '',
          timing,
        };
      }

      const successfulFastPath = response.calls.length === 1
        && toolOutputs[0].output?.ok === true
        && toolOutputs[0].optimisticNarration;
      if (successfulFastPath) {
        timing.totalBackendMs = Date.now() - startedAt;
        timing.optimisticNarration = true;
        this.onTiming(timing);
        return {
          speak: true,
          kind: 'action_result',
          utterance: toolOutputs[0].optimisticNarration,
          timing,
        };
      }

      const continuationStartedAt = Date.now();
      response = await this.request({
        previousResponseId: response.responseId,
        toolOutputs: toolOutputs.map(({ callId, output }) => ({ callId, output })),
        // The action has already been attempted. The continuation may only
        // turn the verified JavaScript result into dealer speech.
        tools: [],
      });
      timing.serviceTier = response.serviceTier || timing.serviceTier;
      timing.postToolTerraMs += Date.now() - continuationStartedAt;
    }

    if (response.type === 'tool_calls') throw new Error('The dealer exceeded the action-tool limit.');
    if (response.type !== 'result' || !response.result) throw new Error('The dealer returned an invalid result.');
    timing.totalBackendMs = Date.now() - startedAt;
    this.onTiming(timing);
    return { ...response.result, timing };
  }
}
