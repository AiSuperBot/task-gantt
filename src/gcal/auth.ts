// Google OAuth 2.0 (loopback + PKCE) using the user's own GCP client
// desktop-only: receiving the auth code needs a temporary HTTP server on 127.0.0.1

import { Notice, Platform, requestUrl } from "obsidian";
import type GanttPlugin from "../main";
import { t as tr } from "../i18n";
import { getClientSecret, getRefreshToken, setRefreshToken } from "./secrets";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
// events read/write + calendar list only (never the full calendar scope)
const SCOPES =
  "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";

// the access token lives in memory only (just the refresh token is persisted, in SecretStorage)
let accessToken = "";
let accessTokenExp = 0; // expiry (epoch ms)

// bytes to base64url
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// PKCE code_challenge (S256)
async function sha256(text: string): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return new Uint8Array(buf);
}

// lazily grab Node's http (via window.require so the bundle gets no static require)
type HttpServer = {
  close(): void;
  listen(port: number, host: string, cb: () => void): void;
  address(): { port: number } | string | null;
  on(ev: string, cb: (e: unknown) => void): void;
};
type HttpModule = {
  createServer(
    handler: (
      req: { url?: string },
      res: { writeHead(code: number, headers?: Record<string, string>): void; end(body?: string): void }
    ) => void
  ): HttpServer;
};
function nodeHttp(): HttpModule | null {
  if (!Platform.isDesktop) return null;
  try {
    return (window as unknown as { require: (m: string) => HttpModule }).require("http");
  } catch {
    return null;
  }
}

// call the token endpoint (shared by the code exchange and refresh)
async function tokenRequest(params: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await requestUrl({
    url: TOKEN_URL,
    method: "POST",
    contentType: "application/x-www-form-urlencoded",
    body: new URLSearchParams(params).toString(),
    throw: false,
  });
  let json: Record<string, unknown> = {};
  try {
    json = res.json as Record<string, unknown>;
  } catch {
    /* leave empty when the body isn't JSON */
  }
  return { status: res.status, json };
}

// connected?
export function isConnected(plugin: GanttPlugin): boolean {
  return !!getRefreshToken(plugin);
}

// connect flow: start the loopback server, consent in the browser, exchange the code, store the refresh token
export async function connectGoogle(plugin: GanttPlugin): Promise<boolean> {
  const g = plugin.settings.gcal;
  const http = nodeHttp();
  if (!http) {
    new Notice(tr().gcalDesktopOnly);
    return false;
  }
  const clientSecret = getClientSecret(plugin);
  if (!g.clientId || !clientSecret) {
    new Notice(tr().gcalNeedClient);
    return false;
  }

  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await sha256(verifier));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  let redirectUri = "";

  // receive the code on 127.0.0.1 (3-minute timeout)
  const code = await new Promise<string | null>((resolve) => {
    let settled = false;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const got = url.searchParams.get("state") === state ? url.searchParams.get("code") : null;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<h3>Task Gantt</h3><p>${got ? "Connected. You can close this tab." : "Authorization failed."}</p>`);
      done(got);
    });
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        server.close();
      } catch {
        /* ignore double close */
      }
      resolve(v);
    };
    const timer = window.setTimeout(() => done(null), 180_000);
    server.on("error", () => done(null));
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      redirectUri = `http://127.0.0.1:${port}/callback`;
      const p = new URLSearchParams({
        client_id: g.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: SCOPES,
        access_type: "offline", // get a refresh token
        prompt: "consent", // always re-issue the refresh token
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
      });
      window.open(`${AUTH_URL}?${p.toString()}`);
    });
  });

  if (!code) {
    new Notice(tr().gcalConnectFailed);
    return false;
  }

  const { status, json } = await tokenRequest({
    code,
    client_id: g.clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  if (status !== 200 || typeof json.refresh_token !== "string") {
    console.error("Task Gantt: Google token exchange failed", status, json);
    // surface Google's own reason: the fix differs entirely per cause
    // (redirect_uri_mismatch vs invalid_client …), so a generic message forces a console trip.
    const reason =
      typeof json.error_description === "string"
        ? json.error_description
        : typeof json.error === "string"
          ? json.error
          : // a missing refresh_token alone means consent existed and Google didn't re-issue one
            status === 200
            ? "no refresh_token in response"
            : `HTTP ${status}`;
    new Notice(`${tr().gcalConnectFailed}\n${reason}`, 15_000);
    g.lastError = `connect: ${reason}`;
    await plugin.saveData(plugin.settings);
    return false;
  }
  setRefreshToken(plugin, json.refresh_token);
  accessToken = String(json.access_token ?? "");
  accessTokenExp = Date.now() + (Number(json.expires_in ?? 0) - 60) * 1000;
  await plugin.saveData(plugin.settings);
  new Notice(tr().gcalConnectedNotice);
  return true;
}

// return a valid access token (refreshing when needed)
export async function getAccessToken(plugin: GanttPlugin, force = false): Promise<string> {
  const g = plugin.settings.gcal;
  const refreshToken = getRefreshToken(plugin);
  if (!refreshToken) throw new Error("Google Calendar: not connected");
  if (!force && accessToken && Date.now() < accessTokenExp) return accessToken;
  const { status, json } = await tokenRequest({
    client_id: g.clientId,
    client_secret: getClientSecret(plugin),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (status !== 200 || typeof json.access_token !== "string") {
    // an expired/revoked refresh token means the user must reconnect
    if (json.error === "invalid_grant") {
      setRefreshToken(plugin, "");
      accessToken = "";
      throw new Error("Google Calendar: reconnect required");
    }
    throw new Error(`Google Calendar: token refresh failed (${status})`);
  }
  accessToken = json.access_token;
  accessTokenExp = Date.now() + (Number(json.expires_in ?? 0) - 60) * 1000;
  return accessToken;
}

// disconnect: revoke (best effort) and clear the connection + sync state
export async function disconnectGoogle(plugin: GanttPlugin): Promise<void> {
  const g = plugin.settings.gcal;
  const refreshToken = getRefreshToken(plugin);
  if (refreshToken) {
    try {
      await requestUrl({
        url: `${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`,
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        throw: false,
      });
    } catch {
      /* ignore revoke failures; still clear locally */
    }
  }
  setRefreshToken(plugin, "");
  g.syncToken = "";
  g.state = {};
  g.lastError = "";
  accessToken = "";
  accessTokenExp = 0;
  await plugin.saveData(plugin.settings);
}
