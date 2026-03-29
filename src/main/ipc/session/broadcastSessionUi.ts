import { BrowserWindow } from 'electron';
import type { SessionUiEvent } from '../../../shared/ipc/sessionUi';
import { SESSION_IPC_EVENTS } from '../../../shared/ipc/channels';

export function broadcastSessionUiEvent(event: SessionUiEvent): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    window.webContents.send(SESSION_IPC_EVENTS.uiSnapshot, event);
  }
}
