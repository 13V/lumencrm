# Lumen CRM

The private sales and client system for Lumen adl, built for Troy Watson in Adelaide. Next.js App Router, strict TypeScript, Supabase Postgres/Auth/Storage/Realtime and pnpm. Read [the build plan](docs/BUILD-PLAN.md), [integration contracts](docs/INTEGRATION.md), [decisions](docs/DECISIONS.md) and [go-live checklist](docs/GO-LIVE.md).

## Local setup

1. Install Node 24 LTS and pnpm 11. Run `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env.local`. Keep secrets in that ignored file locally and in Vercel environment settings for deployment. Never paste secrets into chat or commit them.
3. Create a Supabase project in **Sydney / ap-southeast-2**. Add its project URL and anonymous key to `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Server secrets never use a `NEXT_PUBLIC_` prefix.
4. Apply `supabase/migrations/*.sql` in filename order, using the Supabase CLI (`supabase link`, then `supabase db push`) or SQL editor. Review migrations first. With Docker and the Supabase CLI, `supabase start` and `supabase db reset` create a local instance.
5. Configure Auth site URL to `APP_URL`; allow the exact `/auth/callback` URL for local and production environments. Disable public user sign-ups. Enable email OTP/magic-link login and TOTP.
   In hosted Supabase **Authentication → Email templates**, copy `supabase/templates/invite.html` into **Invite user** and `supabase/templates/magic-link.html` into **Magic Link**. These templates send `TokenHash` to the server callback. Admin invitations cannot use the browser-bound PKCE verifier; the default fragment-based invitation link is not suitable for this server callback. The local Supabase config already references these files.
6. Create or invite the first auth user in the Supabase dashboard. Copy its **user UUID**, then provision the owner in the SQL editor:

   ```sql
   insert into public.profiles(user_id, name, role)
   values ('REPLACE-WITH-AUTH-USER-UUID', 'Troy Watson', 'owner');
   ```

   There is no automatic first-user promotion. Sign in at `/login`, enrol an authenticator and verify its code. Owner CRM access requires AAL2 at both the application and database.
7. Run `pnpm dev` and open http://127.0.0.1:3000. Set `APP_URL=http://127.0.0.1:3000` locally so origin checks match.

For an isolated fictional preview, set `LUMEN_DEMO_MODE=true` locally. No Supabase connection is needed; the preview is labelled and its browser data is separate from the database. Production ignores this flag. Use a separate test Supabase project for integration acceptance tests; do not seed production.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm test:database
node tests/database/run.mjs --seed
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Database checks are in `tests/database`. Browser tests exercise the fictional preview at 375 px and desktop sizes. They do not prove provider delivery or production permissions; those require the dedicated database and provider checks in GO-LIVE.

To enable GitHub Actions, copy `docs/CI-WORKFLOW.yml` to `.github/workflows/checks.yml` using a GitHub connection with workflow-write permission. The current connected OAuth app cannot publish workflow files, so the configuration is provided as a template; local verification has run independently.

Run `pnpm check:accessibility` while the fictional preview is running for light/dark phone/desktop WCAG checks. `pnpm check:production` creates a separate, ignored fixture copy under `.quality`, installs the locked dependencies, builds it with production optimisation, measures Today with Lighthouse and exercises the public quote on a phone against a local RPC fixture. It never changes release source or uses real credentials. Results are written beside that fixture. The database suite separately verifies actual quote acceptance transactions and permissions.

`supabase/seed.sql` contains 30 fictional Adelaide enquiries using verified ACMA creative-work numbers and `example.com` addresses. It refuses a database with existing contacts or deals. Seeding is disabled by default; apply it explicitly only to an empty local/test project after the migrations. Never run it in production.

Database TypeScript types are generated from the PostgreSQL catalog after applying the checked-in migrations in the local test harness (`node tests/database/run.mjs --types`). After applying migrations, regenerate against your actual Supabase project:

```sh
supabase gen types typescript --linked > src/lib/database.types.ts
```

## Deploy to Vercel

Import this private repository, select pnpm, and set the environment values in Vercel. `vercel.json` pins functions to **syd1**. Set `APP_URL=https://crm.lumenadl.com`, connect that subdomain in Vercel, and update Supabase's exact Auth redirect allowlist. Do not configure a public preview with real data.

Configure provider secrets only when ready to test the corresponding integration. All CAPI sends and optional AI work are off by default. The CRM never automatically sends a client SMS or email; Chloe remains on lumenadl.com. Follow the integration document for signed forwarding from the website.

Set the five-minute scheduler using `supabase/schedules.sql` after configuring the CRM URL and cron secret in Supabase Vault. Set `BACKUP_ENCRYPTION_KEY` in Vercel and keep its recovery copy separately. The script does not contain secrets and does not run automatically during migration. Enable daily Supabase backups, then test a restore.

## Data and security

Every business table has RLS. Staff cannot access invoices, settings, exports or deletion operations. Viewers cannot mutate records. Attribution and first milestone timestamps are immutable, while ordinary deletion uses a 30-day bin. Settings hold editable prices, GST wording, call hours, terms, invoice numbering and bank details.

Secrets belong in Vercel or Supabase settings. Logs and integration receipts contain identifiers and statuses, not enquiry payload copies. Security headers include noindex, HSTS, frame restrictions and a per-request script nonce. The service-role key is reserved for trusted ingestion and jobs.
