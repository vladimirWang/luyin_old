from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class LocalAnswerResult:
    answer: str
    citations: list[dict[str, Any]]
    context_ids: list[str]
    warning: str = ""
    empty_reason: str = ""


def no_recordings_answer() -> LocalAnswerResult:
    return LocalAnswerResult(
        answer="没有找到符合当前范围的录音。请先选择录音，或在问题里明确说“全部会议”。",
        citations=[],
        context_ids=[],
        warning="当前范围没有可分析的录音。",
        empty_reason="NO_RECORDINGS",
    )


def no_context_warning() -> str:
    return "所选录音暂无可用转写或纪要，暂时只能返回范围说明。"


def local_answer_intro() -> list[str]:
    return [
        "结论：当前 Python FastAPI 后端已经接管问答入口；在 LLM 适配完成前，本回答基于 MySQL 中已有的转写和纪要做本地归纳。",
        "",
        "相关会议：",
    ]
