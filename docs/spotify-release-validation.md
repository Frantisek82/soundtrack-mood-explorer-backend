# Spotify v2.2.0 release validation

Issue: #40
Status: in progress; release and production OAuth enablement are not complete.

## Implementation baseline

- Backend dev includes contact fix #48, merged through PR #49 as 33d07a8.
- Backend validation on 20 October 2026: 659 tests across 58 files,
  ESLint, TypeScript, production build, and whitespace checks passed.
- Frontend controls merged through frontend PR #45 as b4a40ce.
- Frontend validation on 19 October 2026: 221 tests across 22 suites,
  ESLint, TypeScript, production build, and whitespace checks passed.
- Frontend #44 remains open for privacy/agreement review, deployed checks,
  and Chrome/Safari/iOS verification.

## Provider documentation review

Official Spotify documentation checked on 19 October 2026:

- Development Mode requires a Premium app owner and supports up to five
  authenticated, allowlisted Spotify users:
  https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- Production redirect URIs require HTTPS and exact matching. Explicit
  loopback IP addresses may use HTTP; localhost is not accepted:
  https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- PKCE uses S256:
  https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

This documentation review does not verify private dashboard configuration.

## Atlas backup inventory — 20 October 2026

Evidence: maintainer-supplied Atlas overview and Backup-page screenshots.

- Cluster tier displayed: FREE.
- Cluster overview displayed Backups: OFF.
- Backup page displayed upgrade options, rather than configured snapshots.
- No enabled customer backup schedule or point-in-time recovery was
  evidenced in the inspected screens.
- The maintainer reports no known manual database copies or exports.
  This is a maintainer statement, not an exhaustive search of every device.
- Development and production databases share this cluster.

These observations do not establish MongoDB's internal storage-erasure
timing or service-provider retention. No immediate physical-erasure
guarantee is claimed.

Restore safeguards remain unresolved. Before introducing backups, exports,
or restores, define and test a procedure that prevents restored Spotify
credentials and deleted accounts from becoming usable before deletion
obligations are reapplied. Live generation fencing alone does not protect
against restoring older database history.

## Contact processing

Code inspection confirms contact details and message content are sent
through Resend to the configured recipient mailbox.

Fix #48 checks provider acceptance and sanitizes application error logging.
Provider acceptance does not prove mailbox delivery.

Remaining:
- Verify controlled mailbox receipt.
- Inventory Resend and recipient-mailbox retention and deletion behavior.
- Update the frontend privacy notice to identify Resend and mailbox processing.

## Remaining release evidence

Private production configuration, Spotify dashboard settings, persistence
readiness, Preview disablement, deployment logging, retention/deletion,
restore safeguards, and deployed/browser checks remain pending.

Local frontend checks recorded on 19 October 2026 passed for connection
status, connect, reconnect, disconnect, refresh persistence, keyboard use,
and correct display of the maintainer's name.

Do not mark deployed or cross-browser checks complete from local evidence.

## Release process

Latest published backend release remains v2.1.2.
Changes merge through reviewed PRs into dev. After validation succeeds,
follow the existing release PR process from dev into main.
No v2.2.0 publication or version change has been performed.

## Resend retention review — 20 October 2026

The maintainer's dashboard shows the Free transactional plan.

Official reference checked on 20 October 2026:
https://resend.com/security/gdpr

Resend documents:
- Email and log retention of 30 days on the Free plan.
- Backups persisting for 7 days.
- Contacting support for removal of a specific message before expiry.
- Customer data storage in the United States.

These are provider-documented practices, not independently tested erasure
guarantees. They do not establish retention of the recipient mailbox.

Recipient-mailbox provider, forwarding/copies, retention arrangements,
and controlled delivery verification remain pending.

## Recipient mailbox policy — 20 October 2026

The maintainer confirms:
- Contact messages arrive in a personal Gmail account.
- Messages are not forwarded or downloaded into another mailbox/app.

For ordinary project enquiries, the maintainer will manually delete the
conversation, including replies, within 30 days after resolution and
permanently remove those messages from Trash.

This is a manual operating policy, not automated deletion.
It applies separately from Resend's retention and does not establish
immediate erasure from Google's internal systems.

Controlled contact delivery verification and updating the frontend privacy
notice with Resend, Gmail, and this policy remain pending.

## Frontend disclosure update — 20 October 2026

Frontend PR #46 merged into dev as 7bc1b79.

The Privacy notice identifies Resend and personal Gmail processing,
documents provider retention separately from manual mailbox deletion,
and explains that account deletion does not automatically delete contact
correspondence.

Six notice tests, lint, TypeScript, production build, whitespace checks,
and PR CI passed.

