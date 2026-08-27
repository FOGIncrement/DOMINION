import type { DominionApi } from "../shared-types.js";

export type { Me, Announcement, LauncherSettings, ApiResponse } from "../shared-types.js";

declare global {
  interface Window {
    dominion: DominionApi;
  }
}
