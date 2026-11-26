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

        prev_token = engine_main._get_engine_token()
        try:
            client = TestClient(engine_main.app)

            # Fail closed with 503 if token is empty/missing
            engine_main._set_engine_token("")
            r_missing_health = client.get("/health")
            self.assertEqual(r_missing_health.status_code, 200)
            self.assertFalse(r_missing_health.json().get("token_configured"))
            self.assertNotIn("hardware", r_missing_health.json())

            r_missing_caps = client.get("/capabilities")
            self.assertEqual(r_missing_caps.status_code, 503)

            # Active valid token enables protected endpoints
            initial_token = "mk_test_initial_secure_token_1234567890"
            engine_main._set_engine_token(initial_token)

            r_health_authed = client.get(
                "/health", headers={"Authorization": f"Bearer {initial_token}"}
            )
            self.assertEqual(r_health_authed.status_code, 200)
            self.assertTrue(r_health_authed.json().get("token_protected"))
            self.assertIn("hardware", r_health_authed.json())

            # /capabilities without token must return 401
            r_unauth = client.get("/capabilities")
            self.assertEqual(r_unauth.status_code, 401)

            # External origin and null origin must be blocked with 403
            r_bad_origin = client.get(
                "/capabilities",
                headers={
                    "Authorization": f"Bearer {initial_token}",
                    "Origin": "https://evil.example.com",
                },
            )
            self.assertEqual(r_bad_origin.status_code, 403)

            r_null_origin = client.get(
                "/capabilities",
                headers={
                    "Authorization": f"Bearer {initial_token}",
                    "Origin": "null",
                },
            )
            self.assertEqual(r_null_origin.status_code, 403)

            # DNS rebinding Host header must be blocked with 403
            r_bad_host = client.get(
                "/capabilities",
                headers={
                    "Authorization": f"Bearer {initial_token}",
                    "Host": "evil.attacker.example:8765",
                },
            )
            self.assertEqual(r_bad_host.status_code, 403)

            # Malformed Bearer token with extra spaces must return 401
            r_malformed = client.get(
                "/capabilities",
                headers={"Authorization": f"Bearer  {initial_token} "},
            )
            self.assertEqual(r_malformed.status_code, 401)

            # Valid token + local origin succeeds
            r_ok = client.get(
                "/capabilities",
                headers={
                    "Authorization": f"Bearer {initial_token}",
                    "Origin": "http://127.0.0.1:3000",
                },
            )
            self.assertEqual(r_ok.status_code, 200)
            self.assertIn("supported_architectures", r_ok.json())

            # Rotating to the identical active token must fail with 400
            r_same_rot = client.post(
                "/security/rotate-token",
                headers={"Authorization": f"Bearer {initial_token}"},
                json={"new_token": initial_token},
            )
            self.assertEqual(r_same_rot.status_code, 400)

            # Live token rotation invalidates previous token and activates new token immediately
            rotated_token = "mk_test_rotated_secure_token_0987654321"
            r_rot = client.post(
                "/security/rotate-token",
                headers={"Authorization": f"Bearer {initial_token}"},
                json={"new_token": rotated_token},
            )
            self.assertEqual(r_rot.status_code, 200)
            self.assertTrue(r_rot.json().get("rotated"))

            r_old_rejected = client.get(
                "/capabilities", headers={"Authorization": f"Bearer {initial_token}"}
            )
            self.assertEqual(r_old_rejected.status_code, 401)

            r_new_accepted = client.get(
                "/capabilities", headers={"Authorization": f"Bearer {rotated_token}"}
            )
            self.assertEqual(r_new_accepted.status_code, 200)
        finally:
            engine_main._set_engine_token(prev_token)


if __name__ == "__main__":
    unittest.main()
