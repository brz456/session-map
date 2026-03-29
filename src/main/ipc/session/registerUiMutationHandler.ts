import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { SESSION_IPC_CHANNELS } from '../../../shared/ipc/channels';
import { broadcastSessionUiEvent } from './broadcastSessionUi';
import { getSessionStore } from '../../session/sessionStoreInstance';

type IpcResultLike =
  | { ok: true; [k: string]: unknown }
  | { ok: false; code: string; message: string };

const NO_UI_BROADCAST_ALLOWLIST = new Set<string>([
  SESSION_IPC_CHANNELS.addPlaybackEvent,
  SESSION_IPC_CHANNELS.exportMarkerStill,
  SESSION_IPC_CHANNELS.exportMarkerClip,
  SESSION_IPC_CHANNELS.exportGroupClip,
]);

export function registerUiMutationHandler<
  TArgs extends unknown[],
  TResult extends IpcResultLike,
>(opts: {
  channel: string;
  handler: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult;
  /**
   * Default true. Set false only for allowlisted opt-out cases (telemetry hot path, exports).
   * This keeps the "broadcast vs no-broadcast" decision centralized and enforceable.
   */
  broadcastUi?: boolean;
}): void {
  if (opts.broadcastUi === false && !NO_UI_BROADCAST_ALLOWLIST.has(opts.channel)) {
    throw new Error(`broadcastUi=false is not allowed for channel: ${opts.channel}`);
  }

  ipcMain.handle(opts.channel, async (event, ...args) => {
    const result = await opts.handler(event, ...(args as TArgs));
    if (result.ok && opts.broadcastUi !== false) {
      const store = getSessionStore();
      const uiState = store.getUi();
      broadcastSessionUiEvent({
        type: 'session_ui_snapshot',
        uiRevision: uiState.uiRevision,
        session: uiState.session,
        sessionDir: uiState.sessionDir,
      });
    }
    return result;
  });
}
