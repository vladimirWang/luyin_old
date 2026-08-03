import unittest
from datetime import datetime, timedelta, timezone

from backend.app.scoping import is_all_scope, resolve_auto_scope, unique_ids


class ScopingTests(unittest.TestCase):
    def rows(self):
        return [
            {
                "id": "today-alpha-zhang",
                "name": "Alpha 项目晨会",
                "folder_name": "Alpha 项目",
                "folder_id": "folder-alpha",
                "speaker_name": "张三",
                "speaker_map": {},
                "tag": "客户反馈",
                "created_at": datetime(2026, 7, 1, 9, 0),
            },
            {
                "id": "last-week-beta",
                "name": "Beta 风险复盘",
                "folder_name": "Beta 项目",
                "folder_id": "folder-beta",
                "speaker_name": "李四",
                "speaker_map": {},
                "tag": "风险",
                "created_at": datetime(2026, 6, 24, 10, 0),
            },
            {
                "id": "last-week-alpha-wang",
                "name": "Alpha 客户访谈",
                "folder_name": "Alpha 项目",
                "folder_id": "folder-alpha",
                "speaker_name": "说话人 1",
                "speaker_map": {"speaker-1": "王五"},
                "tag": "访谈",
                "created_at": datetime(2026, 6, 25, 14, 0),
            },
        ]

    def test_unique_ids_keeps_order_and_drops_blank_values(self):
        self.assertEqual(unique_ids([" a ", "", "b", "a", None, "c"]), ["a", "b", "c"])

    def test_all_scope_matches_explicit_words_or_request_flag(self):
        self.assertTrue(is_all_scope("帮我看全部会议有什么风险"))
        self.assertTrue(is_all_scope("今天", "ALL"))
        self.assertFalse(is_all_scope("今天会议有什么风险"))

    def test_auto_scope_defaults_to_today_when_question_has_no_range_clue(self):
        result = resolve_auto_scope("客户反馈里有哪些风险", self.rows(), datetime(2026, 7, 1, 12, 0))

        self.assertEqual(result.key, "today")
        self.assertEqual(result.label, "今天（默认）")
        self.assertEqual([row["id"] for row in result.recordings], ["today-alpha-zhang"])

    def test_auto_scope_understands_last_week(self):
        result = resolve_auto_scope("上周客户反馈里有哪些风险", self.rows(), datetime(2026, 7, 1, 12, 0))

        self.assertEqual(result.key, "last-week")
        self.assertEqual(result.label, "上周")
        self.assertEqual([row["id"] for row in result.recordings], ["last-week-beta", "last-week-alpha-wang"])

    def test_auto_scope_combines_yesterday_and_today(self):
        rows = [
            {"id": "yesterday", "created_at": datetime(2026, 6, 30, 9, 0)},
            {"id": "today", "created_at": datetime(2026, 7, 1, 9, 0)},
            {"id": "older", "created_at": datetime(2026, 6, 29, 9, 0)},
        ]

        result = resolve_auto_scope("昨天和今天开了什么会", rows, datetime(2026, 7, 1, 12, 0))

        self.assertEqual(result.key, "yesterday+today")
        self.assertEqual(result.label, "昨天和今天")
        self.assertEqual([row["id"] for row in result.recordings], ["yesterday", "today"])

    def test_auto_scope_combines_date_project_and_speaker_terms(self):
        result = resolve_auto_scope("上周 Alpha 项目王五说了什么", self.rows(), datetime(2026, 7, 1, 12, 0))

        self.assertEqual(result.key, "last-week+metadata")
        self.assertIn("上周", result.label)
        self.assertIn("项目：Alpha 项目", result.label)
        self.assertIn("成员：王五", result.label)
        self.assertEqual([row["id"] for row in result.recordings], ["last-week-alpha-wang"])

    def test_auto_scope_can_match_recording_name_without_date(self):
        result = resolve_auto_scope("Beta 风险复盘结论是什么", self.rows(), datetime(2026, 7, 1, 12, 0))

        self.assertEqual(result.key, "metadata")
        self.assertIn("录音：Beta 风险复盘", result.label)
        self.assertEqual([row["id"] for row in result.recordings], ["last-week-beta"])

    def test_auto_scope_uses_tag_project_when_mobile_record_has_no_folder(self):
        rows = [{
            "id": "mobile-project",
            "name": "方案讨论",
            "folder_id": None,
            "tag": "户型优化 / 产品力",
            "speaker_name": "speaker-1",
            "created_at": datetime(2026, 7, 1, 9, 0),
        }]

        result = resolve_auto_scope("户型优化项目有什么结论", rows, datetime(2026, 7, 1, 12, 0))

        self.assertEqual(result.key, "metadata")
        self.assertIn("项目：户型优化", result.label)
        self.assertEqual([row["id"] for row in result.recordings], ["mobile-project"])

    def test_today_scope_uses_business_timezone_for_utc_database_values(self):
        rows = [
            {"id": "beijing-today", "created_at": datetime(2026, 6, 30, 16, 30, tzinfo=timezone.utc)},
            {"id": "beijing-yesterday", "created_at": datetime(2026, 6, 30, 15, 59, tzinfo=timezone.utc)},
            {"id": "beijing-tomorrow", "created_at": datetime(2026, 7, 1, 16, 0, tzinfo=timezone.utc)},
        ]
        china_timezone = timezone(timedelta(hours=8), "Asia/Shanghai")

        result = resolve_auto_scope(
            "今天有哪些会议",
            rows,
            datetime(2026, 6, 30, 17, 0, tzinfo=timezone.utc),
            china_timezone,
        )

        self.assertEqual([row["id"] for row in result.recordings], ["beijing-today"])


if __name__ == "__main__":
    unittest.main()
