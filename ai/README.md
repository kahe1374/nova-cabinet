# NOVA AI — self-hosted starter

This is the first safe infrastructure scaffold for the self-hosted NOVA AI path.

## Start locally

1. Copy deploy/.env.example to deploy/.env.
2. Replace NOVA_JOB_TICKET_SECRET with a long random secret.
3. From this directory run: docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build
4. Check http://127.0.0.1:8080/health and /ready.

## Current limitations

- This scaffold does not contain or download an image-generation model.
- The worker deliberately rejects jobs until a reviewed model adapter is installed.
- Appwrite signed-ticket issuance, source-file retrieval, private output upload, and completion callback are not connected yet.
- The cancel route is deliberately disabled until Appwrite authorization is implemented.
- Do not connect this scaffold to production or expose the gateway publicly.

## Model policy

Use only a model and code whose license permits the intended commercial use. Review the exact model card, weights license, dependencies, and redistribution terms. Customer images are not training data unless the customer explicitly opts in.

## Cost policy

Local CPU development can be free but will be slow and may not support useful image generation. Free hosted GPU sessions are temporary and unsuitable for guaranteed customer jobs. Benchmark candidate models before selecting hardware.
