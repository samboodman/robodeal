const fullCircle = Math.PI * 2;

export function normalizeSeatAngle(angle) {
  const normalized = Number(angle) % fullCircle;
  return normalized < 0 ? normalized + fullCircle : normalized;
}

/** Returns player IDs in clockwise screen order. The starting seat is irrelevant. */
export function clockwisePlayerIds(players, seatAngles) {
  return players
    .map((player, index) => ({
      id: player.id,
      angle: normalizeSeatAngle(seatAngles[player.id] ?? (index / players.length) * fullCircle),
    }))
    .sort((first, second) => first.angle - second.angle)
    .map(({ id }) => id);
}
