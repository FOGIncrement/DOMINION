import { net, session } from "electron";
import { readSettings } from "./settingsStore";
import type { Announcement, ApiResponse, Me } from "../shared-types";

// All DOMINION API calls happen here, in the main process, using Electron's
// net.fetch — not plain Node fetch, and not a renderer-side fetch. Two
// reasons: (1) the server's CORS config only allows one static origin, so a
// renderer fetch would be blocked outright; (2) net.fetch runs on
// Chromium's real network stack and participates in session.defaultSession's
// cookie jar automatically in both directions — a Set-Cookie on login is
// stored with zero manual parsing, and the game window's later navigation
// to the same origin sends it back automatically. Both windows must keep
// using the default session (no `partition` option anywhere) for this to
// work — see windows.ts.

function baseUrl(): string {
  return readSettings().serverUrl.replace(/\/$/, "");
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function postJson<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  try {
    const res = await net.fetch(`${baseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await parseJson(res);
    if (!res.ok) return { ok: false, error: (json.error as string) ?? `Request failed (${res.status})` };
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

async function getJson<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const res = await net.fetch(`${baseUrl()}${path}`);
    const json = await parseJson(res);
    if (!res.ok) return { ok: false, error: (json.error as string) ?? `Request failed (${res.status})` };
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function getMe(): Promise<Me | null> {
  try {
    const res = await net.fetch(`${baseUrl()}/api/auth/me`);
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

export async function login(email: string, password: string): Promise<ApiResponse<Me>> {
  const result = await postJson<{ playerId: string }>("/api/auth/login", { email, password });
  if (!result.ok) return result;
  const me = await getMe();
  if (!me) return { ok: false, error: "Logged in, but couldn't load your profile" };
  return { ok: true, data: me };
}

export async function register(
  email: string,
  password: string,
  settlementName?: string,
): Promise<ApiResponse<Me>> {
  const result = await postJson<{ playerId: string }>("/api/auth/register", { email, password, settlementName });
  if (!result.ok) return result;
  const me = await getMe();
  if (!me) return { ok: false, error: "Registered, but couldn't load your profile" };
  return { ok: true, data: me };
}

export async function logout(): Promise<void> {
  const url = baseUrl();
  await net.fetch(`${url}/api/auth/logout`, { method: "POST" }).catch(() => undefined);
  // net.fetch should already process the server's clearing Set-Cookie
  // response into session.defaultSession's jar, but clearing it explicitly
  // too guards against a stale cookie surviving into a later login as a
  // different account — this is an auth boundary, worth the extra line.
  try {
    await session.defaultSession.cookies.remove(url, "dominion_session");
  } catch {
    // best-effort
  }
}

export async function getAnnouncements(): Promise<ApiResponse<Announcement[]>> {
  const result = await getJson<{ announcements: Announcement[] }>("/api/announcements");
  if (!result.ok) return result;
  return { ok: true, data: result.data.announcements };
}
