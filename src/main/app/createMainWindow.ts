import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

function parseDevServerUrl(): { url: string; origin: string } | null {
  if (app.isPackaged) {
    return null;
  }

  const envUrl = process.env.SESSIONMAP_DEV_SERVER_URL;
  if (!envUrl) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(envUrl);
  } catch {
    throw new Error(`Invalid SESSIONMAP_DEV_SERVER_URL: "${envUrl}" is not a valid URL`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid SESSIONMAP_DEV_SERVER_URL: "${envUrl}" must use http: or https: protocol`);
  }

  return { url: envUrl, origin: parsed.origin };
}

const MIN_CONTENT_WIDTH = 1920;
const MIN_CONTENT_HEIGHT = 1080;

export async function createMainWindow(): Promise<BrowserWindow> {
  const devServer = parseDevServerUrl();

  const win = new BrowserWindow({
    width: MIN_CONTENT_WIDTH,
    height: MIN_CONTENT_HEIGHT,
    minWidth: MIN_CONTENT_WIDTH,
    minHeight: MIN_CONTENT_HEIGHT,
    useContentSize: true, // width/height refers to content area, not window frame
    resizable: true, // Allow resizing; enforce minimum for recording
    frame: false, // Frameless window for custom title bar
    titleBarStyle: 'hidden', // Hide native title bar
    icon: app.isPackaged
      ? path.join(__dirname, 'renderer', 'favicon.ico')
      : path.join(__dirname, '..', 'src', 'renderer', 'public', 'favicon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
    },
  });

  // Block new windows
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // Allowed renderer directory for file: URLs
  const allowedRendererDir = path.resolve(__dirname, 'renderer');

  // Block navigation except allowed origins
  win.webContents.on('will-navigate', (event, url) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      // Malformed URL (e.g. about:blank) - block
      event.preventDefault();
      return;
    }

    // Allow dev server origin in dev mode
    if (devServer && parsedUrl.origin === devServer.origin) {
      return;
    }

    // Allow file: URLs only within the renderer directory
    if (parsedUrl.protocol === 'file:') {
      let filePath: string;
      try {
        filePath = fileURLToPath(parsedUrl);
      } catch {
        event.preventDefault();
        return;
      }

      const resolvedPath = path.resolve(filePath);
      const relativePath = path.relative(allowedRendererDir, resolvedPath);

      // Block if path escapes renderer directory (starts with .. or is absolute)
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        event.preventDefault();
        return;
      }

      return;
    }

    // Block everything else
    event.preventDefault();
  });

  // Load renderer
  if (devServer) {
    await win.loadURL(devServer.url);
  } else {
    await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  }

  return win;
}
