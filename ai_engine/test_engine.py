import os
import tempfile
import unittest
from pathlib import Path

os.environ.setdefault("LOCAL_STORAGE_DIR", tempfile.mkdtemp(prefix="mk_ai_engine_test_"))

try:
    import main as engine_main  # noqa: E402
    HAS_FASTAPI = True
except ModuleNotFoundError as exc:
    engine_main = None  # type: ignore
    HAS_FASTAPI = False
    IMPORT_ERR = str(exc)


@unittest.skipUnless(HAS_FASTAPI, "FastAPI/Pydantic not installed in current Python interpreter")
class TestMkAiEngine(unittest.TestCase):
    def test_detect_hardware_returns_valid_profile(self) -> None:
        hw = engine_main.detect_hardware()
        self.assertGreaterEqual(hw.cpu_count, 1)
        self.assertIn(hw.execution_profile, ("nvidia_gpu", "cpu", "safe_compatibility"))
        if not hw.torch_installed:
            self.assertFalse(hw.cuda_available)

    def test_safe_job_dir_blocks_path_traversal(self) -> None:
        with self.assertRaises(ValueError):
            engine_main._safe_job_dir("../escape")
        with self.assertRaises(ValueError):
            engine_main._safe_job_dir("bad/slash")
        safe = engine_main._safe_job_dir("pyjob_test_123")
        self.assertTrue(safe.exists())
        self.assertTrue(str(safe).startswith(str(engine_main.CHECKPOINT_ROOT) + os.sep))

    def test_fastapi_local_security_and_capabilities(self) -> None:
        try:
            from fastapi.testclient import TestClient  # type: ignore
        except Exception:
            self.skipTest("fastapi TestClient not installed in current Python interpreter")
            return

        prev_token = engine_main.ENGINE_TOKEN
        engine_main.ENGINE_TOKEN = "mk-test-secret-token"
        try:
            client = TestClient(engine_main.app)
            # /health without token returns minimal status without leaking full paths
            r_health = client.get("/health")
            self.assertEqual(r_health.status_code, 200)
            self.assertTrue(r_health.json().get("token_protected"))

            # /capabilities without token must return 401
            r_unauth = client.get("/capabilities")
            self.assertEqual(r_unauth.status_code, 401)

            # External origin must be blocked with 403
            r_bad_origin = client.get(
                "/capabilities",
                headers={
                    "Authorization": "Bearer mk-test-secret-token",
                    "Origin": "https://evil.example.com",
                },
            )
            self.assertEqual(r_bad_origin.status_code, 403)

            # Valid token + local origin succeeds
            r_ok = client.get(
                "/capabilities",
                headers={
                    "Authorization": "Bearer mk-test-secret-token",
                    "Origin": "http://127.0.0.1:3000",
                },
            )
            self.assertEqual(r_ok.status_code, 200)
            self.assertIn("supported_architectures", r_ok.json())
        finally:
            engine_main.ENGINE_TOKEN = prev_token


if __name__ == "__main__":
    unittest.main()
