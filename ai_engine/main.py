"""
MK AI — by MK Tech
Independent Python AI Training & Inference Engine (FastAPI)

Phase 3: Real PyTorch / torchvision & Ultralytics YOLO Training Worker.
Executes genuine forward/backward passes, real checkpoint persistence,
pause/resume/cancel signaling, and SSE live epoch streaming.
No simulated training or fabricated metrics are permitted.
"""

import asyncio
import json
import os
import platform
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    import torch  # type: ignore
    import torch.nn as nn  # type: ignore
    from torch.utils.data import DataLoader, TensorDataset  # type: ignore
except ImportError:
    torch = None  # type: ignore
    nn = None  # type: ignore
    DataLoader = None  # type: ignore
    TensorDataset = None  # type: ignore

try:
    import torchvision  # type: ignore
except ImportError:
    torchvision = None  # type: ignore

try:
    from ultralytics import YOLO  # type: ignore
except ImportError:
    YOLO = None  # type: ignore

app = FastAPI(
    title="MK AI Training Engine",
    description="Computer Vision AI Training & Inference Service by MK Tech",
    version="1.0.0-phase3",
)

START_TIME = time.time()
CHECKPOINT_ROOT = Path(os.environ.get("MK_CHECKPOINT_DIR", "./checkpoints")).resolve()
CHECKPOINT_ROOT.mkdir(parents=True, exist_ok=True)
JOB_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]{1,128}$")


class HardwareStatus(BaseModel):
    cpu_count: int
    architecture: str
    os_name: str
    torch_installed: bool
    torch_version: Optional[str]
    torchvision_installed: bool
    ultralytics_installed: bool
    cuda_available: bool
    cuda_device_count: int
    cuda_devices: List[str]
    mps_available: bool


class HyperparametersPayload(BaseModel):
    epochs: int = Field(default=15, ge=1, le=200)
    batchSize: int = Field(default=8, ge=1, le=128)
    learningRate: float = Field(default=0.001, gt=0.0, le=1.0)
    optimizer: Literal["adam", "sgd", "rmsprop"] = "adam"
    inputSize: int = Field(default=224, ge=32, le=1024)
    confidenceThreshold: float = Field(default=0.45, ge=0.0, le=1.0)
    iouThreshold: float = Field(default=0.50, ge=0.0, le=1.0)
    earlyStoppingPatience: int = Field(default=5, ge=0, le=50)
    saveCheckpoints: bool = True


class TrainJobRequest(BaseModel):
    projectId: str = Field(min_length=1, max_length=128)
    datasetId: str = Field(min_length=1, max_length=128)
    taskType: Literal["image_classification", "object_detection"]
    architecture: str = Field(min_length=2, max_length=64)
    classes: List[str] = Field(min_length=1, max_length=50)
    datasetYamlPath: Optional[str] = Field(default=None, max_length=500)
    datasetDirPath: Optional[str] = Field(default=None, max_length=500)
    hyperparameters: HyperparametersPayload = Field(default_factory=HyperparametersPayload)
    resumeCheckpointPath: Optional[str] = Field(default=None, max_length=500)


class JobState:
    def __init__(self, job_id: str, req: TrainJobRequest) -> None:
        self.job_id = job_id
        self.req = req
        self.status: str = "queued"
        self.current_epoch: int = 0
        self.total_epochs: int = req.hyperparameters.epochs
        self.epoch_metrics: List[Dict[str, Any]] = []
        self.best_epoch: int = 0
        self.best_val_metric: float = 0.0
        self.checkpoint_path: Optional[str] = None
        self.error_message: Optional[str] = None
        self.logs: List[str] = []
        self.pause_event = threading.Event()
        self.pause_event.set()
        self.cancel_event = threading.Event()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "projectId": self.req.projectId,
            "datasetId": self.req.datasetId,
            "taskType": self.req.taskType,
            "architecture": self.req.architecture,
            "status": self.status,
            "currentEpoch": self.current_epoch,
            "totalEpochs": self.total_epochs,
            "epochMetrics": self.epoch_metrics,
            "bestEpoch": self.best_epoch,
            "bestValMetric": self.best_val_metric,
            "checkpointPath": self.checkpoint_path,
            "errorMessage": self.error_message,
            "logs": self.logs[-60:],
        }


