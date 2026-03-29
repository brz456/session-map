// src/main/ipc/appFolder/registerAppFolderIpc.ts
// IPC handlers for app folder operations (session listing, etc.)

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { APP_FOLDER_IPC_CHANNELS } from '../../../shared/ipc/channels';
import { validateSessionPackage } from '../../../shared/sessionPackage/validate';
import { writeAtomic } from '../../fs/writeAtomic';
import type {
  AppFolderGetResult,
  AppFolderEnsureResult,
  AppFolderListSessionsResult,
  AppFolderDeleteSessionResult,
  AppFolderRenameSessionResult,
  AppFolderErrorCode,
  SessionSummary,
  InvalidSessionSummary,
} from '../../../shared/ipc/types';

// Default app folder location - uses Electron's known-folders API for proper Windows support
const APP_FOLDER_NAME = 'SessionMap';

/**
 * Gets the default app folder path using Electron's known-folders API.
 */
function getAppFolderPath(): string {
  return path.join(app.getPath('videos'), APP_FOLDER_NAME);
}

/** Error with code for distinguishing error types (Node.js system errors) */
interface NodeErrorWithCode extends Error {
  code?: string;
}

/** Structured error class for app folder operations (uses canonical AppFolderErrorCode from shared types) */
class AppFolderError extends Error {
  constructor(
    public readonly code: AppFolderErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AppFolderError';
  }
}

/**
 * Scans a directory for session folders (folders containing session.json).
 * Returns session summaries (and invalid session summaries) without renderer-specific sorting.
 *
 * @throws Error if the folder exists but cannot be read (permission/IO error).
 *         Returns empty sessions/invalidSessions only if folder does not exist (ENOENT).
 */
