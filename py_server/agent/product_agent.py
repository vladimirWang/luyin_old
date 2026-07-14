import contextvars
import json

import agent.config_data as config
from agent.product_base import ProductBase
from agent.sqlalchemy_history_store import get_history
from database.models import Product
from database.session import SessionLocal
from langchain_community.chat_models.tongyi import ChatTongyi
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from module_order.order_service import create_order_data, serialize_order
from module_order.order_vo import OrderCreate, OrderItemCreate, OrderItemCreateForPrepare, PrepareOrderMultipleProducts
from sqlalchemy import Integer, column, select, values
from enum import StrEnum

class ProductAgentState(StrEnum):
    BROWSE = 'browse'
    PREPARE = 'prepare'
    SUGGEST = 'suggest'
    AWAIT_CONFIRM = 'await_confirm'

SYSTEM_PROMPT = """你是智能买手，帮助用户查询商品并代购下单。
流程：
1. 用 list_products 查商品，记住返回的 product_id。
2. 用户表达购买意图时，必须调用 prepare_order，使用 list_products 中的 product_id 和对应数量，不要只用文字回复。
3. 如果 prepare_order 返回 missing 或 insufficient，对每个缺货商品调用 search_similar_products(product_id=..., quantity=...)，向用户推荐替代品并询问是否购买；用户同意后重新走流程第二步。
4. 只有用户在下一轮对话中明确表示「确认」「好的」「下单」等时，才调用 confirm_order 真正下单。
5. 禁止在同一轮对话里连续调用 prepare_order 和 confirm_order。"""

# 会话状态
_session_state: dict[str, ProductAgentState] = {}

# 获取设置会话状态
def _get_session_state(session_id: str) -> ProductAgentState:
    return _session_state.get(session_id, ProductAgentState.BROWSE)

def _set_session_state(session_id: str, state: ProductAgentState):
    _session_state[session_id] = state

# 待确认订单
_pending_orders: dict[str, dict] = {}
# 会话ID上下文
_session_id_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "product_agent_session_id", default=None
)


def _current_session_id() -> str:
    session_id = _session_id_ctx.get()
    if session_id is None:
        raise RuntimeError("session_id 未设置")
    return session_id


@tool
def list_products() -> str:
    """列出所有可购商品，返回 id、名称、价格。"""
    with SessionLocal() as db:
        products = db.scalars(select(Product).where(Product.balance > 0).order_by(Product.id)).all()
        data = [{"id": p.id, "name": p.name, "price": p.price, "balance": p.balance} for p in products]
    return json.dumps(data, ensure_ascii=False)

def _serialize_issue_item(
    item: OrderItemCreateForPrepare,
    product_map: dict[int, Product],
) -> dict:
    db_product = product_map.get(item.product_id)
    data = {
        "product_id": item.product_id,
        "quantity": item.quantity,
    }
    if db_product is not None:
        data["name"] = db_product.name
        data["available"] = db_product.balance
    return data