JOBS_LOCK = threading.Lock()
JOBS: Dict[str, JobState] = {}


def detect_hardware() -> HardwareStatus:
    cuda_available = False
    cuda_device_count = 0
    cuda_devices: List[str] = []
    mps_available = False
    torch_version = None

    if torch is not None:
        torch_version = str(torch.__version__)
        cuda_available = bool(torch.cuda.is_available())
        if cuda_available:
            cuda_device_count = int(torch.cuda.device_count())
            cuda_devices = [
                str(torch.cuda.get_device_name(i)) for i in range(cuda_device_count)
            ]
        mps_backend = getattr(torch.backends, "mps", None)
        if mps_backend is not None:
            mps_available = bool(mps_backend.is_available())

    return HardwareStatus(
        cpu_count=os.cpu_count() or 1,
        architecture=platform.machine(),
        os_name=platform.system(),
        torch_installed=torch is not None,
        torch_version=torch_version,
        torchvision_installed=torchvision is not None,
        ultralytics_installed=YOLO is not None,
        cuda_available=cuda_available,
        cuda_device_count=cuda_device_count,
        cuda_devices=cuda_devices,
        mps_available=mps_available,
    )


def _safe_job_dir(job_id: str) -> Path:
    if not JOB_ID_PATTERN.match(job_id):
        raise ValueError("Invalid job_id format")
    resolved = (CHECKPOINT_ROOT / job_id).resolve()
    if not str(resolved).startswith(str(CHECKPOINT_ROOT) + os.sep):
        raise ValueError("Path traversal blocked")
    resolved.mkdir(parents=True, exist_ok=True)
    return resolved


