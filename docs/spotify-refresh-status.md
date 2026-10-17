# Spotify token refresh and connection status

Backend implementation for issue #38. See [account linking](spotify-account-linking.md),
[configuration](spotify-configuration.md), and [persistence](spotify-persistence.md).

Disconnect/account-deletion route integration remains in #39, frontend controls
in frontend #44, and production enablement verification in #40.

## Backend-only access-token service

getSpotifyAccessToken() accepts a trusted application user, link generation,
enabled configuration, and optional cancellation signal and clock.

Its result contains a plaintext access token for backend use only. Never expose
that result through a route, browser storage, logs, issue comments, or screenshots.
There is no public token endpoint.

A stored access token is usable only when its validated expiry is more than
60 seconds away. Otherwise, the service coordinates a refresh.

Access expiry comes from the validated provider expires_in value. A successful
refresh without refresh_token preserves the existing encrypted refresh token.
A supplied replacement is encrypted before persistence. Omitted scope metadata
preserves existing scopes; an explicit empty scope string records an empty list.

Refresh does not change originalAuthorizedAt or estimatedRefreshExpiry.
The stored 180-day lifetime is an estimate, not an authoritative expiry signal.
Provider invalid_grant is authoritative and requires reauthorization.

## Cross-instance coordination

A refresh lease has a random owner, a 30-second expiry, and the connection's
generation and token version. Acquisition and persistence coordinate through
the same transactional User generation write used by account linking.

Only the lease owner may persist a result, and only while the lease is unexpired
and the connection generation and token version still match. Writes never upsert.

Concurrent callers wait briefly and reread the database. They do not independently
replay the same refresh while another owner holds the lease. Callers stop waiting
after approximately two seconds or earlier cancellation.

Successful persistence increments tokenVersion and clears the lease.
Same-account reauthorization also increments tokenVersion and clears obsolete leases,
so an older refresh cannot overwrite the newly authorized credentials.

Generation invalidation or User deletion prevents stale refresh persistence.
Provider HTTP always runs outside automatically retried database transactions.

## Failure recovery

- invalid_grant discards both credential envelopes and access expiry, increments
  tokenVersion, and sets reauthorization_required.
- A network failure, timeout after dispatch, malformed success response, or
  uncertain server failure may have rotated the refresh token. Its owner
  conservatively requires reauthorization instead of replaying that token.
- A definite rejected request preserves the connection and credentials, releases
  ownership, increments tokenVersion, and records a cooldown. Valid Retry-After
  values are respected for rate limiting.
- An expired owned lease is an abandoned operation with an uncertain outcome.
  Recovery discards credentials and requires reauthorization without another POST.
  This also conservatively covers a process that crashed before dispatch.
- An ownerless cooldown can expire without discarding credentials.
- Stale successes and failures cannot alter a newer token version or restored link.

Minimal account identity remains stored during reauthorization_required, preserving
the rule that switching Spotify accounts requires disconnecting first.

Provider read outages and definite refresh rejections do not themselves mark the
connection disconnected. An uncertain refresh POST has stricter recovery because
its credential rotation outcome is unknown.

## Safe provider reads

readSpotifyCurrentProfile() demonstrates the backend read policy using only the
fixed https://api.spotify.com/v1/me destination. It validates account_id against
the current connection and returns only a nullable displayName.

Ownership and token version are revalidated before each GET and after a successful
response. Results from a disconnected, deleted, or superseded connection are discarded.

An operation makes at most two GET attempts and one refresh POST:

- A 401 may force one refresh and one GET retry. A token already refreshed by the
  same operation is not refreshed again.
- A persistent 401 requires reauthorization only for the rejected token version.
  It cannot invalidate a newer version or a version owned by an active refresh lease.
- A 403 reports access restriction without refresh or retry loops.
- A 429 permits one retry only with a valid Retry-After that fits the remaining budget.
  Both delay-seconds and canonical HTTP-date forms are supported.
- A network failure or transient 500/502/503/504 response permits one safe GET retry
  with short jitter. The same GET retry budget applies across failure categories.
- Malformed or oversized responses are rejected without partial persistence.

Provider calls have ten-second per-call timeouts. Token acquisition, provider
requests, and retry waits share a twenty-second cancellation budget. Database
transactions use their database timeouts; cleanup may still be needed after
provider cancellation. No additional provider request is dispatched after cancellation.

Token POST requests are never automatically replayed. Responses are limited to
64 KiB, redirects are rejected, and provider requests use cache: no-store.
Errors carry bounded codes and generic messages, never raw provider bodies.

## GET /api/spotify/status

Requires application authentication, an existing User, enabled configuration,
and the configured exact frontend Origin. OPTIONS does not require authentication.

The query is limited to the authenticated user and current link generation,
and selects only status and displayName. It returns an explicit DTO:

- {"state":"disconnected","account":null}
- {"state":"connected","account":{"displayName":"Test Listener"}}
- {"state":"reauthorization_required","account":{"displayName":null}}

displayName may be null in either linked state. No account IDs, credentials,
encryption envelopes, token versions, leases, or provider error text are returned.

Polling does not contact Spotify, decrypt credentials, refresh tokens, or mutate
connection state. Access-token expiry alone does not change the stored link state.

Responses use Cache-Control: no-store and Vary: Origin. Approved origins receive
credentialed CORS headers. Disabled/invalid configuration returns 503,
authentication failures return 401, rejected origins return 403, and unexpected
errors return a generic 500.

## Validation

Automated tests use the isolated MongoDB replica set, fake credentials, test-only
encryption keys, mocked provider HTTP, and injected business clocks.

Coverage includes status serialization, refresh margins, replacement/omitted
refresh tokens, original lifetime preservation, lease concurrency and recovery,
version fencing, cancellation, bounded reads, rate limits, and disconnect/deletion
races. No production database or live Spotify requests are used by these tests.
