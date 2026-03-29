import type { SessionPackage, Transcript } from '../shared/sessionPackage/types';
import { nowIso } from '../shared/sessionPackage/types';
import { buildAnnotatedTranscript, type AnnotatedTranscript } from './mergeIndex';

export type { AnnotatedTranscript };

export function buildMergedOutput(params: {
  sessionPath: string;
  transcriptPath: string;
  session: SessionPackage;
  transcript: Transcript;
}): AnnotatedTranscript {
  return buildAnnotatedTranscript({
    sessionPath: params.sessionPath,
    transcriptPath: params.transcriptPath,
    session: params.session,
    transcript: params.transcript,
    generatedAtIso: nowIso(),
  });
}
