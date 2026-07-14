from functools import lru_cache

from langchain_community.embeddings import DashScopeEmbeddings
from langchain_postgres import PGVector
from sqlalchemy import select

import agent.config_data as config
from base_config.database import SYNC_SQLALCHEMY_DATABASE_URL


def get_embeddings() -> DashScopeEmbeddings:
    return DashScopeEmbeddings(model=config.embedding_model)


@lru_cache
def get_pgvector_store(collection_name: str) -> PGVector:
    """获取 PGVector 向量库单例（与 ruoyi-fastapi 共用 PostgreSQL）。"""
    print("SYNC_SQLALCHEMY_DATABASE_URL: ", SYNC_SQLALCHEMY_DATABASE_URL)
    return PGVector(
        embeddings=get_embeddings(),
        collection_name=collection_name,
        connection=SYNC_SQLALCHEMY_DATABASE_URL,
        use_jsonb=True,
        embedding_length=config.embedding_length,
        create_extension=True,
    )

def delete_by_logical_source(store: PGVector, file_id: str) -> int:
    """删除同一逻辑文件的历史向量（含旧版带时间戳的 source）。"""
    ids_to_delete: list[str] = []
    with store._make_sync_session() as session:
        collection = store.get_collection(session)
        if not collection:
            return 0
        rows = session.execute(
            select(store.EmbeddingStore.id, store.EmbeddingStore.cmetadata).where(
                # 找到对应的collection
                store.EmbeddingStore.collection_id == collection.uuid
            )
        ).all()
        for row_id, cmetadata in rows:
            print(f"cmetadata: {cmetadata}, row_id: {row_id}", )
            src = (cmetadata or {}).get('source') or ''
            print(f"src: {src}, file_id: {file_id}")
            if src == file_id:
                ids_to_delete.append(row_id)

    if ids_to_delete:
        store.delete(ids=ids_to_delete, collection_only=True)
    return len(ids_to_delete)

def delete_by_ids(store: PGVector, vector_ids: list[str]) -> int:
    """返回实际删除的数量"""
    try:
        store.delete(ids=vector_ids, collection_only=True)
        # 删除后验证
        with store._make_sync_session() as session:
            collection = store.get_collection(session)
            if not collection:
                return len(vector_ids)
            remaining = session.execute(
                select(store.EmbeddingStore.id).where(
                    store.EmbeddingStore.collection_id == collection.uuid,
                    store.EmbeddingStore.id.in_(vector_ids)
                )
            ).scalars().all()
            return len(vector_ids) - len(remaining)
    except Exception as e:
        print(f"删除向量失败: {e}")
        return 0
    