@tool
def prepare_order(items: PrepareOrderMultipleProducts) -> str:
    """生成待确认订单，不真正下单。用户确认后再调用 confirm_order。"""
    if not items.products:
        return json.dumps({"error": "订单商品不能为空"}, ensure_ascii=False)

    with SessionLocal() as db:
        order_request = values(
            column("product_id", Integer),
            column("quantity", Integer),
            name="order_request",
        ).data([(item.product_id, item.quantity) for item in items.products])

        rows = db.execute(
            select(
                order_request.c.product_id,
                order_request.c.quantity.label("requested_qty"),
                Product,
            )
            .select_from(order_request)
            .outerjoin(Product, Product.id == order_request.c.product_id)
        ).all()

        item_by_id = {item.product_id: item for item in items.products}
        product_map: dict[int, Product] = {}
        missing: list[OrderItemCreateForPrepare] = []
        insufficient: list[OrderItemCreateForPrepare] = []

        for product_id, requested_qty, db_product in rows:
            item = item_by_id[product_id]
            if db_product is None:
                missing.append(item)
            elif db_product.balance < requested_qty:
                insufficient.append(item)
                product_map[product_id] = db_product
            else:
                product_map[product_id] = db_product

        if missing or insufficient:
            return json.dumps(
                {
                    "error": "部分商品缺货，无法下单",
                    "missing": [_serialize_issue_item(item, product_map) for item in missing],
                    "insufficient": [_serialize_issue_item(item, product_map) for item in insufficient],
                },
                ensure_ascii=False,
            )

        draft = []
        total_price = 0.0
        for item in items.products:
            db_product = product_map[item.product_id]
            draft.append(
                {
                    "product_id": item.product_id,
                    "product_name": db_product.name,
                    "quantity": item.quantity,
                    "price": db_product.price,
                }
            )
            total_price += db_product.price * item.quantity

        _pending_orders[_current_session_id()] = {
            "items": draft,
            "remark": items.remark or "",
        }
        msg_item = [f"{i['product_name']} x{i['quantity']}，单价 {i['price']}" for i in draft]
        resp = {
            "status": "pending_confirmation",
            "summary": {"items": draft, "total_price": total_price, "remark": items.remark},
            "message": f"请确认： {', '.join(msg_item)}，合计 {total_price}。回复「确认」后下单。",
        }

        return json.dumps(resp, ensure_ascii=False)

@tool
def search_similar_products(product_id: int, quantity: int = 1) -> str:
    """根据缺货商品的 product_id 搜索语义相似的替代品，仅返回库存大于等于 quantity 的商品。"""
    with SessionLocal() as db:
        result = ProductBase().search_similar(
            db,
            reference_product_id=product_id,
            quantity=quantity,
        )
    return json.dumps(result, ensure_ascii=False)


@tool
def confirm_order() -> str:
    """用户确认后，根据待确认订单真正创建订单。"""
    session_id = _current_session_id()
    draft = _pending_orders.get(session_id)
    if draft is None:
        return json.dumps({"error": "没有待确认订单，请先 prepare_order"}, ensure_ascii=False)

    with SessionLocal() as db:
        order = create_order_data(
            OrderCreate(
                items=[
                    OrderItemCreate(
                        product_id=draft_item["product_id"],
                        quantity=draft_item["quantity"],
                        price=draft_item["price"],
                    )
                    for draft_item in draft["items"]
                ],
                remark=draft.get("remark", ""),
            ),
            db,
        )
        result = serialize_order(order)

    del _pending_orders[session_id]
    return json.dumps(result, ensure_ascii=False, default=str)

@tool
def cancel_pending_order() -> str:
    """取消当前订单。"""
    session_id = _current_session_id()
    del _pending_orders[session_id]
    return json.dumps({"message": "订单已取消"}, ensure_ascii=False)

PRODUCT_TOOLS = [list_products, prepare_order, confirm_order, cancel_pending_order, search_similar_products]
_TOOL_MAP = {t.name: t for t in PRODUCT_TOOLS}

# 不同状态对应不同的工具
STATE_TOOLS: dict[ProductAgentState, list] = {
    ProductAgentState.BROWSE: [list_products, prepare_order],
    # ProductAgentState.PREPARE: [prepare_order],
    ProductAgentState.SUGGEST: [search_similar_products, prepare_order, list_products],
    ProductAgentState.AWAIT_CONFIRM: [confirm_order, prepare_order, list_products, cancel_pending_order],
}

