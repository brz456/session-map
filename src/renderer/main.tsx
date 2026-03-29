// src/renderer/main.tsx
// React entry point

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from './app/AppShell';
import { ThemeProvider } from './styles/useTheme';

// CSS - order matters: fonts first, then base, then themes override
import './styles/fonts.css';
import './styles/base.css';
import './styles/themes/broadcast.css';
import './styles/themes/synthwave.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

const root = createRoot(container);
root.render(
  <StrictMode>
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  </StrictMode>
);
