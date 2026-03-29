// src/main/ipc/obsIpc.ts
// IPC handlers for OBS recording operations

import { ipcMain } from "electron";
import type {
  ObsInitOptions,
  ObsInitResult,
  ObsStartResult,
  ObsStopResult,
  ObsStatus,
  ObsShutdownResult,
  ObsForceResetResult,
} from "../../../shared/ipc/types";
import { OBS_IPC_CHANNELS } from "../../../shared/ipc/channels";
import { ObsEngine } from "../../obs/ObsEngine";

// Singleton instance - lazily created on first use
let obsEngineInstance: ObsEngine | null = null;

function getObsEngine(): ObsEngine {
  if (!obsEngineInstance) {
    obsEngineInstance = new ObsEngine();
  }
  return obsEngineInstance;
}

/**
 * Registers all OBS-related IPC handlers.
 * Must be called once during app startup (before renderer loads).
 *
 * Each handler returns a typed result; errors are explicit, never thrown.
 */
export function registerObsIpcHandlers(): void {
  ipcMain.handle(
    OBS_IPC_CHANNELS.initialize,
    async (_event, options: ObsInitOptions): Promise<ObsInitResult> => {
      const engine = getObsEngine();
      return engine.initialize(options);
    },
  );

  ipcMain.handle(
    OBS_IPC_CHANNELS.startRecording,
    async (): Promise<ObsStartResult> => {
      const engine = getObsEngine();
      return engine.startRecording();
    },
  );

  ipcMain.handle(
    OBS_IPC_CHANNELS.stopRecording,
    async (): Promise<ObsStopResult> => {
      const engine = getObsEngine();
      return engine.stopRecording();
    },
  );

  ipcMain.handle(
    OBS_IPC_CHANNELS.shutdown,
    async (): Promise<ObsShutdownResult> => {
      const engine = getObsEngine();
      const result = await engine.shutdown();
      if (!result.ok) {
        return {
          ok: false,
          code: "shutdown_failed",
          message: result.error.message,
        };
      }
      return { ok: true };
    },
  );

  ipcMain.handle(OBS_IPC_CHANNELS.getStatus, (): ObsStatus => {
    const engine = getObsEngine();
    return {
      initialized: engine.isInitialized(),
      recording: engine.isRecording(),
    };
  });

  ipcMain.handle(OBS_IPC_CHANNELS.forceReset, (): ObsForceResetResult => {
    const engine = getObsEngine();
    return engine.forceReset();
  });
}

/**
 * Unregisters all OBS IPC handlers.
 * Call during app shutdown or for testing.
 */
export function unregisterObsIpcHandlers(): void {
  ipcMain.removeHandler(OBS_IPC_CHANNELS.initialize);
  ipcMain.removeHandler(OBS_IPC_CHANNELS.startRecording);
  ipcMain.removeHandler(OBS_IPC_CHANNELS.stopRecording);
  ipcMain.removeHandler(OBS_IPC_CHANNELS.shutdown);
  ipcMain.removeHandler(OBS_IPC_CHANNELS.getStatus);
  ipcMain.removeHandler(OBS_IPC_CHANNELS.forceReset);
}

/**
 * Best-effort OBS cleanup for main-process shutdown.
 * Attempts graceful shutdown first, then force-reset fallback.
 */
export async function shutdownObsEngineForAppExit(): Promise<void> {
  if (!obsEngineInstance) {
    return;
  }

  const engine = obsEngineInstance;
  try {
    const shutdownResult = await engine.shutdown();
    if (shutdownResult.ok) {
      return;
    }

    console.warn(
      '[obsIpc] Graceful OBS shutdown failed during app exit, applying force-reset:',
      shutdownResult.error.message,
    );

    const resetResult = engine.forceReset();
    if (!resetResult.ok) {
      console.warn(
        '[obsIpc] OBS force-reset completed with cleanup errors during app exit:',
        resetResult.errors,
      );
    }
  } catch (err) {
    console.warn(
      '[obsIpc] OBS shutdown threw during app exit, applying force-reset:',
      err instanceof Error ? err.message : String(err),
    );
    const resetResult = engine.forceReset();
    if (!resetResult.ok) {
      console.warn(
        '[obsIpc] OBS force-reset completed with cleanup errors after throw:',
        resetResult.errors,
      );
    }
  } finally {
    obsEngineInstance = null;
  }
}
