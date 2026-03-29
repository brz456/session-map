// src/main/fs/writeAtomic.ts
// File writes via write-to-temp + sync + rename pattern

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export type WriteAtomicErrorCode = 'write_failed' | 'sync_failed' | 'rename_failed' | 'invalid_path';

export type WriteAtomicResult =
  | { ok: true }
  | { ok: false; code: WriteAtomicErrorCode; message: string };

/**
 * Writes content to targetPath via temp file + sync + rename.
 *
 * Behavior:
 * - Writes content to a temp file in the same directory.
 * - Calls handle.sync() on the temp file.
 * - Calls fs.rename() to swap the temp file to targetPath.
 *
 * On success: targetPath contains the new content.
 * On failure: returns a typed error; targetPath is not modified (the original
 * file, if any, remains intact). Temp file cleanup is best-effort.
 */
export async function writeAtomic(
  targetPath: string,
  content: string
): Promise<WriteAtomicResult> {
  if (!targetPath || typeof targetPath !== 'string') {
    return { ok: false, code: 'invalid_path', message: 'targetPath must be a non-empty string' };
  }

  const dir = path.dirname(targetPath);
  const basename = path.basename(targetPath);
  const tempPath = path.join(dir, `.${basename}.tmp.${crypto.randomUUID()}`);

  // Ensure directory exists
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      code: 'write_failed',
      message: `Failed to create directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Write to temp file, fsync, and close
  type WriteStage = 'open' | 'write' | 'sync' | 'close';
  let handle: fs.FileHandle | null = null;
  let stage: WriteStage = 'open';
  try {
    handle = await fs.open(tempPath, 'w');
    stage = 'write';
    await handle.writeFile(content, 'utf-8');
    stage = 'sync';
    await handle.sync();
    stage = 'close';
    await handle.close();
    handle = null;
  } catch (err) {
    // Attempt cleanup (best-effort since we're already returning an error)
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Best-effort cleanup
      }
    }
    try {
      await fs.unlink(tempPath);
    } catch {
      // Best-effort cleanup
    }
    // Map stage to error code (no dedicated 'close_failed'; use 'sync_failed' as closest)
    const codeByStage: Record<WriteStage, WriteAtomicErrorCode> = {
      open: 'write_failed',
      write: 'write_failed',
      sync: 'sync_failed',
      close: 'sync_failed',
    };
    return {
      ok: false,
      code: codeByStage[stage],
      message: `Failed to ${stage} temp file ${tempPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Rename temp to target
  try {
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    // Attempt cleanup of temp file
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }

    return {
      ok: false,
      code: 'rename_failed',
      message: `Failed to rename ${tempPath} to ${targetPath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true };
}
