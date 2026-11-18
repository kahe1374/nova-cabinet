# NOVA Appwrite admin API adapter

This module is an isolated integration adapter. It is deliberately **not imported by** `admin/index.html` and does not change the production login, order, AI-design, or storage flows.

## Contract

- Uses the Appwrite browser SDK and the existing signed-in Appwrite owner session.
- Checks the owner email and verified-email flag in the browser as an early guard. The function independently repeats the authoritative account and `app_users` row checks.
- Requests a short-lived Appwrite JWT and invokes only the `nova-admin-api` function.
- Exposes a single `call(action, parameters)` method. Never pass API keys or service credentials to this module.
- Preserves server error codes and the `partial` flag so callers can distinguish a failed operation from a write that succeeded but whose audit record failed.

## Current deployment gate

The function is deployed disabled with an empty execute-permissions list. This adapter cannot successfully invoke it until a separately reviewed rollout explicitly grants execution to the verified owner account and enables the function. Do not weaken those controls as part of routine testing.

## Safe integration order

1. Verify the function's runtime identity/JWT propagation with owner-only execution in a controlled rollout.
2. Verify CORS and browser-origin behavior if direct HTTP invocation is ever introduced. This SDK adapter currently uses Appwrite Functions execution instead.
3. Complete read-only parity checks for orders, customers, AI requests and pricing.
4. Verify file access and signed/private file delivery independently.
5. Implement and test every required write operation and audit behavior.
6. Migrate and reconcile data without deleting or mutating the Supabase source.
7. Only then consider a separately approved panel cutover with a rollback path.

No production panel cutover is authorized by adding this adapter.
