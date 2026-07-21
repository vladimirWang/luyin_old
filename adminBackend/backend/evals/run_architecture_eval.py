from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
import re

from backend.app.llm import build_retrieval_query, select_evidence
from backend.evals.architecture_dataset import build_dataset


def dataset_inputs() -> tuple[dict[str, dict], dict[str, list[dict]]]:
    dataset = build_dataset()
    recordings = {}
    segments = {}
    for meeting in dataset["meetings"]:
        recordings[meeting["id"]] = {
            "id": meeting["id"],
            "name": meeting["name"],
            "tag": meeting["tag"],
            "summary": meeting["summary"],
            "created_at": meeting["dayOffset"],
        }
        segments[meeting["id"]] = [
            {
                "id": item["id"],
                "start_ms": item["startMs"],
                "end_ms": item["endMs"],
                "speaker_label": item["speaker"],
                "text": item["text"],
            }
            for item in meeting["segments"]
        ]
    return recordings, segments


def run_retrieval_eval(limit: int = 12) -> bool:
    dataset = build_dataset()
    recordings_by_id, segments_by_id = dataset_inputs()
    totals = defaultdict(int)
    failures = []
    reciprocal_rank = 0.0

    for case in dataset["evaluations"]:
        selected_recordings = [recordings_by_id[item] for item in case["meetingIds"]]
        selected_segments = {item: segments_by_id[item] for item in case["meetingIds"]}
        query = build_retrieval_query(case["question"], case.get("history") or [], {})
        evidence = select_evidence(
            selected_recordings,
            selected_segments,
            case["question"],
            limit=limit,
            retrieval_query=query,
        )
        result_ids = [item["id"] for item in evidence]
        expected = set(case["expectedEvidenceIds"])
        hits = [index for index, item in enumerate(result_ids, 1) if item in expected]
        passed = bool(hits)
        totals[case["type"]] += int(passed)
        totals[f"{case['type']}:all"] += 1
        reciprocal_rank += 1 / min(hits) if hits else 0
        if not passed:
            failures.append((case["id"], case["question"], result_ids[:5], sorted(expected)))

    count = len(dataset["evaluations"])
    passed_count = count - len(failures)
    print(f"retrieval_recall_at_{limit}={passed_count}/{count}")
    print(f"mean_reciprocal_rank={reciprocal_rank / max(count, 1):.3f}")
    for kind in sorted(key for key in totals if not key.endswith(":all")):
        print(f"{kind}={totals[kind]}/{totals[f'{kind}:all']}")
    for case_id, question, actual, expected in failures:
        print(f"FAILED {case_id}: {question}")
        print(f"  actual={actual}")
        print(f"  expected={expected}")
    return not failures


async def run_live_eval(limit: int, case_ids: list[str] | None = None) -> None:
    from backend.app.llm import answer_meetings

    dataset = build_dataset()
    recordings_by_id, segments_by_id = dataset_inputs()
    selected_cases = dataset["evaluations"]
    if case_ids:
        requested = set(case_ids)
        selected_cases = [case for case in selected_cases if case["id"] in requested]
        missing_cases = requested - {case["id"] for case in selected_cases}
        if missing_cases:
            raise ValueError(f"Unknown evaluation case(s): {', '.join(sorted(missing_cases))}")
    else:
        selected_cases = selected_cases[:limit]
    passed = 0
    for case in selected_cases:
        recordings = [recordings_by_id[item] for item in case["meetingIds"]]
        segments = {item: segments_by_id[item] for item in case["meetingIds"]}
        try:
            result = await answer_meetings(case["question"], recordings, segments, case.get("history") or [])
        except RuntimeError as error:
            print(f"ERROR {case['id']} model_error={error}")
            continue
        normalized_answer = re.sub(r"\s+", "", result.answer)
        missing = []
        for requirement in case["mustMention"]:
            alternatives = [
                re.sub(r"\s+", "", item)
                for item in requirement.split("|")
            ]
            if not any(item in normalized_answer for item in alternatives):
                missing.append(requirement)
        forbidden = [
            term
            for term in case.get("forbiddenMention") or []
            if re.sub(r"\s+", "", term) in normalized_answer
        ]
        citation_ids = {item["segmentId"] for item in result.citations}
        has_expected_citation = bool(citation_ids & set(case["expectedEvidenceIds"]))
        headings = re.findall(r"^##\s+.+$", result.answer, re.M)
        structured = bool(headings and headings[0].strip() == "## 结论" and len(headings) >= 2)
        case_passed = not missing and not forbidden and has_expected_citation and structured
        passed += int(case_passed)
        print(
            f"{'PASS' if case_passed else 'FAIL'} {case['id']} "
            f"missing={missing} forbidden={forbidden} citations={len(citation_ids)} structured={structured}"
        )
        if not case_passed:
            print(f"  answer={result.answer[:500].replace(chr(10), ' ')}")
    print(f"live_answer_eval={passed}/{len(selected_cases)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run architecture meeting QA evaluations.")
    parser.add_argument("--live", action="store_true", help="Also call the configured LLM.")
    parser.add_argument("--live-limit", type=int, default=5)
    parser.add_argument("--live-case", action="append", default=[], help="Run a specific live case by ID.")
    parser.add_argument("--retrieval-limit", type=int, default=12)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    retrieval_ok = run_retrieval_eval(args.retrieval_limit)
    if args.live:
        asyncio.run(run_live_eval(max(1, args.live_limit), args.live_case))
    raise SystemExit(0 if retrieval_ok else 1)
