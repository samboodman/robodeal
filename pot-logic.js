function samePlayers(first, second) {
  return first.length === second.length && first.every((number, index) => number === second[index]);
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
