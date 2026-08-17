const amountPattern = /(?:\d+(?:\.\d+)?|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)\b)/i;

function isCommand(normalizedTranscript, action) {
  const prefix = '(?:okay[,. ]+|ok[,. ]+|please\\s+)?(?:i(?:\\s+will|\\s+want\\s+to|\'ll)?\\s+)?';
  return new RegExp(`^${prefix}${action}\\b`, 'i').test(normalizedTranscript);
}

export function classifyVoiceCommand(transcript, pendingWagerKind = null) {
  const normalizedTranscript = transcript.toLowerCase().trim();
  const hasAmount = amountPattern.test(normalizedTranscript);

  if (pendingWagerKind && hasAmount) {
    return {
      type: 'action',
      toolName: 'betCurrentPlayer',
      wagerKind: pendingWagerKind,
      isAmountAnswer: true,
    };
  }

  if (isCommand(normalizedTranscript, '(?:go\\s+)?all[ -]?in')) {
    return { type: 'action', toolName: 'goAllIn' };
  }
  if (isCommand(normalizedTranscript, 'fold')) {
    return { type: 'action', toolName: 'foldCurrentPlayer' };
  }
  if (isCommand(normalizedTranscript, 'check')) {
    return { type: 'action', toolName: 'checkCurrentPlayer' };
  }
  if (isCommand(normalizedTranscript, 'call')) {
    return { type: 'action', toolName: 'callCurrentPlayer' };
  }

  const wagerMatch = normalizedTranscript.match(/^(?:okay[,. ]+|ok[,. ]+|please\s+)?(?:i(?:\s+will|\s+want\s+to|'ll)?\s+)?(raise|bet|wager)\b/i);
  if (!wagerMatch) return null;

  const wagerKind = wagerMatch[1] === 'raise' ? 'raise' : 'bet';
  if (!hasAmount) return { type: 'clarification', wagerKind };
  return { type: 'action', toolName: 'betCurrentPlayer', wagerKind, isAmountAnswer: false };
}
