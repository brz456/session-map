// Build annotated transcript: transcript-first merge of session.json + transcript.json

import fs from 'node:fs';
import path from 'node:path';

import type { SessionPackage, Transcript } from '../shared/sessionPackage/types';
import { validateSessionPackage } from '../shared/sessionPackage/validate';
import { validateTranscript } from '../shared/transcript/validate';
import { writeAtomic } from '../main/fs/writeAtomic';
import { buildMergedOutput } from './mergedOutput';

function fatal(message: string): never {
  throw new Error(message);
}

function loadJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) fatal(`File not found: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw) as T;
  } catch {
    fatal(`Invalid JSON: ${filePath}`);
  }
}

type DirectArgs = { sessionPath: string; transcriptPath: string; outPath?: string };

function parseArgs(argv: string[]): DirectArgs {
  const sessionIndex = argv.indexOf('--session');
  const transcriptIndex = argv.indexOf('--transcript');
  const outIndex = argv.indexOf('--out');
  if (sessionIndex === -1 || transcriptIndex === -1) {
    fatal('Usage: --session <path> --transcript <path> [--out <path>]');
  }
  const sessionPath = argv[sessionIndex + 1];
  if (!sessionPath || sessionPath.startsWith('--')) fatal('Missing value for --session');
  const transcriptPath = argv[transcriptIndex + 1];
  if (!transcriptPath || transcriptPath.startsWith('--')) fatal('Missing value for --transcript');
  const outPath = outIndex !== -1 ? argv[outIndex + 1] : undefined;
  if (outIndex !== -1 && (!outPath || outPath.startsWith('--'))) fatal('Missing value for --out');
  return { sessionPath, transcriptPath, outPath };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionPath = args.sessionPath;
  const transcriptPath = args.transcriptPath;
  const outPath = args.outPath;

  if (path.basename(sessionPath) !== 'session.json') {
    fatal(`--session must point to session.json. Got: ${sessionPath}`);
  }
  const sessionUnknown = loadJson<unknown>(sessionPath);
  const sessionValidation = validateSessionPackage(sessionUnknown);
  if (!sessionValidation.ok) {
    fatal(`Invalid session package (${sessionValidation.code}): ${sessionValidation.message}`);
  }
  const session: SessionPackage = sessionValidation.session;
  const transcriptUnknown = loadJson<unknown>(transcriptPath);
  const transcriptValidation = validateTranscript(transcriptUnknown);
  if (!transcriptValidation.ok) {
    fatal(`Invalid transcript (${transcriptValidation.code}): ${transcriptValidation.message}`);
  }
  const transcript: Transcript = transcriptValidation.transcript;

  const merged = buildMergedOutput({
    sessionPath,
    transcriptPath,
    session,
    transcript,
  });

  const output = outPath ?? path.join(path.dirname(sessionPath), 'merged-session.json');
  const writeResult = await writeAtomic(output, JSON.stringify(merged, null, 2));
  if (!writeResult.ok) {
    fatal(`Atomic write failed (${writeResult.code}) for ${output}: ${writeResult.message}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote merged output: ${output}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(msg);
  process.exit(1);
});
