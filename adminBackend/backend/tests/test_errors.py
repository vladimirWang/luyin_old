import unittest

from backend.app.errors import error_content


class ErrorContentTests(unittest.TestCase):
    def test_string_detail_becomes_error_field(self):
        self.assertEqual(error_content("坏请求"), {"error": "坏请求"})

    def test_dict_detail_preserves_code_and_message(self):
        self.assertEqual(
            error_content({"error": "数据库未配置", "code": "DATABASE_NOT_CONFIGURED"}),
            {"error": "数据库未配置", "code": "DATABASE_NOT_CONFIGURED"},
        )

    def test_dict_detail_accepts_message_alias(self):
        self.assertEqual(error_content({"message": "未登录"}), {"error": "未登录"})


if __name__ == "__main__":
    unittest.main()
