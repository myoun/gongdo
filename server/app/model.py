from pydantic import BaseModel, Field
from typing import List

class AskRequest(BaseModel):
    query: str

class Citation(BaseModel):
    source_index: int = Field(description="참고한 문서의 1-based 인덱스")
    text: str = Field(description="답변의 근거가 되는 문서의 내용")

class Answer(BaseModel):
    answer: str = Field(description="사용자의 질문에 대한 답변")
    sources: List[Citation] = Field(description="답변에 사용된 출처 목록")
