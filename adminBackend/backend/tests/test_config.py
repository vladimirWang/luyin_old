import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from backend.app.config import ROOT_DIR, env_int, parse_env_line, resolve_app_path, resolve_timezone


class ConfigTests(unittest.TestCase):
    def test_parse_env_line_ignores_comments_and_invalid_lines(self):
        self.assertIsNone(parse_env_line("# comment"))
        self.assertIsNone(parse_env_line(""))
        self.assertIsNone(parse_env_line("NO_VALUE"))

    def test_parse_env_line_keeps_urls_and_strips_quotes(self):
        self.assertEqual(
            parse_env_line("DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/wecom_recorder"),
            ("DATABASE_URL", "postgresql://user:pass@127.0.0.1:5432/wecom_recorder"),
        )
        self.assertEqual(parse_env_line("ADMIN_PASSWORD='secret value'"), ("ADMIN_PASSWORD", "secret value"))

    def test_resolve_app_path_keeps_absolute_paths(self):
        absolute = Path("C:/wecom/storage") if ROOT_DIR.drive else Path("/var/lib/wecom/storage")
        self.assertEqual(resolve_app_path(absolute), absolute)

    def test_resolve_app_path_makes_relative_paths_root_based(self):
        self.assertEqual(resolve_app_path("backend/storage"), ROOT_DIR / "backend" / "storage")

    def test_env_int_uses_fallback_for_invalid_values(self):
        self.assertEqual(env_int("MISSING_INT_TEST_VALUE", 42), 42)

    def test_china_timezone_works_without_host_timezone_database(self):
        china = resolve_timezone("Asia/Shanghai")
        utc_value = datetime(2026, 6, 30, 16, 30, tzinfo=timezone.utc)

        self.assertEqual(utc_value.astimezone(china).date().isoformat(), "2026-07-01")
        self.assertEqual(utc_value.astimezone(china).utcoffset(), timedelta(hours=8))


if __name__ == "__main__":
    unittest.main()
