from datetime import datetime
import copy
from langchain_text_splitters import RecursiveCharacterTextSplitter
import mimetypes
import agent.config_data as config
from agent.pgvector_store import get_pgvector_store, delete_by_logical_source
from langchain_community.document_loaders import PyPDFLoader
from utils.file import get_local_file, read_filepath_bytes_sync
from urllib.parse import urlparse

def load_and_split_pdf(filepath: str, splitter: RecursiveCharacterTextSplitter):
    loader = PyPDFLoader(filepath)
    docs = loader.load()  # 每页一个 Document，带 page 等 metadata
    result = splitter.split_documents(docs)
    # print("---------------pdf_chunks----------: ", len(docs), len(result), result)
    return result


class KnowledgeBase:
    def __init__(self):
        self.vector_store = get_pgvector_store(config.documents_collection_name)
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_overlap=config.chunk_overlap,
            chunk_size=config.chunk_size,
            length_function=len,
            separators=config.separators,
        )

    def add_knowledge(self, filepath: str, file_id: int, operator: int):
        path = urlparse(filepath).path if filepath.startswith(("http://", "https://")) else filepath
        mime_type, _ = mimetypes.guess_type(path)
        file_content = ''
        if mime_type != 'text/plain':
            if mime_type == 'application/pdf':
                pdf_chunks = load_and_split_pdf(filepath, self.splitter)
                for chunk in pdf_chunks:
                    file_content += " "+chunk.page_content
                    # print("---------------pdf_chunk----------: ", chunk)
                # print("---------------pdf----------: ", filepath, pdf_chunks)
        else:
            byte_content = read_filepath_bytes_sync(filepath)
            file_content = byte_content.decode("utf-8")
            # print("file_content: ", file_content)
        # print("---------------bytes----------: ", mime_type, bytes.decode("utf-8"), bytes)
        deleted_count = delete_by_logical_source(self.vector_store, str(file_id))
        
        chunks = []
        if len(file_content) > config.chunk_overlap:
            chunks = self.splitter.split_text(file_content)
        else:
            chunks = [file_content]
        metadata = {
            "file_id": file_id,
            "operator": operator,
            "source": str(file_id),
        }
        ids = self.vector_store.add_texts(chunks, metadatas=[copy.deepcopy(metadata) for _ in chunks])
        print(f"新增 {len(chunks)} 条向量 {ids}, ids.length: {len(ids)}")
        
        # print(f"chunks: {chunks}, str: {str}, file_id: {file_id}, operator: {operator}")
        return {
            "ids": ids,
            "deleted_count": deleted_count, # 删除的向量数量
            "added_count": len(chunks), # 新增的向量数量
            "is_update": deleted_count > 0, # 是否更新
            "addleted_count": len(chunks) - deleted_count if deleted_count > 0 else 0, # 当对已向量化后的文件再次向量化时，新增的向量数量 - 删除的向量数量
        }

    def delete_knowledge(self, knowledge: str):
        self.knowledge_base.remove(knowledge)

    def update_knowledge(self, knowledge: str):
        self.knowledge_base.append(knowledge)

    def get_knowledge(self):
        return self.knowledge_base
