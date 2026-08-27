import path from "node:path";
import { app, BrowserWindow } from "electron";

const RENDERER_DEV_URL = "http://localhost:5174";
const PRELOAD_PATH = path.join(__dirname, "../preload/index.js");

let launcherWindow: BrowserWindow | null = null;
let gameWindow: BrowserWindow | null = null;

export function createLauncherWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 820,
    minHeight: 560,
    title: "Dominion Launcher",
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  } else {
    win.loadURL(RENDERER_DEV_URL);
  }

  win.on("closed", () => {
    launcherWindow = null;
  });

  launcherWindow = win;
  return win;
}

export function getLauncherWindow(): BrowserWindow | null {
  return launcherWindow;
}

// Opens (or focuses, if already open) the game window against the given
// server URL, and hides the launcher window while it's up. No preload here
// — this window is just the live DOMINION web app in a native frame, the
// same origin the launcher's own API calls already authenticated against
// (see main/api.ts), so it opens straight into the logged-in Dashboard.
// Critically, this window must NOT set a `partition` — it has to share
// Electron's implicit default session with the launcher's own net.fetch
// calls, or the auth cookie won't be visible here at all.
export function openGameWindow(serverUrl: string): void {
  if (gameWindow) {
    gameWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: "Dominion",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(serverUrl);

  win.once("ready-to-show", () => {
    launcherWindow?.hide();
  });

  win.on("closed", () => {
    gameWindow = null;
    if (launcherWindow) {
      launcherWindow.show();
      launcherWindow.focus();
    } else {
      createLauncherWindow();
    }
  });

  gameWindow = win;
}
