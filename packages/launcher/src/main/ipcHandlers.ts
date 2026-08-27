import { ipcMain } from "electron";
import * as api from "./api";
import { readSettings, writeSettings } from "./settingsStore";
import { openGameWindow } from "./windows";
import type { LauncherSettings } from "../shared-types";

export function registerIpcHandlers(): void {
  ipcMain.handle("dominion:login", (_event, email: string, password: string) => api.login(email, password));

  ipcMain.handle(
    "dominion:register",
    (_event, email: string, password: string, settlementName?: string) =>
      api.register(email, password, settlementName),
  );

  ipcMain.handle("dominion:logout", () => api.logout());

  ipcMain.handle("dominion:getMe", () => api.getMe());

  ipcMain.handle("dominion:getAnnouncements", () => api.getAnnouncements());

  ipcMain.handle("dominion:play", () => {
    openGameWindow(readSettings().serverUrl);
  });

  ipcMain.handle("dominion:getSettings", () => readSettings());

  ipcMain.handle("dominion:setSettings", (_event, partial: Partial<LauncherSettings>) => {
    const next = { ...readSettings(), ...partial };
    writeSettings(next);
    return next;
  });
}
