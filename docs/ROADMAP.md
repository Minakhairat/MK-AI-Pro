# MK AI — by MK Tech: Development Roadmap

## Phase 1 — Foundation (Current Phase)
**Goal**: Establish production architecture, bilingual/dual-theme Design System, real authentication, persistent database with hardened rules, backend API gateway, Dockerized Python AI Engine scaffold, and Project Management workspace.
- **Deliverables**:
  - System Architecture, Project Structure, and Roadmap documentation.
  - Design System (`Light/Dark`, `Arabic RTL / English LTR`, Crimson Red + Monochrome palette).
  - Real Firebase Auth (Google Sign-In + Email/Password handling) & Firestore persistence with verified security rules.
  - Node/Express API Gateway (`server.ts`) with ID token verification, rate limiting, and Multi-Cloud Adapter abstraction.
  - Python FastAPI AI Engine scaffold (`ai_engine/`) with honest hardware capability detection.
  - Main Dashboard, Workspaces, Project Creation & Workspace Shell, Account & System Status views.
  - Automated validation tests (Security Rules TDD, Backend API tests, TypeScript & ESLint checks).
- **Dependencies**: Provisioned Firebase/Firestore project, Node 20+, Docker (optional for Python engine).

## Phase 2 — MK Dataset Studio
**Goal**: Full dataset ingestion, annotation, quality auditing, and augmentation configuration.
- **Deliverables**:
  - Image & video frame upload + Live Webcam/Mobile Camera continuous capture.
  - Classification labeling & interactive Bounding Box canvas annotation tool (zoom/pan, keyboard shortcuts).
  - YOLO & COCO dataset import parsers.
  - Real data quality checks (duplicate hash detection, missing annotations, class imbalance analysis, resolution checks).
  - Train / Validation / Test splitting and leakage-safe augmentation config persistence.
- **Dependencies**: Phase 1 Project & Storage Adapter layer.

## Phase 3 — Real AI Training Engine
**Goal**: Execute real CPU/GPU training jobs for V1.0 tasks (Image Classification & Object Detection).
- **Deliverables**:
  - Background job queue & WebSocket/SSE live epoch streaming.
  - PyTorch/torchvision classifiers (MobileNetV3, EfficientNet) & Object Detection trainers.
  - Beginner Mode (auto-hyperparameters) & Advanced Mode (epochs, batch size, LR, optimizer, IoU/confidence thresholds).
  - Checkpoint saving, pause/resume/cancel, best/final weight artifact storage, real confusion matrices & mAP/F1 metrics.
- **Dependencies**: Phase 2 Dataset Studio + Phase 1 Python FastAPI Engine (`ai_engine/`).

## Phase 4 — MK AI Model Hub & Evaluation Studio
**Goal**: Standardized model comparison, auto-selection, and real test-set evaluation.
- **Deliverables**:
  - Model Hub registry with explicit license, size, latency, and mobile/offline compatibility metadata.
  - Side-by-side comparison on identical Test Datasets.
  - Interactive Inference Testing (upload/camera), failure case review, and Excel/PDF evaluation reports.
- **Dependencies**: Phase 3 trained model artifacts.

## Phase 5 — MK App Builder (PWA Generator)
**Goal**: Convert trained models into installable standalone web/mobile/desktop applications.
- **Deliverables**:
  - 3 App Tiers: Basic App, Custom App (branding/logo/colors/UI), Professional App (analytics/logs/exports).
  - Compatibility validator before generation (verifying whether model supports On-Device/Offline vs Cloud runtime).
  - Dynamic PWA generator (`manifest.webmanifest`, Service Worker, responsive camera/upload UI, source/bundle export).
- **Dependencies**: Phase 4 validated models.

## Phase 6 — Deployment & Hybrid Storage
**Goal**: Dual deployment (MK AI Hosting + External Export) and external storage integrations.
- **Deliverables**:
  - Versioned app publishing, model hot-swapping, and rollback.
  - External bundle export (Docker / static PWA / standalone runtime).
  - OAuth-based integrations for Google Drive, Microsoft OneDrive, and Dropbox.
  - Usage Credits metering & pre-training cost estimation gate.
- **Dependencies**: Phase 5 App Builder + Phase 1 Cloud Adapter layer.

## Future Phases (V1.5 – V2.5+)
- **V1.5**: Image Segmentation, Anomaly Detection.
- **V2.0**: Pose Estimation, OCR & Text Recognition, Team Workspaces (RBAC workflows & approval queues).
- **V2.5**: Video Recognition, Custom AI Tasks, Enterprise Self-Hosted Deployments.
