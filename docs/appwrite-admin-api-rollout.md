# Appwrite Admin API — current deployment and safety state

Last verified: 2026-11-20

## Live deployment

- Public website: `https://kahe1374.github.io/nova-cabinet/`
- Admin panel: `https://kahe1374.github.io/nova-cabinet/admin/`
- Appwrite function: `nova-admin-api`
- Active deployment at last verification: `6aff62846f9c373b7991`
- Function is enabled and its execute permission is `any` because the same function handles public order and AI-intake actions. This is not public admin access: admin actions independently require a valid Appwrite user JWT, the verified owner email, and an active `owner_admin` row.
- Function scopes at last verification: `rows.read`, `rows.write`, `files.read`, `files.write`.
- `NOVA_PUBLIC_ORDER_INTAKE_ENABLED=true`
- `NOVA_PUBLIC_AI_INTAKE_ENABLED=true`
- `NOVA_ADMIN_API_READ_ONLY=true`

## What is enabled

### Public website intake

The function accepts the public order and AI-intake actions only from the exact GitHub Pages origin. These actions have independent input validation and rate limiting. AI intake requires a valid Appwrite session JWT; upload confirmation checks private-file ownership and metadata; price acceptance validates the request token, quoted amount, upload completion, and pending-payment state.

Public intake creates the required records in Appwrite. This is separate from admin-panel write access.

### Owner admin panel

The owner must authenticate with the verified owner email. The function also checks the active `owner_admin` row in `app_users`.

Read-only admin capabilities include:
- health and connection status;
- order list;
- active order-assignee directory (owner/admin and factory manager roles only);
- per-order status history;
- AI design requests;
- AI pricing.

The following admin mutations are deliberately blocked while read-only mode is active:
- `update_order_status`;
- `assign_order`;
- `upsert_ai_pricing`.

The UI disables these controls while the API reports read-only mode. Do not set `NOVA_ADMIN_API_READ_ONLY=false` without separate explicit approval after a scoped production-write review.

## Data protection and boundaries

- Appwrite is used for the current public intake and owner admin API.
- Keep the existing Supabase project, records, functions, buckets, and policies intact. No Supabase migration or deletion is authorized by this rollout.
- Do not expose Appwrite API keys, function keys, FAL keys, or other service secrets in browser code or Git.
- Private customer uploads remain in the `nova-ai-designs` bucket with per-user file permissions.
- Never expose AI acceptance-token hashes in admin responses.
- Do not mark a request paid based on frontend input or price acceptance alone.
- Do not start image generation unless payment is verified as paid and the required generation credentials and storage-token scope are configured.

## Remaining production gates

1. **Payment:** no verified payment gateway/webhook is connected. A payment-related pull request is still open and must not be merged while it contains hard-coded payment-card details in a public repository branch. Use a secure payment provider flow; never commit payment credentials or card data.
2. **AI provider:** the Appwrite function secret `FAL_KEY` is not configured. Image generation must remain unavailable until a provider is selected and configured securely, or the approved self-hosted gateway replaces it.
3. **Storage token permission:** the current function scope list does not include `tokens.write`; confirm the minimum required permission before attempting source-file token creation.
4. **Admin writes:** order status changes, assignment writes, and pricing updates remain blocked by `NOVA_ADMIN_API_READ_ONLY=true`. Enabling them requires explicit owner approval and a narrow write-scope review.
5. **Self-hosted AI:** the target architecture is documented in `NOVA-AI-SELF-HOSTED-ARCHITECTURE.md`. GPU provisioning and model evaluation are deferred until the website backlog is complete.

## Verification history

- Public order and AI intake integration was exercised with synthetic test data.
- Admin owner authentication and read-only data retrieval were verified.
- Admin API mocked regression workflow passed (50 tests) on commit `83c116c9cdd9bb92a943226e59ce1c5b153fa1e3`.
- Appwrite API deployment workflow passed on the same commit.
- GitHub Pages build and deploy workflow completed successfully on the same commit.

## Rollback

If public intake or owner read access behaves unexpectedly, disable the relevant public-intake environment flag or disable the function through the controlled deployment process. Preserve Appwrite and Supabase records; do not delete customer data as a rollback shortcut.
