# Phase checks

## Phase 1 — foundations

Implemented auth and owner TOTP, database roles/RLS, responsive Today and relationship workspace, contacts/businesses/deals, timeline notes, tasks, quick add, search, theme controls, owner configuration, editable products and invitations. Full schema is in the foundation migrations so later work shares one data model.

Verified locally:

- TypeScript strict check and Next.js production build pass.
- 47 unit checks pass.
- 16 foundation checks execute against real PostgreSQL through PGlite, with Supabase Auth/Storage schemas emulated by the harness.
- 8 Playwright checks pass at 375 px and desktop, covering Today, quick add/search/persistence, task undo and security headers.
- Phone and desktop screenshots inspected; no horizontal overflow on Today.

Run: `pnpm install --frozen-lockfile`, configure `.env.local`, `pnpm dev`. Check: `pnpm typecheck`, `pnpm test`, `node tests/database/run.mjs --phase1`, `pnpm test:e2e`, `pnpm build`.

Live Supabase email delivery, owner enrolment and Vercel deployment need configured external services and remain go-live checks. Database tests emulate auth claims; they do not exercise Supabase Auth itself.

## Phase 2 — leads coming in

Implemented signed website/Meta/Chloe ingestion with durable idempotency and rate limits, normalized contact matching and merge, realtime refresh, working-hour timers, draggable pipeline with keyboard stage controls, call return sheet and follow-ups, consent-aware ClickSend/Resend sends, Chloe takeover, contact editing, day/week calendar and revocable private ICS feed.

Verified: 78 unit checks, 25 PostgreSQL checks through the Phase 2 migrations, strict TypeScript, and 11 new phone/desktop browser checks. A pointer-specific desktop drag test is intentionally skipped on the phone project; its accessible stage menu is exercised on both. The eight foundation browser checks also passed after the UI changes.

Run and check: `pnpm dev`, `pnpm typecheck`, `pnpm test`, `node tests/database/run.mjs --phase=2`, `pnpm exec playwright test tests/e2e/foundations.spec.ts tests/e2e/leads.spec.ts`, `pnpm build`. Use the signed examples in INTEGRATION with a dedicated Supabase test project for the full webhook-to-Realtime latency check. Provider network calls are mocked in unit tests; no client messages were sent during development.

## Phase 3 — selling and delivery

Implemented demo board, quote builder with editable/included lines, immutable issued terms/prices, public capability quote view and acceptance, project checklists and feature permission, launch-to-hosting workflow, subscriptions, invoice creation/deposit/balance, partial payments, Unicode PDF/print and explicit email sending.

Verified: production build and strict TypeScript pass; eight commerce browser checks pass at phone/desktop sizes. PostgreSQL checks cover capability isolation, repeated quote acceptance, project/checklist/deposit creation, invoice totals/numbering/payments and idempotent launch. A real invoice PDF was generated, rendered to PNG and visually inspected; a long multi-page invoice is tested too.

Run and check: `node tests/database/run.mjs --phase=3`, `pnpm exec playwright test tests/e2e/commerce.spec.ts`, `pnpm exec vitest run tests/unit/invoice-pdf.test.ts`, `pnpm build`. Configure written terms in owner Settings before issuing live quotes. Configure Resend and verified sender before sending invoices; test delivery with an approved test recipient.

## Phase 4 — knowing what works

Implemented enquiry-cohort reports, working-hour response percentiles, ad spend and acquisition maths, a counts-only outcomes feed, stable CAPI outbox events, Adelaide-time scheduled work, Telegram and web-push notifications, encrypted weekly exports, retention and anonymous report preservation. Jobs create client-message drafts only. CAPI stays off until enabled by the owner.

Verified locally: 39 PostgreSQL checks through this phase, including job leases, stable CAPI identifiers, disabled sends, anonymisation and retained report counts. Unit tests cover report denominators, ad joins, notification deduplication, stale reminders, provider retries and backup encryption. Provider calls use test doubles; no live messages or Meta events were sent.

Run and check: `node tests/database/run.mjs --phase=4`, `pnpm test`, `pnpm exec playwright test tests/e2e/reports.spec.ts`, `pnpm typecheck`, `pnpm build`. Set the optional provider variables, then configure the five-minute tick using `supabase/schedules.sql`. The scheduler script is opt-in and was not run against a hosted project. Verify delivery, cron history and a backup restore before go-live.

## Phase 5 — polish and handover

Implemented keyboard navigation and command search, phone swipe/hold actions, bulk snooze with Undo, saved views, timers and local note drafts, consent editing, related sales/delivery summaries, common Settings forms and editable products/templates, CSV mapping/dry-run/resumable import, private uploads, bin restoration and person-data export/anonymisation. The optional AI helper produces drafts only. PWA caching is read-only, scoped to the server-confirmed user and cleared on sign-out or anonymisation. Seed data contains 30 fictional Adelaide enquiries. Retention now defaults to 12 months following Troy's clarification.

Final checks:

- Strict TypeScript and production build pass.
- 170 unit tests pass across 31 files, including offline cache privacy/races, provider boundaries, report arithmetic, CSV retries and public-auth callbacks.
- 55 real PostgreSQL checks pass through all ten migrations. Auth claims and Storage scaffolding are emulated locally; the actual policies, functions, triggers and transactions execute in PostgreSQL.
- Seed coverage verifies all sales stages, sources and outcomes, reserved phone numbers, example.com addresses and refusal to seed a non-empty database.
- The clean full Playwright run passes 51 tests at 375 px and desktop. Three tests intentionally run only on their relevant device type.
- 36 automated WCAG scans pass: nine screens, two widths and both themes. Project progress indicators were corrected during this pass; no page-level horizontal overflow was found.
- An isolated production fixture scored Lighthouse **91 performance / 100 accessibility** for Today at phone size. Script transfer was **337,950 bytes**, above the aspirational 200 KB target after lazy-loading secondary panels. Hosted auth/database latency and real iPhone behaviour are not measured by this fixture.
- The public quote passed phone rendering, accessible form, view tracking and acceptance-evidence checks against a local RPC fixture; its actual transaction/security rules are covered by the PostgreSQL suite. Invoice PDFs were rendered to PNG and visually inspected, including Unicode and multi-page content.

Run and check: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm test:database`, `node tests/database/run.mjs --seed`, `pnpm exec playwright test --workers=1`, `pnpm build`. With the local fictional preview running, use `pnpm check:accessibility`; use `pnpm check:production` for the isolated production fixture. Reports live in ignored `test-results`/`.quality` directories. The CI template is in `docs/CI-WORKFLOW.yml`; an authorised repository administrator can install it at `.github/workflows/checks.yml`. The connected OAuth app lacks workflow-write scope, so automated GitHub checks are not enabled by this branch.

Remaining release gates are explicit in GO-LIVE: hosted Supabase Auth/TOTP/RLS/Storage/Realtime, two-second ingest latency, provider delivery, Meta test events, cron execution, backup restore and physical iPhone install/push. Real credentials were not available during this build and no client messages were sent.
