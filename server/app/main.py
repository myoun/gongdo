from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from .model import AskRequest
from qdrant_client import QdrantClient
import os
from litellm import completion, embedding
import asyncio
import json
import re
import logging
from typing import List, Dict, Any

# Logging setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

qdrant_client = QdrantClient(
    url=os.getenv("QDRANT_URL"),
    api_key=os.getenv("QDRANT_API_KEY"),
)

async def rewrite_query(question: str, chat_history: List[Dict[str, Any]]) -> str:
    if not chat_history:
        return question

    history_str = "\n".join([f'{msg['role']}: {msg['content']}' for msg in chat_history])
    
    prompt = f"""
        주어진 대화 기록을 바탕으로, 사용자의 마지막 질문을 독립적으로 검색할 수 있는 완전한 질문으로 재작성하세요.
        사용자의 원래 의도를 보존하되, 이전 대화의 맥락을 포함시켜야 합니다.

        대화 기록:
        ---
        {history_str}
        ---
        
        마지막 질문: {question}
        
        재작성된 질문:
    """
    
    logging.info("질문 재작성 중...")
    response = completion(
        model="gemini/gemini-2.5-pro-preview-06-05",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=100,
    )
    
    rewritten_question = question # Default to original question
    if response.choices and response.choices[0].message.content:
        rewritten_question = response.choices[0].message.content.strip()
    else:
        logging.warning("질문 재작성에 실패하여 원본 질문을 사용합니다.")
    
    logging.info(f"재작성된 질문: {rewritten_question}")
    return rewritten_question

@app.get("/")
async def root():
    return {"message": "Server is running"}

async def stream_answer(request: AskRequest):
    question = request.query
    chat_history = request.chat_history
    
    try:
        logging.info(f"질문 수신: {question}, 대화 기록 수: {len(chat_history)}")
        
        # Step 1: Rewrite query based on history
        standalone_question = await rewrite_query(question, chat_history)
        
        # 1. Status: Searching documents
        yield json.dumps({"type": "status", "data": "관련 문서를 찾는 중..."}) + "\n"
        await asyncio.sleep(0.1)

        embedding_result = embedding("text-embedding-3-small", standalone_question).data[0]["embedding"]

        logging.info(f"Qdrant에서 '{standalone_question}'(으)로 검색 중...")
        search_result = qdrant_client.search(
            collection_name="textbook",
            query_vector={"name": "text", "vector": embedding_result},
            limit=5,
            with_payload=True
        )
        logging.info(f"{len(search_result)}개의 문서를 찾았습니다.")

        rag_info = []
        original_sources = []
        for i, scored_point in enumerate(search_result):
            payload = scored_point.payload
            rag_info.append(f"[{i+1}] {payload.get('text', '')}")
            original_sources.append({
                "subject": payload.get("subject", "N/A"),
                "source": payload.get("source", "N/A"),
                "page_num": payload.get("page", 0),
                "text": payload.get("text", "")
            })
        
        # 2. Status: Generating answer
        yield json.dumps({"type": "status", "data": "답변을 생성하는 중..."}) + "\n"
        await asyncio.sleep(0.1)

        history_str = "\n".join([f"{msg['role']}: {msg['content']}" for msg in chat_history])

        prompt = f"""
            당신은 유용한 AI 어시스턴트입니다. 주어진 이전 대화 기록과 새로운 문서들을 참고하여 사용자의 마지막 질문에 한국어로 답변하는 학습 도우미가 당신의 임무입니다.
            문서의 내용을 참고할 경우, 반드시 해당 문서의 인덱스를 사용하여 출처를 밝혀야 합니다. 예: [1].
            각 출처는 개별적인 대괄호로 표시해야 합니다. 예: [1] [2].
            주어진 문서 목록에 있는 번호만 인용해야 하며, 절대로 목록에 없는 번호를 만들어내지 마세요.

            이전 대화 기록:
            ---
            {history_str}
            ---

            새로 검색된 문서:
            ---
            {"\n".join(rag_info)}
            ---

            사용자의 마지막 질문: {question}
        """

        logging.info("LLM을 통해 최종 답변 생성 시작...")
        response = completion(
            model="gemini/gemini-2.5-pro-preview-06-05",
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        # 3. Stream answer and track citations
        full_answer = ""
        for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                full_answer += content
                yield json.dumps({"type": "token", "data": content}) + "\n"
                await asyncio.sleep(0.01)
        
        logging.info(f"생성된 전체 답변: {full_answer}")
        
        # 4. Analyze and filter citations
        all_cited_indices = set()
        for match in re.finditer(r'\[(.*?)\]', full_answer):
            parts = match.group(1).split(',')
            for part in parts:
                try:
                    index = int(part.strip())
                    all_cited_indices.add(index)
                except ValueError:
                    continue
        
        valid_indices = set(range(1, len(original_sources) + 1))
        cited_valid_indices = all_cited_indices.intersection(valid_indices)
        invalid_indices = all_cited_indices.difference(valid_indices)

        logging.info(f"모든 인용: {all_cited_indices}, 유효 인용: {cited_valid_indices}, 환각 인용: {invalid_indices}")

        cited_sources = []
        for i in sorted(cited_valid_indices):
            source_data = original_sources[i-1]
            source_data['original_index'] = i
            cited_sources.append(source_data)
        
        # 5. Send valid sources
        yield json.dumps({"type": "sources", "data": cited_sources}) + "\n"

        # 6. Send correction signal for hallucinated citations
        if invalid_indices:
            logging.info(f"환각 인용 정정 신호 전송: {invalid_indices}")
            yield json.dumps({"type": "correction", "data": {"invalid_indices": list(invalid_indices)}}) + "\n"

        logging.info("스트림 완료.")

    except Exception as e:
        logging.error(f"스트림 중 오류 발생: {e}", exc_info=True)
        error_message = f"오류가 발생했습니다: {str(e)}"
        yield json.dumps({"type": "error", "data": error_message}) + "\n"

@app.post("/api/search")
async def ask_question(request: AskRequest):
    return StreamingResponse(stream_answer(request), media_type="application/x-ndjson")
