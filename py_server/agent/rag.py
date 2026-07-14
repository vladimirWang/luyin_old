from langchain_community.chat_models.tongyi import ChatTongyi
from langchain_community.embeddings import DashScopeEmbeddings
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompt_values import PromptValue
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnableLambda, RunnablePassthrough
from langchain_core.runnables.history import RunnableWithMessageHistory

import agent.config_data as config
from agent.sqlalchemy_history_store import get_history
from agent.vector_stores import VectorStore


def print_prompt(prompt: PromptValue):
    print("---------以下为提示词---------")
    print(prompt)
    return prompt


class RagService(object):
    def __init__(self, collection_name: str):
        self.prompt_template = ChatPromptTemplate.from_messages(
            [
                ("system", "以我提供的参考资料为主， 如下: {context}"),
                ("system", "这是聊天历史消息， 如下"),
                MessagesPlaceholder("history"),
                ("human", "请回答用户提问: {input}"),
            ],
        )
        self.chat_model = ChatTongyi(model=config.chat_model_name)
        self.vector_store = VectorStore(collection_name)
        self.chain = self.__get_chain()

    def __get_chain(self):
        retriever = self.vector_store.get_retriever()

        def format_func(docs: list[Document]):
            print("------format_func-------", type(docs), len(docs))
            if not docs:
                return "无相关参考资料"
            # print("func_format: ", len(docs))
            result = "".join(doc.page_content for doc in docs)
            print("format_func result: ", result)
            return f"[{result}]"

        def format_for_retriever(value):
            return value["input"]

        def format_prompt(value):
            # print("format_prompt value: ", value)
            return {
                "input": value["input"]["input"],
                "history": value["input"]["history"],
                "context": value["context"],
            }

        chain = (
            {
                "input": RunnablePassthrough(),
                "context": RunnableLambda(format_for_retriever)
                | retriever
                | RunnableLambda(format_func),
            }
            | RunnableLambda(format_prompt)
            # | RunnableLambda(print_prompt)
            | self.prompt_template
            | self.chat_model
            | StrOutputParser()
        )

        conversation_chain = RunnableWithMessageHistory(
            chain,
            get_history,
            input_messages_key="input",
            history_messages_key="history",
        )
        return conversation_chain

if __name__ == "__main__":
    rag = RagService(collection_name="documents")
    session_config = {"configurable": {"session_id": "user_1"}}
    result = rag.chain.invoke({"input": "什么是RAG？"}, session_config)
    print("最终结果.length: ", type(result), len(result))
    # for message in result['messages']:
    #     print("遍历输出: ", message['role'], message['content'])