# NOVA CABINET backend setup

The public website is hosted on GitHub Pages (static hosting). It cannot run a database or protect admin credentials. The backend scaffold in this repository uses Supabase PostgreSQL and an Edge Function.

## Current status
- Database foundation: `database/001_core_schema.sql`
- Lead API source: `supabase/functions/create-lead/index.ts`
- Supabase project: not connected
- Database migration: not executed
- Edge Function: not deployed
- Admin panel/authentication: not deployed

## Required one-time setup
1. Create a Supabase project in the region appropriate for your business.
2. In the SQL Editor, run `database/001_core_schema.sql`.
3. Install the Supabase CLI and link this repository to the new project.
4. Set the Edge Function secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Never put the service-role key in website JavaScript or GitHub.
5. Deploy the function: `supabase functions deploy create-lead`.
6. Add the project URL and public anon key to the website configuration, then connect the form to the function.
7. Test a real submission, verify one customer and one order row, then test invalid input and unauthorized database reads.

## Important
Do not publish an admin dashboard until authentication and role-based access control are configured. The service-role key must remain server-side. The current website form continues to use WhatsApp until the backend is deployed and verified. No database has been provisioned and no customer data is being stored yet.