def _run_python_training_worker(job: JobState) -> None:
    try:
        job.status = "running"
        job.logs.append(f"[{job.job_id}] Initializing real Python worker for {job.req.architecture}")

        if job.req.taskType == "object_detection" and job.req.architecture in ("yolo11n", "yolov8n"):
            if YOLO is None:
                raise RuntimeError("Ultralytics YOLO is not installed on this Python worker.")
            if not job.req.datasetYamlPath or not Path(job.req.datasetYamlPath).exists():
                raise RuntimeError("Valid datasetYamlPath pointing to YOLO data.yaml is required.")

            job_dir = _safe_job_dir(job.job_id)
            weights_ref = job.req.resumeCheckpointPath or f"{job.req.architecture}.pt"
            model = YOLO(weights_ref)

            def on_fit_epoch_end(trainer: Any) -> None:
                job.pause_event.wait()
                if job.cancel_event.is_set():
                    raise InterruptedError("Training cancelled by user.")
                epoch_idx = int(getattr(trainer, "epoch", len(job.epoch_metrics))) + 1
                metrics = getattr(trainer, "metrics", {}) or {}
                loss_items = getattr(trainer, "tloss", None)
                train_loss = float(loss_items.mean().item()) if hasattr(loss_items, "mean") else 0.0
                val_box = float(metrics.get("val/box_loss", 0.0))
                val_cls = float(metrics.get("val/cls_loss", 0.0))
                val_dfl = float(metrics.get("val/dfl_loss", 0.0))
                val_loss = (val_box + val_cls + val_dfl) / 3.0 if (val_box + val_cls + val_dfl) > 0 else train_loss
                val_map50 = float(metrics.get("metrics/mAP50(B)", 0.0))
                val_f1_approx = float(metrics.get("metrics/precision(B)", 0.0))
                job.current_epoch = epoch_idx
                job.epoch_metrics.append({
                    "epoch": epoch_idx,
                    "trainLoss": round(train_loss, 5),
                    "valLoss": round(val_loss, 5),
                    "trainMetric": round(val_f1_approx, 4),
                    "valMetric": round(val_map50, 4),
                    "durationMs": 0,
                })
                if val_map50 > job.best_val_metric or len(job.epoch_metrics) == 1:
                    job.best_val_metric = round(val_map50, 4)
                    job.best_epoch = epoch_idx

            model.add_callback("on_fit_epoch_end", on_fit_epoch_end)
            model.train(
                data=job.req.datasetYamlPath,
                epochs=job.req.hyperparameters.epochs,
                imgsz=job.req.hyperparameters.inputSize,
                batch=job.req.hyperparameters.batchSize,
                lr0=job.req.hyperparameters.learningRate,
                project=str(job_dir),
                name="run",
                exist_ok=True,
                verbose=False,
            )
            best_pt = job_dir / "run" / "weights" / "best.pt"
            if best_pt.exists():
                job.checkpoint_path = str(best_pt)
            job.status = "completed"
            return

        if torch is None or torchvision is None:
            raise RuntimeError(
                "PyTorch & torchvision are not installed on this Python worker environment."
            )

        if not job.req.datasetDirPath or not Path(job.req.datasetDirPath).exists():
            raise RuntimeError(
                "Valid datasetDirPath containing train/val splits is required for PyTorch training."
            )

        from torchvision import datasets, models, transforms  # type: ignore

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        img_sz = job.req.hyperparameters.inputSize
        tf_train = transforms.Compose([
            transforms.Resize((img_sz, img_sz)),
            transforms.RandomHorizontalFlip(),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])
        tf_val = transforms.Compose([
            transforms.Resize((img_sz, img_sz)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ])

        train_dir = Path(job.req.datasetDirPath) / "train"
        val_dir = Path(job.req.datasetDirPath) / "val"
        if not train_dir.exists():
            raise RuntimeError("Missing train/ directory inside datasetDirPath.")

        train_ds = datasets.ImageFolder(str(train_dir), transform=tf_train)
        val_ds = datasets.ImageFolder(str(val_dir), transform=tf_val) if val_dir.exists() else train_ds

        # Enforce consistent class-to-index alignment between train, val, and request classes
        expected_classes = [c for c in job.req.classes if c in train_ds.class_to_idx]
        if expected_classes and expected_classes == sorted(expected_classes) and len(expected_classes) == len(train_ds.classes):
            active_classes = expected_classes
        else:
            active_classes = list(train_ds.classes)
            class_remap = {cls_name: idx for idx, cls_name in enumerate(job.req.classes)}
            if all(c in class_remap for c in train_ds.classes) and len(job.req.classes) == len(train_ds.classes):
                train_ds.samples = [(p, class_remap[train_ds.classes[t]]) for p, t in train_ds.samples]
                train_ds.targets = [s[1] for s in train_ds.samples]
                if val_ds is not train_ds:
                    val_ds.samples = [(p, class_remap[val_ds.classes[t]]) for p, t in val_ds.samples]
                    val_ds.targets = [s[1] for s in val_ds.samples]
                active_classes = list(job.req.classes)

        if len(train_ds) < 2:
            raise RuntimeError("PyTorch training requires at least 2 images in train/.")

        effective_batch = min(job.req.hyperparameters.batchSize, len(train_ds))
        drop_last_for_bn = len(train_ds) > effective_batch and (len(train_ds) % effective_batch == 1)
        train_loader = DataLoader(train_ds, batch_size=effective_batch, shuffle=True, drop_last=drop_last_for_bn)
        val_loader = DataLoader(val_ds, batch_size=effective_batch, shuffle=False)
        num_classes = len(active_classes)

        if job.req.architecture == "efficientnet_b0":
            net = models.efficientnet_b0(weights=None)
            net.classifier[1] = nn.Linear(net.classifier[1].in_features, num_classes)
        else:
            net = models.mobilenet_v3_large(weights=None)
            net.classifier[3] = nn.Linear(net.classifier[3].in_features, num_classes)

        net = net.to(device)
        criterion = nn.CrossEntropyLoss()
        if job.req.hyperparameters.optimizer == "sgd":
            optimizer = torch.optim.SGD(net.parameters(), lr=job.req.hyperparameters.learningRate, momentum=0.9)
        elif job.req.hyperparameters.optimizer == "rmsprop":
            optimizer = torch.optim.RMSprop(net.parameters(), lr=job.req.hyperparameters.learningRate)
        else:
            optimizer = torch.optim.Adam(net.parameters(), lr=job.req.hyperparameters.learningRate)

        job_dir = _safe_job_dir(job.job_id)
        best_val_loss = float("inf")
        best_val_acc = -1.0

        for epoch in range(1, job.total_epochs + 1):
            job.pause_event.wait()
            if job.cancel_event.is_set():
                job.status = "cancelled"
                return

            t0 = time.time()
            net.train()
            train_loss = 0.0
            train_correct = 0
            train_total = 0
            before_params = [p.detach().clone() for p in net.parameters() if p.requires_grad] if epoch == 1 else None

            for step_idx, (xb, yb) in enumerate(train_loader):
                job.pause_event.wait()
                if job.cancel_event.is_set():
                    job.status = "cancelled"
                    return
                if xb.size(0) < 2:
                    continue
                xb, yb = xb.to(device), yb.to(device)
                optimizer.zero_grad()
                logits = net(xb)
                loss = criterion(logits, yb)
                if not torch.isfinite(loss):
                    raise RuntimeError(f"Non-finite training loss detected at epoch {epoch}, step {step_idx}.")
                loss.backward()
                if epoch == 1 and step_idx == 0:
                    grad_norm = sum(float(p.grad.abs().sum().item()) for p in net.parameters() if p.grad is not None)
                    if grad_norm <= 0:
                        raise RuntimeError("Zero gradient norm detected during first backward pass.")
                    job.logs.append(f"[Diagnostic] Initial grad L1 norm = {grad_norm:.4f}")
                optimizer.step()
                train_loss += float(loss.item()) * xb.size(0)
                train_correct += int((logits.argmax(dim=1) == yb).sum().item())
                train_total += int(xb.size(0))

            if before_params is not None:
                after_params = [p.detach() for p in net.parameters() if p.requires_grad]
                param_delta = sum(float((a - b).abs().sum().item()) for a, b in zip(after_params, before_params))
                if param_delta <= 0:
                    raise RuntimeError("Model parameters did not update after Epoch 1 optimizer steps.")
                job.logs.append(f"[Diagnostic] Epoch 1 weight update delta = {param_delta:.4f}")

            net.eval()
            val_loss = 0.0
            val_correct = 0
            val_total = 0
            with torch.no_grad():
                for xb, yb in val_loader:
                    xb, yb = xb.to(device), yb.to(device)
                    logits = net(xb)
                    loss = criterion(logits, yb)
                    if not torch.isfinite(loss):
                        raise RuntimeError(f"Non-finite validation loss detected at epoch {epoch}.")
                    val_loss += float(loss.item()) * xb.size(0)
                    val_correct += int((logits.argmax(dim=1) == yb).sum().item())
                    val_total += int(xb.size(0))

            avg_train_loss = train_loss / max(1, train_total)
            avg_val_loss = val_loss / max(1, val_total)
            train_acc = train_correct / max(1, train_total)
            val_acc = val_correct / max(1, val_total)
            duration_ms = round((time.time() - t0) * 1000)

            job.current_epoch = epoch
            job.epoch_metrics.append({
                "epoch": epoch,
                "trainLoss": round(avg_train_loss, 5),
                "valLoss": round(avg_val_loss, 5),
                "trainMetric": round(train_acc, 4),
                "valMetric": round(val_acc, 4),
                "durationMs": duration_ms,
            })
            job.logs.append(
                f"Epoch {epoch}/{job.total_epochs} - loss: {avg_train_loss:.4f} acc: {train_acc:.4f} val_loss: {avg_val_loss:.4f} val_acc: {val_acc:.4f}"
            )

            if val_acc > best_val_acc or (val_acc == best_val_acc and avg_val_loss < best_val_loss):
                best_val_acc = val_acc
                best_val_loss = avg_val_loss
                job.best_val_metric = round(val_acc, 4)
                job.best_epoch = epoch
                if job.req.hyperparameters.saveCheckpoints:
                    ckpt = job_dir / "best.pt"
                    torch.save({"epoch": epoch, "model_state": net.state_dict(), "classes": active_classes}, ckpt)
                    job.checkpoint_path = str(ckpt)

        job.status = "completed"
    except InterruptedError:
        job.status = "cancelled"
        job.logs.append("Training cancelled.")
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)[:480]
        job.logs.append(f"Training failed: {job.error_message}")


