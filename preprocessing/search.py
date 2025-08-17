from qdrant_client import QdrantClient
import os
from litellm import embedding, completion

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")


qdrant_client = QdrantClient(
    url=QDRANT_URL, 
    api_key=QDRANT_API_KEY,
)

question = "일본의 한 건축가가 말한 놀이기구의 발전 단계와 그 건축가의 이름은?"
result = embedding("text-embedding-3-small", question).data[0]["embedding"]


search_result = qdrant_client.search(
    collection_name="textbook",
    query_vector={"name": "text", "vector": result},
    limit=30
)

rag_info = []


for scored_point in search_result:
    payload = scored_point.payload
    subject = payload["subject"]
    source = payload["source"]
    text = payload["text"]
    page_num = payload["page"]

    rag_info.append(f"(과목: {subject}, 출처: {source} {page_num}쪽) {text}")


PROMPT = f"""
    아래 문서를 참고하여 질문에 답하고 출처를 남기세요.

    문서 내용:
    ---
    {"\n\n".join(rag_info)}
    ---

    질문: {question}
"""

response = completion("gemini/gemini-2.5-pro-preview-06-05", messages=[
    {"role": "user", "content": PROMPT}
])

print(response.choices[0].message.content)