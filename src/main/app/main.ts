import { app, BrowserWindow, ipcMain } from 'electron';
import { registerMediaProtocol } from '../mediaProtocol';
import { WINDOW_IPC_CHANNELS } from '../../shared/ipc/channels';
import { registerIpcHandlers } from '../ipc/registerIpc';
import { createMainWindow } from './createMainWindow';

let quittingCleanupInProgress = false;

/** Register window control IPC handlers */
function registerWindowIpcHandlers(win: BrowserWindow): void {
  ipcMain.handle(WINDOW_IPC_CHANNELS.minimize, () => {
    win.minimize();
  });

  ipcMain.handle(WINDOW_IPC_CHANNELS.maximize, () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });

  ipcMain.handle(WINDOW_IPC_CHANNELS.close, () => {
    win.close();
  });

  ipcMain.handle(WINDOW_IPC_CHANNELS.isMaximized, () => {
    return win.isMaximized();
  });
}

function registerAppQuitCleanup(): void {
  app.on('before-quit', (event) => {
    if (quittingCleanupInProgress) {
      return;
    }

    event.preventDefault();
    quittingCleanupInProgress = true;

    void (async () => {
      try {
        const { shutdownObsEngineForAppExit } = await import('../ipc/obs/obsIpc');
        await shutdownObsEngineForAppExit();
      } catch (err) {
        console.warn(
          '[main] best-effort OBS cleanup failed during app quit:',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        app.quit();
      }
    })();
  });
}

export async function runMain(): Promise<void> {
  await app.whenReady();

  // Register custom protocol for secure media access
  // Allowlist is populated when media files are imported (see mediaIpc.ts)
  registerMediaProtocol();

  // Register IPC handlers before creating window
  await registerIpcHandlers();
  registerAppQuitCleanup();

  const mainWindow = await createMainWindow();

  // Register window control handlers (requires window reference)
  registerWindowIpcHandlers(mainWindow);
}
