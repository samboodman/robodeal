const fullCircle = Math.PI * 2;

export function normalizeSeatAngle(angle) {
  const normalized = Number(angle) % fullCircle;
  return normalized < 0 ? normalized + fullCircle : normalized;
}

export function snapSeatAngle(
  angle,
  playerCount,
  offset = Math.PI / 2,
  maxSnapDistance = Number.POSITIVE_INFINITY
) {
  const count = Math.max(2, Math.floor(Number(playerCount) || 2));
  const step = fullCircle / count;
  const requestedAngle = normalizeSeatAngle(angle);
  const regularShapeAngles = Array.from({ length: count }, (_, index) =>
    normalizeSeatAngle(offset + index * step)
  );
  const squareAngles = Array.from({ length: 4 }, (_, index) =>
    normalizeSeatAngle(offset + (index * fullCircle) / 4)
  );
  const candidates = [...regularShapeAngles, ...squareAngles];
  const angularDistance = (candidate) => {
    const difference = Math.abs(normalizeSeatAngle(candidate - requestedAngle));
    return Math.min(difference, fullCircle - difference);
  };
  const closest = candidates.reduce((currentClosest, candidate) =>
    angularDistance(candidate) < angularDistance(currentClosest)
      ? candidate
      : currentClosest
  );
  return angularDistance(closest) <= maxSnapDistance ? closest : requestedAngle;
}

export function clockwisePlayerIds(players, seatAngles) {
  return players
    .map((player, index) => ({
      id: player.id,
      angle: normalizeSeatAngle(
        seatAngles[player.id] ?? (index / players.length) * fullCircle
      ),
    }))
    .sort((first, second) => first.angle - second.angle)
    .map(({ id }) => id);
}
