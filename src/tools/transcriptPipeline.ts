// Transcript pipeline: discover inputs, parse text to TranscriptImportInput JSON, merge+normalize to transcript.json
//
// Convention:
//   raw/transcript-0.txt, transcript-1.txt, ...   (required, sequential starting at 0)
//   raw/summary-0, summary-1, ...                 (optional, but if any exist the count must match transcripts)
//   transcript-config.json                        (sessionPath, provider, parsedDir?, mergedTranscriptPath?)
//
// Each transcript-N maps to session.recordings[N] for its time offset.

import fs from 'node:fs';
import path from 'node:path';

import type { SessionPackage } from '../shared/sessionPackage/types';
import { nowIso } from '../shared/sessionPackage/types';
import { validateSessionPackage } from '../shared/sessionPackage/validate';
import type { TranscriptImportInput } from '../shared/transcript/importFormat';
import { validateTranscriptImportInput } from '../shared/transcript/validateImportInput';
import { normalizeTranscript } from '../shared/transcript/normalize';
import { writeAtomic } from '../main/fs/writeAtomic';

interface TranscriptConfig {
  sessionPath: string;
  provider: string;
  parsedDir?: string;
  mergedTranscriptPath?: string;
}

interface DiscoveredInput {
  name: string;
  transcriptPath: string;
  summaryPath: string | null;
  parsedPath: string;
  recordingIndex: number;
}

type PipelineMode = 'parse' | 'merge' | 'all';

function fatal(message: string): never {
  throw new Error(message);
}

function resolvePath(baseDir: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function normalizePathForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function compareString(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fatal(`${label} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    fatal(`${label} must not have leading/trailing whitespace`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    fatal(`${label} must be a non-empty string when provided`);
  }
  if (value !== value.trim()) {
    fatal(`${label} must not have leading/trailing whitespace`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function validateConfigShape(raw: unknown): TranscriptConfig {
  const obj = asObject(raw);
  if (!obj) fatal('Config JSON must be an object');

  const sessionPath = requireNonEmptyString(obj.sessionPath, 'sessionPath');
  const provider = requireNonEmptyString(obj.provider, 'provider');
  const parsedDir = optionalNonEmptyString(obj.parsedDir, 'parsedDir');
  const mergedTranscriptPath = optionalNonEmptyString(obj.mergedTranscriptPath, 'mergedTranscriptPath');

  return {
    sessionPath,
    provider,
    ...(parsedDir ? { parsedDir } : {}),
    ...(mergedTranscriptPath ? { mergedTranscriptPath } : {}),
  };
}

function readConfig(
  configPath: string,
): { config: TranscriptConfig; baseDir: string } {
  const resolvedConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(resolvedConfigPath)) fatal(`Config not found: ${resolvedConfigPath}`);
  const raw = fs.readFileSync(resolvedConfigPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    fatal(`Invalid JSON in config: ${resolvedConfigPath}`);
  }
  const config = validateConfigShape(parsed);
  return { config, baseDir: path.dirname(resolvedConfigPath) };
}

// ---------------------------------------------------------------------------
// Auto-discovery
// ---------------------------------------------------------------------------

function parseIndexedFilename(
  fileName: string,
  prefix: string,
  suffix: string,
): number | null {
  if (!fileName.startsWith(prefix) || !fileName.endsWith(suffix)) return null;
  const middle = fileName.slice(prefix.length, fileName.length - suffix.length);
  // Only allow canonical numeric indices: "0", or non-zero without leading zeros.
  // Rejects "01", "001", etc. to prevent ambiguous index collisions.
  if (!/^(0|[1-9]\d*)$/.test(middle)) return null;
  return Number(middle);
}

function enumerateIndexedFiles(
  baseDir: string,
  prefix: string,
  suffix: string,
  label: string,
): Map<number, string> {
  const entries = fs.readdirSync(baseDir);
  const found = new Map<number, string>();
  for (const entry of entries) {
    const idx = parseIndexedFilename(entry, prefix, suffix);
    if (idx === null) continue;
    const resolved = path.resolve(baseDir, entry);
    const existing = found.get(idx);
    if (existing !== undefined) {
      fatal(`Duplicate ${label} index ${idx}: "${existing}" and "${resolved}"`);
    }
    found.set(idx, resolved);
  }
  return found;
}

function validateContiguousIndices(
  indices: number[],
  label: string,
): void {
  if (indices.length === 0) return;
  const sorted = [...indices].sort((a, b) => a - b);
  if (sorted[0] !== 0) {
    fatal(`${label} indices must start at 0 (found: ${sorted.join(', ')})`);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) {
      fatal(
        `${label} indices must be contiguous with no gaps ` +
        `(found: ${sorted.join(', ')}, gap after ${sorted[i - 1]})`,
      );
    }
  }
}

function discoverInputs(baseDir: string, parsedDir: string): DiscoveredInput[] {
  // Enumerate all transcript-N.txt and summary-N files on disk
  const transcriptMap = enumerateIndexedFiles(baseDir, 'transcript-', '.txt', 'transcript');
  const summaryMap = enumerateIndexedFiles(baseDir, 'summary-', '', 'summary');

  const transcriptIndices = Array.from(transcriptMap.keys());
  if (transcriptIndices.length === 0) {
    fatal(`No transcript files found (expected transcript-0.txt, transcript-1.txt, ... in ${baseDir})`);
  }

  // Validate transcripts are contiguous 0..N-1
  validateContiguousIndices(transcriptIndices, 'Transcript');

  // Validate summaries: either none, or exact same index set as transcripts
  const summaryIndices = Array.from(summaryMap.keys());
  if (summaryIndices.length > 0) {
    validateContiguousIndices(summaryIndices, 'Summary');
    const extraSummaries = summaryIndices.filter((i) => !transcriptMap.has(i));
    const missingSummaries = transcriptIndices.filter((i) => !summaryMap.has(i));
    if (extraSummaries.length > 0 || missingSummaries.length > 0) {
      const details: string[] = [];
      if (extraSummaries.length > 0) {
        details.push(`extra summaries with no transcript: ${extraSummaries.map((i) => `summary-${i}`).join(', ')}`);
      }
      if (missingSummaries.length > 0) {
        details.push(`missing summaries: ${missingSummaries.map((i) => `summary-${i}`).join(', ')}`);
      }
      fatal(
        `Summary/transcript index mismatch. ` +
        `Found ${transcriptIndices.length} transcript(s) [0..${transcriptIndices.length - 1}] ` +
        `and ${summaryIndices.length} summary/summaries [${summaryIndices.sort((a, b) => a - b).join(', ')}]. ` +
        details.join('; ') + '.',
      );
    }
  }

  const count = transcriptIndices.length;
  const inputs: DiscoveredInput[] = [];
  for (let i = 0; i < count; i++) {
    inputs.push({
      name: `transcript-${i}`,
      transcriptPath: transcriptMap.get(i)!,
      summaryPath: summaryMap.get(i) ?? null,
      parsedPath: path.join(parsedDir, `transcript-${i}.json`),
      recordingIndex: i,
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Discovered ${count} transcript(s), ${summaryIndices.length} summary/summaries in ${baseDir}`,
  );

  return inputs;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseTimeToken(token: string): number {
  const trimmed = token.trim();
  if (trimmed.includes(':') || trimmed.includes('.')) {
    const parts = trimmed.split(/[:.]/);
    if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1]);
      return minutes * 60 + seconds;
    }
  }
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  fatal(`Unrecognized time token: ${token}`);
}

