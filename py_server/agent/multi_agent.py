import agent.config_data as config
from agent.product_agent import run_product_agent
from agent.rag import RagService
from agent.router import route
from langchain_community.chat_models.tongyi import ChatTongyi
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from agent.sqlalchemy_history_store import get_history
# from module_chat.chat_service import get_rag_service
from functools import lru_cache


@lru_cache
def get_rag_service(collection_name: str) -> RagService:
    return RagService(collection_name)

AGENT_LABELS = {
    "booking": "订票",
    "product": "智能买手",
    "tcm": "中医养生",
    "translation": "翻译",
}

PROMPTS = {
    "booking": "你是订票助手，帮助用户查询和预订机票、火车票、酒店。无法真实下单时，说明这是演示并给出操作建议。",
    "product": "你是智能买手，帮助用户查询代购商品。",
    "translation": "你是翻译助手，准确翻译用户提供的文本，并简要说明源语言和目标语言。",
}


def _run_llm_agent(kind: str, question: str, session_id: str) -> str:
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", PROMPTS[kind]), ("human", "{input}"),
            MessagesPlaceholder("history"),
        ]
    )
    chain = prompt | ChatTongyi(model=config.chat_model_name) | StrOutputParser()
    conversation_chain = RunnableWithMessageHistory(
        chain,
        get_history,
        input_messages_key="input",
        history_messages_key="history",
    )
    session_config = {"configurable": {"session_id": session_id}}
    return conversation_chain.invoke({"input": question}, session_config)


def _run_tcm_agent(question: str, session_id: str, rag: RagService) -> str:
    session_config = {"configurable": {"session_id": session_id}}
    return rag.chain.invoke({"input": question}, session_config)


def dispatch(question: str, session_id: str) -> str:
    agent = route(question)
    label = AGENT_LABELS[agent]

    if agent == "tcm":
        print("------ 命中 tcm agent ------")
        rag = get_rag_service(collection_name=config.documents_collection_name)
        answer = _run_tcm_agent(question, session_id, rag)
    elif agent == "product":
        print("------ 命中 product agent ------")
        rag = get_rag_service(collection_name=config.products_collection_name)
        answer = run_product_agent(question, session_id)
    else:
        print("------ 命中 llm agent ------")
        answer = _run_llm_agent(agent, question, session_id)

    return f"【{label} Agent】\n{answer}"
