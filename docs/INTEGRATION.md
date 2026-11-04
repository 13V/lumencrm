# Lumen CRM integration contracts

Contract version: 1. All timestamps are ISO 8601 with an explicit offset; stored as `timestamptz`. Display and working-hour calculations use `Australia/Adelaide`, including daylight saving. Amounts are AUD. Set secrets in Vercel environment settings, never in source or a chat.

This document defines the target integration contract for the phased build. The phase checklist in README is the source of truth for which routes are implemented and verified. Do not point live integrations at a phase that has not passed its acceptance checks.

## Shared signed ingest

The three routes accept UTF-8 JSON:

- `POST /api/ingest/website-lead`
- `POST /api/ingest/meta-lead`
- `POST /api/ingest/chloe-event`

Headers:

```http
Content-Type: application/json
X-Lumen-Timestamp: 1793768867
X-Lumen-Signature: sha256=<64 hexadecimal characters>
```

The signature is `HMAC-SHA256(CRM_INGEST_SECRET, timestamp + "." + rawBody)`. Sign the exact body bytes transmitted, including whitespace and any final newline. Do not parse and re-serialise between signing and sending. The timestamp is Unix seconds. Requests more than 300 seconds old or ahead are rejected. The digest comparison is constant time. Body limit: 65,536 bytes. Rate limit: 60 authenticated requests per minute per route/source, enforced in the database so separate server instances share the limit.

Success is `200`:

```json
{
  "ok": true,
  "deal_id": "a36c7171-7a96-46dd-bf1c-1d13b62355df",
  "url": "https://crm.lumenadl.com/leads/a36c7171-7a96-46dd-bf1c-1d13b62355df",
  "duplicate": false
}
```

A repeated upstream identity returns the same deal and `duplicate: true`, also `200`. Idempotency is enforced by a unique database key inside the same transaction as the lead write, not an in-memory cache. A successful response means the core records are durable. Notifications and provider requests run after the response through durable jobs. Core contact matching must finish before returning the definitive `deal_id`; only ancillary work can be deferred. The two-second acceptance target must be measured against the deployed Sydney database and functions.

Failure shapes:

```json
{"error":"Invalid signature"}
```

`401` for an absent/invalid signature or an expired timestamp.

```json
{"error":"Invalid input","fields":{"name":["Name is required"],"event_id":["Event ID is required"]}}
```

`400` for malformed JSON or invalid fields. Error text may vary; consumers should branch on HTTP status and the `fields` keys.

```json
{"error":"Rate limit exceeded","retry_after":60}
```

`429` with `Retry-After: 60`. Oversized bodies return `413`. A missing server configuration returns `503`; a database failure returns `500` without personal data. Retry network failures, `429` and `5xx` with bounded exponential backoff and the same upstream identity. Re-sign each retry using its current timestamp; the body and idempotency identity stay unchanged. Never retry a `400` or `401` indefinitely.

### Signed curl example

The following is a POSIX shell example. Put the ingest secret in the process environment through your secret manager; it is read by Node, not written into the command arguments. This sample uses a fictional number and `example.com` email.

```sh
cat > /tmp/lumen-example.json <<'JSON'
{"name":"Dave Example","email":"dave@example.com","phone":"0491 570 156","business":"Example Electrical","website":"","service":"Website","message":"A new website for our local electrical business","source":"tradie-websites-landing","page_url":"https://www.lumenadl.com/tradie-websites","referrer":"","landing_url":"https://www.lumenadl.com/tradie-websites","landing_referrer":"","utm_source":"facebook","utm_medium":"paid_social","utm_campaign":"2610_tradies_founder","utm_term":"2610_tradies_founder_set1","utm_content":"2610_tradies_offer_h1_v1","event_id":"fictional-contract-test-001","fbp":"","fbc":"","promise":"by Wednesday 11 November","details":{"Your trade":"Electrician"},"received_at":"2026-11-04T05:07:47Z"}
JSON
export LUMEN_REQUEST_TIMESTAMP="$(date +%s)"
signature="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHmac} from "node:crypto"; const secret=process.env.CRM_INGEST_SECRET; if(!secret) throw new Error("Set CRM_INGEST_SECRET in the environment"); process.stdout.write("sha256="+createHmac("sha256",secret).update(process.env.LUMEN_REQUEST_TIMESTAMP+".").update(readFileSync("/tmp/lumen-example.json")).digest("hex"));')"
curl --fail-with-body "${APP_URL}/api/ingest/website-lead" \
  -H 'Content-Type: application/json' \
  -H "X-Lumen-Timestamp: ${LUMEN_REQUEST_TIMESTAMP}" \
  -H "X-Lumen-Signature: ${signature}" \
  --data-binary @/tmp/lumen-example.json
```

