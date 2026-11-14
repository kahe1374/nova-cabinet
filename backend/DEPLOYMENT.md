# NOVA CABINET backend setup

The public website is hosted on GitHub Pages (static hosting). Supabase provides PostgreSQL and the server-side lead function.

## Live infrastructure status
- Supabase project: `nova-cabinet` (`sjapgxjllnlttrhjxkez`), region `eu-central-1`
- Database: eight core public tables exist; RLS is enabled on all eight
- Access control: an `admin_allowlist` table and `current_app_role()` function are installed
- Owner allowlist: `vahiiidk74@gmail.com` is registered as `owner`
- Policies: owner-only access policies are installed; factory-manager policies allow operational reads and limited order/status updates
- Factory-manager order updates are additionally restricted by a database trigger to status, assignment, and updated timestamp fields
- Admin identity: no Supabase Auth user currently exists for the owner email; invite/confirmation is still required before the owner can sign in
- Edge Function: `create-lead` is deployed with JWT gateway verification disabled for the public lead form; its server-side implementation must validate inputs and keep service secrets server-side
- Website: GitHub Pages static site; public form still needs a real browser end-to-end submission test

## Function configuration
The function should use the project's built-in `SUPABASE_URL` and server-side `SUPABASE_SECRET_KEYS` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) as appropriate. Never put a secret/service-role key in website JavaScript, public repository files, or client-visible settings.

## Remaining setup and verification
1. In Supabase Dashboard → Authentication → Users, invite `vahiiidk74@gmail.com`; complete the email confirmation flow. Do not share passwords or one-time codes in chat.
2. Configure the production email provider/SMTP and the exact GitHub Pages redirect URL for Auth.
3. Add the factory manager's email only after it is supplied and verified; assign the `factory_manager` role through the protected allowlist, not client-side metadata.
4. Build and connect the authenticated admin UI; verify owner and factory-manager permissions with separate accounts.
5. Add rate limiting / abuse protection to the public lead endpoint.
6. Submit a real test lead from a browser and verify the customer/order rows and audit trail.
7. Configure backups and monitoring.

The database remains protected by RLS. The allowlist does not itself create an Auth user or send an invitation. The public lead function is separate from the authenticated admin interface.
