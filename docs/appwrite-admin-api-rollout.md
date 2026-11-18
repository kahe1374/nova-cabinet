# Appwrite Admin API staged rollout

## Current safety state
- The production admin UI remains on Supabase.
- The Appwrite `nova-admin-api` function must remain disabled during preparation.
- Function execute permissions must remain empty during preparation.
- `NOVA_ADMIN_API_READ_ONLY` defaults to `true`; do not set it to `false` for the first live check.
- No Supabase records, buckets, policies, or functions are to be removed during this rollout.

## Browser client contract
The browser imports `admin/appwrite-admin-api.js`. It uses the Appwrite public endpoint and project ID only. It must never contain an API key or service secret. Authentication is accepted only for the exact owner mailbox after Appwrite reports `emailVerification === true`. The function independently validates the JWT and the active `owner_admin` row in `app_users`.

## Preconditions before any live invocation
1. Confirm the deployed function is the reviewed `nova-admin-api` build.
2. Confirm the function has the `rows.read` and `rows.write` scopes required for its implementation.
3. Confirm its runtime has the Appwrite-provided function API key available as `APPWRITE_FUNCTION_API_KEY`; never inject a key into browser code or repository files.
4. Keep the function in read-only mode.
5. Add only the exact owner account ID `6afdf252002cc39270ab` to the function execute allow-list; do not grant `any`, `users`, or public execution.
6. Enable only for a short controlled owner test after explicit operator approval. If any precondition is uncertain, keep it disabled.

## First live check
After the controlled owner-only execution permission is configured, invoke only `health`, then `list_ai_pricing`, `list_ai_requests`, and `list_orders`. Confirm responses are read-only and that AI price acceptance token hashes are absent. Do not run any write action. Disable the function and clear execute permissions immediately after the test if the rollout is not continuing.

## Production migration gate
Do not change `admin/index.html` or switch authentication, orders, AI requests, pricing, or file access to Appwrite until:
- live owner authentication and read-only reads pass;
- all Appwrite schema and row permission behavior is verified;
- AI file storage and signed access are implemented and tested;
- existing Supabase records are migrated and reconciled without data loss;
- write workflows, status history, audit behavior, and rollback are tested;
- explicit approval is given for the production cutover.

## Rollback
Keep Supabase intact. Revert the frontend integration independently of the backend. Disable the Appwrite function and empty its execute allow-list if unexpected behavior occurs.
