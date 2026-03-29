// src/shared/transcript/normalize.test.ts
// Contract validation: ensures the fixture is a valid TranscriptImportInput

import { describe, it, expect } from 'vitest';
import { normalizeTranscript } from './normalize';
import fixture from '../../../fixtures/transcript/transcript-import-input.sample.json';

describe('normalizeTranscript', () => {
  it('accepts the sample fixture', () => {
    const result = normalizeTranscript(fixture);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcript.provider).toBe('internal-transcript-tool');
      expect(result.transcript.speakers).toHaveLength(2);
      expect(result.transcript.sections).toHaveLength(3);
      expect(result.transcript.utterances).toHaveLength(9);
    }
  });
});
