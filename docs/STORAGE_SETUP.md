# MK AI — Storage Infrastructure Setup Guide

MK AI separates business logic from storage backends through a unified `StorageProvider` interface in `server/providers/cloudAdapter.ts`.

## Supported Providers

| Provider | Env Selector | Required Env Vars | Credentials Needed |
| --- | --- | --- | --- |
| **Local Filesystem** (Default) | `STORAGE_PROVIDER=local` | None (`LOCAL_STORAGE_DIR` optional, defaults to `.mk_ai_storage`) | None |
| **S3-Compatible / MinIO** | `STORAGE_PROVIDER=s3` | `S3_BUCKET`, `S3_REGION` (`S3_ENDPOINT` optional for MinIO) | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (server-side only) |
| **Google Cloud Storage** | `STORAGE_PROVIDER=gcs` | `GCS_BUCKET`, `CLOUD_REGION` | ADC / `GOOGLE_APPLICATION_CREDENTIALS` or Workload Identity |

> **Security Rule**: Never place `S3_*`, `GCS_*`, or `GOOGLE_APPLICATION_CREDENTIALS` in `VITE_*` variables. All cloud storage credentials stay strictly on the Express backend.

---

## 1. Local Development (Zero Cloud Credentials)

Copy the local development template:

```bash
cp .env.development.example .env
npm install
npm run dev
```

With `STORAGE_PROVIDER=local`, MK AI starts immediately with no GCP or AWS credentials. Server-side objects are stored safely inside `.mk_ai_storage/` with path-traversal protection, while browser datasets and TensorFlow.js models stay private in IndexedDB.

---

## 2. Local S3-Compatible Testing with MinIO

To test the S3 provider locally using MinIO:

```bash
docker compose --profile minio up -d
```

1. Open MinIO Console at `http://localhost:9001` (default user/pass: `minioadmin` / `minioadmin`) and create bucket `mk-ai-dev-bucket`.
2. Set in `.env`:
   ```env
   STORAGE_PROVIDER=s3
   S3_BUCKET=mk-ai-dev-bucket
   S3_REGION=us-east-1
   S3_ENDPOINT=http://localhost:9000
   S3_ACCESS_KEY_ID=minioadmin
   S3_SECRET_ACCESS_KEY=minioadmin
   ```
3. Restart the backend server (`npm run dev`).

---

## 3. Production Deployment (Google Cloud Storage)

```env
STORAGE_PROVIDER=gcs
CLOUD_PROVIDER=gcp
CLOUD_REGION=europe-west3
GCS_BUCKET=your-gcs-bucket-name
```

Use Cloud Run Workload Identity or mount `GOOGLE_APPLICATION_CREDENTIALS` at runtime. No `S3_*` variables are required when `STORAGE_PROVIDER=gcs`.

---

## 4. Production Deployment (AWS S3)

```env
STORAGE_PROVIDER=s3
CLOUD_PROVIDER=aws
S3_BUCKET=your-aws-s3-bucket
S3_REGION=eu-central-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

Leave `S3_ENDPOINT` unset for standard AWS S3 virtual-hosted URLs, or set `S3_ENDPOINT` for Cloudflare R2 / DigitalOcean Spaces / custom S3 endpoints. No `GCS_*` variables are required when `STORAGE_PROVIDER=s3`.
