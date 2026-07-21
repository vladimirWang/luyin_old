import unittest

from backend.app.llm import build_retrieval_query, select_evidence
from backend.evals.architecture_dataset import build_dataset


class ArchitectureDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = build_dataset()
        cls.meetings = {item["id"]: item for item in cls.dataset["meetings"]}

    def test_dataset_has_rich_projects_transcripts_and_questions(self):
        self.assertEqual(len(self.dataset["projects"]), 3)
        self.assertGreaterEqual(len(self.dataset["meetings"]), 12)
        self.assertGreaterEqual(
            sum(len(item["segments"]) for item in self.dataset["meetings"]),
            120,
        )
        self.assertGreaterEqual(len(self.dataset["evaluations"]), 20)
        self.assertIn("follow-up", {item["type"] for item in self.dataset["evaluations"]})
        self.assertIn("insufficient-evidence", {item["type"] for item in self.dataset["evaluations"]})

    def test_all_expected_evidence_ids_exist(self):
        evidence_ids = {
            segment["id"]
            for meeting in self.dataset["meetings"]
            for segment in meeting["segments"]
        }
        for case in self.dataset["evaluations"]:
            with self.subTest(case=case["id"]):
                self.assertTrue(set(case["expectedEvidenceIds"]).issubset(evidence_ids))

    def test_hybrid_retrieval_finds_expected_evidence_for_every_case(self):
        for case in self.dataset["evaluations"]:
            recordings = []
            segments = {}
            for meeting_id in case["meetingIds"]:
                meeting = self.meetings[meeting_id]
                recordings.append({
                    "id": meeting["id"],
                    "name": meeting["name"],
                    "tag": meeting["tag"],
                    "summary": meeting["summary"],
                })
                segments[meeting_id] = [
                    {
                        "id": item["id"],
                        "start_ms": item["startMs"],
                        "end_ms": item["endMs"],
                        "speaker_label": item["speaker"],
                        "text": item["text"],
                    }
                    for item in meeting["segments"]
                ]
            query = build_retrieval_query(case["question"], case.get("history") or [], {})
            actual = select_evidence(
                recordings,
                segments,
                case["question"],
                limit=12,
                retrieval_query=query,
            )
            actual_ids = {item["id"] for item in actual}

            with self.subTest(case=case["id"]):
                self.assertTrue(actual_ids & set(case["expectedEvidenceIds"]))


if __name__ == "__main__":
    unittest.main()