STATE_PROMPTS: dict[ProductAgentState, str] = {
    ProductAgentState.BROWSE: """
当前阶段：浏览商品。
- 用户问有什么商品 → 调用 list_products
- 用户要买 → 调用 prepare_order（必须带 product_id 和 quantity）
- 不要调用 confirm_order
""",
    ProductAgentState.SUGGEST: """
当前阶段：缺货推荐。
- prepare_order 已失败，请对 insufficient 里的每个商品调用 search_similar_products
- 向用户展示 alternatives，询问是否换购
- 用户同意换购 → 用新 product_id 再调用 prepare_order
""",
    ProductAgentState.AWAIT_CONFIRM: """
当前阶段：等待用户确认订单。
- 已有待确认订单，向用户复述订单内容
- 仅当用户明确说「确认下单」→ 调用 confirm_order
- 如果用户说还有其他什么商品要买 → 调用 list_products
- 如果用户说 「改单, 修改订单， 修改数量， 再加」→ 调用 prepare_order
- 如果用户说 「取消订单, 取消， 不要了」→ 调用 cancel_pending_order
""",
}

BASE_PROMPT = "你是智能买手，语气简洁友好。禁止在同一轮对话里连续调用 prepare_order 和 confirm_order。"

def build_system_prompt(state: ProductAgentState) -> str:
    return f"{BASE_PROMPT}\n{STATE_PROMPTS[state]}"

def _transition_after_tool(
    session_id: str,
    tool_name: str,
    result: str,
) -> None:
    payload = json.loads(result)

    if tool_name == "prepare_order":
        if payload.get("status") == "pending_confirmation":
            _set_session_state(session_id, ProductAgentState.AWAIT_CONFIRM)
        elif payload.get("error"):
            _set_session_state(session_id, ProductAgentState.SUGGEST)

    elif tool_name == "confirm_order":
        if "error" not in payload:
            _set_session_state(session_id, ProductAgentState.BROWSE)

    elif tool_name == "search_similar_products":
        # 通常保持 SUGGEST，直到 prepare 成功
        pass
    elif tool_name == "cancel_pending_order":
        # _pending_orders.pop(session_id, None)
        # del _pending_orders[session_id]
        _set_session_state(session_id, ProductAgentState.BROWSE)


def run_product_agent(question: str, session_id: str) -> str:
    session_token = _session_id_ctx.set(session_id)
    prepared_this_turn = False
    try:
        state = _get_session_state(session_id)
        history = get_history(session_id)
        human_msg = HumanMessage(content=question)
        turn_messages: list[BaseMessage] = [human_msg]
        messages = [
            SystemMessage(content=build_system_prompt(state)),
            *history.messages,
            human_msg,
        ]
        allowed_tools = STATE_TOOLS[state]
        llm = ChatTongyi(model=config.chat_model_name).bind_tools(allowed_tools)

        for _ in range(5):
            ai_msg = llm.invoke(messages)
            turn_messages.append(ai_msg)
            if not ai_msg.tool_calls:
                history.add_messages(turn_messages)
                return ai_msg.content or "已完成。"

            messages.append(ai_msg)
            for tc in ai_msg.tool_calls:
                if tc["name"] not in {t.name for t in allowed_tools}:
                    result = json.dumps({"error": f"当前阶段 {state} 不允许调用 {tc['name']}"})
                elif tc["name"] == "confirm_order" and prepared_this_turn:
                    result = json.dumps(
                        {"error": "请等待用户在下一条消息中确认后再下单"},
                        ensure_ascii=False,
                    )
                else:
                    tool_fn = _TOOL_MAP[tc["name"]]
                    result = tool_fn.invoke(tc["args"])
                    if tc["name"] == "prepare_order":
                        prepared_this_turn = True
                tool_msg = ToolMessage(content=str(result), tool_call_id=tc["id"], name=tc["name"])
                messages.append(tool_msg)
                turn_messages.append(tool_msg)

                # 工具调用后，更新会话状态
                _transition_after_tool(session_id, tc["name"], result)
                # 工具可能改了状态，重新获取状态
                state = _get_session_state(session_id)  # 工具可能改了状态

            # 工具调用后，重新绑定工具
            allowed_tools = STATE_TOOLS[state]
            llm = ChatTongyi(model=config.chat_model_name).bind_tools(allowed_tools)

    finally:
        _session_id_ctx.reset(session_token)

    return "处理超时，请重试。"
