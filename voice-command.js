const numberWords = new Map([
  ['zero', 0],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
  ['sixteen', 16],
  ['seventeen', 17],
  ['eighteen', 18],
  ['nineteen', 19],
  ['twenty', 20],
  ['thirty', 30],
  ['forty', 40],
  ['fifty', 50],
  ['sixty', 60],
  ['seventy', 70],
  ['eighty', 80],
  ['ninety', 90],
  ['one hundred', 100],
]);

function normalizeTranscript(transcript) {
  return String(transcript || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmount(value) {
  const text = value.trim();
  if (/^\d+$/.test(text)) return Number(text);
  if (numberWords.has(text)) return numberWords.get(text);

  const parts = text.split(' ');
  if (parts.length === 2 && numberWords.has(parts[0]) && numberWords.has(parts[1])) {
    const first = numberWords.get(parts[0]);
    const second = numberWords.get(parts[1]);
    if (first >= 20 && first % 10 === 0 && second > 0 && second < 10) return first + second;
  }
  return null;
}

export function classifyVoiceCommand(transcript, snapshot, pendingFoldPlayerNumber = null) {
  const speech = normalizeTranscript(transcript);
  const player = snapshot?.currentPlayer;
  if (!speech || !player) return null;

  if (pendingFoldPlayerNumber !== null) {
    if (/^(yes|yes i fold|yeah|yep|confirm|confirm fold|do it|fold)$/.test(speech)) {
      return { type: 'confirm-fold', playerNumber: pendingFoldPlayerNumber };
    }
    if (/^(no|nope|cancel|cancel fold|dont fold|do not fold)$/.test(speech)) {
      return { type: 'cancel-fold' };
    }
  }

  if (/^(im all in|i am all in|all in|go all in)$/.test(speech)) {
    return { type: 'action', name: 'allIn', args: {} };
  }

  if (/^(cards dealt|cards are dealt|done dealing|dealing is done)$/.test(speech)) {
    return { type: 'action', name: 'cardsDealt', args: {} };
  }

  if (/^(fold|i fold|i want to fold|fold my hand|im out|i am out|too rich for me im out|too rich for me i am out)$/.test(speech)) {
    return { type: 'request-fold', playerNumber: snapshot.currentPlayerNumber };
  }

  if (/^(call|i call|call it)$/.test(speech)) {
    return { type: 'action', name: 'call', args: {} };
  }

  if (/^(check|i check)$/.test(speech)) {
    return { type: 'action', name: 'check', args: {} };
  }

  const raiseMatch = speech.match(/^raise(?: by)? (.+)$/);
  if (raiseMatch) {
    const raiseAmount = parseAmount(raiseMatch[1]);
    if (raiseAmount !== null) {
      return {
        type: 'action',
        name: 'bet',
        args: { amount: player.amountToCall + raiseAmount },
      };
    }
  }

  const totalBetMatch = speech.match(/^(?:bet|im in|i am in|im in for|i am in for|screw it im in|screw it i am in) (.+)$/);
  if (totalBetMatch) {
    const totalRoundBet = parseAmount(totalBetMatch[1]);
    if (totalRoundBet !== null) {
      return {
        type: 'action',
        name: 'bet',
        args: { amount: Math.max(0, totalRoundBet - player.roundBet) },
      };
    }
  }

  if (/^(im in|i am in|screw it im in|screw it i am in)$/.test(speech)) {
    return { type: 'clarify-bet' };
  }

  return null;
}
