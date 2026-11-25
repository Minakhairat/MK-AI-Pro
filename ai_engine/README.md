# MK AI — Python AI Training Engine (`ai_engine/`)

This service is the independent Computer Vision execution backend for **MK AI by MK Tech**.

## Local Execution

```bash
cd ai_engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Or via Docker Compose from the repository root:

```bash
docker compose up --build ai-engine
```

## Model Licensing Governance

- **TorchVision Backbones (MobileNetV3, EfficientNet, Faster R-CNN)**: BSD-3-Clause — permissive for commercial deployment.
- **Ultralytics YOLO**: AGPL-3.0 open-source license (commercial enterprise license required for closed-source proprietary redistribution). The Model Hub displays model licenses before training and export.
