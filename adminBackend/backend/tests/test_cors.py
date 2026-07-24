import unittest

from backend.app.config import env_list
from backend.app.cors import cors_options


class CorsTests(unittest.TestCase):
    def test_env_list_parses_comma_separated_origins(self):
        self.assertEqual(
            env_list("MISSING_CORS_TEST_VALUE", "https://admin.example.com, https://m.example.com"),
            ["https://admin.example.com", "https://m.example.com"],
        )

    def test_cors_defaults_to_same_origin_only(self):
        self.assertEqual(
            cors_options([]),
            {
                "allow_origins": [],
                "allow_credentials": False,
                "allow_methods": ["*"],
                "allow_headers": ["*"],
            },
        )

    def test_cors_all_origin_disables_credentials(self):
        self.assertEqual(cors_options(["*"])["allow_credentials"], False)

    def test_cors_explicit_origins_allow_credentials(self):
        result = cors_options(["https://admin.example.com"])
        self.assertEqual(result["allow_origins"], ["https://admin.example.com"])
        self.assertEqual(result["allow_credentials"], True)


if __name__ == "__main__":
    unittest.main()
