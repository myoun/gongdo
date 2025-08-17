from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from .model import AskRequest
from qdrant_client import QdrantClient
import os
from litellm import embedding, completion
import asyncio
import json
import re

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

@app.get("/")
async def root():
    return {"message": "Server is running"}

async def stream_answer(question: str):
    try:
        # 1. 상태: 문서 검색 중
        yield json.dumps({"type": "status", "data": "관련 문서를 찾는 중..."}) + "\n"
        await asyncio.sleep(0.1)

        embedding_result = embedding("text-embedding-3-small", question).data[0]["embedding"]

        search_result = qdrant_client.search(
            collection_name="textbook",
            query_vector={"name": "text", "vector": embedding_result},
            limit=5,
            with_payload=True
        )

        rag_info = []
        original_sources = []
        for i, scored_point in enumerate(search_result):
            payload = scored_point.payload
            # AI에게는 인용 번호와 순수 텍스트만 제공
            rag_info.append(f"[{i+1}] {payload.get('text', '')}")
            
            # 페이지 번호 등 모든 메타데이터는 백엔드에서만 보관
            original_sources.append({
                "subject": payload.get("subject", "N/A"),
                "source": payload.get("source", "N/A"),
                "page_num": payload.get("page", 0),
                "text": payload.get("text", "")
            })

        print(rag_info)
        print(original_sources)
        
        # 2. 상태: 답변 생성 중
        yield json.dumps({"type": "status", "data": "답변을 생성하는 중..."}) + "\n"
        await asyncio.sleep(0.1)

        prompt = f"""
            당신은 유용한 AI 어시스턴트입니다. 주어진 문서들을 참고하여 사용자의 질문에 한국어로 답변하는 것이 당신의 임무입니다.
            문서의 내용을 참고할 경우, 반드시 해당 문서의 인덱스를 사용하여 출처를 밝혀야 합니다.
            각 출처는 개별적인 대괄호로 표시해야 합니다. 예: '...이것은 사실입니다 [1]. 그리고 저것도 사실입니다 [2].'
            절대로 '[1, 2]'와 같이 하나의 대괄호 안에 여러 번호를 넣지 마세요.
            주어진 문서 목록에 있는 번호만 인용해야 하며, 절대로 목록에 없는 번호를 만들어내지 마세요.

            문서:
            ---
            {"\n\n".join(rag_info)}
            ---

            질문: {question}
        """

        response = completion(
            model="gemini/gemini-2.5-pro-preview-06-05", 
            messages=[{"role": "user", "content": prompt}],
            stream=True
        )

        # 3. 답변 토큰 스트리밍 및 인용 추적
        full_answer = ""
        for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                full_answer += content
                yield json.dumps({"type": "token", "data": content}) + "\n"
                await asyncio.sleep(0.01)
        
        print(full_answer)
        
        # 4. 인용된 출처 분석 및 필터링
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

        cited_sources = []
        for i in sorted(cited_valid_indices):
            source_data = original_sources[i-1]
            source_data['original_index'] = i # Add the original index
            cited_sources.append(source_data)
        
        # 5. 유효한 출처 전송
        yield json.dumps({"type": "sources", "data": cited_sources}) + "\n"

        # 6. 환각 인용 정정 신호 전송
        if invalid_indices:
            yield json.dumps({"type": "correction", "data": {"invalid_indices": list(invalid_indices)}}) + "\n"


    except Exception as e:
        error_message = f"오류가 발생했습니다: {str(e)}"
        yield json.dumps({"type": "error", "data": error_message}) + "\n"


@app.post("/api/search")
async def ask_question(request: AskRequest):
    return StreamingResponse(stream_answer(request.query), media_type="application/x-ndjson")
