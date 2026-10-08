/**
 * Runtime mode (Development / Preview / Production).
 *
 * Originally this app shipped with a binary mode driven purely by
 * `NODE_ENV`: if `NODE_ENV !== "production"` we were in "dev mode"
 * (no Corporate ID, demo accounts visible), and otherwise we were in
 * "production mode" (Corporate ID required, demo accounts hidden).
 *
 * Revise round 7 introduced a middle ground — **Preview** — that sits
 * between the two and is used for staging/UAT builds. A Preview build is
 * a real `next build` artifact (so the bundle is fully compiled), but:
 *
 *   - The Demo Account panel IS shown (just like in Dev), so testers
 *     can quickly log in as owner / budi / hendra / … without typing
 *     credentials.
 *   - The Corporate ID field IS shown (just like in Production), because
 *     Preview still routes through the license server — but the value is
 *     pre-filled with the constant `TRIAL_CORP_ID` (configurable via the
 *     `PREVIEW_CORP_ID` env var). The user can override it before login.
 *
 * The three modes are selected as follows:
 *
 *   - `NODE_ENV !== "production"`                    → Development
 *   - `NODE_ENV === "production"` && `PREVIEW_MODE === "true"`
 *                                                   → Preview
 *   - `NODE_ENV === "production"` && otherwise      → Production
 *
 * Use `RUNTIME_MODE` (server) / `NEXT_PUBLIC_RUNTIME_MODE` (browser) to
 * branch on this instead of `NODE_ENV` directly — that way every code
 * path that depended on the old binary mode picks up Preview correctly.
 */

export type RuntimeMode = "development" | "preview" | "production";

/** Sentinel Corporate ID used by Preview builds. Override with the
 *  `PREVIEW_CORP_ID` env var (e.g. when the license server has a different
 *  trial account per staging environment). */
export const PREVIEW_CORP_ID = process.env.PREVIEW_CORP_ID ?? "TRIAL";

function detectMode(serverNodeEnv: string | undefined, previewFlag: string | undefined): RuntimeMode {
  const isProd = (serverNodeEnv ?? "").toLowerCase() === "production";
  if (!isProd) return "development";
  if (previewFlag === "true") return "preview";
  return "production";
}

/** Server-side authoritative mode — reads NODE_ENV + PREVIEW_MODE at module
 *  load time. `PREVIEW_MODE` must be set in the runtime environment of the
 *  server process (e.g. `PREVIEW_MODE=true bun .next/standalone/server.js`)
 *  so that the server-side render of the login screen picks the right
 *  variant before the client re-hydrates. */
export const RUNTIME_MODE: RuntimeMode = detectMode(process.env.NODE_ENV, process.env.PREVIEW_MODE);

/** Convenience booleans derived from `RUNTIME_MODE`. */
export const IS_DEV = RUNTIME_MODE === "development";
export const IS_PREVIEW = RUNTIME_MODE === "preview";
export const IS_PROD = RUNTIME_MODE === "production";

/** True when the Demo Account panel should be visible on the login
 *  screen — Dev + Preview. Production hides it (demo users don't exist
 *  in a real tenant's database). */
export const SHOW_DEMO_ACCOUNTS = IS_DEV || IS_PREVIEW;

/** True when the Corporate ID field should be visible on the login
 *  screen — Preview + Production. Dev hides it (license server is never
 *  contacted in dev). */
export const SHOW_CORP_ID = IS_PREVIEW || IS_PROD;

/** True when the "Lacak Paket" / "Track a Package" link should be
 *  shown to customers from inside the authenticated app — Dev + Preview.
 *  In production the public tracking page is reachable via the public
 *  `/tracking-paket` URL only, so it doesn't appear in the in-app UI. */
export const SHOW_TRACKING_LINK = IS_DEV || IS_PREVIEW;

/** Mode label shown to the user in the login screen banner so testers
 *  always know which variant they are looking at. */
export const MODE_LABEL: string = IS_DEV ? "DEV Mode" : IS_PREVIEW ? "PREVIEW Mode" : "Production";

/** Same value as `RUNTIME_MODE` but exposed to the browser bundle via the
 *  `NEXT_PUBLIC_*` prefix. The login screen reads this to decide which
 *  variant to render. To keep the server-rendered HTML and the hydrated
 *  client in sync, ALWAYS set BOTH env vars in your runtime env:
 *
 *   - Server-side: PREVIEW_MODE=true
 *   - Client-side (inlined into the build): NEXT_PUBLIC_PREVIEW_MODE=true
 *
 *  The fallback here is `RUNTIME_MODE` itself so that any code path that
 *  only sets the server-side flag still works correctly. */
export const NEXT_PUBLIC_RUNTIME_MODE: RuntimeMode =
  (process.env.NEXT_PUBLIC_RUNTIME_MODE as RuntimeMode | undefined) ?? RUNTIME_MODE;

export const NEXT_PUBLIC_IS_DEV = NEXT_PUBLIC_RUNTIME_MODE === "development";
export const NEXT_PUBLIC_IS_PREVIEW = NEXT_PUBLIC_RUNTIME_MODE === "preview";
export const NEXT_PUBLIC_IS_PROD = NEXT_PUBLIC_RUNTIME_MODE === "production";

export const NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS = NEXT_PUBLIC_IS_DEV || NEXT_PUBLIC_IS_PREVIEW;
export const NEXT_PUBLIC_SHOW_CORP_ID = NEXT_PUBLIC_IS_PREVIEW || NEXT_PUBLIC_IS_PROD;
export const NEXT_PUBLIC_SHOW_TRACKING_LINK = NEXT_PUBLIC_IS_DEV || NEXT_PUBLIC_IS_PREVIEW;
export const NEXT_PUBLIC_MODE_LABEL: string = NEXT_PUBLIC_IS_DEV
  ? "DEV Mode"
  : NEXT_PUBLIC_IS_PREVIEW
  ? "PREVIEW Mode"
  : "Production";

/** Browser-safe Corporate ID to pre-fill when running in Preview. Mirrors
 *  the server-side `PREVIEW_CORP_ID` constant via the `NEXT_PUBLIC_*` prefix. */
export const NEXT_PUBLIC_PREVIEW_CORP_ID: string =
  process.env.NEXT_PUBLIC_PREVIEW_CORP_ID ?? PREVIEW_CORP_ID;
