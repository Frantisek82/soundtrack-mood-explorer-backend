# Spotify disconnect and account deletion

Implemented for issue #39. See [account linking](spotify-account-linking.md),
[refresh/status](spotify-refresh-status.md), and [persistence](spotify-persistence.md).

Official Spotify disconnect/revocation guidance checked on 17 October 2026:
- https://support.spotify.com/article/spotify-on-other-apps/
- https://developer.spotify.com/policy

## DELETE /api/spotify/disconnect

Requires an authenticated application user, an existing User record, enabled
Spotify configuration, and the exact configured frontend Origin.

The service transactionally:
1. Increments the User's Spotify link generation.
2. Deletes the complete SpotifyConnection record, including credentials and profile data.
3. Deletes every pending SpotifyOAuthTransaction for that user.

The route returns an empty 204 only after commit. Repeated disconnects remain safe.
No disconnected personal-data record is retained.

The application account, Favorites, and custom Playlists remain intact.
Disconnect does not clear the application authentication cookie.

After commit, the current browser's host-only spotify_oauth cookie is cleared
using its matching path, SameSite, HttpOnly, and transport-dependent Secure settings.
Cookies in other browsers cannot be cleared remotely; their server-side transactions
have been deleted, so they cannot complete the old authorization flow.

Disabled/invalid configuration returns 503, authentication failures return 401,
rejected origins return 403, and generation races return 409. Unexpected cleanup
failures return a generic 500 without clearing cookies or reporting success.

Responses are non-cacheable. Approved origins receive credentialed CORS headers.
No Spotify HTTP request or undocumented provider revocation endpoint is used.

## Application-account deletion

DELETE /api/user/me coordinates through the same User-generation transaction.
It removes the User, Favorites, owned custom Playlists, Spotify connection,
and pending OAuth transactions.

Spotify cleanup works even when Spotify is disabled or its configuration is invalid.
The success contract remains 200 {"message":"Account deleted successfully"}.
The current browser's authentication and Spotify transaction cookies are cleared
only after commit. Cleanup failure rolls back all changes and returns a generic 500.

Owned custom Playlist cleanup is implemented in #45 within the same transaction.
Other users' Playlists and shared Soundtrack catalogue records are preserved.
Active-database cleanup does not establish deletion from backups or historical
copies; operational verification remains in #40.

This work does not redesign application-wide JWT revocation. Spotify routes
require an existing User and reject sessions for deleted users.

## In-flight work and reconnects

Callbacks, refreshes, and provider profile reads register local cancellation scopes
before database generation validation and provider dispatch.

After cleanup commits, older-generation work in the same process is aborted.
Rollback does not cancel work for a generation that remains valid. Registry entries
are removed after completion, failure, or invalidation and contain no credentials.

This registry is local to a running server instance. Cross-instance protection
comes from database generation, token-version, and lease-owner checks.
Requests already dispatched elsewhere may finish, but late results are discarded
and invalidated operations cannot issue subsequent reads or restore the link.

A later reconnect starts with the current generation. Old transactions, callback
results, and refresh results cannot overwrite it.

## Separately revoke Spotify consent

Disconnect removes Soundtrack Mood Explorer's active Spotify data and stops its
access. It does not promise to revoke Spotify's server-side consent.

To separately remove Spotify permission:
1. Open https://www.spotify.com/account/apps/ and sign in to Spotify.
2. Find Soundtrack Mood Explorer.
3. Choose Remove Access.

Removing access in Spotify does not itself delete this application's account or
prove deletion of copies held by this application. Use local disconnect/account
deletion as appropriate as well.

Frontend #44 must provide accessible disconnect controls and clear instructions.
General-user OAuth enablement remains blocked until that work and #40 are complete.

## Active data, caches, logs, and retention

| Location | Implemented behavior or remaining verification |
| --- | --- |
| Active MongoDB Spotify records | Connection and all pending transactions are deleted in the committed cleanup transaction. |
| Current browser cookies | Transaction cookie is cleared on disconnect; authentication cookie is also cleared on account deletion. |
| Other browsers | Old transaction cookies may remain until expiry, but deleted server transactions and generation checks reject them. |
| Process memory | Local work is cancelled and registry entries removed. Transient plaintext credentials are not a persistent cache; immediate memory zeroing is not guaranteed. |
| HTTP responses | Spotify connection routes use no-store; no public token endpoint exists. |
| Application logs | Spotify handlers use sanitized failures and do not log raw provider bodies or credentials. |
| Development access logs | Next.js incoming-request logging is disabled to avoid callback query-string logging. |
| Deployment/third-party logs | Actual collection, redaction, access controls, and retention still require verification in #40. |
| Backups, snapshots, exports, and point-in-time history | Actual availability, retention periods, deletion handling, and restore procedures remain unverified in #40. |

Deleting live records does not prove deletion from backups or database history.
The development database shares a cluster with production, so do not assume that
development records are excluded from any cluster-level backup configuration.

No backup-erasure deadline, physical-storage erasure guarantee, or verified
retention period is claimed by this implementation.

## Restore safeguards and enablement blockers

A restored snapshot could restore deleted Users, credentials, transactions, and
older generation counters. Live-database generation fencing alone cannot detect
that rollback of history.

Before enabling general-user OAuth, #40 must:
- Inventory backups, snapshots, exports, point-in-time recovery, and third-party logs.
- Record actual retention periods, access restrictions, and deletion procedures.
- Establish and test a restore process that keeps restored data quarantined.
- Prevent restored Spotify credentials/transactions from becoming usable before
  deletion obligations are reapplied; clearing restored credentials and requiring
  fresh authorization is one safeguard to evaluate.
- Establish how account-deletion requests survive a restore and are reapplied.
- Verify deployment callback log redaction and privacy/end-user disclosures.
- Verify owned Playlist cleanup (#45) during deployed account-deletion checks.
- Complete frontend disconnect instructions and local/deployed browser validation.

These are unresolved operational gates, not completed capabilities. Keep OAuth
disabled for general users while they remain unresolved.

## Validation

Tests use isolated transaction-capable MongoDB, fake credentials, and mocked HTTP.
Coverage includes authentication, exact disconnect Origin checks, cookie clearing,
idempotence, owner isolation, rollback, current-generation reconnects, local
cancellation, cross-instance generation fencing, and callback/refresh/read races.
