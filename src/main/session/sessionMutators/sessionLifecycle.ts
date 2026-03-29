import * as fs from 'fs/promises';
import * as path from 'path';
import { SessionPackage, newId, nowIso } from '../../../shared/sessionPackage/types';
import type {
  SessionCreateResult,
  SessionLoadResult,
  SessionSaveResult,
  SessionCloseResult,
  SessionUpdateResult,
} from '../../../shared/ipc/types';
import { validateSessionPackage } from '../../../shared/sessionPackage/validate';
import { toSessionUiSnapshot } from '../toSessionUiSnapshot';
import { writeAtomic } from '../../fs/writeAtomic';
import type { SessionStoreMutatorContext } from './types';

/**
 * Creates an empty SessionPackage with defaults.
 */
function createEmptySession(name: string): SessionPackage {
  const now = nowIso();
  return {
    version: 1,
    sessionId: newId(),
    name,
    createdAtIso: now,
    updatedAtIso: now,
    platform: { os: 'windows' },
    timebase: {
      origin: 'obs_recording_started',
      timeUnit: 'seconds',
    },
    recordings: [],
    media: {
      assets: [],
    },
    outline: {
      buckets: [],
    },
    taxonomy: {
      tags: [],
    },
    telemetry: {
      events: [],
    },
    markers: [],
    transcript: null,
  };
}

export async function createSession(
  ctx: SessionStoreMutatorContext,
  baseDir: string,
  name: string
): Promise<SessionCreateResult> {
  if (ctx.getCurrentSession() !== null) {
    return {
      ok: false,
      code: 'session_already_active',
      message: `Session already active: ${ctx.getCurrentSession()!.sessionId}`,
    };
  }

  if (!baseDir || typeof baseDir !== 'string') {
    return {
      ok: false,
      code: 'invalid_session_path',
      message: 'baseDir must be a non-empty string',
    };
  }

  if (!name || typeof name !== 'string') {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'name must be a non-empty string',
    };
  }

  const session = createEmptySession(name);
  const sessionDir = path.join(baseDir, session.sessionId);
  const sessionJsonPath = path.join(sessionDir, 'session.json');
  const recordingDir = path.join(sessionDir, 'recording');

  // Create directories
  try {
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.mkdir(recordingDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      code: 'create_failed',
      message: `Failed to create session directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Persist initial session.json
  let serialized: string;
  try {
    serialized = JSON.stringify(session, null, 2);
  } catch (err) {
    return {
      ok: false,
      code: 'create_failed',
      message: `Failed to serialize session: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const saveResult = await writeAtomic(sessionJsonPath, serialized);
  if (!saveResult.ok) {
    return {
      ok: false,
      code: 'create_failed',
      message: `Failed to write session.json: ${saveResult.message}`,
    };
  }

  ctx.setCurrentSession(session);
  ctx.setCurrentSessionDir(sessionDir);
  ctx.bumpUiRevision();

  return {
    ok: true,
    sessionId: session.sessionId,
    sessionDir,
  };
}

export async function loadSession(
  ctx: SessionStoreMutatorContext,
  sessionDir: string
): Promise<SessionLoadResult> {
  if (ctx.getCurrentSession() !== null) {
    return {
      ok: false,
      code: 'session_already_active',
      message: `Session already active: ${ctx.getCurrentSession()!.sessionId}`,
    };
  }

  if (!sessionDir || typeof sessionDir !== 'string') {
    return {
      ok: false,
      code: 'invalid_session_path',
      message: 'sessionDir must be a non-empty string',
    };
  }

  const sessionJsonPath = path.join(sessionDir, 'session.json');

  let content: string;
  try {
    content = await fs.readFile(sessionJsonPath, 'utf-8');
  } catch (err) {
    return {
      ok: false,
      code: 'session_not_found',
      message: `Failed to read session.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      code: 'load_failed',
      message: `Failed to parse session.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Validate the parsed session against the schema
  const validation = validateSessionPackage(parsed);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'load_failed',
      message: `Invalid session.json: ${validation.message}`,
    };
  }

  ctx.setCurrentSession(validation.session);
  ctx.setCurrentSessionDir(sessionDir);
  const uiRevision = ctx.bumpUiRevision();

  return {
    ok: true,
    session: toSessionUiSnapshot(validation.session),
    sessionDir,
    uiRevision,
  };
}

export function closeSession(ctx: SessionStoreMutatorContext): SessionCloseResult {
  if (ctx.getCurrentSession() === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session to close',
    };
  }

  ctx.setCurrentSession(null);
  ctx.setCurrentSessionDir(null);
  ctx.bumpUiRevision();
  return { ok: true };
}

export function renameSession(
  ctx: SessionStoreMutatorContext,
  newName: string
): SessionUpdateResult {
  if (ctx.getCurrentSession() === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session',
    };
  }

  const trimmedName = newName.trim();
  if (!trimmedName) {
    return {
      ok: false,
      code: 'invalid_input',
      message: 'Session name cannot be empty',
    };
  }

  const next = {
    ...ctx.getCurrentSession(),
    name: trimmedName,
  };

  return ctx.commitValidated(next);
}

export async function saveSession(ctx: SessionStoreMutatorContext): Promise<SessionSaveResult> {
  if (ctx.getCurrentSession() === null || ctx.getCurrentSessionDir() === null) {
    return {
      ok: false,
      code: 'no_active_session',
      message: 'No active session to save',
    };
  }

  // Validate before persisting to maintain SSoT integrity
  const validation = validateSessionPackage(ctx.getCurrentSession());
  if (!validation.ok) {
    return {
      ok: false,
      code: 'save_failed',
      message: `Session validation failed: ${validation.message}`,
    };
  }

  // Serialize with try/catch to return error result on failure
  let serialized: string;
  try {
    serialized = JSON.stringify(ctx.getCurrentSession(), null, 2);
  } catch (err) {
    return {
      ok: false,
      code: 'save_failed',
      message: `Failed to serialize session: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const sessionJsonPath = path.join(ctx.getCurrentSessionDir()!, 'session.json');
  const saveResult = await writeAtomic(sessionJsonPath, serialized);

  if (!saveResult.ok) {
    return {
      ok: false,
      code: 'save_failed',
      message: `Failed to save session.json: ${saveResult.message}`,
    };
  }

  return { ok: true };
}
