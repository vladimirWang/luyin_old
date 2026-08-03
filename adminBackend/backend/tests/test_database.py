from __future__ import annotations

import unittest

from backend.app.database import decode_row, prepare_query, split_sql_statements


class DatabaseAdapterTests(unittest.TestCase):
    def test_prepare_query_reorders_and_serializes_parameters(self) -> None:
        query, params = prepare_query(
            "SELECT * FROM items WHERE second = $2 AND first = $1 AND payload = $3",
            ("one", "two", {"name": "测试"}),
        )

        self.assertEqual(query, "SELECT * FROM items WHERE second = %s AND first = %s AND payload = %s")
        self.assertEqual(params[:2], ("two", "one"))
        self.assertEqual(params[2], '{"name": "测试"}')

    def test_decode_row_parses_known_json_columns(self) -> None:
        row = decode_row({"id": "one", "recording_ids": '["a", "b"]', "summary": '{"overview": "ok"}'})

        self.assertEqual(row["recording_ids"], ["a", "b"])
        self.assertEqual(row["summary"], {"overview": "ok"})

    def test_split_schema_ignores_semicolon_inside_string(self) -> None:
        statements = split_sql_statements("INSERT INTO items VALUES ('a;b'); SELECT 1;")

        self.assertEqual(statements, ["INSERT INTO items VALUES ('a;b')", "SELECT 1"])


if __name__ == "__main__":
    unittest.main()
