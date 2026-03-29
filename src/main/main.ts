// src/main/main.ts
// Electron main process entry point (Windows-only)

import { app, protocol } from 'electron';
import { MEDIA_PROTOCOL } from '../shared/mediaProtocol';
// Windows-only: fail-fast on unsupported platforms
// This check runs before any OBS-related modules are imported
if (process.platform !== 'win32') {
  console.error(`Fatal: SessionMap requires Windows. Current platform: ${process.platform}`);
  process.exit(1);
}

// Register custom protocol as privileged BEFORE app.ready()
// Required for video streaming to work with custom protocols
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

void import('./app/main')
  .then(({ runMain }) => runMain())
  .catch((err) => {
    console.error('Fatal: Failed to initialize application:', err);
    app.exit(1);
  });

app.on('window-all-closed', () => {
  app.quit();
});
