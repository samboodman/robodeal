const smallNumbers = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
});

/** Converts the first numeric phrase in text to a number. */
export function wordsToNumber(input) {
  const text = String(input || '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9.$\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const digitAmount = text.match(/(?:^|\s)\$?(\d+(?:\.\d{1,2})?)(?=\s|$)/);
  if (digitAmount) {return Number(digitAmount[1]);}

  const tokens = text.split(' ');
  for (let start = 0; start < tokens.length; start += 1) {
    if (!(tokens[start] in smallNumbers) && !['hundred', 'thousand', 'million'].includes(tokens[start])) {continue;}
    let total = 0;
    let current = 0;
    let found = false;
    for (let index = start; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token === 'and' && found) {continue;}
      if (token in smallNumbers) {
        current += smallNumbers[token];
        found = true;
      } else if (token === 'hundred') {
        current = Math.max(1, current) * 100;
        found = true;
      } else if (token === 'thousand' || token === 'million') {
        const scale = token === 'thousand' ? 1_000 : 1_000_000;
        total += Math.max(1, current) * scale;
        current = 0;
        found = true;
      } else {
        break;
      }
    }
    if (found) {return total + current;}
  }
  return null;
}
