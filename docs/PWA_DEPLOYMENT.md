# MK AI Mobile PWA & Desktop Companion Deployment Guide

## 1. Progressive Web App (PWA) Architecture

MK AI Mobile extends the existing MK AI React + TypeScript platform with a dedicated mobile-first workspace (`< 1024px` viewports) and installable PWA capabilities while preserving the full Web and Electron Desktop interfaces.

- **Web App Manifest (`vite.config.ts`)**:
  - `display: "standalone"`, `display_override: ["window-controls-overlay", "standalone"]`
  - `start_url: "./"`, `scope: "./"` (relative paths support both `/` and subpath deployments such as `/MK-AI-Pro/` on GitHub Pages)
  - Separate `any` icons (`pwa-192x192.png`, `pwa-512x512.png`), padded `maskable` icon (`pwa-maskable-512x512.png`), and `apple-touch-icon.png` (`180x180`)
  - 3 App Shortcuts: **New Vision Project** (`?action=new-project`), **Camera Capture** (`?mobileTab=capture`), **Train Model** (`?mobileTab=train`)
- **Service Worker (Workbox via `vite-plugin-pwa`)**:
  - `registerType: "prompt"` with automatic update prompt banner (`src/components/pwa/PwaUpdateBanner.tsx`)
  - `cleanupOutdatedCaches: true`
  - `NetworkOnly` for `/api/*` endpoints (prevents stale API or auth responses from being cached)
  - `navigateFallback` mapped to `index.html` with `navigateFallbackDenylist` excluding `/api/`

## 2. Installing MK AI on Mobile Devices

### Android (Chrome / Edge / Samsung Internet)
1. Open the HTTPS MK AI URL (or GitHub Pages URL).
2. Tap **Install App** in the browser banner or inside **More → Install Mobile App**, or open Chrome menu (`⋮`) → **Install app** / **Add to Home screen**.
3. Launches in standalone full-screen mode with app icon and long-press shortcuts.

### iOS / iPadOS (Safari 16.4+)
1. Open MK AI in **Safari**.
2. Tap the **Share** icon (`□↑`), then tap **Add to Home Screen**.
3. Launch MK AI from the Home Screen to run in standalone mode with `env(safe-area-inset-*)` padding and local camera/IndexedDB access.

## 3. Offline Caching & Explicit-Consent Sync Queue

- **Offline Snapshots (`src/lib/mobileOfflineStore.ts`)**: Projects, trained models, and evaluation reports are cached in IndexedDB (`mk_ai_mobile_offline_v1`) and clearly distinguish `synced` vs `cached_offline` status when the device goes offline.
- **Offline Sync Queue**: Photos captured or touch-annotated while offline are stored locally in browser IndexedDB (`localMediaStore` + `sync_queue`).
- **Privacy Guarantee**: Any project configured for cloud storage requires explicit `cloudConsentGranted` confirmation before uploading queued items.

## 4. Secure Desktop Companion Pairing

To execute heavy PyTorch / CUDA workloads from a mobile phone:
1. Open **MK AI Desktop** → **Desktop Engine** → **Mobile PWA Companion Pairing**.
2. Enable **LAN Relay** and click **Generate Pairing Code** (creates a single-use 8-character code with a 5-minute TTL and 5-attempt lockout).
3. On MK AI Mobile (**More → MK AI Desktop Companion Pairing**), enter the Desktop LAN endpoint URL and pairing code.
4. Electron Main exchanges the pairing code for a separate, revocable `mkpair_...` session token stored only as a SHA-256 hash in Desktop `userData/security/paired-devices.json`.
5. `MK_ENGINE_TOKEN` never leaves Desktop Main Process. If Desktop becomes unreachable, mobile falls back cleanly to **Cloud Python** or **On-Device Browser TensorFlow.js**.

## 5. Manual GitHub Release Steps for MK AI Desktop `v1.0.0`

Because this container does not hold GitHub credentials or `.git` remote history, run these commands locally or in your GitHub-connected workstation to execute the first real Windows build (`MK-AI-Setup.exe` and `MK-AI-Offline-Setup.exe`):

```bash
git status
git add .
git commit -m "feat: add Desktop v1.0.0 Windows CI fixes and MK AI Mobile PWA"
git remote -v
# If remote is missing: git remote add origin https://github.com/mk-tech/MK-AI-Pro.git
git push -u origin main
git tag -a v1.0.0 -m "MK AI Desktop v1.0.0 Windows Release"
git push origin v1.0.0
```

Once tag `v1.0.0` is pushed, `.github/workflows/build-desktop.yml` runs on `windows-latest`, builds and verifies `MK-AI-Setup.exe`, `MK-AI-Offline-Setup.exe`, `SHA256SUMS.txt`, and `desktop-release-manifest.json`, and publishes GitHub Release `v1.0.0`.