function parseTranscript(text: string) {
  const lines = text.split(/\r?\n/);
  const utterances: TranscriptImportInput['utterances'] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^(S\d+)\s*\|\s*(\d+:\d\d)-(\d+:\d\d)\s*$/);
    if (!match) continue;
    const speakerId = match[1];
    const startTimeSec = parseTimeToken(match[2]);
    const endTimeSec = parseTimeToken(match[3]);
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const textLine = j < lines.length ? lines[j].trim() : '';
    utterances.push({ speakerId, startTimeSec, endTimeSec, text: textLine });
    i = j;
  }

  return utterances;
}

function parseSummary(text: string) {
  const lines = text.split(/\r?\n/);
  const sections: TranscriptImportInput['sections'] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (!line) {
      i++;
      continue;
    }
    if (!/^\d+(\.\d+)?$/.test(line)) {
      i++;
      continue;
    }

    const providerKey = line;
    let title = '';
    let j = i + 1;
    while (j < lines.length) {
      const t = lines[j].trim();
      if (t) {
        title = t;
        break;
      }
      j++;
    }

    // find time range line
    let timeLine = '';
    let timeIndex = -1;
    for (let k = j + 1; k < lines.length; k++) {
      const t = lines[k];
      if (/\d+:\d\d\s*[–-]\s*\d+:\d\d/.test(t)) {
        timeLine = t.trim();
        timeIndex = k;
        break;
      }
    }
    if (!timeLine || timeIndex === -1) {
      i++;
      continue;
    }

    const match = timeLine.match(/(\d+:\d\d)\s*[–-]\s*(\d+:\d\d)/);
    if (!match) {
      i++;
      continue;
    }

    const startTimeSec = parseTimeToken(match[1]);
    const endTimeSec = parseTimeToken(match[2]);

    const summaryBullets: string[] = [];
    const decisions: string[] = [];
    const importantFacts: string[] = [];
    const actionItems: string[] = [];

    let currentBlock: 'Summary' | 'Decisions' | 'Important Facts' | 'Action Items' | null =
      null;
    const isSectionHeader = (value: string) => /^\d+(\.\d+)?$/.test(value);
    const isBlockHeader = (value: string) =>
      value === 'Summary' ||
      value === 'Decisions' ||
      value === 'Important Facts' ||
      value === 'Action Items' ||
      value === 'Transcript' ||
      value === 'Copy for AI' ||
      value === 'Advanced Copy';

    for (let k = timeIndex + 1; k < lines.length; k++) {
      const raw = lines[k].trim();
      if (isSectionHeader(raw)) {
        i = k;
        break;
      }
      if (raw === 'Summary') {
        currentBlock = 'Summary';
        continue;
      }
      if (raw === 'Decisions') {
        currentBlock = 'Decisions';
        continue;
      }
      if (raw === 'Important Facts') {
        currentBlock = 'Important Facts';
        continue;
      }
      if (raw === 'Action Items') {
        currentBlock = 'Action Items';
        continue;
      }
      if (raw.startsWith('●') || raw.startsWith('•')) {
        let item = raw.replace(/^[●•]\s*/, '').trim();
        if (!item) {
          let m = k + 1;
          while (m < lines.length && lines[m].trim() === '') m++;
          if (m < lines.length) {
            const candidate = lines[m].trim();
            if (!isSectionHeader(candidate) && !isBlockHeader(candidate)) {
              item = candidate;
              k = m;
            }
          }
        }
        if (item) {
          if (currentBlock === 'Summary') summaryBullets.push(item);
          if (currentBlock === 'Decisions') decisions.push(item);
          if (currentBlock === 'Important Facts') importantFacts.push(item);
          if (currentBlock === 'Action Items') actionItems.push(item);
        }
      }
      if (k === lines.length - 1) {
        i = k + 1;
      }
    }

    sections.push({
      providerKey,
      title,
      startTimeSec,
      endTimeSec,
      summaryBullets,
      ...(decisions.length ? { decisions } : {}),
      ...(importantFacts.length ? { importantFacts } : {}),
      ...(actionItems.length ? { actionItems } : {}),
    });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Pipeline steps
// ---------------------------------------------------------------------------

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const result = await writeAtomic(filePath, JSON.stringify(value, null, 2));
  if (!result.ok) {
    fatal(`Atomic write failed (${result.code}) for ${filePath}: ${result.message}`);
  }
}

