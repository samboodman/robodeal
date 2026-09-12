export class DealerAgent {
  constructor({
    getGameState,
    tools,
    executeTool,
    onStatus = () => {},
    fetchImplementation = (...args) => fetch(...args),
    maxToolRounds = 3,
  }) {
    this.getGameState = getGameState;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onStatus = onStatus;
    this.fetchImplementation = fetchImplementation;
    this.maxToolRounds = maxToolRounds;
    this.queue = Promise.resolve();
  }

  run(sourceEvent, recentConversation = []) {
    const turn = this.queue.then(() => this.runTurn(sourceEvent, recentConversation));
    this.queue = turn.catch(() => {});
    return turn;
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

  async runTurn(sourceEvent, recentConversation) {
    this.onStatus('Processing…');
    let response = await this.request({
      envelope: {
        sourceEvent,
        gameState: this.getGameState(),
        recentConversation: recentConversation.slice(-12),
      },
      tools: this.tools,
    });

    for (let round = 0; response.type === 'tool_calls' && round < this.maxToolRounds; round += 1) {
      this.onStatus('Applying action…');
      const toolOutputs = [];
      for (const [index, call] of response.calls.entries()) {
        let output;
        if (index > 0) {
          output = {
            ok: false,
            errorCode: 'MULTIPLE_ACTIONS_NOT_ALLOWED',
            stateAfter: this.getGameState(),
          };
        } else {
          try {
            output = await this.executeTool(call.name, JSON.parse(call.arguments || '{}'));
          } catch (error) {
            output = {
              ok: false,
              errorCode: 'TOOL_EXECUTION_FAILED',
              details: { reason: error.message },
              stateAfter: this.getGameState(),
            };
          }
        }
        toolOutputs.push({ callId: call.callId, output });
      }

      response = await this.request({
        previousResponseId: response.responseId,
        toolOutputs,
        tools: this.tools,
      });
    }

    if (response.type === 'tool_calls') throw new Error('The dealer exceeded the action-tool limit.');
    if (response.type !== 'result' || !response.result) throw new Error('The dealer returned an invalid result.');
    return response.result;
  }
}