The same procedure signs Meta and Chloe JSON files. Do not enable shell tracing (`set -x`) while using secrets.

### Contact matching and returning enquiries

Phone numbers are parsed with `libphonenumber-js`, default region AU, then stored as E.164. Email is trimmed and lowercased. Match phone first, then email. A matching contact with an open deal receives another `form` activity and the deal's `returning` flag. A closed deal does not reopen automatically: a fresh deal is created for the existing contact. Conflicting phone/email ownership requires a human review; never merge unrelated identities silently. Unique indexes and transaction locks prevent concurrent duplicate contacts.

Keep the first attribution row. A subsequent form is preserved in its activity without overwriting the first source. `integration_inbox` stores source, key, time, status, error code and result IDs only; it never stores the body or personal details.

## Website lead

Required: nonblank `name`, nonblank `event_id`, and at least one valid `phone` or `email`. Requiring `event_id` makes retry identity explicit; callers that previously omitted it must generate one once per submitted form.

All string fields are trimmed. Empty optional strings are accepted and represented internally as absent values. Unknown source labels are accepted. The full JSON example above is the canonical request.

| Fields | Maximum characters |
| --- | ---: |
| `name`, `business` | 200 |
| `email` | 254 |
| `phone` | 50 |
| `website` | 500 |
| `service`, `source`, `event_id` | 100 |
| `message` | 5,000 |
| `page_url`, `landing_url`, `referrer`, `landing_referrer` | 2,000 |
| `fbp`, `utm_source`, `utm_medium` | 200 |
| `fbc` | 500 |
| `utm_campaign`, `utm_term`, `utm_content` | 300 |
| `promise` | 80 |

`details` is an object of at most 10 string label/value pairs. Labels are limited to 200 characters and values to 2,000. `received_at` is optional ISO 8601; omit it to use the server receive time. It must not be used as an authentication timestamp.

Known `source` labels are seeded in editable Settings:

| Source | Friendly label |
| --- | --- |
| `tradie-websites-landing`, `tradie-landing` | Tradie website enquiry |
| `business-card` | Business card |
| `contact` | Contact form |
| `realestate-landing` | Real estate website enquiry |
| `dental-landing` | Dental website enquiry |
| `medical-landing` | Medical website enquiry |
| `law-firm-landing`, `law-firm-websites` | Law firm website enquiry |
| `allied-health-websites` | Allied health website enquiry |
| `local-seo-landing` | Local SEO enquiry |
| `ai-automation-landing` | AI automation enquiry |
| `southern-landing` | Southern Adelaide enquiry |
| `regional-landing` | Regional enquiry |

`promise` is preserved verbatim as `promised_text`. Explicit dates, today/tomorrow and named weekdays are interpreted in Adelaide time; the task is due at 3pm. A date without a year uses the receipt year. Past dates stay overdue rather than silently rolling into next year. An ambiguous or impossible date leaves `promised_due_at` empty and creates a review task. Never discard the original promise.

## Meta instant-form lead

Required: `leadgen_id`, `name`, and one of `phone`/`email`. `created_time` is an ISO timestamp when supplied. Optional strings are trimmed. `platform` accepts `fb` or `ig`; unknown platform values are stored without being interpreted as permission to contact. `is_organic` is a boolean.

```json
{
  "leadgen_id": "1234567890123456",
  "form_id": "1234567890123457",
  "form_name": "Tradie website enquiries",
  "created_time": "2026-11-04T05:07:47Z",
  "ad_id": "1234567890123458",
  "ad_name": "2610_tradies_offer_h1_v1",
  "adset_id": "1234567890123459",
  "adset_name": "2610_tradies_founder_set1",
  "campaign_id": "1234567890123460",
  "campaign_name": "2610_tradies_founder",
  "platform": "fb",
  "is_organic": false,
  "name": "Dave Example",
  "phone": "+61491570156",
  "email": "dave@example.com",
  "business": "Example Electrical",
  "answers": [{ "label": "What's your trade?", "value": "Electrician" }]
}
```

IDs stay strings: JavaScript numbers cannot safely represent every Meta ID. `leadgen_id` is the idempotency key. Meta IDs: max 100 characters; names: max 300; `name`/`business`: 200; phone/email limits match the website contract. `answers` contains at most 10 items with label max 200 and value max 2,000. The example IDs are illustrative, not valid Meta test identities. Do not send them to the live CAPI endpoint.

