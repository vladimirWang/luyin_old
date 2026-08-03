import asyncio
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from backend.app.main import remove_file_if_exists, save_upload
from backend.app.upload_limits import content_length_too_large, should_check_upload_body, upload_body_limit


class FakeUpload:
    def __init__(self, chunks):
        self.chunks = list(chunks)
        self.closed = False

    async def read(self, _size):
        if not self.chunks:
            return b""
        return self.chunks.pop(0)

    async def close(self):
        self.closed = True


class UploadTests(unittest.TestCase):
    def test_save_upload_writes_file_within_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "audio.bin"
            upload = FakeUpload([b"abc", b"def"])

            size = asyncio.run(save_upload(upload, target, 6))

            self.assertEqual(size, 6)
            self.assertEqual(target.read_bytes(), b"abcdef")
            self.assertTrue(upload.closed)

    def test_save_upload_rejects_oversized_file_and_removes_partial_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "audio.bin"
            upload = FakeUpload([b"abc", b"def"])

            with self.assertRaises(HTTPException) as context:
                asyncio.run(save_upload(upload, target, 5))

            self.assertEqual(context.exception.status_code, 413)
            self.assertFalse(target.exists())
            self.assertTrue(upload.closed)

    def test_content_length_limit_allows_multipart_overhead(self):
        max_upload_bytes = 10

        self.assertEqual(upload_body_limit(max_upload_bytes), 1_048_586)
        self.assertFalse(content_length_too_large({"content-length": "1048586"}, max_upload_bytes))
        self.assertTrue(content_length_too_large({"content-length": "1048587"}, max_upload_bytes))

    def test_upload_body_check_only_applies_to_upload_routes(self):
        self.assertTrue(should_check_upload_body("POST", "/admin-api/recordings"))
        self.assertTrue(should_check_upload_body("POST", "/admin-api/recordings/segments"))
        self.assertFalse(should_check_upload_body("GET", "/admin-api/recordings"))
        self.assertFalse(should_check_upload_body("POST", "/admin-api/ask"))

    def test_remove_file_if_exists_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "audio.bin"
            target.write_bytes(b"orphan")

            remove_file_if_exists(target)
            remove_file_if_exists(target)

            self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
