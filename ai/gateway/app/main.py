import base64
import hashlib
import hmac
import json
import os
import time
import uuid
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from redis import Redis

app = FastAPI(title="NOVA AI Gateway", version="0.1.0")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
TICKET_SECRET = os.getenv("NOVA_JOB_TICKET_SECRET", "")
QUEUE_NAME = "nova:ai:jobs"

class JobRequest(BaseModel):
    ticket: str = Field(min_length=20, max_length=8192)

def decode_ticket(ticket: str) -> dict[str, Any]:
    if not TICKET_SECRET:
        raise HTTPException(503, "Gateway ticket verification is not configured")
    try:
        body, signature = ticket.split(".", 1)
        expected = hmac.new(TICKET_SECRET.encode(), body.encode(), hashlib.sha256).digest()
        supplied = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(expected, supplied):
            raise ValueError("signature")
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if int(payload.get("exp", 0)) < int(time.time()):
            raise ValueError("expired")
        required = ("request_id", "user_id", "source_file_id", "nonce")
        if any(not isinstance(payload.get(k), str) or not payload[k] for k in required):
            raise ValueError("claims")
        return payload
    except Exception:
        raise HTTPException(401, "Invalid or expired job ticket")

@app.get("/health")
def health():
    return {"service": "nova-ai-gateway", "status": "ok"}

@app.get("/ready")
def ready():
    try:
        Redis.from_url(REDIS_URL, socket_connect_timeout=2).ping()
        return {"status": "ready", "queue": "redis"}
    except Exception:
        raise HTTPException(503, "Queue unavailable")

@app.post("/v1/jobs", status_code=202)
def create_job(body: JobRequest, idempotency_key: str = Header(alias="Idempotency-Key", min_length=8, max_length=128)):
    claims = decode_ticket(body.ticket)
    redis = Redis.from_url(REDIS_URL, decode_responses=True)
    idem_key = "nova:ai:idem:" + hashlib.sha256(idempotency_key.encode()).hexdigest()
    existing = redis.get(idem_key)
    if existing:
        return {"job_id": existing, "status": redis.hget("nova:ai:job:" + existing, "status") or "queued"}
    job_id = str(uuid.uuid4())
    job = {
        "job_id": job_id,
        "request_id": claims["request_id"],
        "user_id": claims["user_id"],
        "source_file_id": claims["source_file_id"],
        "status": "queued",
        "created_at": str(int(time.time())),
    }
    pipe = redis.pipeline()
    pipe.hset("nova:ai:job:" + job_id, mapping=job)
    pipe.set(idem_key, job_id, ex=86400)
    pipe.rpush(QUEUE_NAME, json.dumps(job))
    pipe.execute()
    return {"job_id": job_id, "status": "queued"}

@app.get("/v1/jobs/{job_id}")
def get_job(job_id: str):
    if len(job_id) > 64:
        raise HTTPException(404, "Job not found")
    redis = Redis.from_url(REDIS_URL, decode_responses=True)
    job = redis.hgetall("nova:ai:job:" + job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {k: v for k, v in job.items() if k not in ("user_id", "source_file_id")}

@app.post("/v1/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    # Production cancellation must be authorized by Appwrite before enabling this route.
    raise HTTPException(501, "Cancellation is not enabled until Appwrite authorization is connected")