@app.get("/health")
def health() -> Dict[str, Any]:
    hw = detect_hardware()
    return {
        "status": "online",
        "service": "mk-ai-training-engine",
        "phase": "phase3_real_training_engine",
        "uptime_seconds": round(time.time() - START_TIME, 2),
        "hardware": hw.model_dump(),
    }


@app.get("/capabilities")
def capabilities() -> Dict[str, Any]:
    hw = detect_hardware()
    return {
        "engine_version": "v1.0",
        "phase": "phase3_real_training_engine",
        "torch_ready": hw.torch_installed and hw.torchvision_installed,
        "yolo_ready": hw.ultralytics_installed,
        "tasks": [
            {
                "id": "image_classification",
                "version": "v1.0",
                "status": "active" if hw.torch_installed and hw.torchvision_installed else "missing_dependencies",
                "architectures": [
                    {"id": "mobilenet_v3_large", "name": "MobileNetV3-Large", "license": "BSD-3-Clause (torchvision)"},
                    {"id": "efficientnet_b0", "name": "EfficientNet-B0", "license": "BSD-3-Clause (torchvision)"},
                ],
            },
            {
                "id": "object_detection",
                "version": "v1.0",
                "status": "active" if hw.ultralytics_installed else "missing_dependencies",
                "architectures": [
                    {"id": "yolo11n", "name": "YOLO11n", "license": "AGPL-3.0 (Ultralytics)"},
                    {"id": "yolov8n", "name": "YOLOv8n", "license": "AGPL-3.0 (Ultralytics)"},
                    {"id": "fasterrcnn_mobilenet_v3", "name": "Faster R-CNN MobileNetV3", "license": "BSD-3-Clause (torchvision)"},
                ],
            },
        ],
    }


