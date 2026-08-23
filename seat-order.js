const fullCircle = Math.PI * 2;

export function normalizeSeatAngle(angle) {
  const normalized = Number(angle) % fullCircle;
  return normalized < 0 ? normalized + fullCircle : normalized;
}

export function snapSeatAngle(angle, playerCount, offset = Math.PI / 2) {
  const count = Math.max(2, Math.floor(Number(playerCount) || 2));
  const step = fullCircle / count;
  const relativeAngle = normalizeSeatAngle(angle - offset);
  const slot = Math.round(relativeAngle / step) % count;
  return normalizeSeatAngle(offset + slot * step);
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
