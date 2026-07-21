import unittest

from backend.app.payloads import provided_fields


class PayloadFieldTests(unittest.TestCase):
    def test_provided_fields_reads_pydantic_v2_field_set(self):
        class Payload:
            model_fields_set = {"folderId", "favorite"}

        self.assertEqual(provided_fields(Payload()), {"folderId", "favorite"})

    def test_provided_fields_reads_pydantic_v1_field_set(self):
        class Payload:
            __fields_set__ = {"folderId"}

        self.assertEqual(provided_fields(Payload()), {"folderId"})

    def test_provided_fields_defaults_to_empty_set(self):
        self.assertEqual(provided_fields(object()), set())


if __name__ == "__main__":
    unittest.main()