The website remains responsible for fetching the actual Meta lead and handing it to Chloe. CRM ingest does not register a second Meta webhook or send a duplicate `Lead` event.

## Chloe event

Required: `type`, E.164 `phone`, `at` ISO timestamp. Identity is exactly `chloe:{phone}:{at}:{type}`. Preserve the event's original `at` on retries. Two messages with the same type and phone must have different event timestamps.

```json
{
  "type": "booked",
  "phone": "+61491570156",
  "lead_id": "1234567890123456",
  "at": "2026-11-04T05:07:47Z",
  "text": "",
  "status": "booked",
  "fields": {
    "trade": "Electrician",
    "areas": "Morphett Vale and nearby suburbs",
    "current_website": "",
    "goals": "Explain the services and make it easy to call",
    "logo_and_photos": "Logo available",
    "timing": "Discuss on the call",
    "decision_makers": "Owner",
    "notes": "Prefers a short call"
  },
  "call_time": "2026-11-05T00:30:00Z",
  "reason": ""
}
```

Types: `started`, `message_in`, `message_out`, `fields`, `booked`, `rescheduled`, `cancelled`, `handoff`, `stopped`, `done`, `human`. Statuses: `queued`, `active`, `booked`, `handoff`, `done`, `stopped`, `human`. `text` max 5,000; `reason` max 2,000; each known `fields` value max 2,000. `booked`/`rescheduled` require `call_time`. The call duration is configured in Settings, default 15 minutes. A booking outside the configured hours or holiday calendar must be flagged for review rather than moved to another time silently.

| Event | Durable effect |
| --- | --- |
| `started` | Chloe status activity and active state |
| `message_in` | `chloe_in` activity; first reply sets `two_way_at` |
| `message_out` | `chloe_out` activity; first outbound attempt sets `first_touch_at` |
| `fields` | Merge supplied fields into Chloe's collected facts |
| `booked` | Create a call, record Call booked milestone, prepare task and reminder |
| `rescheduled` | Update the current Chloe appointment; preserve the event in the timeline |
| `cancelled` | Cancel the current Chloe appointment and its pending reminder |
| `handoff` | Handoff state and an owner task |
| `stopped` | SMS opt-out consent; cancel SMS drafts; block all SMS actions |
| `done` | Done state and timeline activity |
| `human` | Human state and timeline activity |

`message_in` applies even if Chloe is not handling the lead. A message containing only STOP (case-insensitive, allowing whitespace/punctuation), STOPALL, UNSUBSCRIBE, CANCEL, END or QUIT triggers opt-out immediately. An opted-out contact must never be re-enabled by later `fields`, `started` or message events.

Prefer `lead_id` to associate a known Meta deal, then normalised phone. Out-of-order events may append to the timeline but must not erase newer state or an earlier first-touch/milestone timestamp. Unknown contacts are kept for review as a Chloe enquiry; do not lose a STOP just because the original lead has not arrived yet.

### Take over

Only expose Take over if `CHLOE_TAKEOVER_URL` is configured. The server sends:

```json
{"phone":"+61491570156"}
```

Use the same timestamp/HMAC headers and `CRM_INGEST_SECRET`. The configured URL must use HTTPS in production. A failed request must be shown to Troy and must not pretend Chloe has stopped. No client may choose an arbitrary takeover URL.

## ClickSend SMS

