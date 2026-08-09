/**
 * A BCP-47-ish tag and nothing else.
 *
 * The detected language is the one value a transcription provider controls
 * that we echo into a log line, and it arrives typed `unknown` from a third
 * party, so it is matched against a shape rather than trusted: anything else is
 * reported as unexpected instead of being printed. Without this, a provider
 * change could turn the field into free text and quietly put consultation
 * speech into the logs.
 *
 * Shared by every transcription adapter rather than copied into each: this is a
 * compliance control, and two copies of it are two chances for one to drift.
 */
const LANGUAGE_TAG = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/

export function languageTagForLog(value: unknown) {
  if (typeof value !== 'string') return '(absent)'
  return LANGUAGE_TAG.test(value) ? value : '(unexpected)'
}
