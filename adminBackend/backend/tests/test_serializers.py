import unittest

from backend.app.serializers import public_recording


class SerializerTests(unittest.TestCase):
    def test_transcript_url_exists_when_segments_are_stored_in_database(self):
        recording = {
            "id": "rec-1",
            "seq": 1,
            "name": "会议录音",
            "speaker_name": "说话人 1",
            "speaker_map": {},
            "duration_ms": 1000,
            "mime_type": "audio/mpeg",
            "file_size": 42,
            "status": "uploaded",
            "summary_status": "idle",
        }
        segments = [{
            "id": "seg-1",
            "start_ms": 0,
            "end_ms": 1000,
            "text": "讨论了项目风险。",
            "speaker_label": "speaker-1",
        }]

        result = public_recording(recording, segments)

        self.assertEqual(result["transcriptUrl"], "/admin-api/recordings/rec-1/transcript.txt")
        self.assertEqual(result["transcriptText"], "讨论了项目风险。")

    def test_recording_exposes_mobile_taxonomy_and_uploader_metadata(self):
        result = public_recording({
            "id": "rec-2",
            "name": "户型评审",
            "tag": "户型优化 / 产品力",
            "folder_name": "建筑设计项目",
            "user_id": "user-1",
            "uploader_name": "王晓宇",
            "uploader_department": "产品与会议",
        }, [])

        self.assertEqual(result["projectName"], "建筑设计项目")
        self.assertEqual(result["category"], "产品力")
        self.assertEqual(result["uploaderName"], "王晓宇")
        self.assertEqual(result["uploaderDepartment"], "产品与会议")


if __name__ == "__main__":
    unittest.main()