Official [ClickSend REST v3 documentation](https://developers.clicksend.com/docs/rest/v3/) was checked on 4 November 2026. Send to `POST https://rest.clicksend.com/v3/sms/send` using HTTP Basic authentication with `CLICKSEND_USERNAME:CLICKSEND_API_KEY`.

```json
{
  "messages": [{
    "source": "Lumen CRM",
    "from": "<CLICKSEND_FROM>",
    "to": "+61491570156",
    "body": "<owner-approved text>"
  }]
}
```

Check both HTTP status and per-message provider status. `SUCCESS` means queued, not delivered. Store the provider `message_id` and status on `sms_out`. The UI counts GSM-7 extension characters as two units and Unicode using UTF-16 units; multipart limits are 153/67 units. Warn above three segments. ClickSend's billing and final segmentation remain authoritative.

No separate inbound callback is registered. The existing website ClickSend receiver forwards every inbound message through the Chloe event contract. `sms:` fallback opens the user's phone and logs an attempt only when the user explicitly confirms; opening Messages is not evidence of delivery.

Before sending, check current consent, channel opt-out and `do_not_contact` inside the server transaction. Identify Lumen and include a working opt-out instruction in commercial messages. Templates alone do not establish consent. The same block applies to phone-message links. Review ClickSend's Australian sender requirements in the account before live sending.

## Resend email

Official [Send Email API](https://resend.com/docs/api-reference/emails/send-email) was checked on 4 November 2026. `POST https://api.resend.com/emails`, `Authorization: Bearer RESEND_API_KEY`.

```json
{
  "from": "<CRM_EMAIL_FROM>",
  "to": ["dave@example.com"],
  "subject": "Your Lumen adl quote",
  "text": "<owner-approved plain text>",
  "html": "<escaped text inside the Lumen wrapper>"
}
```

The response contains an `id`; API success is acceptance for sending, not proof of delivery. Use a verified sending domain and log `email_out` with provider ID. Escape all template values before HTML rendering. Block opted-out recipients server-side. Include a reply-based unsubscribe instruction for individually sent commercial email; process requests immediately. Keep `mailto:` as an explicit fallback. Resend supports the [`Idempotency-Key` header](https://resend.com/docs/dashboard/emails/idempotency-keys) for 24 hours; the CRM also keeps its own durable request identity beyond that window.

### Authenticated message composer API

`GET /api/messages?deal_id={uuid}&channel=sms|email` returns `{ templates, configured, consent: { allowed, reason }, takeover_configured }`. Templates have `id`, `name`, `body`, `subject` and `channel`. This endpoint requires an owner or staff session and reads current consent; hiding a button alone is insufficient protection.

`POST /api/messages` accepts `{ deal_id, request_id, channel, body, subject?, confirm_long_sms? }`. `request_id` is a fresh UUID for one explicit send decision and is retained on network retries. `subject` is required for email. No provider request occurs if consent fails (`409`). SMS exceeding three segments returns `422` with `segments` and the exact `preview` before reserving the send, unless `confirm_long_sms` is true. A missing provider configuration returns `503`. The composer displays the identification and unsubscribe footer that the server also enforces.

Success returns `{ ok: true, activity_id, status: "queued", segments? }`. A repeated request returns `{ ok: true, duplicate: true, activity_id, message }` and never sends again. A timed-out provider call is recorded as `unknown`; Troy must check its provider delivery log before approving another send. The system does not silently retry ambiguous client messages. `POST /api/messages/takeover` accepts `{ deal_id }` and updates human status only after the configured Chloe endpoint confirms success.

## Telegram

Official [Bot API sendMessage](https://core.telegram.org/bots/api#sendmessage) was checked on 4 November 2026. `POST https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage` with JSON `chat_id`, `text` and optionally `reply_markup.inline_keyboard`. Use a plain text message and a URL button linking to the authenticated CRM. Never log the endpoint because the bot token is in its URL.

```json
{
  "chat_id": "<TELEGRAM_CHAT_ID>",
  "text": "A new enquiry is waiting in Lumen CRM.",
  "reply_markup": { "inline_keyboard": [[{ "text": "Open CRM", "url": "https://crm.lumenadl.com/today" }]] }
}
```

Check the response's `ok` flag, not HTTP status alone. Notifications use stable keys to prevent duplicate reminders. Digest defaults to 7:30am Adelaide, Monday–Saturday. Speed nudge is once per lead after the configured working-minute target. Call reminders are due 15 minutes before the appointment. These go to Troy, never automatically to clients.

## Web push

VAPID keys: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Store endpoint subscriptions against the authenticated user. Push payloads use a general title and an authenticated CRM deep link; avoid names, phone numbers or message content on lock screens. Delete expired subscriptions on provider `404`/`410`. A service worker notification click focuses the existing app or opens its CRM route.

On iPhone, enable notifications after adding the app to the home screen; permission requests must follow a user gesture. Validate on a supported real iPhone at go-live. Events are new lead, call in 15 minutes, quote accepted and a reply requiring human attention.

## Meta stage events

CAPI is off by default. Settings holds enabled state, test event code and stage mapping. `META_CAPI_TOKEN` is server-only. Endpoint:

```text
POST https://graph.facebook.com/{META_API_VERSION}/{META_PIXEL_ID}/events
```

Default API version: `v26.0`, overridable through the environment. Validate the configured version in Meta's app dashboard before enabling. Send access credentials in the request body or an authorised header; never put the token in application logs. The request envelope is `{ "data": [event], "test_event_code": "..." }` with the optional test code only when configured.

| Milestone | Default event |
| --- | --- |
| `contacted` | `TwoWayContact` |
| `suitable` | `QualifiedLead` |
| `call_booked` | `Schedule` |
| `demo` | `DemoSent` |
| `quote` | `QuoteSent` |
| `won` | `Purchase` |

Stable event ID: `crm:{deal_id}:{milestone}`. Event time is the first milestone timestamp in Unix seconds. The outbox unique constraint ensures exactly one queued event per milestone. Do not change event time on retries. Skip events older than seven days and record an age-expired status. Re-check the enabled switch immediately before each send; turning off stops queued events as well as new ones. Retry transient provider errors with exponential backoff, capped at one hour. Never store raw names, email or phone in `capi_outbox` or its error logs.

Normalised website-origin contact data uses SHA-256: email trimmed/lowercase, phone digits including country code, first/last names trimmed/lowercase with punctuation removed (preserving UTF-8 letters), country `au`, and contact UUID as `external_id`. `fbp` and `fbc` stay unhashed. Set an accurate `action_source` for the milestone (such as `phone_call` or `chat`); a manually changed stage with no reliable channel uses `other`. Do not claim a conversion occurred on the website merely because the original lead came from it. A `website` event requires the actual event URL and browser user agent.

Instant-form events use this distinct shape:

```json
{
  "event_name": "QualifiedLead",
  "event_time": 1793768867,
  "event_id": "crm:a36c7171-7a96-46dd-bf1c-1d13b62355df:suitable",
  "action_source": "system_generated",
  "user_data": { "lead_id": "1234567890123456" },
  "custom_data": { "event_source": "crm", "lead_event_source": "Lumen CRM" }
}
```

Purchase adds `custom_data.value` equal to the one-off build value and `currency: "AUD"`. Never add hosting MRR to purchase value. The `lead_id` must be a genuine retrieved Meta lead. A stage timestamp must be after lead generation. Test events are not a licence to send fabricated identities.

### Meta documentation findings and discrepancy

Official pages checked on 4 November 2026:

- [Implementing the CRM integration](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/crm-integration/3-implementing-the-crm-integration)
- [Conversion Leads payload specification](https://developers.facebook.com/documentation/ads-commerce/conversions-api/conversion-leads-integration/payload-specification)
- [Server event parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/server-event)
- [Customer information parameters](https://developers.facebook.com/documentation/ads-commerce/conversions-api/parameters/customer-information-parameters)

The CRM-specific Conversion Leads payload is for Meta instant-form leads; Meta explicitly warns against using it for website leads. The documented backfill window is seven days.

**Check before enabling Conversion Leads optimisation:** Meta asks for every stage, including the initial raw lead, while the brief forbids this CRM from sending `Lead` because the website already sends it. The implementation preserves that boundary. Ensure the website's initial Meta instant-form event reaches the same dataset using the correct CRM payload, or configure a separate initial CRM stage event name with the website developer. The default mapping alone should not be presented as a complete Conversion Leads training integration. No extra raw `Lead` is sent silently.

## Ad spend import

Use the read-only `META_ADS_READ_TOKEN` with `ads_read` and `META_AD_ACCOUNT_ID`. Call the account Insights endpoint with `level=ad`, `time_increment=1`, a seven-day inclusive `time_range`, and these official fields:

```text
account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions,date_start,date_stop
```

Map `inline_link_clicks` to `link_clicks`. Lead actions are read from the `actions` array; do not invent a `meta_leads` API field. Reconcile the selected lead action type with Ads Manager to avoid double-counting aggregate and specific lead action entries. Follow pagination until exhausted. Upsert `(date, ad_id)` so attribution revisions replace the previous seven days rather than duplicate spend. Meta account reporting dates follow the ad account timezone; configure Adelaide and verify it at go-live.

Joining is exact ID for instant forms, otherwise exact `utm_content` to ad name. Campaign name is a fallback only when ad matching fails. Ambiguous reused names must be shown as unresolved, never joined to every matching ad and multiplied.

Official reference: [Insights API](https://developers.facebook.com/docs/marketing-api/insights/). Run daily at 6:05am Adelaide and keep failure/status metadata free of personal data.

## Outcomes export

`GET /api/export/outcomes`, header `Authorization: Bearer OUTCOMES_EXPORT_TOKEN`. The token is separate from user sessions and ingest. Invalid or missing token: `401`. No names, contact details, message content, browser IDs or raw payloads are returned.

```json
{
  "as_of": "2026-11-04T05:07:47Z",
  "campaigns": {
    "1234567890123460": {
      "name": "2610_tradies_founder",
      "enquiries": 3,
      "contacted": 2,
      "suitable": 1,
      "call_booked": 1,
      "brief": 1,
      "demo": 0,
      "quote": 0,
      "won": 0,
      "won_value": 0,
      "median_first_touch_mins": 4
    }
  },
  "ads": {
    "2610_tradies_offer_h1_v1": {
      "enquiries": 3,
      "contacted": 2,
      "suitable": 1,
      "call_booked": 1,
      "brief": 1,
      "demo": 0,
      "quote": 0,
      "won": 0,
      "won_value": 0,
      "median_first_touch_mins": 4
    }
  }
}
```

For a website campaign with no Meta ID, use a documented `name:{utm_campaign}` key. Unattributed records use `unattributed`. Empty speed observations produce `null`; counts remain integers. Funnel counts use first-reached milestones, grouped by enquiry creation cohort when date filters are supplied. Soft-deleted/anonymised records retain only anonymous report eligibility and counts.

## Session-authenticated reports

`GET /api/reports` requires an owner or viewer session. It uses that user's normal Supabase RLS client; there is no service-role bypass. Optional filters are `source`, `campaign`, `adset`, `ad`, `trade`, `from`, `to`, and `cohort=week|month`. Dates are valid `YYYY-MM-DD` calendar dates and are inclusive in Adelaide time. An invalid filter returns `400` with field errors. Responses are private and never cached.

The response contains `sample`, filter options, `funnel`, `cohorts`, `speed`, `ads` (campaign/ad set/ad arrays), `presales`, `pipeline`, `clients`, and `calculator_defaults`. It contains aggregate numbers and group labels, never contact names, phone numbers, email addresses, raw attribution or individual deal IDs. Every funnel rate includes its numerator and enquiry-cohort denominator. Empty speed/cost samples are `null`. A campaign-only attribution match is kept separate at ad/ad-set level, with unknown spend represented by `null`; spend is never multiplied across enquiries or guessed across ads with identical names.

Source/trade filters narrow enquiry outcomes; ad spend remains the spend of the selected ads and dates. Client MRR and invoice balances describe the current portfolio independently of enquiry filters, while cancellation counts use the selected date period. Churn is shown as cancellations because the schema does not retain historical subscription status snapshots from which to compute a defensible churn rate.

## Private calendar feed

`GET /api/calendar/{token}.ics`. Tokens are 32 random bytes encoded base64url. Store a hash, support revocation, and return `404` for invalid/revoked tokens. Treat the full URL as a secret. No login cookie is needed because native calendar clients use the token. Return `Content-Type: text/calendar; charset=utf-8` and `Cache-Control: private, no-store`.

Emit stable `UID`, UTC `DTSTAMP`, `DTSTART`, `DTEND`, escaped `SUMMARY`/`DESCRIPTION`, and `STATUS:CANCELLED` for cancelled appointments so subscribed calendars can remove them. Escape commas, semicolons, backslashes and newlines, and fold lines by UTF-8 octets. Avoid unneeded phone numbers or personal notes in the feed. Calendar refresh timing is controlled by the client, so it is not a real-time notification channel.

## Jobs and scheduling

`GET /api/jobs` (or its documented POST equivalent), header `Authorization: Bearer CRON_SECRET`. Invalid secret: `401`. A successful run returns status counts and IDs only. Each effect has a stable deduplication key, so retries and overlapping ticks are safe. Required jobs are five-minute reminders, the Adelaide digest, spend import, outbox retries, quote expiry, overdue invoice drafts, subscription billing drafts and retention.

Run the scheduler every five minutes and evaluate local Adelaide calendar/time in the worker. Do not hard-code a single UTC offset: Adelaide changes between UTC+9:30 and UTC+10:30. The daily digest and spend import acquire a once-per-local-date job key. If the Vercel plan cannot run that often, use Supabase `pg_cron` with `pg_net`, keeping the bearer secret in Supabase Vault.

The opt-in deployment script is [`supabase/schedules.sql`](../supabase/schedules.sql). It is outside the migrations directory and is never applied by the app or test suite. After setting the named Vault secrets, run it deliberately in the intended project's SQL Editor. It validates prerequisites without printing the secret, installs the named five-minute schedule, and includes status-only verification and an unschedule command. Do not enable a second scheduler when another service already invokes `/api/jobs`.

No scheduled CRM job sends clients a message. They create drafts, tasks and notifications for Troy. Chloe remains the only automatic lead texter and stays on the website.

The implemented worker accepts both GET and POST at `/api/jobs`; it returns `{ ok, as_of, jobs: { job_name: { status, count } } }`. Statuses include `done`, `busy`, `failed`, `disabled` and `not_configured`. `503` means at least one job failed or the worker could not start. Each job acquires a database lease before work; completed daily/weekly keys are not repeated. Interrupted notification and CAPI claims can be recovered after ten minutes. Provider responses and contact details never appear in job errors.

Use the following Supabase SQL after enabling `pg_cron` and `pg_net`. First add `lumen_crm_url` and `lumen_cron_secret` through the Supabase Vault interface. The latter must exactly match Vercel's `CRON_SECRET`; the URL is the HTTPS CRM origin. No secret literal belongs in this SQL or source control.

```sql
select cron.schedule(
  'lumen-crm-five-minute-jobs',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lumen_crm_url') || '/api/jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'lumen_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
```

Do not create a second scheduler if Vercel already runs the five-minute tick. Inspect `net._http_response` and Cron run history after setup. Confirm your Supabase `pg_net` version accepts the shown timeout; its API is marked beta. Official references: [scheduling with Vault](https://supabase.com/docs/guides/functions/schedule-functions), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net), and [Supabase Cron](https://supabase.com/docs/guides/cron). Keep backup/export database roles out of cron and Vault; the application exports through the service-only job boundary, not an extra login role.

Supabase's current [scheduler documentation](https://supabase.com/docs/guides/functions/schedule-functions) notes that `pg_net` temporarily stores decrypted headers in its request queue. Keep the `net` schema out of exposed Data API schemas, restrict direct database LOGIN roles and dashboard access, and inspect only response status fields when checking this job. Vault values and queued request headers must not be copied to logs or support messages.

### Weekly encrypted backup

Set `BACKUP_ENCRYPTION_KEY` in Vercel to a cryptographically generated 32-byte key encoded as standard base64. Keep a separate recovery copy in your password manager. The job does not run without it. `crm-backups` is private and has no browser read policy.

Once per Adelaide week (Monday identity, after 3am), the worker exports public CRM tables in pages of 100 rows. Every chunk is encrypted with AES-256-GCM and a fresh 12-byte nonce before upload. Object paths are authenticated as additional data. The binary format is UTF-8 `LUMENB1\n`, the 12-byte nonce, the 16-byte authentication tag, then ciphertext. The manifest is encrypted with the same format and includes each chunk's path, table, row count and SHA-256 checksum of its encrypted bytes. Only a completed manifest marks a restorable export. Keys and plain rows are never stored in the backup bucket.

Paths are `weekly/{Monday-date}/{table}/{six-digit-page}.jsonl.enc` and `weekly/{Monday-date}/manifest.json.enc`. Exports older than 35 days are removed, limiting how long deleted personal data survives in secondary backups. This is a paginated logical export, not a transaction-consistent PostgreSQL snapshot. It does not copy Auth credentials or Storage object contents. Enable Supabase daily database backups and appropriate Storage backup coverage separately; those remain the primary disaster-recovery mechanism.

For recovery, use a disposable Sydney project first: download the encrypted manifest and its listed chunks, decrypt with the saved key and exact object path as AAD, verify the manifest's encrypted-byte checksums, then import rows in foreign-key order with triggers reviewed. The tested `decryptBackup` helper describes the exact format. Run and record this restore drill before go-live. Do not restore a stale backup into production without reapplying deletion/opt-out events that occurred afterward.

## Supabase authentication and Realtime

Official sources checked on 4 November 2026:

- [SSR client and Next.js proxy](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs)
- [Multi-factor authentication and assurance levels](https://supabase.com/docs/guides/auth/auth-mfa)
- [Row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Server-readable email templates and invitation token hashes](https://supabase.com/docs/guides/auth/auth-email-templates)

Use `@supabase/ssr` cookie clients. Verify identity with `getClaims()` (or server-verified `getUser()` where a fresh user record is needed), not an unvalidated session object. Preserve refreshed cookies on the final proxy response. Private pages and session-bearing responses are not shared-cacheable. Owner access requires the verified `aal2` claim in both the application and database policies; magic link alone is insufficient. No profile or role is trusted from editable user metadata.

Configure hosted Auth email templates from `supabase/templates/`. Invitations use `/auth/callback?token_hash={{ .TokenHash }}&type=invite`; magic links use `type=email`. The callback verifies the hash server-side and then claims only a matching pending invitation. It also accepts standard PKCE `code` callbacks. Admin invitation links cannot rely on a PKCE verifier created in the inviter's browser. Unsupported OTP actions are rejected and failed membership claims sign out the session.

Supabase service-role access is limited to signed ingest and jobs (plus the explicit server-side account administration boundary). Browser code uses the public anonymous key and authenticated RLS. Enable Realtime on deals, activities, tasks and appointments; the client refetches authorised data when events arrive. It must never subscribe with the service-role key.

## CSV and privacy

CSV import is an owner-only, two-step flow: column mapping and dry-run validation first, explicit apply second. Normalise identities using the same helper as ingest. Explain every skipped/invalid row and offer duplicates for review. CSV exports must escape formula prefixes (`=`, `+`, `-`, `@`, tabs and carriage returns) before spreadsheet use. Export is owner-only at both route and RLS boundaries.

Use only fictional data in tests and previews. ACMA's [numbers reserved for creative works](https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works) were verified on 4 November 2026; the seed uses those exact numbers and `example.com` email addresses. Never derive extra mobile numbers by incrementing a reserved number.

### Owner data routes

- `POST /api/data/import`: `{ "csv": "First name,Phone\nAlex,0491 570 156", "entity": "deals", "dry_run": true }`. The response includes `request_id`, detected `headers`, proposed `mapping`, validated `rows`, `valid_count` and `error_count`. Review or change the column mapping, then repeat the request with the same `request_id`, mapping and CSV and `dry_run: false`. A maximum of 1,000 rows/2 MB is accepted. Completed row receipts prevent duplication on retries. A contacts-only import creates no deals.
- `GET /api/data/export?entity=deals` returns CSV. `entity=all` returns a ZIP of supported tables and a manifest. Optional `ids` is a comma-separated UUID list for a single entity; `from`/`to` are ISO timestamps filtering creation dates. Formula prefixes are escaped. Exports exclude authentication material and capability tokens. Large downloads redirect to a temporary owner-only Storage object; cleanup is scheduled after one hour.
- `POST /api/data/person`: `{ "contact_id": "uuid", "action": "export" }` returns the person's related data; `action: "anonymise"` removes personal fields and revokes public capabilities while retaining anonymous counts. A `207` response means database redaction completed but Storage removal needs retry; do not report that all bytes were removed. The scheduled cleanup retries the original queued paths.
- `GET /api/data/bin` lists restorable deleted records. `POST` with `{ "entity": "deals", "id": "uuid" }` restores a supported record within 30 days. Anonymised and merged identities cannot be restored.

All mutations require the same-origin session and owner access. Ordinary staff cannot use these routes, even if they manually construct a request. They are separate from the counts-only bearer export used by the ads agent.

### Files

`GET /api/files?entity=deal&entity_id=uuid` returns authorised file metadata and short-lived download links. Uploads use a signed direct-to-Storage handshake, followed by server confirmation of metadata, size and supported file signatures; the UI never sends a 25 MB body through Vercel. Pending uploads are hidden from unrelated users and abandoned uploads are reaped. `DELETE /api/files` is owner-only and uses the bin. Staff cannot access quote/invoice files. See [Vercel function payload limits](https://vercel.com/docs/functions/limitations) and [Supabase signed uploads](https://supabase.com/docs/reference/javascript/storage-from-uploadtosignedurl).

### Optional draft-only AI

Set `AI_PROVIDER_API_KEY` and optionally `AI_MODEL` in Vercel. Enable `ai_enabled` in owner Settings separately; the default is off. The adapter uses [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) with a model from the [official model list](https://platform.claude.com/docs/en/models/overview). The configured default is `claude-haiku-5-5`; the checked API version is `2026-10-21`. No provider key or tool execution is exposed to the browser.

`GET /api/ai` returns availability, never a key. Owner-only `POST /api/ai` accepts `{ "action": "summary|reply", "deal_id": "uuid" }` or `{ "action": "parse", "text": "pasted details" }`. The selected lead context, up to 30 timeline entries and active price list are sent to the provider. Responses are `{ "draft": "...", "draft_only": true }`; parse returns a validated object as `draft`. The endpoint never writes the draft into a record or sends a message. The UI requires review and copying before use. Review personal-data disclosures before enabling this optional integration.
