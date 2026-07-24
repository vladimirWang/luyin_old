from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timedelta
import json
from pathlib import Path

from backend.app.config import settings
from backend.app.database import acquire, close, connect
from backend.evals.architecture_dataset import build_dataset


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_EXPORT_PATH = Path(__file__).with_name("architecture_dataset.json")


def export_dataset(path: Path = DEFAULT_EXPORT_PATH) -> None:
    path.write_text(
        json.dumps(build_dataset(), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"exported={path.relative_to(ROOT_DIR)}")


async def seed_dataset() -> None:
    if not settings.database_configured:
        raise RuntimeError("MySQL configuration is required to seed the architecture evaluation dataset.")

    dataset = build_dataset()
    anchor = datetime.now(settings.app_timezone).replace(hour=10, minute=0, second=0, microsecond=0)
    await connect()
    try:
        async with acquire() as connection:
            async with connection.transaction():
                for project in dataset["projects"]:
                    await connection.execute(
                        """
                        INSERT INTO recording_folders (id, user_id, name)
                        VALUES ($1, 'default-user', $2) AS incoming
                        ON DUPLICATE KEY UPDATE name = incoming.name, updated_at = now()
                        """,
                        f"eval-folder-{project['id']}",
                        project["name"],
                    )

                for meeting in dataset["meetings"]:
                    created_at = anchor + timedelta(days=int(meeting["dayOffset"]))
                    speaker_map = {role: name for role, name in meeting["speakers"].items()}
                    await connection.execute(
                        """
                        INSERT INTO recordings (
                          id, user_id, folder_id, name, speaker_name, speaker_map, tag,
                          duration_ms, mime_type, file_size, status, transcript_provider,
                          transcript_source, transcribed_at, summary, summary_status,
                          summary_provider, summarized_at, source, created_at, updated_at
                        )
                        VALUES (
                          $1, 'default-user', $2, $3, $4, $5, $6,
                          $7, 'audio/wav', 0, 'transcribed', 'architecture-eval',
                          $8, $9, $10, 'completed',
                          'architecture-eval', $9, $8, $9, now()
                        ) AS incoming
                        ON DUPLICATE KEY UPDATE
                          folder_id = incoming.folder_id,
                          name = incoming.name,
                          speaker_name = incoming.speaker_name,
                          speaker_map = incoming.speaker_map,
                          tag = incoming.tag,
                          duration_ms = incoming.duration_ms,
                          status = incoming.status,
                          transcript_provider = incoming.transcript_provider,
                          transcript_source = incoming.transcript_source,
                          transcribed_at = incoming.transcribed_at,
                          summary = incoming.summary,
                          summary_status = incoming.summary_status,
                          summary_provider = incoming.summary_provider,
                          summarized_at = incoming.summarized_at,
                          source = incoming.source,
                          created_at = incoming.created_at,
                          updated_at = now()
                        """,
                        meeting["id"],
                        f"eval-folder-{meeting['projectId']}",
                        meeting["name"],
                        next(iter(speaker_map.values())),
                        speaker_map,
                        meeting["tag"],
                        meeting["durationMs"],
                        f"architecture-eval:{dataset['version']}",
                        created_at,
                        meeting["summary"],
                    )
                    await connection.execute("DELETE FROM transcript_segments WHERE recording_id = $1", meeting["id"])
                    await connection.executemany(
                        """
                        INSERT INTO transcript_segments (
                          id, recording_id, start_ms, end_ms, text, confidence, speaker_label, emotion
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, $7, '中性')
                        """,
                        [
                            (
                                segment["id"],
                                meeting["id"],
                                segment["startMs"],
                                segment["endMs"],
                                segment["text"],
                                segment["confidence"],
                                segment["speaker"],
                            )
                            for segment in meeting["segments"]
                        ],
                    )
    finally:
        await close()

    print(
        f"seeded_meetings={len(dataset['meetings'])} "
        f"seeded_segments={sum(len(item['segments']) for item in dataset['meetings'])}"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export or seed the architecture QA evaluation dataset.")
    parser.add_argument("--export", action="store_true", help="Write the portable JSON dataset.")
    parser.add_argument("--seed", action="store_true", help="Upsert meetings and transcripts into MySQL.")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    should_export = args.export or not (args.export or args.seed)
    should_seed = args.seed or not (args.export or args.seed)
    if should_export:
        export_dataset()
    if should_seed:
        asyncio.run(seed_dataset())
