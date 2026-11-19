import json
import os
import time
from redis import Redis

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
QUEUE_NAME = "nova:ai:jobs"

def process(job: dict):
    # Safe placeholder: connect the selected, license-reviewed local model here.
    # Do not mark an Appwrite request as completed until output is uploaded privately
    # and the signed completion callback has been verified.
    raise RuntimeError("No inference model configured; refusing to fabricate an output")

def main():
    redis = Redis.from_url(REDIS_URL, decode_responses=True)
    print("NOVA worker waiting for jobs")
    while True:
        item = redis.blpop(QUEUE_NAME, timeout=5)
        if not item:
            continue
        _, raw = item
        job = json.loads(raw)
        key = "nova:ai:job:" + job["job_id"]
        redis.hset(key, mapping={"status": "failed", "error": "model_not_configured"})
        print("Job safely rejected: model_not_configured")

if __name__ == "__main__":
    main()