function listInputs(inputs: DiscoveredInput[]) {
  // eslint-disable-next-line no-console
  console.log('Transcript inputs:');
  for (const input of inputs) {
    // eslint-disable-next-line no-console
    console.log(`- ${input.name} (recording ${input.recordingIndex})`);
    // eslint-disable-next-line no-console
    console.log(`  transcript: ${input.transcriptPath}`);
    // eslint-disable-next-line no-console
    console.log(`  summary:    ${input.summaryPath ?? '(none)'}`);
  }
}

async function parseInputs(
  inputs: DiscoveredInput[],
  provider: string,
): Promise<TranscriptImportInput[]> {
  const parsed: TranscriptImportInput[] = [];
  for (const input of inputs) {
    const transcriptText = fs.readFileSync(input.transcriptPath, 'utf8');
    const summaryText = input.summaryPath ? fs.readFileSync(input.summaryPath, 'utf8') : null;

    const utterances = parseTranscript(transcriptText);
    const sections = summaryText ? parseSummary(summaryText) : [];

    const speakerIds = Array.from(new Set(utterances.map((u) => u.speakerId)));
    const speakers = speakerIds.map((speakerId) => ({ speakerId }));

    const payload: TranscriptImportInput = {
      provider,
      speakers,
      sections,
      utterances,
    };

    const validation = validateTranscriptImportInput(payload);
    if (!validation.ok) {
      fatal(
        `Invalid generated payload (${input.name}) (${validation.code}): ${validation.message}`,
      );
    }

    await writeJsonAtomic(input.parsedPath, validation.input);
    // eslint-disable-next-line no-console
    console.log(`Wrote ${input.parsedPath}`);

    parsed.push(validation.input);
  }
  return parsed;
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

function loadParsedInputs(inputs: DiscoveredInput[]): TranscriptImportInput[] {
  const parsed: TranscriptImportInput[] = [];
  for (const input of inputs) {
    if (!fs.existsSync(input.parsedPath)) {
      fatal(`Parsed transcript not found: ${input.parsedPath}`);
    }
    const loaded = loadJson<unknown>(input.parsedPath);
    const validation = validateTranscriptImportInput(loaded);
    if (!validation.ok) {
      fatal(
        `Invalid parsed input (${input.parsedPath}) (${validation.code}): ${validation.message}`,
      );
    }
    parsed.push(validation.input);
  }
  return parsed;
}

function resolveOffsets(
  session: SessionPackage,
  inputs: DiscoveredInput[],
): number[] {
  return inputs.map((input) => {
    const rec = session.recordings[input.recordingIndex];
    if (!rec) {
      fatal(
        `Recording index ${input.recordingIndex} out of range for ${input.name} ` +
        `(session has ${session.recordings.length} recording(s))`,
      );
    }
    return rec.startSessionTimeSec;
  });
}

function ensureOffsetsNonDecreasing(inputs: DiscoveredInput[], offsets: number[]): void {
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] < offsets[i - 1]) {
      const details = inputs
        .map((input, idx) => `- ${input.name}: recording ${input.recordingIndex}, offset=${offsets[idx]}`)
        .join('\n');
      fatal(`Inputs must be ordered by non-decreasing resolved offset.\n${details}`);
    }
  }
}