This completes the disclosure update identified during contact review.
Controlled mailbox delivery and the remaining #40/#44 verification
are still pending.

## Controlled contact delivery — 20 October 2026

The maintainer confirms that one controlled message submitted through the
local Contact page:
- Produced a success response in the frontend.
- Showed Delivered in Resend.
- Arrived in the configured Gmail mailbox.

The message contained test text only. No credentials, addresses, message
contents, or provider identifiers are included in this record.

This verifies local application-to-Resend-to-Gmail delivery.
It does not verify the deployed contact route or complete the remaining
Spotify deployment, logging, privacy, restore, or browser checks.

## Vercel logging inventory — 20 October 2026

The maintainer reports:
- Team plan: Hobby.
- Backend Logs offers Last 30 minutes and Last hour.
- Team Settings > Drains displays only an upgrade prompt;
  no configured drain was visible.

This records dashboard-visible history and settings, not a guarantee
of erasure from every provider system.

Callback query-string exposure and credential exclusion still require
a controlled probe using fake values. No real OAuth code, state, token,
or cookie should be used for that probe.

## Preview callback logging probe — 20 October 2026

The maintainer inspected a dev-branch Preview deployment using fake query
values only.

Observed:
- GET /api/spotify/callback returned HTTP 503.
- Vercel reported no outgoing requests.
- Vercel request details displayed both fake code and state values
  under Search Params.

Result:
- Preview callback was unavailable as intended.
- Platform query-string exclusion is NOT satisfied.

This was platform request metadata, not a raw application error message.
Disabling Next.js development request logging does not resolve this finding.

The deployed OAuth logging requirement remains blocked. No verified
platform redaction/exclusion control or alternative deployment arrangement
has yet been established. Keep deployed OAuth disabled until a solution
is validated with another fake-value probe.

Reference:
https://vercel.com/docs/logs/runtime

## Vercel clarification requested — 21 October 2026

The maintainer posted a public configuration question:
https://community.vercel.com/t/exclude-oauth-callback-query-parameters-from-runtime-logs-before-storage-hobby/51106

The question asks whether Runtime Logs can exclude or redact OAuth code/state
query values before ingestion/storage, and which plan and exact setting
would provide that control.

No confirmed answer or validated remedy has been recorded.
The logging requirement remains unresolved and deployed OAuth stays disabled.

## Spotify dashboard verification — 21 October 2026

The maintainer confirms:
- App status is Development Mode.
- The app owner's Premium subscription is active.
- The testing account is allowlisted.

Saved dashboard settings show both redirect URIs:
- https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback
- http://127.0.0.1:3000/api/spotify/callback

This verifies callback registration, not successful deployed authorization.
Deployed OAuth remains disabled while the logging blocker is unresolved.

## Production environment inventory — 21 October 2026

The maintainer inspected Vercel's Production-scoped backend variables:
- SPOTIFY_ENABLED is false.
- SPOTIFY_CLIENT_ID is present.
- SPOTIFY_TOKEN_ENCRYPTION_KEYS is present.
- SPOTIFY_TOKEN_ACTIVE_KEY_ID is present.

The following saved values differed and were corrected:
- SPOTIFY_FRONTEND_ORIGIN:
  https://soundtrack-mood-explorer-frontend.vercel.app
- SPOTIFY_REDIRECT_URI:
  https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback

This verifies saved configuration only. Active deployment values,
encryption-key validity, indexes, and transaction readiness remain unverified.
No secret values were recorded. Deployed OAuth remains disabled.

## Production CLI verification limitation — 21 October 2026

Vercel CLI 65.0.0 was authenticated and linked to the existing backend project.

An initial env run loaded .env.local, so its output was unsuitable as
evidence of saved Production configuration.

A second attempt ran from an empty temporary directory with the Production
environment, team scope, and project explicitly selected. The CLI reported
that four Secret values could not be pulled. None of the six expected
Spotify settings was available to the validation command.

Result: CLI verification is inconclusive. This does not establish that
saved Production configuration is invalid. Secret protections were not
weakened, and no database or Spotify requests were made.

Production configuration validity and active-deployment readiness remain
unverified. Deployed OAuth remains disabled.

## Production configuration verifier prepared — 21 October 2026

Added scripts/verify-spotify-production-config.mjs.

The script requires VERCEL_ENV=production and SPOTIFY_ENABLED=false.
It validates an enabled copy of the configuration without changing the
process environment. Output is a fixed PASS/FAIL message without secrets.

It imports only the configuration parser and makes no database or
Spotify requests. It is not attached to the build command.

Validation passed: 34 targeted tests, ESLint, TypeScript, and whitespace
checks. Script tests use isolated environments and fake credentials.

Execution against actual Production settings remains pending.
