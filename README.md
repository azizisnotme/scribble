# Scribble

Native desktop typing assistant — paste text, switch windows, let Scribble type
it into whatever has focus. OCR images locally. Optionally use a free local
WebLLM writing assistant. One compact installer, no admin needed.

The core typing, OCR, drafts, and analytics features remain local. An optional
Supabase connection provides optional Google sign-in and the admin menu. Every
feature is free; there are no paid tiers or upgrade gates.

## Stack

| Layer        | Tech                                                            |
|--------------|-----------------------------------------------------------------|
| Window shell | Tauri 2 + Edge WebView2 (Rust binary, ~5 MB)                    |
| Frontend     | React 19, TypeScript, Tailwind 4, shadcn/ui, lucide-react       |
| Typing core  | Rust + [`enigo`](https://crates.io/crates/enigo) (SendInput)    |
| Hotkeys      | `tauri-plugin-global-shortcut` (F9 start, F10 cancel)           |
| OCR          | `tesseract.js` (WASM, lazy-loaded the first time you scan)      |
| Analytics    | `localStorage` (no telemetry)                                   |
| AI chat      | Hardware-adaptive WebLLM running locally through WebGPU         |
| Accounts     | Supabase Auth + Google OAuth (optional)                          |

There is **no Python runtime** in the shipped app.

## Quick start

Prereqs: Node 18+, Rust (via [rustup](https://rustup.rs/)), and MSVC Build
Tools on Windows.

```bat
:: development with hot reload
npm install
npm run tauri:dev

:: production build (NSIS .exe + WiX .msi, both per-user)
build.bat
```

Built installers land in `src-tauri/target/release/bundle/`:

- `nsis/Scribble_<ver>_x64-setup.exe`
- `msi/Scribble_<ver>_x64_en-US.msi`

Either one installs into `%LocalAppData%\Scribble` and does **not** trigger a
UAC prompt.

## Google sign-in and admin setup

The app works without account configuration. To enable Google sign-in and the
admin menu:

1. Create a project at [Supabase](https://supabase.com/).
2. Open the project's **SQL Editor**, paste the contents of
   `supabase/migrations/001_auth_profiles_and_admin.sql` and
   `supabase/migrations/002_admin_controls.sql`, and run them once. This
   creates account profiles, Row Level Security policies, and
   the admin allowlist for `az.i.zisnotme@gmail.com`.
3. In [Google Auth Platform](https://console.cloud.google.com/auth/), configure
   the consent screen and create an OAuth client of type **Web application**.
   Add this Google authorized redirect URI, replacing the project reference:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

4. In Supabase, open **Authentication → Providers → Google**, enable Google,
   and enter that client ID and client secret.
5. In **Authentication → URL Configuration**, add these exact redirect URLs to
   the allow list:

   ```text
   http://127.0.0.1:18765/auth/callback
   scribble://auth/callback
   ```

   The first URL is the browser success page. The second is the desktop fallback.

6. Copy `.env.example` to `.env.local`, then copy the project URL and
   **publishable key** from **Project Settings → API**:

   ```powershell
   Copy-Item .env.example .env.local
   ```

   `VITE_SUPABASE_ANON_KEY` may contain either the current publishable key or a
   legacy anon key. Never place a Supabase service-role key in this file.
7. Restart `npm run tauri:dev`, open **Account**, and select **Continue with
   Google**. The browser returns to the app through
   `scribble://auth/callback`. Installed builds register this scheme during
   installation; Windows development builds register it when Scribble starts.

Only the verified Google identity `az.i.zisnotme@gmail.com` receives the Admin
sidebar item. The database independently enforces that allowlist for user
listing, so hiding or modifying the desktop interface cannot
grant admin access. Supabase sessions are split into protected entries in the
operating system credential vault rather than stored in WebView
`localStorage`.

## Layout

```text
.
├── src/                    React frontend
│   ├── components/         Sidebar, Header, StatusBar, OcrCard, DraftingCard
│   ├── views/              Dashboard, Live, OcrScanner, AiCore, Analytics, ...
│   └── lib/
│       ├── ipc.ts              Thin facade for the renderer's local engine
│       ├── local-engine.ts     Analytics + OCR dispatcher (no Python)
│       ├── typing-engine.ts    Tauri command wrappers for type_text / cancel
│       ├── ollama.ts           Streaming HTTP client for the AI Core panel
│       ├── theme.ts            Theme selection persisted to localStorage
│       └── utils.ts
├── src-tauri/              Rust shell
│   ├── Cargo.toml
│   ├── tauri.conf.json     Bundle targets, per-user NSIS, CSP, etc.
│   ├── capabilities/
│   └── src/
│       ├── main.rs         Boots the lib entry point
│       ├── lib.rs          Tauri commands + hotkey registration
│       └── typing.rs       enigo-powered typing task + progress events
├── public/                 Static assets served by Vite
├── index.html              Vite entry
├── vite.config.ts          Bundler config, chunk split for tesseract.js
├── package.json
├── build.bat               One-command release build
├── _legacy_python/         Archived old Python app (not shipped)
└── README.md
```

## Features

### Live typing

Paste text, set a target WPM (40–600), choose a pre-roll (1–5 s), press
**Start** or **F9**. Scribble counts down, then types every character into
whichever window has focus. **F10** cancels at any time.

The engine handles Unicode and newlines correctly. Throttled progress
events flow back so the UI shows `typed / total` and a progress bar.

### OCR scanner

Drag-drop an image or click Browse. The first scan downloads the English
model (~10 MB) once and caches it. Results can be edited, restored from local
history, exported, or sent directly into Live.

### AI Core

Uses **WebLLM** through WebGPU. Scribble detects the device tier and tries the
best practical free local model, falling back to a smaller model if needed.
The first model download can be hundreds of megabytes; later sessions use the
local browser cache. No API key, subscription, or separate AI server is needed.

### Analytics

`Live` records every typed session locally. Analytics shows lifetime totals,
today's counts, recent sessions, a 14-day chart, and JSON/CSV export. Settings
can export or restore all Scribble local data.

### Themes

Cobalt, Bloodlust, Toxic, Sketch, Classic Light, Classic Dark — all
hot-swap. Stored locally.

## Keyboard shortcuts

| Key            | Action                                                |
|----------------|-------------------------------------------------------|
| **F9**         | Start typing from the Live buffer                     |
| **F10**        | Cancel any in-progress typing run                     |
| **F11**        | Pause or resume the active typing run                 |
| **Ctrl+Enter** | Send a message in AI Core                             |

If another app already owns F9 or F10, the in-app buttons still work.

## Optimization notes

- Frontend initial JS payload: **~110 KB gzipped**. `tesseract.js` is a
  separate ~20 KB stub chunk that pulls down the WASM blob lazily on
  first OCR scan.
- Rust release profile: `opt-level = "z"`, `lto = "fat"`,
  `codegen-units = 1`, `strip = true`, `panic = "abort"`. Cold build
  takes 5–10 minutes; warm rebuilds are seconds.
- Installer (per-user) targets both `nsis` and `msi`. The NSIS installer
  is typically smaller; the MSI is friendlier for managed environments
  (Group Policy, intune, etc.).

## Recommendations for future work

- **Sign the installers** — get a code-signing cert (~$70–200/yr) so
  SmartScreen / browsers stop warning. Configure under
  `bundle.windows.signCommand` in `tauri.conf.json`.
- **Background tab targeting** — re-implement the legacy "type into
  Brave/Chrome via CDP" path using `tauri-plugin-http` or a small Rust
  CDP client. Lives orthogonally to the foreground typing engine.
- **Cloud sync of scribbles + analytics** — wire a `Sync` button to a
  Cloudflare D1 / Supabase backend. Keep `localStorage` as the offline
  cache.
- **Optional content sync** — if added later, keep it opt-in and retain the
  local backup format as the source of portability.

## What was removed / merged in v0.2

The v0.2 refactor consolidated two overlapping codebases (a PyInstaller
CustomTkinter app and an experimental Tauri shell) into one native
build. Specifically:

- **Removed (archived):** every `.py` file at the project root, the
  `scribble_ai/` package, the PyInstaller `.spec` files, the Inno Setup
  `installer.iss`, the WiX `installer.wxs`, the `License.rtf`,
  `build.bat` / `release.bat` / `build_msi.bat`, `client_secret.json`,
  `.env`, `config.json`, and the `python_sidecar/` bridge from the
  Tauri app. Everything sits in `_legacy_python/` if you ever need a
  reference.
- **Removed (deleted):** `build/`, `dist/` (PyInstaller), `Output/`,
  `.venv/`, `__pycache__/`, the previous `scribble_desktop/` wrapper
  directory, the old `launch-app.mjs` Edge launcher, the old Python
  sidecar `sidecar.rs`.
- **Re-implemented in Rust:** the typing engine (was `engine.py`).
- **Re-implemented in TS:** the AI panel now runs hardware-adaptive WebLLM
  locally instead of depending on the Python `scribble_ai` stack.
- **Kept:** the modern React UI, all themes, OCR via tesseract.js,
  analytics, scribble notes, templates.

Before / after sizes:

| Asset                            | Before (Python) | After (Rust)    |
|----------------------------------|-----------------|-----------------|
| Compiled executable              | 388 MB          | ~5 MB           |
| MSI installer                    | 737 MB          | ~5–10 MB        |
| Idle RAM                         | ~600 MB         | ~80–120 MB      |
| Cold start                       | ~6–8 s          | ~0.5 s          |
| First OCR (WASM cold)            | n/a (EasyOCR)   | ~3 s            |
| Subsequent OCR                   | ~2 s            | <1 s            |
