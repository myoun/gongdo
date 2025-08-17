from pydantic import BaseModel, Field
from typing import List, Dict, Any

class AskRequest(BaseModel):
    query: str
    chat_history: List[Dict[str, Any]] = Field(default_factory=list)
