from fastapi import FastAPI, Form, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from qdrant_client import QdrantClient
import os
from litellm import acompletion, aembedding
import asyncio
import json
import re
import logging
from typing import List, Dict, Any, Optional
import base64

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

async def rewrite_query_multimodal(question: str, chat_history: List[Dict[str, Any]], image_bytes: Optional[bytes] = None, image_content_type: Optional[str] = None) -> str:
    """
    Rewrites the user's query into a self-contained search query based on chat history and image context.
    """
    if not chat_history and not image_bytes:
        return question

    history_str = "\n".join([f'{msg["role"]}: {msg["content"]}' for msg in chat_history])
    
    prompt = f"""
        당신은 사용자의 질문을 분석하여 최적의 검색어로 재작성하는 전문가입니다.
        주어진 대화 기록, 사용자의 마지막 질문, 그리고 첨부된 이미지를 모두 종합적으로 고려하여,
        문서 검색에 가장 적합한 하나의 독립적인 검색어를 만들어주세요.

        - 이미지가 있다면, 이미지의 핵심 내용을 텍스트로 변환하여 질문에 통합하세요.
        - 대화 기록이 있다면, 그 맥락을 반영하여 질문을 구체화하세요.
        - 최종 결과는 오직 검색어 자체만이어야 합니다.

        예시 1:
        - 대화 기록: "광합성에 대해 알려줘."
        - 사용자 질문: "캘빈 회로는 뭐야?"
        - 재작성된 검색어: "광합성에서의 캘빈 회로"

        예시 2:
        - 대화 기록: 없음
        - 사용자 질문: "이거 풀어줘"
        - 이미지: "x^2 + 5x + 6 = 0" 이라는 수식이 적힌 이미지
        - 재작성된 검색어: "이차방정식 x^2 + 5x + 6 = 0의 해법"

        ---
        대화 기록:
        {history_str}
        ---
        사용자 질문: {question}
        ---
        재작성된 검색어:
    """

    user_content = [{"type": "text", "text": prompt}]
    if image_bytes and image_content_type:
        base64_image = base64.b64encode(image_bytes).decode("utf-8")
        user_content.append({"type": "image_url", "image_url": {"url": f"data:{image_content_type};base64,{base64_image}"}})

    messages = [{"role": "user", "content": user_content}]
    
    logging.info("멀티모달 질문 재작성 중...")
    try:
        response = await acompletion(
            model="gemini/gemini-2.5-pro-preview-06-05",
            messages=messages,
            max_tokens=200,
        )
        rewritten_question = response.choices[0].message.content.strip()
        logging.info(f"재작성된 검색어: {rewritten_question}")
        return rewritten_question
    except Exception as e:
        logging.error(f"멀티모달 질문 재작성 중 오류 발생: {e}")
        return question # Fallback to the original question

@app.get("/")
async def root():
    return {"message": "Server is running"}

