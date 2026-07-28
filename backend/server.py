from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator
import os
from dotenv import load_dotenv
from typing import Optional, List, Dict
import json
import re
import uuid
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError
from context import prompt
from rate_limit import get_usage, reserve_slot, release_slot, DAILY_CHAT_LIMIT

load_dotenv()

app = FastAPI(title="Vitor Alves Digital Twin API")

origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

bedrock_client = boto3.client(
    service_name="bedrock-runtime",
    region_name=os.getenv("DEFAULT_AWS_REGION", "us-east-1"),
)

BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "us.amazon.nova-micro-v1:0")
USE_S3 = os.getenv("USE_S3", "false").lower() == "true"
S3_BUCKET = os.getenv("S3_BUCKET", "")
MEMORY_DIR = os.getenv("MEMORY_DIR", "../memory")
MAX_MESSAGE_LENGTH = int(os.getenv("MAX_MESSAGE_LENGTH", "1000"))
SESSION_ID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
INJECTION_PATTERNS = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)",
        r"disregard\s+(all\s+)?(previous|prior|above)",
        r"you\s+are\s+now\s+(dan|jailbroken|unrestricted)",
    ]
]

if USE_S3:
    s3_client = boto3.client("s3")


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=MAX_MESSAGE_LENGTH)
    session_id: Optional[str] = Field(default=None, max_length=36)

    @field_validator("message")
    @classmethod
    def validate_message(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Message cannot be empty")
        if any(ord(ch) < 9 or (13 < ord(ch) < 32) for ch in cleaned):
            raise ValueError("Message contains unsupported control characters")
        if any(pattern.search(cleaned) for pattern in INJECTION_PATTERNS):
            raise ValueError("Message rejected by content guardrails")
        return cleaned

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        if not SESSION_ID_PATTERN.match(value):
            raise ValueError("session_id must be a valid UUID")
        return value


class ChatResponse(BaseModel):
    response: str
    session_id: str
    remaining: int
    daily_limit: int


def get_memory_path(session_id: str) -> str:
    return f"{session_id}.json"


def load_conversation(session_id: str) -> List[Dict]:
    if USE_S3:
        try:
            response = s3_client.get_object(Bucket=S3_BUCKET, Key=get_memory_path(session_id))
            return json.loads(response["Body"].read().decode("utf-8"))
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return []
            raise
    file_path = os.path.join(MEMORY_DIR, get_memory_path(session_id))
    if os.path.exists(file_path):
        with open(file_path, "r") as f:
            return json.load(f)
    return []


def save_conversation(session_id: str, messages: List[Dict]):
    if USE_S3:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=get_memory_path(session_id),
            Body=json.dumps(messages, indent=2),
            ContentType="application/json",
        )
        return
    os.makedirs(MEMORY_DIR, exist_ok=True)
    file_path = os.path.join(MEMORY_DIR, get_memory_path(session_id))
    with open(file_path, "w") as f:
        json.dump(messages, f, indent=2)


def call_bedrock(conversation: List[Dict], user_message: str) -> str:
    messages = []
    for msg in conversation[-20:]:
        role = msg.get("role")
        content = msg.get("content", "")
        if role not in ("user", "assistant") or not isinstance(content, str):
            continue
        messages.append({"role": role, "content": [{"text": content[:MAX_MESSAGE_LENGTH]}]})

    messages.append({"role": "user", "content": [{"text": user_message}]})

    try:
        response = bedrock_client.converse(
            modelId=BEDROCK_MODEL_ID,
            system=[{"text": prompt()}],
            messages=messages,
            inferenceConfig={
                "maxTokens": 1000,
                "temperature": 0.7,
                "topP": 0.9,
            },
        )
        text = extract_bedrock_text(response)
        if not text:
            raise HTTPException(status_code=502, detail="Empty response from Bedrock")
        return text
    except HTTPException:
        raise
    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        error_message = e.response["Error"].get("Message", str(e))
        print(f"Bedrock ClientError [{error_code}]: {error_message}")
        if error_code == "ValidationException":
            raise HTTPException(
                status_code=400,
                detail="Bedrock rejected the request. Check the model ID (use an inference profile, e.g. us.amazon.nova-micro-v1:0).",
            )
        if error_code == "AccessDeniedException":
            raise HTTPException(status_code=403, detail="Access denied to Bedrock model")
        raise HTTPException(status_code=500, detail="Bedrock request failed")


def extract_bedrock_text(response: dict) -> str:
    content = (
        response.get("output", {})
        .get("message", {})
        .get("content", [])
    )
    chunks = []
    for part in content:
        if isinstance(part, dict) and isinstance(part.get("text"), str):
            text = part["text"].strip()
            if text:
                chunks.append(text)
    return "\n".join(chunks).strip()


@app.get("/")
async def root():
    return {
        "message": "Vitor Alves Digital Twin API",
        "memory_enabled": True,
        "storage": "S3" if USE_S3 else "local",
        "ai_model": BEDROCK_MODEL_ID,
        "daily_chat_limit": DAILY_CHAT_LIMIT,
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "use_s3": USE_S3,
        "bedrock_model": BEDROCK_MODEL_ID,
    }


@app.get("/quota")
async def quota():
    return get_usage()


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    remaining = reserve_slot()
    session_id = request.session_id or str(uuid.uuid4())
    completed = False

    try:
        conversation = load_conversation(session_id)
        assistant_response = call_bedrock(conversation, request.message)

        conversation.append(
            {
                "role": "user",
                "content": request.message,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        conversation.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        save_conversation(session_id, conversation)
        completed = True

        return ChatResponse(
            response=assistant_response,
            session_id=session_id,
            remaining=remaining,
            daily_limit=DAILY_CHAT_LIMIT,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Chat request failed")
    finally:
        if not completed:
            release_slot()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
