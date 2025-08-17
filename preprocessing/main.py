from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct
import glob
import fitz
import re
import os
from litellm import embedding

QDRANT_URL = os.getenv("QDRANT_URL")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY")

raw_pdf_files = glob.glob("raw/*.pdf")

SUBJECT = "독서"
SOURCE = "고등학교 독서 교과서 (비상 한철우)"

page_num = 0

texts = []
metadatas = []
ids = []
for filename in raw_pdf_files:
    pdf = fitz.open(filename)
    
    for page in pdf:
        page_num += 1
        textpage = page.get_textpage()
        text = textpage.extractText()

        text = text.replace("\n", "").replace("\t", "")
        text = re.sub(r"\s+", " ", text)
        text = re.sub(r"\b\d+\b", "", text)
        text = re.sub(r"[^가-힣a-zA-Z0-9.,!? ]", "", text)

        texts.append(text)
        metadata = { "page" : page_num, "subject" : SUBJECT, "text": text, "source": SOURCE }
        metadatas.append(metadata)    

        ids.append(page_num)

print(f"Vectorizing {len(texts)} texts...")
vectors = list(map(lambda r: r["embedding"], embedding("text-embedding-3-small", texts).data))

qdrant_client = QdrantClient(
    url=QDRANT_URL, 
    api_key=QDRANT_API_KEY,
)

print("Upserting vectors into collection...")
operation_info = qdrant_client.upsert(
    collection_name="textbook",
    points=[
        PointStruct(
            id=id,
            payload=metadata,
            vector={"text": vector}
        )
        for vector, metadata, id in zip(vectors, metadatas, ids)
    ]
)

print(operation_info)