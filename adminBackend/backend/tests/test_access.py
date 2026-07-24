import unittest
from types import SimpleNamespace

from backend.app.access import ask_requires_admin, qa_history_requires_admin, qa_message_requires_admin


class AccessRulesTests(unittest.TestCase):
    def test_admin_surface_ask_requires_admin(self):
        self.assertTrue(ask_requires_admin(SimpleNamespace(surface="admin", sessionId="", scope="", recordingIds=["rec-1"], recordingId="")))
        self.assertTrue(ask_requires_admin(SimpleNamespace(surface="", sessionId="qa-1", scope="", recordingIds=["rec-1"], recordingId="")))

    def test_broad_ask_requires_admin(self):
        self.assertTrue(ask_requires_admin(SimpleNamespace(surface="mobile", sessionId="", scope="all", recordingIds=[], recordingId="")))
        self.assertTrue(ask_requires_admin(SimpleNamespace(surface="mobile", sessionId="", scope="", recordingIds=[], recordingId="")))

    def test_mobile_ask_with_explicit_recording_scope_can_use_shared_access(self):
        self.assertFalse(ask_requires_admin(SimpleNamespace(surface="mobile", sessionId="", scope="", recordingIds=["rec-1"], recordingId="")))
        self.assertFalse(ask_requires_admin(SimpleNamespace(surface="", sessionId="", scope="", recordingIds=[], recordingId="rec-1")))

    def test_qa_history_admin_surface_requires_admin(self):
        self.assertTrue(qa_history_requires_admin("admin"))
        self.assertFalse(qa_history_requires_admin("mobile"))

    def test_legacy_session_qa_message_requires_admin(self):
        self.assertTrue(qa_message_requires_admin({"session_id": "qa-1"}))
        self.assertFalse(qa_message_requires_admin({"recording_id": "rec-1"}))


if __name__ == "__main__":
    unittest.main()
