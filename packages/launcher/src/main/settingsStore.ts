import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { LauncherSettings } from "../shared-types";

// Hand-rolled rather than electron-store: that package went ESM-only at v9,
// which can't be require()'d from this deliberately-CommonJS main process
// (see the plan doc). For 2-3 flat fields this is simpler and safer than
// fighting that dependency's module format.
const DEFAULTS: LauncherSettings = {
  serverUrl: "http://130.162.188.190:4000",
  rememberedEmail: null,
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

export function readSettings(): LauncherSettings {
  try {
    const raw = fs.readFileSync(settingsPath(), "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSettings(next: LauncherSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}
