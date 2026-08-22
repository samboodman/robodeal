function samePlayers(first, second) {
  return first.length === second.length && first.every((number, index) => number === second[index]);
}

export function maximumAdditionalBet(players, playerNumber) {
  const player = players.find((candidate) => candidate.number === playerNumber);
  if (!player || player.folded || player.eliminated) return 0;

  const opposingTotals = players
    .filter((candidate) => candidate.number !== playerNumber && !candidate.folded && !candidate.eliminated)
    .map((candidate) => (Number(candidate.handContribution) || 0) + (Number(candidate.chips) || 0));
  if (opposingTotals.length === 0) return 0;

  const playerContribution = Number(player.handContribution) || 0;
  const playerChips = Math.max(0, Number(player.chips) || 0);
  const coverableAmount = Math.max(0, Math.max(...opposingTotals) - playerContribution);
  return Math.min(playerChips, coverableAmount);
}

export function calculatePots(players) {
  const totalContributions = players.reduce(
    (total, player) => total + (Number(player.handContribution) || 0),
    0,
  );
  const highestContribution = Math.max(0, ...players.map((player) => Number(player.handContribution) || 0));
  const eligiblePlayerNumbers = players
    .filter((player) => !player.folded && !player.eliminated)
    .map((player) => player.number)
    .sort((first, second) => first - second);
  const hasAllInPlayer = players.some((player) =>
    !player.folded
    && !player.eliminated
    && player.chips === 0
    && player.handContribution > 0);

  // Unequal contributions are normal while a bet is waiting to be called.
  // They only become separate pots when an all-in player caps the amount they
  // can win. Until then, keep every contributed chip in one main pot.
  if (!hasAllInPlayer) {
    return totalContributions > 0
      ? [{ amount: totalContributions, contributionCap: highestContribution, eligiblePlayerNumbers }]
      : [];
  }

  const contributionLevels = [...new Set(players
    .map((player) => Number(player.handContribution) || 0)
    .filter((amount) => amount > 0))]
    .sort((first, second) => first - second);
  const pots = [];
  let previousLevel = 0;

  contributionLevels.forEach((level) => {
    const contributors = players.filter((player) => player.handContribution >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligiblePlayerNumbers = contributors
      .filter((player) => !player.folded && !player.eliminated)
      .map((player) => player.number)
      .sort((first, second) => first - second);
    const previousPot = pots.at(-1);

    // Folded chips can create contribution levels without changing who may
    // win them. Merge those levels so players are not asked to award two pots
    // that have exactly the same eligible winners.
    if (previousPot && samePlayers(previousPot.eligiblePlayerNumbers, eligiblePlayerNumbers)) {
      previousPot.amount += amount;
      previousPot.contributionCap = level;
    } else {
      pots.push({ amount, contributionCap: level, eligiblePlayerNumbers });
    }

    previousLevel = level;
  });

  return pots;
}

export function potsForBettingDisplay(pots) {
  const displayedPots = pots.map((pot) => ({
    ...pot,
    eligiblePlayerNumbers: [...pot.eligiblePlayerNumbers],
  }));

  // A final layer with only one eligible player is not a contested side pot.
  // It is an unresolved/uncalled part of the current wager. Keep it in the
  // visible preceding pot until another player acts and makes a real side pot.
  while (displayedPots.length > 1 && displayedPots.at(-1).eligiblePlayerNumbers.length <= 1) {
    const uncalledLayer = displayedPots.pop();
    const precedingPot = displayedPots.at(-1);
    precedingPot.amount += uncalledLayer.amount;
    precedingPot.contributionCap = Math.max(precedingPot.contributionCap, uncalledLayer.contributionCap);
  }

  return displayedPots;
}

export function hasBettingRoundFinished(players, highestRoundBet) {
  const playersWhoCanAct = players.filter((player) => !player.folded && !player.eliminated && player.chips > 0);

  if (playersWhoCanAct.length === 0) return true;
  return playersWhoCanAct.every((player) =>
    player.hasActedThisRound && player.roundBet === highestRoundBet);
}

export function splitPotAmount(amount, orderedWinnerNumbers) {
  const winnerNumbers = [...new Set(orderedWinnerNumbers)];
  if (winnerNumbers.length === 0) return [];

  const equalShare = Math.floor(amount / winnerNumbers.length);
  const oddChips = amount % winnerNumbers.length;
  return winnerNumbers.map((number, index) => ({
    number,
    amount: equalShare + (index < oddChips ? 1 : 0),
  }));
}
