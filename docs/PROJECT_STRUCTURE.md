# MK AI — by MK Tech: Project Structure

```
/
├── .env.example                    # Environment configuration template (no secrets)
├── Dockerfile                      # Production container for Web + Node API Gateway
├── docker-compose.yml              # Local full-stack orchestration (Web/API + Python AI Engine)
├── eslint.config.js                # ESLint config including @firebase/eslint-plugin-security-rules
├── firebase-applet-config.json     # Provisioned Firebase project configuration
├── firebase-blueprint.json         # Intermediate Representation (IR) for Firestore entities & paths
├── firestore.rules                 # Production-hardened Firestore Security Rules
├── index.html                      # HTML entry point & bilingual Google Fonts
├── metadata.json                   # Application metadata & device permissions
├── package.json                    # Dependencies and scripts (dev, build, start, lint, test)
├── security_spec.md                # Security invariants & Dirty Dozen payload test specification
├── server.ts                       # Express API Gateway + Vite dev/prod server (Port 3000)
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite + Tailwind v4 configuration
│
├── ai_engine/                      # Independent Python AI Training Engine
│   ├── Dockerfile                  # Python FastAPI + PyTorch container
│   ├── README.md                   # Engine setup, GPU/CPU instructions & model license notes
│   ├── main.py                     # FastAPI server (/health, /capabilities, /jobs/*)
│   └── requirements.txt            # Python ML dependencies
│
├── docs/                           # Architecture, Roadmap, and Setup Guides
│   ├── ARCHITECTURE.md             # Full technical architecture & diagram
│   ├── PROJECT_STRUCTURE.md        # This file
│   └── ROADMAP.md                  # Phased development roadmap & dependencies
│
├── server/                         # Backend API modules
│   ├── middleware/
│   │   ├── auth.ts                 # Firebase ID token verification (firebase-admin/auth)
│   │   └── rateLimit.ts            # Lightweight API rate limiter
│   ├── providers/
│   │   └── cloudAdapter.ts         # Multi-Cloud Storage & Compute Adapter Layer
│   └── routes/
│       └── api.ts                  # /api/health, /api/capabilities, /api/ai-engine/*
│
├── src/                            # Frontend React + TypeScript application
│   ├── App.tsx                     # Root application shell, routing & ErrorBoundary
│   ├── index.css                   # Tailwind v4 + @custom-variant dark + Design Tokens
│   ├── main.tsx                    # React entry point
│   ├── assets/images/              # Generated visual assets
│   ├── components/
│   │   ├── auth/
│   │   │   └── AuthScreen.tsx      # Bilingual Google & Email/Password Sign-In screen
│   │   ├── common/
│   │   │   ├── ErrorBoundary.tsx   # Structured Firestore/Runtime error boundary
│   │   │   └── EmptyState.tsx      # Reusable empty state component
│   │   ├── dashboard/
│   │   │   └── DashboardView.tsx   # Main KPI overview, projects list & real activity feed
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx         # Collapsible navigation sidebar (RTL/LTR aware)
│   │   │   └── TopBar.tsx          # Clean 3-zone top bar with breadcrumbs & primary action
│   │   ├── projects/
│   │   │   ├── CreateProjectModal.tsx   # Project creation with V1.0 tasks & cloud consent
│   │   │   └── ProjectWorkspaceView.tsx # Independent project workspace & stage tabs
│   │   ├── settings/
│   │   │   └── AccountSettingsView.tsx  # Account, security, billing & system status
│   │   └── workspaces/
│   │       └── WorkspacesView.tsx       # Personal & Team (RBAC) workspace management
│   ├── contexts/
│   │   ├── AuthContext.tsx         # Firebase Auth + Firestore UserProfile sync
│   │   ├── I18nContext.tsx         # Arabic (RTL) / English (LTR) dictionary & state
│   │   └── ThemeContext.tsx        # Light / Dark mode state & html.dark synchronization
│   ├── i18n/
│   │   └── translations.ts         # Complete EN & AR translation strings
│   ├── lib/
│   │   ├── firebase.ts             # Firebase SDK initialization & testConnection()
│   │   ├── firestoreErrors.ts      # Structured FirestoreErrorInfo & handleFirestoreError
│   │   └── apiClient.ts            # Authenticated backend API client (in-memory ID token)
│   ├── services/
│   │   └── firestoreService.ts     # Real Firestore CRUD for users, workspaces, projects & logs
│   └── types/
│       └── domain.ts               # Strict TypeScript domain models & enums
│
└── tests/                          # Automated tests
    ├── api.test.ts                 # Backend API & Cloud Adapter tests
    └── firestore.rules.test.ts     # Dirty Dozen security rule & payload validation tests
```