function mergeInputs(
  inputs: TranscriptImportInput[],
  offsets: number[],
): TranscriptImportInput {
  if (inputs.length !== offsets.length) fatal('Offsets length mismatch');

  const provider = inputs[0]?.provider;
  if (!provider) fatal('Missing provider on input[0]');

  const speakersById = new Map<string, { speakerId: string; displayName?: string }>();

  type SectionWithOrder = TranscriptImportInput['sections'][number] & {
    sourceInputIndex: number;
    sourceIndex: number;
  };
  type UtteranceWithOrder = TranscriptImportInput['utterances'][number] & {
    sourceInputIndex: number;
    sourceIndex: number;
  };

  const sections: SectionWithOrder[] = [];
  const utterances: UtteranceWithOrder[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const offset = offsets[i];

    if (input.provider !== provider) {
      fatal(`Provider mismatch at input[${i}]: ${input.provider} != ${provider}`);
    }

    for (const speaker of input.speakers) {
      const existing = speakersById.get(speaker.speakerId);
      if (!existing) {
        speakersById.set(speaker.speakerId, speaker);
      } else if (existing.displayName !== speaker.displayName) {
        fatal(
          `Speaker displayName mismatch for ${speaker.speakerId}: "${existing.displayName}" vs "${speaker.displayName}"`,
        );
      }
    }

    for (let sectionIndex = 0; sectionIndex < input.sections.length; sectionIndex++) {
      const sec = input.sections[sectionIndex];
      sections.push({
        ...sec,
        startTimeSec: sec.startTimeSec + offset,
        endTimeSec: sec.endTimeSec + offset,
        sourceInputIndex: i,
        sourceIndex: sectionIndex,
      });
    }

    for (let utteranceIndex = 0; utteranceIndex < input.utterances.length; utteranceIndex++) {
      const utt = input.utterances[utteranceIndex];
      utterances.push({
        ...utt,
        startTimeSec: utt.startTimeSec + offset,
        endTimeSec: utt.endTimeSec + offset,
        sourceInputIndex: i,
        sourceIndex: utteranceIndex,
      });
    }
  }

  sections.sort((a, b) => {
    if (a.startTimeSec !== b.startTimeSec) return a.startTimeSec - b.startTimeSec;
    if (a.endTimeSec !== b.endTimeSec) return a.endTimeSec - b.endTimeSec;
    const aProviderKey = a.providerKey ?? '';
    const bProviderKey = b.providerKey ?? '';
    if (aProviderKey !== bProviderKey) return compareString(aProviderKey, bProviderKey);
    if (a.title !== b.title) return compareString(a.title, b.title);
    if (a.sourceInputIndex !== b.sourceInputIndex) return a.sourceInputIndex - b.sourceInputIndex;
    return a.sourceIndex - b.sourceIndex;
  });

  utterances.sort((a, b) => {
    if (a.startTimeSec !== b.startTimeSec) return a.startTimeSec - b.startTimeSec;
    if (a.endTimeSec !== b.endTimeSec) return a.endTimeSec - b.endTimeSec;
    if (a.speakerId !== b.speakerId) return compareString(a.speakerId, b.speakerId);
    if (a.text !== b.text) return compareString(a.text, b.text);
    if (a.sourceInputIndex !== b.sourceInputIndex) return a.sourceInputIndex - b.sourceInputIndex;
    return a.sourceIndex - b.sourceIndex;
  });

  return {
    provider,
    speakers: Array.from(speakersById.values()),
    sections: sections.map(({ sourceInputIndex: _a, sourceIndex: _b, ...sec }) => sec),
    utterances: utterances.map(({ sourceInputIndex: _a, sourceIndex: _b, ...utt }) => utt),
  };
}

