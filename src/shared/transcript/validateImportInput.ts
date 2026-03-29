// src/shared/transcript/validateImportInput.ts
// Deterministic validation (fail-closed) for TranscriptImportInput shape (no normalization side-effects)

import type { TranscriptImportInput } from './importFormat';

export type TranscriptImportValidationErrorCode =
  | 'invalid_input'
  | 'missing_required_field'
  | 'invalid_time_range'
  | 'unknown_speaker';

export type TranscriptImportValidationResult =
  | { ok: true; input: TranscriptImportInput }
  | { ok: false; code: TranscriptImportValidationErrorCode; message: string };

function isStringArray(arr: unknown): arr is string[] {
  return Array.isArray(arr) && arr.every((item) => typeof item === 'string');
}

export function validateTranscriptImportInput(input: unknown): TranscriptImportValidationResult {
  // Must be a non-null object
  if (input === null || typeof input !== 'object') {
    return { ok: false, code: 'invalid_input', message: 'Input must be an object' };
  }

  const obj = input as Record<string, unknown>;

  // Validate provider
  if (typeof obj.provider !== 'string') {
    return { ok: false, code: 'missing_required_field', message: 'provider must be a string' };
  }

  // Validate speakers array
  if (!Array.isArray(obj.speakers)) {
    return { ok: false, code: 'missing_required_field', message: 'speakers must be an array' };
  }

  const speakerIds = new Set<string>();
  for (let i = 0; i < obj.speakers.length; i++) {
    const speaker = obj.speakers[i];
    if (speaker === null || typeof speaker !== 'object') {
      return { ok: false, code: 'invalid_input', message: `Speaker at index ${i} must be an object` };
    }
    const s = speaker as Record<string, unknown>;
    if (typeof s.speakerId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Speaker at index ${i} missing speakerId string` };
    }
    if (speakerIds.has(s.speakerId)) {
      return { ok: false, code: 'invalid_input', message: `Duplicate speakerId at index ${i}: ${s.speakerId}` };
    }
    speakerIds.add(s.speakerId);
    if (s.displayName !== undefined && typeof s.displayName !== 'string') {
      return { ok: false, code: 'invalid_input', message: `Speaker at index ${i} displayName must be a string if present` };
    }
  }

  // Validate sections array
  if (!Array.isArray(obj.sections)) {
    return { ok: false, code: 'missing_required_field', message: 'sections must be an array' };
  }

  for (let i = 0; i < obj.sections.length; i++) {
    const section = obj.sections[i];
    if (section === null || typeof section !== 'object') {
      return { ok: false, code: 'invalid_input', message: `Section at index ${i} must be an object` };
    }
    const sec = section as Record<string, unknown>;

    // Required fields
    if (typeof sec.title !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Section at index ${i} missing title string` };
    }
    if (typeof sec.startTimeSec !== 'number' || !Number.isFinite(sec.startTimeSec)) {
      return { ok: false, code: 'missing_required_field', message: `Section at index ${i} missing valid startTimeSec` };
    }
    if (typeof sec.endTimeSec !== 'number' || !Number.isFinite(sec.endTimeSec)) {
      return { ok: false, code: 'missing_required_field', message: `Section at index ${i} missing valid endTimeSec` };
    }
    if (sec.startTimeSec < 0) {
      return { ok: false, code: 'invalid_time_range', message: `Section at index ${i} has negative startTimeSec: ${sec.startTimeSec}` };
    }
    if (sec.endTimeSec < 0) {
      return { ok: false, code: 'invalid_time_range', message: `Section at index ${i} has negative endTimeSec: ${sec.endTimeSec}` };
    }
    if (sec.startTimeSec > sec.endTimeSec) {
      return { ok: false, code: 'invalid_time_range', message: `Section at index ${i} has startTimeSec > endTimeSec` };
    }
    if (!isStringArray(sec.summaryBullets)) {
      return { ok: false, code: 'missing_required_field', message: `Section at index ${i} summaryBullets must be a string array` };
    }

    // Optional fields - validate type if present
    if (sec.providerKey !== undefined && typeof sec.providerKey !== 'string') {
      return { ok: false, code: 'invalid_input', message: `Section at index ${i} providerKey must be a string if present` };
    }
    if (sec.decisions !== undefined && !isStringArray(sec.decisions)) {
      return { ok: false, code: 'invalid_input', message: `Section at index ${i} decisions must be a string array if present` };
    }
    if (sec.importantFacts !== undefined && !isStringArray(sec.importantFacts)) {
      return { ok: false, code: 'invalid_input', message: `Section at index ${i} importantFacts must be a string array if present` };
    }
    if (sec.actionItems !== undefined && !isStringArray(sec.actionItems)) {
      return { ok: false, code: 'invalid_input', message: `Section at index ${i} actionItems must be a string array if present` };
    }
  }

  // Validate utterances array
  if (!Array.isArray(obj.utterances)) {
    return { ok: false, code: 'missing_required_field', message: 'utterances must be an array' };
  }

  for (let i = 0; i < obj.utterances.length; i++) {
    const utterance = obj.utterances[i];
    if (utterance === null || typeof utterance !== 'object') {
      return { ok: false, code: 'invalid_input', message: `Utterance at index ${i} must be an object` };
    }
    const u = utterance as Record<string, unknown>;

    if (typeof u.speakerId !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Utterance at index ${i} missing speakerId string` };
    }
    // Validate speakerId exists in speakers
    if (!speakerIds.has(u.speakerId)) {
      return { ok: false, code: 'unknown_speaker', message: `Utterance at index ${i} has unknown speakerId: ${u.speakerId}` };
    }
    if (typeof u.startTimeSec !== 'number' || !Number.isFinite(u.startTimeSec)) {
      return { ok: false, code: 'missing_required_field', message: `Utterance at index ${i} missing valid startTimeSec` };
    }
    if (typeof u.endTimeSec !== 'number' || !Number.isFinite(u.endTimeSec)) {
      return { ok: false, code: 'missing_required_field', message: `Utterance at index ${i} missing valid endTimeSec` };
    }
    if (u.startTimeSec < 0) {
      return { ok: false, code: 'invalid_time_range', message: `Utterance at index ${i} has negative startTimeSec: ${u.startTimeSec}` };
    }
    if (u.endTimeSec < 0) {
      return { ok: false, code: 'invalid_time_range', message: `Utterance at index ${i} has negative endTimeSec: ${u.endTimeSec}` };
    }
    if (u.startTimeSec > u.endTimeSec) {
      return { ok: false, code: 'invalid_time_range', message: `Utterance at index ${i} has startTimeSec > endTimeSec` };
    }
    if (typeof u.text !== 'string') {
      return { ok: false, code: 'missing_required_field', message: `Utterance at index ${i} missing text string` };
    }
  }

  return { ok: true, input: input as TranscriptImportInput };
}

