import unittest

from backend.app.answers import no_context_warning, no_recordings_answer


class AnswerFallbackTests(unittest.TestCase):
    def test_no_recordings_answer_separates_user_warning_from_machine_reason(self):
        result = no_recordings_answer()

        self.assertIn("没有找到", result.answer)
        self.assertEqual(result.warning, "当前范围没有可分析的录音。")
        self.assertEqual(result.empty_reason, "NO_RECORDINGS")
        self.assertEqual(result.citations, [])

    def test_no_context_warning_is_human_readable(self):
        self.assertIn("暂无可用转写或纪要", no_context_warning())


if __name__ == "__main__":
    unittest.main()