async def stream_answer(query: str, chat_history_str: str, image_bytes: Optional[bytes] = None, image_content_type: Optional[str] = None):
    try:
        chat_history = json.loads(chat_history_str)
        logging.info(f"질문 수신: {query}, 대화 기록 수: {len(chat_history)}, 이미지: {'있음' if image_bytes else '없음'}")

        # Step 1: Rewrite query multimodally
        yield json.dumps({"type": "status", "data": "질문을 분석하고 검색어를 생성하는 중..."}) + "\n"
        standalone_question = await rewrite_query_multimodal(query, chat_history, image_bytes, image_content_type)
        
        # Step 2: Search documents
        yield json.dumps({"type": "status", "data": f"'{standalone_question}'(으)로 관련 문서를 찾는 중..."}) + "\n"
        embedding_result = (await aembedding("text-embedding-3-small", standalone_question)).data[0]["embedding"]

        logging.info(f"Qdrant에서 '{standalone_question}'(으)로 검색 중...")
        search_result = qdrant_client.search(
            collection_name="textbook",
            query_vector={"name": "text", "vector": embedding_result},
            limit=5,
            with_payload=True
        )
        logging.info(f"{len(search_result)}개의 문서를 찾았습니다.")

        rag_info = [f"[{i+1}] {scored_point.payload.get('text', '')}" for i, scored_point in enumerate(search_result)]
        original_sources = [
            {
                "subject": scored_point.payload.get("subject", "N/A"),
                "source": scored_point.payload.get("source", "N/A"),
                "page_num": scored_point.payload.get("page", 0),
                "text": scored_point.payload.get("text", "")
            } for scored_point in search_result
        ]
        
        # Step 3: Generate final answer
        yield json.dumps({"type": "status", "data": "문서를 바탕으로 답변을 생성하는 중..."}) + "\n"
        history_str_prompt = "\n".join([f"{msg['role']}: {msg['content']}" for msg in chat_history])

        prompt_text = f"""
            당신은 유용한 AI 어시스턴트입니다. 주어진 이전 대화 기록, 새로 검색된 문서, 그리고 첨부된 이미지를 종합적으로 참고하여 사용자의 마지막 질문에 한국어로 답변하는 학습 도우미가 당신의 임무입니다.
            문서의 내용을 참고할 경우, 반드시 해당 문서의 인덱스를 사용하여 출처를 밝혀야 합니다. 예: [1].
            각 출처는 개별적인 대괄호로 표시해야 합니다. 예: [1] [2].
            주어진 문서 목록에 있는 번호만 인용해야 하며, 절대로 목록에 없는 번호를 만들어내지 마세요.

            이전 대화 기록:
            ---
            {history_str_prompt}
            ---

            새로 검색된 문서:
            ---
            {"\n".join(rag_info)}
            ---

            사용자의 마지막 질문: {query}
        """
        
        image_content_for_prompt = []
        if image_bytes and image_content_type:
            base64_image = base64.b64encode(image_bytes).decode("utf-8")
            image_content_for_prompt.append({"type": "image_url", "image_url": {"url": f"data:{image_content_type};base64,{base64_image}"}})

        user_content = [{"type": "text", "text": prompt_text}] + image_content_for_prompt
        messages = [{"role": "user", "content": user_content}]

        logging.info("LLM을 통해 최종 답변 생성 시작...")
        response = await acompletion(
            model="gemini/gemini-2.5-pro-preview-06-05",
            messages=messages,
            stream=True
        )

        full_answer = ""
        async for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                full_answer += content
                yield json.dumps({"type": "token", "data": content}) + "\n"
                await asyncio.sleep(0.01)
        
        logging.info(f"생성된 전체 답변: {full_answer}")
        
        all_cited_indices = {int(part.strip()) for match in re.finditer(r'\[(.*?)\]', full_answer) for part in match.group(1).split(',') if part.strip().isdigit()}
        
        valid_indices = set(range(1, len(original_sources) + 1))
        cited_valid_indices = all_cited_indices.intersection(valid_indices)
        invalid_indices = all_cited_indices.difference(valid_indices)

        logging.info(f"모든 인용: {all_cited_indices}, 유효 인용: {cited_valid_indices}, 환각 인용: {invalid_indices}")

        cited_sources = []
        for i in sorted(cited_valid_indices):
            source_data = original_sources[i-1]
            source_data['original_index'] = i
            cited_sources.append(source_data)
        
        yield json.dumps({"type": "sources", "data": cited_sources}) + "\n"

        if invalid_indices:
            logging.info(f"환각 인용 정정 신호 전송: {invalid_indices}")
            yield json.dumps({"type": "correction", "data": {"invalid_indices": list(invalid_indices)}}) + "\n"

        logging.info("스트림 완료.")

    except Exception as e:
        logging.error(f"스트림 중 오류 발생: {e}", exc_info=True)
        error_message = f"오류가 발생했습니다: {str(e)}"
        yield json.dumps({"type": "error", "data": error_message}) + "\n"

@app.post("/api/search")
async def ask_question(
    query: str = Form(...),
    chat_history: str = Form("[]"),
    image: Optional[UploadFile] = File(None)
):
    image_bytes, image_content_type = None, None
    if image:
        image_bytes = await image.read()
        image_content_type = image.content_type
    
    return StreamingResponse(stream_answer(query, chat_history, image_bytes, image_content_type), media_type="application/x-ndjson")