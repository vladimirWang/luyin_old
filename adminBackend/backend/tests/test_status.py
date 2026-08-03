import unittest
from types import SimpleNamespace

from backend.app.status import service_health


class ServiceHealthTests(unittest.TestCase):
    def test_health_is_not_ready_without_database_or_admin_auth(self):
        result = service_health(
            SimpleNamespace(
                database_url="",
                admin_configured=False,
                admin_backend_api_key="",
                mobile_internal_api_url="",
                cors_origins=[],
                asr_provider="pending-python-asr",
                summary_model="",
            ),
            database_connected=False,
        )

        self.assertFalse(result["ready"])
        self.assertFalse(result["adminReady"])
        self.assertFalse(result["mobileReady"])
        self.assertFalse(result["checks"]["database"]["configured"])
        self.assertFalse(result["checks"]["adminAuth"]["configured"])
        self.assertFalse(result["checks"]["mobileApi"]["configured"])
        self.assertTrue(result["checks"]["cors"]["sameOriginOnly"])
        self.assertEqual(result["checks"]["timezone"]["name"], "Asia/Shanghai")
        self.assertGreaterEqual(len(result["warnings"]), 3)

    def test_health_is_ready_when_database_is_connected_and_admin_auth_configured(self):
        result = service_health(
            SimpleNamespace(
                database_url="mysql://user:pass@127.0.0.1:3306/wecom_recorder",
                admin_configured=True,
                admin_backend_api_key="gateway-secret",
                mobile_internal_api_url="http://127.0.0.1:3000/api/internal-admin",
                cors_origins=["https://m.example.com"],
                asr_provider="pending-python-asr",
                summary_model="deepseek-v4-flash",
            ),
            database_connected=True,
        )

        self.assertTrue(result["ready"])
        self.assertTrue(result["adminReady"])
        self.assertTrue(result["mobileReady"])
        self.assertTrue(result["checks"]["database"]["connected"])
        self.assertTrue(result["checks"]["mobileApi"]["configured"])
        self.assertEqual(result["checks"]["cors"]["origins"], ["https://m.example.com"])
        self.assertTrue(result["checks"]["asr"]["configured"])
        self.assertEqual(result["checks"]["asr"]["mode"], "mobile-service")
        self.assertTrue(result["checks"]["summary"]["configured"])
        self.assertEqual(result["warnings"], [])

    def test_admin_ready_does_not_hide_missing_mobile_key(self):
        result = service_health(
            SimpleNamespace(
                database_url="mysql://user:pass@127.0.0.1:3306/wecom_recorder",
                admin_configured=True,
                admin_backend_api_key="",
                mobile_internal_api_url="",
                cors_origins=[],
                asr_provider="pending-python-asr",
                summary_model="",
            ),
            database_connected=True,
        )

        self.assertFalse(result["adminReady"])
        self.assertFalse(result["ready"])
        self.assertFalse(result["mobileReady"])


if __name__ == "__main__":
    unittest.main()
