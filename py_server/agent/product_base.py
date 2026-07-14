import agent.config_data as config
from agent.pgvector_store import delete_by_ids, get_pgvector_store
from database.models import Product
from sqlalchemy import select
from sqlalchemy.orm import Session


def _embedding_text(product: Product) -> str:
    return f"{product.name} {product.description}".strip()


class ProductBase:
    def __init__(self):
        self.vector_store = get_pgvector_store(config.products_collection_name)

    def delete_product_vector(self, product: Product):
        if product.vector_ids:
            print(f"删除 产品 {product.name} 向量 {product.vector_ids}")
            deleted_count = delete_by_ids(self.vector_store, product.vector_ids)
            print(f"删除 产品 {product.name} 向量 {deleted_count} 条向量")
            return deleted_count
        return 0

    def update_product_vector(self, product: Product, db: Session):
        if product.vector_ids:
            deleted_count = delete_by_ids(self.vector_store, product.vector_ids)
            print(f"删除 产品 {product.name} 向量 {deleted_count} 条向量")
        return self.create_product_vector(product)

    def create_product_vector(self, product: Product) -> list[str]:
        # if product.vectorized:
        #     return f"产品 {product.name} 已向量化"
        if not product.id:
            raise ValueError("产品id不能为空")
        embedding_txt = _embedding_text(product)
        ids = self.vector_store.add_texts(
            [embedding_txt],
            metadatas=[
                {
                    "product_id": product.id,
                    "product_name": product.name,
                    "product_price": product.price,
                }
            ],
        )
        print(f"新增 产品 {product.name} 向量 {len(ids)} 条向量 {ids}, ids.length: {len(ids)}")
        # return f"产品 {product.name} 向量化成功"
        return ids

    def search_similar(
        self,
        db: Session,
        *,
        reference_product_id: int | None = None,
        query: str | None = None,
        quantity: int = 1,
        k: int | None = None,
    ) -> dict:
        if reference_product_id is not None:
            ref = db.get(Product, reference_product_id)
            if ref is None:
                return {
                    "error": f"商品 {reference_product_id} 不存在",
                    "reference_product_id": reference_product_id,
                    "alternatives": [],
                }
            query_text = _embedding_text(ref)
            exclude_id = reference_product_id
            reference_name = ref.name
        elif query and query.strip():
            query_text = query.strip()
            exclude_id = None
            reference_name = None
        else:
            return {"error": "请提供 product_id 或 query", "alternatives": []}

        fetch_k = k or config.search_kwargs
        docs_with_scores = self.vector_store.similarity_search_with_score(
            query_text,
            k=fetch_k + 5,
        )

        candidate_ids: list[int] = []
        score_map: dict[int, float] = {}
        for doc, score in docs_with_scores:
            raw_id = (doc.metadata or {}).get("product_id")
            if raw_id is None:
                continue
            pid = int(raw_id)
            if exclude_id is not None and pid == exclude_id:
                continue
            if pid in score_map:
                continue
            candidate_ids.append(pid)
            score_map[pid] = float(score)

        if not candidate_ids:
            return {
                "reference_product_id": reference_product_id,
                "reference_name": reference_name,
                "quantity": quantity,
                "alternatives": [],
            }

        products = db.scalars(
            select(Product).where(
                Product.id.in_(candidate_ids),
                Product.balance >= quantity,
            )
        ).all()
        product_by_id = {p.id: p for p in products}

        alternatives: list[dict] = []
        for pid in candidate_ids:
            product = product_by_id.get(pid)
            if product is None:
                continue
            alternatives.append(
                {
                    "id": product.id,
                    "name": product.name,
                    "price": product.price,
                    "balance": product.balance,
                    "score": score_map[pid],
                }
            )
            if len(alternatives) >= fetch_k:
                break

        return {
            "reference_product_id": reference_product_id,
            "reference_name": reference_name,
            "quantity": quantity,
            "alternatives": alternatives,
        }
