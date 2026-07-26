import { WAKE_WORDS, type WordTimestamp } from '@mediqaz/contracts';

const PUNCTUATION = /[.,!?;:«»""''()\-—]/;

/** Lowercase, punctuation-free, single-spaced form used for matching. */
export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(new RegExp(PUNCTUATION.source, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes while recording, for each normalized character, where it came from
 * in the original string. The wake word is found in the normalized form but the
 * command is cut from the original, so punctuation and case survive verbatim.
 */
function normalizeWithMap(value: string) {
  let normalized = '';
  const sourceIndexes: number[] = [];
  let previousWasSpace = true;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (PUNCTUATION.test(character)) continue;

    if (/\s/.test(character)) {
      if (previousWasSpace) continue;
      normalized += ' ';
      sourceIndexes.push(index);
      previousWasSpace = true;
      continue;
    }

    normalized += character.toLowerCase();
    sourceIndexes.push(index);
    previousWasSpace = false;
  }

  while (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    sourceIndexes.pop();
  }

  return { normalized, sourceIndexes };
}

/**
 * Returns the instruction spoken after a wake word, or null when the utterance
 * is ordinary consultation speech. Very short tails are ignored because they are
 * usually the tail of a misrecognised product name rather than a command.
 */
export function extractVoiceCommand(text: string) {
  const { normalized, sourceIndexes } = normalizeWithMap(text);

  for (const wakeWord of WAKE_WORDS) {
    const start = normalized.indexOf(wakeWord);
    if (start === -1) continue;

    const endInNormalized = start + wakeWord.length;
    if (endInNormalized >= sourceIndexes.length) return null;

    const command = text
      .slice(sourceIndexes[endInNormalized])
      .replace(/^[\s,.:—-]+/, '')
      .trim();

    return command.length > 3 ? command : null;
  }

  return null;
}

/**
 * Locates a med-card quote inside the timed transcript so the doctor can tap a
 * quote and hear the moment it came from.
 */
export function findQuoteTimestamps(quote: string, wordTimestamps: WordTimestamp[] | undefined) {
  if (!quote || !wordTimestamps?.length) return null;

  const needle = normalizeText(quote).split(' ').filter(Boolean);
  if (!needle.length) return null;

  const haystack = wordTimestamps.map((entry) => normalizeText(entry.word));

  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    let matched = true;

    for (let position = 0; position < needle.length; position += 1) {
      if (haystack[offset + position] !== needle[position]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return {
        start: wordTimestamps[offset].start,
        end: wordTimestamps[offset + needle.length - 1].end,
      };
    }
  }

  return null;
}