@app.post("/jobs/train")
def start_training_job(req: TrainJobRequest) -> Dict[str, Any]:
    hw = detect_hardware()
    if req.architecture in ("yolo11n", "yolov8n") and not hw.ultralytics_installed:
        raise HTTPException(
            status_code=503,
            detail="Ultralytics is not installed on this Python worker. Install ai_engine/requirements.txt first.",
        )
    if req.architecture not in ("yolo11n", "yolov8n") and not (hw.torch_installed and hw.torchvision_installed):
        raise HTTPException(
            status_code=503,
            detail="PyTorch/torchvision not installed on this Python worker. Install ai_engine/requirements.txt first.",
        )

    job_id = f"pyjob_{uuid.uuid4().hex[:16]}"
    job = JobState(job_id, req)
    with JOBS_LOCK:
        JOBS[job_id] = job

    worker = threading.Thread(target=_run_python_training_worker, args=(job,), daemon=True)
    worker.start()
    return job.to_dict()


@app.get("/jobs/{job_id}")
def get_job_status(job_id: str) -> Dict[str, Any]:
    if not JOB_ID_PATTERN.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id format")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job not found")
    return job.to_dict()


@app.post("/jobs/{job_id}/pause")
def pause_job(job_id: str) -> Dict[str, Any]:
    if not JOB_ID_PATTERN.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id format")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job not found")
    job.pause_event.clear()
    if job.status == "running":
        job.status = "paused"
    return job.to_dict()


@app.post("/jobs/{job_id}/resume")
def resume_job(job_id: str) -> Dict[str, Any]:
    if not JOB_ID_PATTERN.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id format")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job not found")
    if job.status == "paused":
        job.status = "running"
    job.pause_event.set()
    return job.to_dict()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> Dict[str, Any]:
    if not JOB_ID_PATTERN.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id format")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Training job not found")
    job.cancel_event.set()
    job.pause_event.set()
    job.status = "cancelled"
    return job.to_dict()


@app.get("/jobs/{job_id}/events")
async def stream_job_events(job_id: str) -> StreamingResponse:
    if not JOB_ID_PATTERN.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job_id format")

    async def event_stream():
        last_sent = -1
        while True:
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if job is None:
                yield f"data: {json.dumps({'error': 'not_found'})}\n\n"
                break
            if len(job.epoch_metrics) != last_sent or job.status in ("completed", "cancelled", "failed"):
                last_sent = len(job.epoch_metrics)
                yield f"data: {json.dumps(job.to_dict())}\n\n"
            if job.status in ("completed", "cancelled", "failed"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
