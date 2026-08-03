import unittest
from pathlib import Path

from backend.app.qa import qa_history_where_clause, qa_message_matches_surface, qa_surface


class QaSurfaceTests(unittest.TestCase):
    def test_explicit_surface_wins(self):
        self.assertEqual(qa_surface({"surface": "mobile", "session_id": "qa-1"}), "mobile")
        self.assertEqual(qa_surface({"surface": "admin"}), "admin")

    def test_legacy_messages_are_separated_by_session_id(self):
        self.assertTrue(qa_message_matches_surface({"session_id": "qa-1"}, "admin"))
        self.assertFalse(qa_message_matches_surface({"session_id": "qa-1"}, "mobile"))
        self.assertTrue(qa_message_matches_surface({"recording_id": "rec-1"}, "mobile"))

    def test_history_where_clause_keeps_legacy_admin_windows(self):
        sql, surface, favorite_only = qa_history_where_clause("admin", True)

        self.assertEqual(surface, "admin")
        self.assertTrue(favorite_only)
        self.assertIn("COALESCE(surface, '') = ''", sql)
        self.assertIn("$2 = 'admin'", sql)
        self.assertIn("session_id", sql)

    def test_schema_defines_persistent_session_lifecycle(self):
        schema = Path("backend/schema.admin.mysql.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS admin_qa_sessions", schema)
        self.assertIn("status VARCHAR(32)", schema)
        self.assertIn("title_source", schema)


if __name__ == "__main__":
    unittest.main()
