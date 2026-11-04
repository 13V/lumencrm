# Lumen CRM — handover to Claude

This is the private CRM for Troy Watson at Lumen adl in Adelaide, South Australia. Use “Lumen adl” or “Lumen”, never “Lumen Studio”.

Repository: https://github.com/13V/lumen-crm (private)
Branch: codex/lumen-crm-v1
Draft PR: https://github.com/13V/lumen-crm/pull/1
Source commit: 3ca973cb9a18212b3e585ef6bcb1b3e8da26b0e3

This ZIP contains the committed source and documentation, plus this note. It excludes Git history, installed dependencies, build output, real environment values and local databases. It is not a verbatim export of the original chat.

## Read first

1. AGENTS.md and README.md: repository instructions, setup and first owner provisioning.
2. docs/BUILD-PLAN.md: architecture, database diagram and routes.
3. docs/INTEGRATION.md: exact website, Meta and Chloe contracts and official references.
4. docs/DECISIONS.md: implementation choices and known limits.
5. docs/PHASES.md: phase work and verification evidence.
6. docs/GO-LIVE.md: remaining release gates.

## Latest instruction from Troy

Retention defaults to **12 months**, matching the current privacy policy. This replaces the original brief’s 24-month default. Migration 010 preserves custom periods while updating the old default.

## Implementation and setup

Five phase commits cover the responsive Today/lead/pipeline workspace, Supabase auth and owner TOTP, roles/RLS, signed ingestion, timeline and consent-aware messaging, calendar/ICS, public quotes, projects, hosting, invoices/PDF/payments, reports, scheduled jobs, CSV/data privacy, private files, offline reading and optional AI drafts. Ten migrations and 30 fictional Adelaide seed leads are included.

Use Node 24 LTS and pnpm 11, then `pnpm install --frozen-lockfile`. Follow README.md for Supabase in Sydney and Vercel functions in syd1. Read the installed Next.js documentation as AGENTS.md requests. Preserve the lockfile.

For a fictional local preview, set `LUMEN_DEMO_MODE=true` and run `pnpm dev`. Production deliberately ignores this flag. Never seed production. Put real secrets in ignored local environment files or Vercel/Supabase settings, never in chat or Git.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm test:database`, `node tests/database/run.mjs --seed`, `pnpm exec playwright install chromium`, `pnpm exec playwright test --workers=1`, `pnpm build`.

## Last verified state

- Production build and strict TypeScript passed.
- 170 unit tests, 55 PostgreSQL checks and fictional seed coverage passed.
- Clean Playwright run: 51 passed; three intentional device-specific skips.
- 36 automated WCAG scans passed across nine screens, two widths and both themes.
- Final production fixture: Lighthouse 91 performance / 100 accessibility; script transfer 337,950 bytes.
- Production sign-in CSP and phone quote acceptance passed against local auth/RPC fixtures. Actual quote transaction/security rules were separately exercised in PostgreSQL.
- Invoice PDFs were rendered and visually inspected.

These are local development checks. Hosted Auth/TOTP/RLS/Storage/Realtime, provider delivery, the two-second intake target, physical iPhone push, cron and backup restoration remain unverified. No real client messages were sent.

## Continue here

Complete GO-LIVE.md in a separate Sydney test project before enabling real forwarding. Configure business details, editable prices, GST wording, written terms, deposits, bank details and public holidays. Apply the shipped hosted Supabase email templates so invitations verify token hashes server-side.

Keep CAPI and AI off until deliberately enabled and tested. Client messages require explicit human action; Chloe remains on the website. Email reply-unsubscribe still requires owner monitoring. Review the opt-in scheduler and avoid duplicate schedules. Weekly encrypted exports supplement primary backups; they omit Auth credentials and Storage binaries and are not transaction-consistent. Perform a restore drill.

Known limits: scripts exceed the aspirational 200 KB target; bulk selection offers Snooze; calendar is an agenda without drag rescheduling; some forms use explicit Save; financial operations lack general Undo. Mutations use authenticated JSON handlers and transactional database functions rather than Next.js Server Actions. See DECISIONS.md for details.

GitHub’s connected OAuth app lacked workflow-write permission. CI is supplied as docs/CI-WORKFLOW.yml; an authorised administrator can install it under .github/workflows/checks.yml. Local checks ran independently.
