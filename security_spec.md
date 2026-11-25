# Security Specification — MK AI by MK Tech (Phase 1 – Phase 5)

## 1. Data Invariants
1. **Identity & Ownership**: Every user profile (`/users/{userId}`), workspace (`/workspaces/{workspaceId}`), project (`/projects/{projectId}`), dataset (`/datasets/{datasetId}`), dataset item (`/datasets/{datasetId}/items/{itemId}`), training run (`/trainingRuns/{runId}`), trained model (`/trainedModels/{modelId}`), evaluation report (`/evaluationReports/{reportId}`), generated app (`/generatedApps/{appId}`), and audit log (`/activityLogs/{logId}`) must be strictly bound to `request.auth.uid` with `request.auth.token.email_verified == true`.
2. **No Self-Privilege Escalation**: Users creating `/users/{uid}` cannot assign themselves `planTier: 'pro'` or `'enterprise'` or inflate `cloudCreditsBalance` beyond `100` / `storageQuotaBytes` beyond `5368709120` (5 GB) on creation, and cannot mutate `planTier`, `storageQuotaBytes`, `storageUsedBytes`, or `cloudCreditsBalance` via client updates.
3. **Referential Integrity**:
   - A `/projects/{projectId}` document cannot be created without referencing an existing `/workspaces/{workspaceId}` owned by `request.auth.uid`.
   - A `/datasets/{datasetId}` document cannot be created without referencing an existing `/projects/{projectId}` owned by `request.auth.uid`.
   - A `/trainingRuns/{runId}` or `/trainedModels/{modelId}` document cannot be created without referencing an existing `/projects/{projectId}` and `/datasets/{datasetId}` owned by `request.auth.uid`.
   - An `/evaluationReports/{reportId}` document cannot be created without referencing an existing `/projects/{projectId}`, `/datasets/{datasetId}`, and `/trainedModels/{modelId}` owned by `request.auth.uid`.
   - A `/generatedApps/{appId}` document cannot be created or switched to a model without referencing an existing `/projects/{projectId}` and `/trainedModels/{modelId}` owned by `request.auth.uid`.
4. **Master Gate**:
   - `/workspaces/{workspaceId}/members/{memberUid}` writes require verifying the parent workspace exists and `ownerUid == request.auth.uid`.
   - `/datasets/{datasetId}/items/{itemId}` writes require verifying the parent dataset exists and `ownerUid == request.auth.uid`.
5. **Split & Augmentation Anti-Leakage Invariant**:
   - `splitTrainPct + splitValPct + splitTestPct == 100` and each split percentage is bounded `[0, 100]`.
   - `augmentationConfig.applyOnlyToTrain == true` is enforced so test data is never augmented.
6. **Terminal State Locking & Bounded Training History**:
   - `TrainingRun` documents reaching terminal states (`completed`, `cancelled`, `failed`) cannot be mutated afterwards by regular users.
   - `EvaluationReport` documents are immutable once created (`allow update: if false;`) and enforce `[0, 1]` metric bounds, `sampleCount` `[1, 50000]`, and bounded confusion matrix arrays.
   - `epochMetrics` is bounded `<= 200`, `confusionLabels` `<= 50`, `confusionFlat` `<= 2500`, `perClassMetrics` `<= 50`, and `totalEpochs` bounded `[1, 200]`.
7. **PWA & App Builder Compatibility Guard**:
   - `GeneratedApp.shortName` length is strictly bounded `[1, 12]` for PWA home-screen compliance; `themeColor` must match `^#[0-9a-fA-F]{6}$`; `inputSources` must be `1..3` items strictly from `['camera', 'upload', 'video']`.
   - Selecting `runtimeTarget == 'on_device_pwa'` requires the referenced `/trainedModels/{modelId}` document to have `onDeviceCompatible == true`.
8. **Bounded Arrays & Media Validation**:
   - `classes` list is bounded `<= 50` items (first element validated as string if non-empty).
   - `annotations` list on each `DatasetItem` is bounded `<= 100` items.
   - `mimeType` restricted strictly to `['image/jpeg', 'image/png', 'image/webp']`, `sha256` length strictly `64`.
9. **Temporal & Ownership Immutability**: `createdAt` must equal `request.time` on creation and never change; `ownerUid`, `projectId`, `datasetId`, `runId`, `modelId`, and `id` are immutable after creation; `activityLogs` are append-only.
10. **PII Isolation**: `/users/{userId}` contains `email` and is readable (`get`) ONLY by the owning user or verified admin; `list` is explicitly denied (`allow list: if false;`).

---

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Yield PERMISSION_DENIED)

1. **Shadow Field Injection on Project/Dataset/TrainingRun/EvaluationReport/GeneratedApp Create**: Adding `isFeatured: true` or `adminApproved: true`.
2. **Identity Spoofing**: Setting `ownerUid` to another user's UID while authenticated as User A.
3. **Privilege Escalation on User Profile Create**: Setting `planTier: "enterprise"` or `cloudCreditsBalance: 999999`.
4. **Unverified Email Spoof**: Attempting any write with `email_verified: false`.
5. **Cross-Tenant List**: Querying `/projects`, `/datasets`, `/trainingRuns`, `/trainedModels`, `/evaluationReports`, or `/generatedApps` without `where('ownerUid', '==', auth.uid)`.
6. **PII Blanket Read on `/users`**: Calling `getDocs(collection(db, 'users'))`.
7. **Orphan Dataset / TrainingRun / EvaluationReport / GeneratedApp Creation**: Creating `/datasets/{id}`, `/trainingRuns/{id}`, `/evaluationReports/{id}`, or `/generatedApps/{id}` with a non-existent or foreign `projectId`/`datasetId`/`modelId`.
8. **ID Poisoning**: Document ID > 128 chars or containing spaces/slashes (`"../admin"`).
9. **Immutable Timestamp Tampering**: Updating `createdAt` or passing backdated `createdAt`.
10. **Audit Log, Evaluation Report & Terminal Run Tampering**: Attempting to `update` or `delete` `/activityLogs/{logId}`, `update` `/evaluationReports/{reportId}`, or modify a `completed`/`cancelled`/`failed` `/trainingRuns/{runId}`.
11. **Data Leakage / Invalid Split Ratios / Uncompatible On-Device App**: Setting `splitTrainPct: 80, splitValPct: 30, splitTestPct: 30`, `augmentationConfig.applyOnlyToTrain: false`, or `runtimeTarget: 'on_device_pwa'` when `trainedModels/{modelId}.onDeviceCompatible == false`.
12. **Array Exhaustion / Invalid Input Sources / Invalid MIME**: Uploading > 100 annotations on one item, > 200 epoch metrics on a training run, `inputSources: ['camera', 'shell_exec']`, `shortName` > 12 chars, or `mimeType: "image/svg+xml"`.
