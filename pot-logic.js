function samePlayers(first, second) {
  return first.length === second.length && first.every((number, index) => number === second[index]);
}

export function calculatePots(players) {
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
