# NOVA CABINET — Self-Hosted AI Architecture

Status: architecture baseline approved; implementation not yet deployed.
Date: 2026-11-19

## Goal

Run NOVA's image-analysis and cabinet/interior redesign inference on GPU infrastructure controlled by NOVA. The production website must not depend on fal.ai or another hosted image-generation API. Appwrite remains the system of record for users, requests, private uploads, pricing, payment state, and generated assets.

Self-hosted means model weights and inference run on NOVA-controlled GPU infrastructure. It does not mean training a foundation model from zero in phase 1. Model selection must include commercial-use license review before deployment.

## Current project constraints

- Public website: GitHub Pages.
- Admin/API and private file storage: Appwrite project already in use.
- AI intake, private upload confirmation, and price acceptance have passed an end-to-end synthetic test.
- AI generation code currently calls a hosted FAL queue endpoint. This is a migration target, not the final architecture.
- The generation gate requires a paid request. Do not bypass payment validation.
- Admin API is intentionally read-only for admin mutations at present. Do not silently enable writes.
- Do not delete or migrate legacy Supabase data as part of this work.
- Existing synthetic review request NA-7A97243493 is retained for owner review.

## Target architecture

1. Browser (GitHub Pages)
   - Uses Appwrite anonymous/authenticated session.
   - Uploads source photos directly to the private Appwrite bucket using per-user file permissions.
   - Calls the Appwrite Function for request lifecycle actions; never receives GPU credentials or service secrets.

2. Appwrite control plane
   - Remains authoritative for request records, owner/customer identity, quote, acceptance, payment status, upload ownership, and output file metadata.
   - nova-admin-api authenticates the caller and validates request ownership, upload completion, accepted quote, and payment_status=paid.
   - Issues a short-lived, one-time internal job authorization to the GPU gateway. No Appwrite API key or FAL key is sent to the browser.
   - Stores job IDs and final output references.

3. NOVA AI Gateway (self-hosted)
   - Python + FastAPI service behind HTTPS.
   - Verifies signed, expiring job tickets; validates MIME type, file size, request state, and allowed operation.
   - Downloads source images using a narrowly scoped, short-lived Appwrite file token or a server-to-server private transfer.
   - Enqueues jobs; exposes authenticated job status and cancellation.
   - Applies per-user concurrency limits, quotas, audit logging, and idempotency keys.

4. Queue and worker
   - Redis-backed queue for MVP; separate API and worker processes.
   - Worker stages: image validation -> scene/geometry analysis -> user-intent/style conditioning -> image editing/generation -> quality checks -> private output upload -> job completion callback.
   - Retries are bounded and idempotent. Failed jobs do not create duplicate customer charges.

5. GPU inference runtime
   - Dockerized model runtime on a dedicated NVIDIA GPU host.
   - Model adapter interface isolates the product from any one model family.
   - Candidate models are evaluated for commercial license, image-edit quality, identity/layout preservation, VRAM, latency, and cost before selection.
   - Keep model weights, prompts, and inference logs private. Do not train on customer images without explicit consent and a documented retention policy.

6. Observability and operations
   - Health/readiness endpoints, structured logs, job metrics, GPU VRAM/utilization, latency, failure rates, and cost per successful output.
   - No customer image bytes, secrets, or full JWTs in logs.
   - Backups and a documented deletion/retention policy for source and output images.

## Suggested repository layout

    ai/
      gateway/
        Dockerfile
        pyproject.toml
        app/
          main.py
          auth.py
          schemas.py
          jobs.py
          appwrite_client.py
      worker/
        app/
          pipeline.py
          stages/
            validate_image.py
            analyze_scene.py
            generate_edit.py
            quality_check.py
          models/
            base.py
            registry.py
      deploy/
        docker-compose.yml
        .env.example
      evals/
        dataset_manifest.example.json
        acceptance_criteria.md

No secrets or model weights belong in Git.

## API contract (initial)

- POST /v1/jobs: accepts an Appwrite-issued short-lived signed job ticket and an idempotency key; returns job_id.
- GET /v1/jobs/{job_id}: returns queued/running/succeeded/failed and safe progress metadata.
- POST /v1/jobs/{job_id}/cancel: owner/admin-authorized cancellation.
- Internal completion callback: gateway signs the result; Appwrite Function verifies signature and updates the request row and private file reference.

The gateway must not accept arbitrary public Appwrite file IDs or arbitrary remote URLs. It only processes a file bound to a verified, paid AI request.

## Delivery phases and exit criteria

### Phase 0 — Freeze interfaces and threat model
- Document existing Appwrite AI request fields and current FAL-specific call sites.
- Define signed ticket format, expiry, nonce, idempotency, upload limits, allowed image formats, and callback authentication.
- Confirm payment webhook design before any production generation is enabled.
- Exit: reviewed API contract and threat model; no production behavior changed.

### Phase 1 — GPU host and deployment skeleton
- Select a host/region and GPU only after benchmark requirements and budget are agreed.
- Provision isolated Linux host, firewall, TLS reverse proxy, Docker, persistent encrypted model volume, Redis, gateway, and worker.
- Keep GPU service private; expose only gateway HTTPS.
- Exit: health checks pass; no model or customer traffic yet.

### Phase 2 — Model evaluation
- Build a consented/licensed evaluation set of representative kitchen/cabinet photos.
- Benchmark candidate self-hostable image-edit models on layout preservation, cabinet/material accuracy, visual quality, latency, VRAM, and commercial license.
- Record baseline outputs and human review rubric.
- Exit: selected model, documented license, hardware sizing, and reproducible benchmark.

### Phase 3 — Inference MVP
- Implement image validation, one editing pipeline, queue, status endpoint, private output handling, and telemetry.
- Run synthetic jobs only; verify no external image-generation API calls.
- Exit: repeatable end-to-end synthetic generation and failure/retry tests.

### Phase 4 — Appwrite integration
- Replace the FAL-specific generation adapter in nova-admin-api with the signed gateway contract.
- Preserve the paid-status gate, upload ownership checks, private storage permissions, and owner authorization.
- Keep admin write restrictions unchanged unless separately authorized.
- Exit: staging test proves unpaid requests cannot generate and paid synthetic requests can generate.

### Phase 5 — Controlled production rollout
- Enable small owner-approved cohort, quotas, cost alerts, retention controls, and rollback.
- Compare quality and cost against acceptance criteria.
- Exit: owner approval after monitored pilot.

## Security and business rules (non-negotiable)

- Never expose Appwrite API keys, GPU credentials, or signing keys in browser code or Git.
- Do not trust client-supplied price, payment status, file owner, or completion status.
- Do not bypass payment status. A successful price acceptance is not proof of payment.
- Customer images remain private. Training use requires separate explicit opt-in.
- Do not enable generation on production until the gateway is authenticated, rate-limited, monitored, and tested.
- Keep Supabase intact unless a separate migration is explicitly approved.

## Decisions still required before provisioning

1. GPU host/provider and region.
2. Monthly infrastructure budget and expected jobs/day.
3. Preferred image output resolution and acceptable average generation time.
4. Whether customer photos may ever be used for model improvement (default: no).
5. Payment provider and verified webhook source.

## Immediate next implementation task

Create the gateway/worker skeleton and API contract tests without connecting it to production Appwrite or changing the live website. Then benchmark candidate self-hosted models on the selected GPU before choosing model weights.
