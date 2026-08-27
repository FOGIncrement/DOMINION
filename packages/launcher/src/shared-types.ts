// Plain data shapes used by both the main process (src/main, src/preload —
// compiled by tsc as CommonJS) and the renderer (src/renderer — bundled by
// Vite). Hand-duplicated from packages/shared's server response shapes
// rather than a workspace dependency, since packages/shared is ESM-only and
// main/preload are deliberately CommonJS. The launcher's real API surface
// is tiny (4 endpoints), so this is far cheaper than the module-format
// friction a real cross-package import would cause.

export interface Me {
  playerId: string;
  email: string;
  isAdmin: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  authorEmail: string;
  createdAt: string;
}

export interface LauncherSettings {
  serverUrl: string;
  rememberedEmail: string | null;
}

export interface ApiResult<T> {
  ok: true;
  data: T;
}

export interface ApiErrorResult {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiResult<T> | ApiErrorResult;

// The full surface exposed on window.dominion by the preload script.
export interface DominionApi {
  login(email: string, password: string): Promise<ApiResponse<Me>>;
  register(email: string, password: string, settlementName?: string): Promise<ApiResponse<Me>>;
  logout(): Promise<void>;
  getMe(): Promise<Me | null>;
  getAnnouncements(): Promise<ApiResponse<Announcement[]>>;
  play(): Promise<void>;
  getSettings(): Promise<LauncherSettings>;
  setSettings(partial: Partial<LauncherSettings>): Promise<LauncherSettings>;
}
