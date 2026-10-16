# Spotify account linking

Backend implementation for issue #37.

See [configuration](spotify-configuration.md),
[persistence](spotify-persistence.md), and
[architecture](spotify-oauth-plan.md).

## Current scope

Implemented:

- Authenticated connection start.
- Backend-owned Authorization Code with S256 PKCE.
- Session/browser-bound transactions with explicit expiry and replay rejection.
- Spotify token exchange and basic profile validation.
- Encrypted account linking and same-account reauthorization.
- Fixed callback redirects with bounded result codes.

Frontend controls, connection-status and refresh services, and disconnect/account
deletion route integration follow in #44, #38, and #39 respectively.

Keep OAuth disabled for general users until the remaining enablement requirements
are resolved. Automated tests do not establish live Spotify access.

## POST /api/spotify/connect

Requires:

- Enabled, valid configuration outside Preview deployments.
- Exact configured frontend Origin.
- application/json media type.
- A valid application JWT cookie referencing an existing User.
- Successful persistence readiness verification.

The route ignores request-body identity and redirect fields. User ID, generation,
and session come from verified backend authentication. Callers can send {}.

Success returns 200 with only:

```json
{ "authorizationUrl": "https://accounts.spotify.com/authorize?..." }
```

A ten-minute HttpOnly browser-binding cookie is set separately.
The existing application authentication cookie is not replaced.

OPTIONS supports approved credentialed preflight without requiring authentication.

Failures include 401 for invalid authentication, 403 for rejected origins,
415 for an unsupported POST media type, 409 if linking state changes during
start, and 503 for disabled or unavailable configuration/persistence.

## GET /api/spotify/callback

The route validates callback parameters, the current application session,
browser-binding cookie, initiating session hash, state, expiry, ownership,
generation, and configured callback URI.

Valid transactions are atomically consumed before provider HTTP.
Only one concurrent callback can consume a transaction. Expired transactions
are rejected explicitly even if TTL housekeeping has not deleted them.

Validated denial and provider-error callbacks also consume their transaction,
without exchanging a code or modifying an existing connection.

For successful authorization, the backend:

1. Decrypts the PKCE verifier.
2. Exchanges the code at Spotify's fixed token endpoint.
3. Validates token fields and derives access expiry from expires_in.
4. Fetches /me and requires immutable account_id.
5. Rechecks application authentication and User generation.
6. Encrypts and persists credentials in a generation-guarded transaction.

Provider requests happen outside database transactions. Requests use ten-second
per-call and twenty-second overall deadlines, bounded JSON bodies, no redirect
following, and no automatic retries.

Only account_id and nullable display_name are retained from the profile.
There is no email/id fallback for account linking. No optional scopes are
requested; live minimal-scope identity access remains to be verified.

## Ownership and reauthorization

One application user can link one Spotify account.
One Spotify account can belong to one application user.

Same-account reauthorization replaces credentials only after successful provider
validation. It increments tokenVersion and clears an obsolete refresh lease.

A different account cannot replace an existing link without disconnecting first.
Conflicts or failed provider requests preserve the previous connection.

Generation changes or User deletion prevent in-flight provider results from
restoring a connection.

The refresh expiry stored at authorization is a 180-day estimate from token
receipt, not a provider-supplied expiry guarantee. Refresh handling must respect
Spotify's authoritative responses and original-authorization lifetime rules.

## Return contract

With valid enabled configuration, callback outcomes return HTTP 303 to:

/profile?spotify=<result>

The origin comes from validated configuration. No caller-supplied return
destination is accepted.

Results: connected, denied, invalid_transaction, session_expired,
account_conflict, or provider_error.

Responses clear the transaction cookie with matching attributes and set
Cache-Control: no-store and Referrer-Policy: no-referrer.

Disabled or invalid configuration returns a generic 503 without redirecting.

The result parameter is a notification, not proof of connection. Frontend #44
must fetch authenticated status, process only recognized single result values,
remove the notification after processing, and preserve a session-expired notice
when redirecting from /profile to the fixed /login route.

## Credentials and errors

Never return or log authorization codes, state, browser bindings, verifiers,
tokens, provider bodies, or raw exceptions.

The provider service returns plaintext credentials only to backend code for
immediate encryption. It must never be serialized as a route response.

Callback failures expose only bounded result codes.

## Verification

Automated tests use fake keys/credentials, mocked provider HTTP, and isolated
transaction-capable MongoDB.

Coverage includes authorization construction, session/browser ownership, expiry,
replay, concurrent consumption, denial, malformed callbacks, provider failures,
stable identity, ownership conflicts, safe serialization, and invalidation or
User deletion during provider requests.

Manual local verification is still pending. Before that check, privately confirm
a dedicated development database and separate development encryption keys.
Do not share environment values, tokens, cookie contents, or authorization URLs.

Production registration, logging/privacy/deletion safeguards, and deployed
browser validation remain tracked in #40.

## Manual local verification — 2026-10-16

An application test user registered and signed in using the separate
`soundtrack-explorer-dev` database and restricted development database user.

The local OAuth flow reached Spotify login and returned to
`http://127.0.0.1:3001/profile?spotify=connected` using the allowlisted
Spotify account. No optional scopes were requested.

Next.js development incoming-request logging is disabled to avoid logging
callback query strings. Production logging verification remains in #40.
Frontend connection controls and result notifications remain in frontend #44.
