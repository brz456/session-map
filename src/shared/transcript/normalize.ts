// src/shared/transcript/normalize.ts
// Validate raw transcript import input and normalize into Transcript with deterministic IDs

import type { Transcript } from '../sessionPackage/types';
import { nowIso } from '../sessionPackage/types';
import type { TranscriptImportInput } from './importFormat';
import { validateTranscriptImportInput } from './validateImportInput';

export type TranscriptNormalizeErrorCode =
  | 'invalid_input'
  | 'missing_required_field'
  | 'invalid_time_range'
  | 'unknown_speaker';

export type TranscriptNormalizeResult =
  | { ok: true; transcript: Transcript }
  | { ok: false; code: TranscriptNormalizeErrorCode; message: string };

/**
 * Deterministic section ID algorithm (PRD Section 4.1):
 * Generate sectionId sequentially in import order: section_0001, section_0002, ...
 */
export function buildSectionId(sectionIndex1Based: number): string {
  return `section_${String(sectionIndex1Based).padStart(4, '0')}`;
}

/**
 * Deterministic utterance ID algorithm (PRD Section 4.1):
 * 1. base = speakerId + ":" + startTimeSec + ":" + endTimeSec
 * 2. Maintain occurrenceIndexByBase[base] starting at 0
 * 3. For each utterance with the same base, increment occurrence
 * 4. utteranceId = base + ":" + occurrenceIndex
 */
export function buildUtteranceId(params: {
  speakerId: string;
  startTimeSec: number;
  endTimeSec: number;
  occurrenceIndex: number;
}): string {
  return `${params.speakerId}:${params.startTimeSec}:${params.endTimeSec}:${params.occurrenceIndex}`;
}

export function normalizeTranscript(input: unknown): TranscriptNormalizeResult {
  const validation = validateTranscriptImportInput(input);
  if (!validation.ok) return validation;
  const validInput: TranscriptImportInput = validation.input;

  // Generate deterministic section IDs
  const sections = validInput.sections.map((sec, index) => ({
    sectionId: buildSectionId(index + 1),
    providerKey: sec.providerKey,
    title: sec.title,
    startTimeSec: sec.startTimeSec,
    endTimeSec: sec.endTimeSec,
    summaryBullets: sec.summaryBullets,
    decisions: sec.decisions,
    importantFacts: sec.importantFacts,
    actionItems: sec.actionItems,
  }));

  // Generate deterministic utterance IDs
  const occurrenceIndexByBase = new Map<string, number>();
  const utterances = validInput.utterances.map((utt) => {
    const base = `${utt.speakerId}:${utt.startTimeSec}:${utt.endTimeSec}`;
    const occurrenceIndex = occurrenceIndexByBase.get(base) ?? 0;
    occurrenceIndexByBase.set(base, occurrenceIndex + 1);

    return {
      utteranceId: buildUtteranceId({
        speakerId: utt.speakerId,
        startTimeSec: utt.startTimeSec,
        endTimeSec: utt.endTimeSec,
        occurrenceIndex,
      }),
      speakerId: utt.speakerId,
      startTimeSec: utt.startTimeSec,
      endTimeSec: utt.endTimeSec,
      text: utt.text,
    };
  });

  const transcript: Transcript = {
    provider: validInput.provider,
    importedAtIso: nowIso(),
    sections,
    utterances,
    speakers: validInput.speakers.map((s) => ({
      speakerId: s.speakerId,
      displayName: s.displayName,
    })),
  };

  return { ok: true, transcript };
}
