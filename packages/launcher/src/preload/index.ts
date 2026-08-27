import { contextBridge, ipcRenderer } from "electron";
import type { DominionApi, LauncherSettings } from "../shared-types";

// The renderer's entire surface — no raw ipcRenderer, no Node access, no
// direct fetch. Every method here is a thin wrapper over ipcMain.handle
// registrations in main/ipcHandlers.ts.
const api: DominionApi = {
  login: (email, password) => ipcRenderer.invoke("dominion:login", email, password),
  register: (email, password, settlementName) =>
    ipcRenderer.invoke("dominion:register", email, password, settlementName),
  logout: () => ipcRenderer.invoke("dominion:logout"),
  getMe: () => ipcRenderer.invoke("dominion:getMe"),
  getAnnouncements: () => ipcRenderer.invoke("dominion:getAnnouncements"),
  play: () => ipcRenderer.invoke("dominion:play"),
  getSettings: () => ipcRenderer.invoke("dominion:getSettings"),
  setSettings: (partial: Partial<LauncherSettings>) => ipcRenderer.invoke("dominion:setSettings", partial),
};

contextBridge.exposeInMainWorld("dominion", api);
