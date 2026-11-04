# Go-live checklist

## Before real data

- [ ] Apply every migration to a separate Sydney Supabase test project, then run database policy tests as owner (email-link session), staff, viewer and anonymous roles.
- [ ] Verify no public signup can create a profile; provision the first owner. Done 4 Nov 2026: hello@lumenadl.com, email-link sign-in only (no TOTP, Troy's choice), 30-day sessions.
- [ ] Apply the shipped Invite user and Magic Link email templates in hosted Supabase. Test invitation acceptance on a different device and owner sign-in followed by TOTP.
- [ ] Set Vercel `syd1`, the CRM domain, exact Auth redirect URLs and independent random ingest, cron and export secrets.
- [ ] Confirm no real `.env` files or provider keys appear in Git history or browser bundles.
- [ ] Set business email/phone/address/ABN, editable products, bank details, GST registration/wording, quote terms URL and deposit policy.
- [ ] Set call hours and the current SA public holidays. Inspect DST transitions and a weekend enquiry.
- [ ] Confirm the configured 12-month lost/no-reply retention matches the public policy. Review the optional AI provider disclosure before enabling it for personal data.
- [ ] Enable Supabase daily backups appropriate to the chosen plan and perform a restore into a separate project.

## Required live acceptance checks

- [ ] Signed website lead arrives once, duplicate returns the same deal, different mobile formatting matches the same contact, and Today updates through Realtime within two seconds.
- [ ] Invalid signature, stale timestamp, oversized payload and rate-limit requests fail without storing personal payloads in logs.
- [ ] Call return sheet records No answer and the next task at 9am Adelaide time.
- [ ] Chloe booking creates a call; reschedule and cancellation update it; private ICS reflects the change.
- [ ] STOP immediately blocks every SMS path, records consent and cancels SMS drafts.
- [ ] Test ClickSend and Resend only with explicitly approved recipients and appropriate consent. Confirm a functional unsubscribe path.
- [ ] Public quote exposes only the quote, accepts once with name/time/IP/user agent, creates the project/checklist and optional deposit draft, and notifies the owner.
- [ ] Record a partial invoice payment, then settle it. Confirm computed overdue status and owner-only access.
- [ ] Reports show `$100` per enquiry and `none yet ($300 spent)` per customer for three enquiries and no wins.
- [ ] Staff cannot bypass the interface to read invoices/settings, export, delete or change roles. Viewer cannot write.
- [ ] Enable CAPI in a test dataset; one milestone queues one stable event; disabling it prevents delivery. Verify current Meta event-age and conversion-leads setup requirements.
- [ ] Verify scheduler authentication, overlap protection, Adelaide digest time, call reminders and retry behaviour. Confirm Vercel plan frequency; use pg_cron/pg_net if needed.
- [ ] Test iPhone home-screen install and web push, plus read-only offline behaviour and logout cache clearing.
- [ ] Upload a small file and a file larger than 4.5 MB through the signed Storage flow; confirm staff cannot access financial or deleted files. Check temporary export and abandoned-upload cleanup.
- [ ] Run phone/desktop Playwright, keyboard-only navigation, contrast checks and Lighthouse. Record scores rather than assuming targets passed.
- [ ] Verify a person-data export, anonymisation, 30-day bin and retention job in the test database.

## Release

- [ ] Keep fictional seed data out of production. Connect website forwarding and Chloe only after signed test requests pass.
- [ ] Enable the supplied GitHub Actions template with an authorised connection, then verify its first run.
- [ ] Check the integration health panel, first daily digest and first recurring invoice draft.
- [ ] Keep rollback deployment and database backup available. Review permission and provider tests after changes to roles or integration contracts.

Unchecked items are release gates, not claims that production has been verified.
