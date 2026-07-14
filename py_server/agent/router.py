import agent.config_data as config
from langchain_community.chat_models.tongyi import ChatTongyi

AGENTS = (
    # "booking", 
    "product", "tcm", "translation"
)

RULES: dict[str, list[str]] = {
    "translation": ["翻译", "translate", "译成", "英文", "中文", "日文"],
    "product": ["购买", "买", "下单", "商品", "代购", "确认"],
    # "booking": ["订票", "机票", "火车", "航班", "酒店", "车票", "买票"],
    "tcm": ["中医", "养生", "调理", "食疗", "穴位", "经络", "体质"],
}


def route_by_rules(question: str) -> str | None:
    q = question.lower()
    for agent, keywords in RULES.items():
        print("agent: ", agent, "keywords: ", keywords)
        if any(kw in q for kw in keywords):
            return agent
    return None


def route_by_llm(question: str) -> str:
    llm = ChatTongyi(model=config.chat_model_name)
    prompt = (
        "将用户问题分类为以下之一，只回复一个词：product、booking、tcm、translation\n"
        # "- booking: 订票、出行、机票火车酒店\n"
        "- product: 购买、买、下单、商品、代购\n"
        "- tcm: 中医、养生、健康调理\n"
        "- translation: 翻译、语言转换\n\n"
        f"用户问题：{question}"
    )
    result = llm.invoke(prompt).content.strip().lower()
    for agent in AGENTS:
        if agent in result:
            return agent
    return "tcm"


def route(question: str) -> str:
    agent = route_by_rules(question)
    if agent:
        print(f"[router] rule -> {agent} {question}")
        return agent
    agent = route_by_llm(question)
    print(f"[router] llm -> {agent} {question}")
    return agent
