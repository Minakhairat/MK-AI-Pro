# MK AI — by MK Tech: System Architecture

## 1. Architectural Principles

MK AI is designed as a modular, cloud-agnostic, privacy-first Computer Vision platform separating the interactive workspace from backend orchestration and Python-based ML execution:

- **No Fake AI / No Simulated Training**: The frontend never fabricates training metrics, epochs, or inference outputs. All training status and hardware capabilities come directly from the Python AI Training Engine or report an explicit offline/unconfigured state.
- **Private by Default + Local First**: User datasets and models remain isolated per user (`ownerUid`) and require explicit user consent before cloud upload.
- **Multi-Cloud Provider Abstraction**: Storage and compute adapters in `server/providers/cloudAdapter.ts` decouple business logic from any single cloud vendor (supporting Local, GCS, or S3-compatible storage and CPU/GPU workers).

---

## 2. High-Level Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                        CLIENT LAYER (Browser / Installable PWA)                   |
|  React 19 + TypeScript + Tailwind v4 + Bilingual i18n (AR RTL / EN LTR)           |
|  - Workspace UI (Dashboard, Project Studio, Dataset, Training, Eval, App Builder) |
|  - Local-First IndexedDB Cache (Phase 2/5) & On-Device Runtime (TF.js / ONNX)     |
+-----------------------------------------+-----------------------------------------+
                                          |
                     +--------------------+--------------------+
                     | HTTPS / Firebase ID Token               | Firebase Client SDK
                     v                                         v
+-----------------------------------------+   +-------------------------------------+
|        API GATEWAY & ORCHESTRATOR       |   |       AUTH & REALTIME METADATA      |
|  Node.js + Express + TypeScript         |   |  Firebase Auth (Google, Email/Pass) |
|  Port 3000 (`server.ts`)                |   |  Firestore Enterprise (Hardened     |
|  - ID Token Verification (firebase-admin|   |  Security Rules + Blueprint IR)     |
|  - Rate Limiting & Security Headers     |   +-------------------------------------+
|  - Multi-Cloud Storage/Compute Adapters |
|  - AI Engine Proxy (`/api/ai-engine/*`) |
+--------------------+--------------------+
                     | REST / WebSocket
                     v
+-----------------------------------------+   +-------------------------------------+
|      PYTHON AI TRAINING ENGINE          |   |        TRAINING WORKERS             |
|  FastAPI + PyTorch + Ultralytics YOLO   |-->|  CPU / CUDA GPU Workers             |
|  Port 8000 (`ai_engine/main.py`)        |   |  - Real Epoch Loops & Checkpoints   |
|  - Dataset Validation & Augmentation    |   |  - Best/Final Weight Export (.pt,   |
|  - Hardware Probe (CPU/RAM/CUDA GPU)    |   |    .onnx, .tflite)                  |
|  - Real Metrics (mAP, Precision, Recall)|   |  - Real Inference & Evaluation      |
+--------------------+--------------------+   +------------------+------------------+
                     |                                           |
                     +---------------------+---------------------+
                                           v
                  +--------------------------------------------------+
                  |        HYBRID STORAGE & DEPLOYMENT LAYER         |
                  |  - Local Disk / IndexedDB (Local-First Mode)     |
                  |  - S3-Compatible / GCS Object Storage            |
                  |  - Generated PWA Bundles (Manifest + SW + Model) |
                  |  - External Integrations (Drive, OneDrive, etc.) |
                  +--------------------------------------------------+
```

---

## 3. Component Responsibilities

### A. Frontend (`src/`)
- **Framework**: React 19 + TypeScript + Tailwind CSS v4.
- **Design System**: MK Tech visual language (Crimson Red `#DC2626` primary accent, monochrome neutral canvas, Light & Dark modes, Arabic RTL & English LTR).
- **State & Auth**: Firebase Auth context keeping tokens in memory (`user.getIdToken()`), Firestore real-time subscriptions guarded by auth readiness.

### B. Backend API Layer (`server.ts` & `server/`)
- **Runtime**: Express + TypeScript (`tsx server.ts`).
- **Authentication**: Verifies incoming `Authorization: Bearer <idToken>` headers via `firebase-admin/auth` (`verifyIdToken`).
- **Cloud Provider Adapter Layer (`server/providers/cloudAdapter.ts`)**: Abstract interfaces (`StorageAdapter`, `ComputeAdapter`) so changing between Local, GCP, or S3-compatible providers requires zero frontend or core workflow changes.

### C. Database & Security (`firebase-blueprint.json` & `firestore.rules`)
- **Database**: Provisioned Firestore database (`ai-studio-8286a73f-1791-491f-b841-0b6ba5fa9693`) with strict JSON Schema IR (`firebase-blueprint.json`).
- **Security Rules**: Enforces strict owner-only isolation (`ownerUid == request.auth.uid`), email verification gates, field allowlists (`hasOnly`), immutable ownership/creation timestamps, and PII isolation on `/users/{uid}`.
- **Relational/Team Expansion**: `/workspaces/{workspaceId}/members/{memberUid}` subcollection schema ready for RBAC (`owner`, `admin`, `trainer`, `annotator`, `viewer`).

### D. Python AI Training Engine (`ai_engine/`)
- **Framework**: FastAPI + Uvicorn + PyTorch + Ultralytics YOLO + OpenCV + NumPy + Pandas.
- **Isolation**: Runs as an independent service (`port 8000` locally or dedicated GPU container in cloud).
- **Licensing Note**: Ultralytics YOLO (AGPL-3.0) requires commercial licensing for closed-source commercial redistribution, whereas Apache-2.0 / MIT backbones (e.g., `timm`, `torchvision` MobileNet/EfficientNet, YOLOX/RT-DETR Apache-2.0) allow permissive commercial usage. The Model Hub tracks each model's license explicitly.

### E. Generated PWA Runtime (Phase 5)
- **Hybrid Inference**:
  - *On-Device / Offline*: Exported ONNX / TensorFlow.js models verified for browser WebGL/WASM memory limits.
  - *Cloud Inference*: High-parameter models served behind authenticated `/api/inference/*` endpoints.
- **Packaging**: Generates custom `manifest.webmanifest`, Service Worker, app icon, theme colors, and exportable bundle.
