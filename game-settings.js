export function restoredPlayerName(savedName, playerNumber) {
  if (typeof savedName !== 'string') {return '';}
  return savedName.trim().toLocaleLowerCase() === `player ${playerNumber}`
    ? ''
    : savedName;
}
