// src/main/ipc/dialogIpc.ts
// IPC handlers for native dialogs

import { ipcMain, dialog, BrowserWindow } from "electron";
import { DIALOG_IPC_CHANNELS } from "../../../shared/ipc/channels";
import type {
  DialogPickDirectoryResult,
  DialogPickMediaFilesResult,
} from "../../../shared/ipc/types";

/**
 * Registers all dialog-related IPC handlers.
 * Must be called once during app startup.
 */
export function registerDialogIpcHandlers(): void {
  ipcMain.handle(
    DIALOG_IPC_CHANNELS.pickDirectory,
    async (_event): Promise<DialogPickDirectoryResult> => {
      const win = BrowserWindow.getFocusedWindow();
      const options: Electron.OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
        title: "Select Session Directory",
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, code: "canceled" };
      }

      return { ok: true, path: result.filePaths[0] };
    },
  );

  ipcMain.handle(
    DIALOG_IPC_CHANNELS.pickMediaFiles,
    async (_event): Promise<DialogPickMediaFilesResult> => {
      const win = BrowserWindow.getFocusedWindow();
      const options: Electron.OpenDialogOptions = {
        properties: ["openFile", "multiSelections"],
        title: "Select Media Files",
        filters: [{ name: "MP4 Videos", extensions: ["mp4"] }],
      };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);

      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, code: "canceled" };
      }

      return { ok: true, paths: result.filePaths };
    },
  );
}

/**
 * Unregisters all dialog IPC handlers.
 */
export function unregisterDialogIpcHandlers(): void {
  ipcMain.removeHandler(DIALOG_IPC_CHANNELS.pickDirectory);
  ipcMain.removeHandler(DIALOG_IPC_CHANNELS.pickMediaFiles);
}
