import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';

// Load .env files (project root / cwd / userData) BEFORE any
// module that reads process.env is imported. config.ts builds its `settings`
// object at import time, so this must happen before ./ipc which transitively
// imports config.
import { loadDotEnv } from './loadEnv';
loadDotEnv();

// In production, Playwright browsers are bundled inside node_modules/playwright
// (because we install with PLAYWRIGHT_BROWSERS_PATH=0). Mirror that at runtime
// so Playwright finds them. Must be set BEFORE requiring './ipc' (which loads
// services that import playwright).
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

import { registerIpcHandlers } from './ipc';
import {
  registerSchemesAsPrivileged,
  registerImageProtocol,
} from './imageProtocol';

const isDev = process.env.NODE_ENV === 'development';
const VITE_DEV_SERVER_URL = 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;

// Must run before app.whenReady().
registerSchemesAsPrivileged();

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Logos',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Open external links in the user's default browser, not in the app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  if (isDev) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, the renderer is bundled into ./dist/renderer/ alongside
    // the compiled main process at ./dist/main.js, so __dirname is dist/.
    const indexPath = path.join(__dirname, 'renderer', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerImageProtocol();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