function updateSessionTranscriptRef(session: SessionPackage): SessionPackage {
  if (session.transcript !== null) return session;
  return {
    ...session,
    transcript: { relativePath: 'transcript.json' },
    updatedAtIso: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const configIndex = process.argv.indexOf('--config');
  const modeIndex = process.argv.indexOf('--mode');
  let mode: PipelineMode = 'all';
  if (modeIndex !== -1) {
    const modeValue = process.argv[modeIndex + 1];
    if (!modeValue || modeValue.startsWith('--')) fatal('Missing value for --mode');
    if (modeValue !== 'parse' && modeValue !== 'merge' && modeValue !== 'all') {
      fatal(`Invalid --mode: ${modeValue} (expected parse|merge|all)`);
    }
    mode = modeValue;
  }
  if (configIndex === -1) fatal('Missing required flag: --config <path>');
  const configPath = process.argv[configIndex + 1];
  if (!configPath || configPath.startsWith('--')) fatal('Missing value for --config');

  const { config, baseDir } = readConfig(configPath);
  const sessionJsonPath = resolvePath(baseDir, config.sessionPath);
  if (path.basename(sessionJsonPath) !== 'session.json') {
    fatal(`sessionPath must point to session.json. Got: ${sessionJsonPath}`);
  }

  const canonicalTranscriptPath = path.join(path.dirname(sessionJsonPath), 'transcript.json');
  if (config.mergedTranscriptPath) {
    const requestedTranscriptPath = resolvePath(baseDir, config.mergedTranscriptPath);
    if (
      normalizePathForCompare(requestedTranscriptPath) !==
      normalizePathForCompare(canonicalTranscriptPath)
    ) {
      fatal(
        `mergedTranscriptPath must be ${canonicalTranscriptPath} (TranscriptRef.relativePath is fixed to transcript.json). Got: ${requestedTranscriptPath}`,
      );
    }
  }
  const mergedTranscriptPath = canonicalTranscriptPath;

  const parsedDir = config.parsedDir
    ? resolvePath(baseDir, config.parsedDir)
    : path.resolve(baseDir, '..');
  const inputs = discoverInputs(baseDir, parsedDir);
  listInputs(inputs);

  const provider = config.provider;
  if (mode === 'parse') {
    await parseInputs(inputs, provider);
    return;
  }

  const parsedInputs =
    mode === 'all' ? await parseInputs(inputs, provider) : loadParsedInputs(inputs);

  const sessionUnknown = loadJson<unknown>(sessionJsonPath);
  const sessionValidation = validateSessionPackage(sessionUnknown);
  if (!sessionValidation.ok) {
    fatal(`Invalid session package (${sessionValidation.code}): ${sessionValidation.message}`);
  }
  const session: SessionPackage = sessionValidation.session;
  const offsets = resolveOffsets(session, inputs);
  ensureOffsetsNonDecreasing(inputs, offsets);
  const mergedInput = mergeInputs(parsedInputs, offsets);

  const normalized = normalizeTranscript(mergedInput);
  if (!normalized.ok) fatal(`normalizeTranscript failed: ${normalized.code} ${normalized.message}`);

  await writeJsonAtomic(mergedTranscriptPath, normalized.transcript);

  const updatedSession = updateSessionTranscriptRef(session);
  if (updatedSession !== session) {
    const updatedValidation = validateSessionPackage(updatedSession);
    if (!updatedValidation.ok) {
      fatal(`Updated session invalid (${updatedValidation.code}): ${updatedValidation.message}`);
    }
    await writeJsonAtomic(sessionJsonPath, updatedSession);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote transcript: ${mergedTranscriptPath}`);
  // eslint-disable-next-line no-console
  console.log(`Updated session: ${sessionJsonPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `Speakers: ${normalized.transcript.speakers.length}, Sections: ${normalized.transcript.sections.length}, Utterances: ${normalized.transcript.utterances.length}`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(msg);
  process.exit(1);
});
