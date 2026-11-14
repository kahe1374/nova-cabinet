# NOVA CABINET backend setup

The public website is hosted on GitHub Pages (static hosting). Supabase provides the PostgreSQL database and the server-side lead function.

## Live infrastructure status
- Supabase project: `nova-cabinet` (`sjapgxjllnlttrhjxkez`), region `eu-central-1`
- Database migration: applied; eight public tables verified
- Row Level Security: enabled on all eight tables; no public policies yet, so direct browser table access remains blocked by default
- Edge Function: `create-lead`, version 2, status ACTIVE, JWT gateway verification disabled because this endpoint validates public form input itself
- Website form: connected to the Edge Function; WhatsApp contact link remains available
- Admin panel/authentication: not implemented
- Real request submission: not yet end-to-end tested from a browser

## Function configuration
The function uses the project's built-in `SUPABASE_URL` and prefers `SUPABASE_SECRET_KEYS` (default secret key), falling back to `SUPABASE_SERVICE_ROLE_KEY`. These are available server-side in Supabase Edge Functions. Never put a secret/service-role key in website JavaScript or GitHub.

## Security and next steps
1. Configure Supabase Auth before adding any customer or manager access policies.
2. Add request rate limiting / abuse protection before promoting the public form.
3. Run a real browser submission and verify one customer and one order row are created.
4. Build the owner and factory-manager panels only after authentication, role checks, and audit logging are implemented.
5. Configure backups and monitoring.

The schema intentionally has RLS enabled without permissive policies. This keeps browser clients from reading or writing customer and order data until the access model is implemented. The Edge Function uses a server-side secret to perform the initial lead insert.