async function listSessionsInFolder(
  folderPath: string
): Promise<{ sessions: SessionSummary[]; invalidSessions: InvalidSessionSummary[] }> {
  const sessions: SessionSummary[] = [];
  const invalidSessions: InvalidSessionSummary[] = [];

  // Resolve realpath of app folder once for containment checks
  let realAppFolder: string;
  try {
    realAppFolder = await fs.realpath(folderPath);
  } catch (err) {
    const code = (err as NodeErrorWithCode).code;
    if (code === 'ENOENT') {
      return { sessions, invalidSessions };
    }
    throw err;
  }
  const realAppFolderLower = realAppFolder.toLowerCase();

  let entries: Awaited<ReturnType<typeof fs.readdir>>;
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeErrorWithCode).code;
    // Only treat ENOENT as empty - propagate real errors
    if (code === 'ENOENT') {
      return { sessions, invalidSessions };
    }
    // ENOTDIR means path exists but is not a directory
    if (code === 'ENOTDIR') {
      throw new AppFolderError('invalid_path', 'App folder path exists but is not a directory');
    }
    throw err;
  }

  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sessionDir = path.join(folderPath, entry.name);

    // Security: skip symlinks/junctions to prevent reading sessions outside app folder
    try {
      const stat = await fs.lstat(sessionDir);
      if (stat.isSymbolicLink()) {
        continue;
      }
    } catch (err) {
      // Only skip on ENOENT (race: entry disappeared); propagate other errors
      if ((err as NodeErrorWithCode).code === 'ENOENT') {
        continue;
      }
      throw new AppFolderError(
        'list_failed',
        `Cannot stat session directory ${sessionDir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Security: verify realpath is within app folder (case-insensitive for Windows)
    let realSessionDir: string;
    try {
      realSessionDir = await fs.realpath(sessionDir);
    } catch (err) {
      // Only skip on ENOENT (race: entry disappeared); propagate other errors
      if ((err as NodeErrorWithCode).code === 'ENOENT') {
        continue;
      }
      throw new AppFolderError(
        'list_failed',
        `Cannot resolve session path ${sessionDir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const realSessionDirLower = realSessionDir.toLowerCase();
    if (!realSessionDirLower.startsWith(realAppFolderLower + path.sep)) {
      // Session dir resolves outside app folder - skip
      continue;
    }

    const sessionJsonPath = path.join(realSessionDir, 'session.json');

    // Get file info via lstat (does not follow symlinks)
    let fileMtime: Date;
    try {
      const stat = await fs.lstat(sessionJsonPath);
      // Security: reject symlinked session.json (could point outside app folder)
      if (stat.isSymbolicLink()) {
        continue;
      }
      fileMtime = stat.mtime;
    } catch (err) {
      // Only skip on ENOENT (no session.json) - propagate other errors (EACCES, etc.)
      if ((err as NodeErrorWithCode).code === 'ENOENT') {
        continue;
      }
      throw new AppFolderError(
        'list_failed',
        `Cannot access session at ${realSessionDir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    const lastModifiedIso = fileMtime.toISOString();

    // Read and validate session.json
    let content: string;
    try {
      content = await fs.readFile(sessionJsonPath, 'utf-8');
    } catch (err) {
      invalidSessions.push({
        sessionDir: realSessionDir,
        lastModifiedIso,
        error: `Failed to read session.json: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      invalidSessions.push({
        sessionDir: realSessionDir,
        lastModifiedIso,
        error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }

    // Validate against schema (SSoT)
    const validation = validateSessionPackage(parsed);
    if (!validation.ok) {
      invalidSessions.push({
        sessionDir: realSessionDir,
        lastModifiedIso,
        error: `Invalid session schema: ${validation.message}`,
      });
      continue;
    }

    const session = validation.session;

    // Compute summary from validated session
    const recordings = session.recordings;
    const last = recordings.length > 0 ? recordings[recordings.length - 1] : undefined;
    const totalDurationSec = last ? last.startSessionTimeSec + last.durationSec : 0;

    sessions.push({
      sessionId: session.sessionId,
      name: session.name,
      sessionDir: realSessionDir,
      createdAtIso: session.createdAtIso,
      updatedAtIso: session.updatedAtIso,
      lastModifiedIso,
      recordingCount: recordings.length,
      totalDurationSec,
      markerCount: session.markers.length,
    });
  }

  sessions.sort((a, b) => (a.sessionDir < b.sessionDir ? -1 : a.sessionDir > b.sessionDir ? 1 : 0));
  invalidSessions.sort((a, b) => (a.sessionDir < b.sessionDir ? -1 : a.sessionDir > b.sessionDir ? 1 : 0));

  return { sessions, invalidSessions };
}

/**
 * Recursively deletes a directory and all its contents.
 * Does not use force:true so ENOENT is propagated for explicit handling.
 */
async function deleteDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true });
}

/**
 * Registers all app folder IPC handlers.
 */
export function registerAppFolderIpcHandlers(): void {
  ipcMain.handle(APP_FOLDER_IPC_CHANNELS.get, (): AppFolderGetResult => {
    return { ok: true, path: getAppFolderPath() };
  });

  ipcMain.handle(
    APP_FOLDER_IPC_CHANNELS.ensure,
    async (): Promise<AppFolderEnsureResult> => {
      const folderPath = getAppFolderPath();

      try {
        // Check if exists and is a directory
        try {
          const stat = await fs.stat(folderPath);
          if (!stat.isDirectory()) {
            return {
              ok: false,
              code: 'invalid_path',
              message: 'App folder path exists but is not a directory',
            };
          }
          return { ok: true, path: folderPath, created: false };
        } catch (err) {
          // Only proceed to create if path doesn't exist
          if ((err as NodeErrorWithCode).code !== 'ENOENT') {
            throw err;
          }
        }

        await fs.mkdir(folderPath, { recursive: true });
        return { ok: true, path: folderPath, created: true };
      } catch (err) {
        return {
          ok: false,
          code: 'create_failed',
          message: `Failed to create app folder: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  );

  ipcMain.handle(
    APP_FOLDER_IPC_CHANNELS.listSessions,
    async (): Promise<AppFolderListSessionsResult> => {
      const folderPath = getAppFolderPath();

      try {
        const { sessions, invalidSessions } = await listSessionsInFolder(folderPath);
        return { ok: true, sessions, invalidSessions };
      } catch (err) {
        // Handle structured AppFolderError with proper code
        if (err instanceof AppFolderError) {
          return { ok: false, code: err.code, message: err.message };
        }
        return {
          ok: false,
          code: 'list_failed',
          message: `Failed to list sessions: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  );

  ipcMain.handle(
    APP_FOLDER_IPC_CHANNELS.deleteSession,
    async (_event, sessionDir: string): Promise<AppFolderDeleteSessionResult> => {
      if (typeof sessionDir !== 'string' || sessionDir === '') {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'sessionDir must be a non-empty string',
        };
      }

      // Security: reject symlinks/junctions to prevent escape attacks
      let sessionDirStat;
      try {
        sessionDirStat = await fs.lstat(sessionDir);
      } catch (err) {
        if ((err as NodeErrorWithCode).code === 'ENOENT') {
          return {
            ok: false,
            code: 'session_not_found',
            message: 'Session directory not found',
          };
        }
        return {
          ok: false,
          code: 'delete_failed',
          message: `Cannot access session directory: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (sessionDirStat.isSymbolicLink()) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session directory cannot be a symbolic link',
        };
      }

      if (!sessionDirStat.isDirectory()) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session path is not a directory',
        };
      }

      // Security: ensure sessionDir is within the app folder using realpath to resolve any
      // intermediate symlinks, then case-fold for Windows case-insensitivity
      let realAppFolder: string;
      let realSessionDir: string;
      try {
        realAppFolder = await fs.realpath(getAppFolderPath());
        realSessionDir = await fs.realpath(sessionDir);
      } catch (err) {
        return {
          ok: false,
          code: 'delete_failed',
          message: `Cannot resolve session path: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const appFolderLower = realAppFolder.toLowerCase();
      const sessionDirLower = realSessionDir.toLowerCase();

      // Session dir must be strictly inside app folder (startsWith + sep excludes equality case)
      if (!sessionDirLower.startsWith(appFolderLower + path.sep)) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session directory must be within the app folder',
        };
      }

      // Verify session.json exists (is a valid session folder)
      const sessionJsonPath = path.join(realSessionDir, 'session.json');
      try {
        await fs.access(sessionJsonPath);
      } catch (err) {
        // Only treat ENOENT as session_not_found - other errors are delete_failed
        if ((err as NodeErrorWithCode).code === 'ENOENT') {
          return {
            ok: false,
            code: 'session_not_found',
            message: 'Session not found or not a valid session folder',
          };
        }
        return {
          ok: false,
          code: 'delete_failed',
          message: `Cannot access session: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      try {
        await deleteDirectory(realSessionDir);
        return { ok: true };
      } catch (err) {
        // Handle ENOENT explicitly (race condition: deleted between check and rm)
        if ((err as NodeErrorWithCode).code === 'ENOENT') {
          return {
            ok: false,
            code: 'session_not_found',
            message: 'Session was deleted before operation completed',
          };
        }
        return {
          ok: false,
          code: 'delete_failed',
          message: `Failed to delete session: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  );

  ipcMain.handle(
    APP_FOLDER_IPC_CHANNELS.renameSession,
    async (_event, sessionDir: string, newName: string): Promise<AppFolderRenameSessionResult> => {
      if (typeof sessionDir !== 'string' || sessionDir === '') {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'sessionDir must be a non-empty string',
        };
      }

      if (typeof newName !== 'string' || newName.trim() === '') {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'newName must be a non-empty string',
        };
      }

      const trimmedName = newName.trim();

      // Security: reject symlinks/junctions
      let sessionDirStat;
      try {
        sessionDirStat = await fs.lstat(sessionDir);
      } catch (err) {
        if ((err as NodeErrorWithCode).code === 'ENOENT') {
          return {
            ok: false,
            code: 'session_not_found',
            message: 'Session directory not found',
          };
        }
        return {
          ok: false,
          code: 'rename_failed',
          message: `Cannot access session directory: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (sessionDirStat.isSymbolicLink()) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session directory cannot be a symbolic link',
        };
      }

      if (!sessionDirStat.isDirectory()) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session path is not a directory',
        };
      }

      // Security: ensure sessionDir is within the app folder
      let realAppFolder: string;
      let realSessionDir: string;
      try {
        realAppFolder = await fs.realpath(getAppFolderPath());
        realSessionDir = await fs.realpath(sessionDir);
      } catch (err) {
        return {
          ok: false,
          code: 'rename_failed',
          message: `Cannot resolve session path: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const appFolderLower = realAppFolder.toLowerCase();
      const sessionDirLower = realSessionDir.toLowerCase();

      if (!sessionDirLower.startsWith(appFolderLower + path.sep)) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session directory must be within the app folder',
        };
      }

      // Security: reject symlinked session.json
      const sessionJsonPath = path.join(realSessionDir, 'session.json');
      let sessionJsonStat;
      try {
        sessionJsonStat = await fs.lstat(sessionJsonPath);
      } catch (err) {
        if ((err as NodeErrorWithCode).code === 'ENOENT') {
          return {
            ok: false,
            code: 'session_not_found',
            message: 'Session not found or not a valid session folder',
          };
        }
        return {
          ok: false,
          code: 'rename_failed',
          message: `Cannot access session file: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (sessionJsonStat.isSymbolicLink()) {
        return {
          ok: false,
          code: 'invalid_path',
          message: 'Session file cannot be a symbolic link',
        };
      }

      // Read, validate, modify, and write session.json
      try {
        const content = await fs.readFile(sessionJsonPath, 'utf-8');
        const parsed: unknown = JSON.parse(content);

        // Validate existing session before modification (fail-closed)
        const validation = validateSessionPackage(parsed);
        if (!validation.ok) {
          return {
            ok: false,
            code: 'rename_failed',
            message: `Invalid session data: ${validation.message}`,
          };
        }

        // Update validated session with new name and timestamp
        const updatedSession = {
          ...validation.session,
          name: trimmedName,
          updatedAtIso: new Date().toISOString(),
        };

        const writeResult = await writeAtomic(sessionJsonPath, JSON.stringify(updatedSession, null, 2));
        if (!writeResult.ok) {
          return {
            ok: false,
            code: 'rename_failed',
            message: `Failed to write session: ${writeResult.message}`,
          };
        }
        return { ok: true };
      } catch (err) {
        if ((err as NodeErrorWithCode).code === 'ENOENT') {
          return {
            ok: false,
            code: 'session_not_found',
            message: 'Session not found or not a valid session folder',
          };
        }
        return {
          ok: false,
          code: 'rename_failed',
          message: `Failed to rename session: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  );
}

/**
 * Unregisters all app folder IPC handlers.
 */
export function unregisterAppFolderIpcHandlers(): void {
  for (const channel of Object.values(APP_FOLDER_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
