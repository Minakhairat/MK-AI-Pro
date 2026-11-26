# MK AI Desktop — Windows Packaging & Local Python AI Architecture (MK Tech)

MK AI runs as a unified Computer Vision platform across two synchronized deployment targets:
1. **MK AI Web (`MK-AI-Pro` / GitHub Pages)**: Instant browser access with real In-Browser TensorFlow.js training and optional Cloud Python server connection.
2. **MK AI Desktop (`MK-AI-Setup.exe` / `MK-AI-Offline-Setup.exe`)**: Official Windows 10/11 Electron application bundling an isolated Python Embedded runtime and local FastAPI AI Engine so users train PyTorch, TIMM, and Ultralytics YOLO models locally without installing Python, CUDA, Node.js, Git, or touching CMD.

---

## Architecture Components

| Layer | Responsibility | Source |
| :--- | :--- | :--- |
| **Electron Main Process** | Single-instance shell, hardened BrowserWindow (`contextIsolation`, `sandbox`), origin-checked IPC handlers, lifecycle supervision | `electron/main.ts` |
| **Preload Bridge** | Strict `contextBridge.exposeInMainWorld('mkDesktop', ...)` typed API | `electron/preload.ts` |
| **Python Runtime Manager** | Detects bundled/AppData embedded Python 3.11.9 isolated from `PATH` / `PYTHONPATH` / user-site packages; enables `._pth` `import site` and bootstraps `pip` | `electron/services/pythonRuntimeManager.ts` |
| **Hardware Detector** | Inspects CPU, RAM, disk, `nvidia-smi` GPU/VRAM/CUDA driver, and live `torch.cuda.is_available()`; picks `nvidia_gpu`, `cpu`, or `safe_compatibility` profile | `electron/services/hardwareDetector.ts` |
| **Dependency Manager** | Audits pinned manifests (`requirements-cu121.txt`, `requirements-cpu.txt`, `requirements-safe.txt`), streams `pip` progress with retry backoff and rollback snapshot | `electron/services/dependencyManager.ts` |
| **Local Engine Supervisor** | Prevents duplicate processes (`mk-engine.lock.json`), allocates a free `127.0.0.1` loopback port, injects a 32-byte hex `MK_ENGINE_TOKEN`, supervises `uvicorn main:app` | `electron/services/engineManager.ts` |
| **Storage Manager** | Initializes `MK-AI-Data/` (datasets, projects, models, model_weights, training_runs, exports, logs, cache, temp, backups), stages IndexedDB images/YOLO `data.yaml`, enforces path confinement | `electron/services/storageManager.ts` |
| **Model Weight Downloader** | HTTPS allowlist validation, `Range`-based `.part` resume, SHA-256 verification, version rollback | `electron/services/modelDownloadManager.ts` |
| **Setup Wizard Runner** | Real 10-step verification from system requirements through PyTorch gradient test and authenticated `/capabilities` end-to-end check | `electron/services/setupWizardRunner.ts` |
| **Desktop UI** | First-launch 10-step Wizard + Desktop Engine Status & Diagnostics Dashboard + 3-way Training Studio target routing | `src/components/desktop/*`, `src/components/training/TrainingStudio.tsx` |

---

## Installer Modes

### 1. Online Installer (`MK-AI-Setup.exe`)
- Compact Windows NSIS installer bundling the Electron shell, Web UI, `ai_engine/`, and the official Windows embeddable Python runtime.
- On first launch, the Setup Wizard automatically detects whether an NVIDIA GPU (`nvidia-smi` + CUDA 11.8+) is present and downloads the matching PyTorch (`cu121` or `cpu`) + FastAPI wheel profile automatically with zero CMD interaction.

### 2. Offline Installer (`MK-AI-Offline-Setup.exe`)
- Stages `build/wheelhouse/` via `node build/prepare-python-runtime.mjs --offline` and installs the complete Python + PyTorch CPU environment in air-gapped environments without Internet access.

---

## Building on Windows (Local or GitHub Actions)

The GitHub Actions workflow `.github/workflows/build-desktop.yml` builds both installers cleanly on `windows-latest`:

```powershell
# 1. Install dependencies & test
npm ci --legacy-peer-deps
npm test

# 2. Build Vite (relative ./ base) & Electron bundles
npm run desktop:build

# 3. Stage Online Python Embedded Runtime & build MK-AI-Setup.exe
node build/prepare-python-runtime.mjs
npx electron-builder --config electron-builder.yml --win nsis

# 4. Stage Offline Wheelhouse & build MK-AI-Offline-Setup.exe
node build/prepare-python-runtime.mjs --offline
$env:OFFLINE_INSTALLER="1"
npx electron-builder --config electron-builder.yml --win nsis -c.win.artifactName=MK-AI-Offline-Setup.exe
```

### Publishing Official GitHub Releases
Push a release tag (e.g., `git tag v1.0.0 && git push origin v1.0.0`). `.github/workflows/build-desktop.yml` builds both `MK-AI-Setup.exe` and `MK-AI-Offline-Setup.exe` on `windows-latest`, verifies non-empty PE executables (`MZ` header), computes `SHA256SUMS.txt` + `desktop-release-manifest.json`, and publishes them automatically to `https://github.com/<owner>/<repo>/releases/latest`.

### Preserving User Data & Cleaning Credentials on Upgrade / Uninstall
- During application upgrades, `%APPDATA%\MK AI Desktop\security\` engine credentials persist automatically across versions.
- During interactive uninstall, `build/installer.nsh` removes `%APPDATA%\MK AI Desktop\security\` credentials and transient engine lockfiles while prompting to preserve `%LOCALAPPDATA%\MK-AI-Data` (datasets, projects, trained weights) by default.

---

## Troubleshooting

- **GPU detected in Windows, but PyTorch runs on CPU**: Open **Desktop Engine -> Run 10-Step Setup Wizard** or click **Repair Python Env** to install the pinned CUDA `cu121` manifest (`ai_engine/manifests/requirements-cu121.txt`). Update your NVIDIA Game Ready / Studio driver if CUDA < 11.8.
- **Engine failed to start or port busy**: Click **Restart AI Engine** in **Desktop Engine**. The supervisor cleans stale lockfiles (`mk-engine.lock.json`) and binds to an open loopback port on `127.0.0.1` with a fresh session bearer token.
- **Need diagnostics for support**: Click **Export Diagnostic Report** in **Desktop Engine** to save a JSON snapshot inside `MK-AI-Data/logs/`.
