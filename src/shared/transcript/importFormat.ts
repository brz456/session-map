// src/shared/transcript/importFormat.ts
// Defines TranscriptImportInput — the only supported raw transcript import schema for MVP

export interface TranscriptImportInput {
  provider: 'internal-transcript-tool' | string;
  speakers: Array<{ speakerId: string; displayName?: string }>;
  sections: Array<{
    providerKey?: string;
    title: string;
    startTimeSec: number;
    endTimeSec: number;
    summaryBullets: string[];
    decisions?: string[];
    importantFacts?: string[];
    actionItems?: string[];
  }>;
  utterances: Array<{
    speakerId: string;
    startTimeSec: number;
    endTimeSec: number;
    text: string;
  }>;
}
