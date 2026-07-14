"""
极简 Demo：SQLAlchemy + PostgreSQL 存对话 + ChatTongyi
（与 postgres_history_store.py 行为一致，共用 ruoyi-backend 管理的 agent_chat_message 表）

前置：PG_DSN、DASHSCOPE_API_KEY 写在 private_chef_agent/.env.dev
运行：cd private_chef_agent && ./run-sqlalchemy-postgres-chat-demo.sh
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from langchain_community.chat_models.tongyi import ChatTongyi
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.messages import BaseMessage, message_to_dict, messages_from_dict
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from sqlalchemy import BigInteger, DateTime, Integer, create_engine, delete, select
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    Session,
    mapped_column,
)
from database.config import settings
from database.models import ChatSession, AgentChatMessage

engine = create_engine(settings.database_url, pool_pre_ping=True)
logger = logging.getLogger("personal_chief.sqlalchemy_history")


def _coerce_session_id(session_id: str) -> str:
    """校验并规范化 UUID 字符串，与 PostgreSQL uuid 列一致。"""
    return str(UUID(session_id))


def _user_id_for_session(db: Session, session_id: str) -> int:
    sid = _coerce_session_id(session_id)
    user_id = db.scalar(
        select(ChatSession.user_id).where(ChatSession.id == sid)
    )
    if user_id is None:
        raise ValueError(f"ChatSession 不存在: {sid}")
    return user_id


class SqlAlchemyPostgresChatMessageHistory(BaseChatMessageHistory):
    def __init__(self, session_id: str):
        self.session_id = _coerce_session_id(session_id)

    @property
    def messages(self) -> list[BaseMessage]:
        with Session(engine) as db:
            rows = db.scalars(
                select(AgentChatMessage)
                .where(AgentChatMessage.session_id == self.session_id)
                .order_by(AgentChatMessage.id)
            ).all()
        return messages_from_dict([row.payload for row in rows])

    def add_messages(self, messages: list[BaseMessage]) -> None:
        with Session(engine) as db:
            try:
                user_id = _user_id_for_session(db, self.session_id)
                for m in messages:
                    db.add(
                        AgentChatMessage(
                            user_id=user_id,
                            session_id=self.session_id,
                            payload=message_to_dict(m),
                        )
                    )
                db.commit()
            except IntegrityError as e:
                db.rollback()
                logger.warning(
                    "对话历史未写入（session_id=%s）: %s",
                    self.session_id,
                    e.orig,
                )
            except ValueError as e:
                logger.warning("对话历史未写入: %s", e)

    def clear(self) -> None:
        with Session(engine) as db:
            db.execute(
                delete(AgentChatMessage).where(
                    AgentChatMessage.session_id == self.session_id
                )
            )
            db.commit()


def get_history(session_id: str) -> SqlAlchemyPostgresChatMessageHistory:
    return SqlAlchemyPostgresChatMessageHistory(session_id)

