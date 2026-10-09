# Spotify OAuth requirements and implementation plan

Status: proposed architecture; implementation has not started.

Milestone: v2.2.0 – Spotify OAuth Integration. Planning issue: [#33](https://github.com/Frantisek82/soundtrack-mood-explorer-backend/issues/33).

Official references and account configuration checked on **9 October 2026**. Recheck provider requirements before release. Architecture choices below are project decisions, not claims that Spotify requires this exact design.

## 1. Purpose and scope

Connect Spotify to an already authenticated Soundtrack Mood Explorer user. Demonstrate account linking, secure credential persistence, refresh, status, disconnect, and automated testing. Application login remains email/password plus the existing JWT cookie.

Excluded: Spotify login/registration, playback, playlist import or synchronization, recommendations, commercial launch planning, and unrelated refactoring. Existing soundtrack discovery, Favorites, and application playlists continue to work without Spotify.

## 2. Access feasibility

Dashboard evidence supplied by the app owner confirms:

| Setting                      | Evidence as of verification date                          |
| ---------------------------- | --------------------------------------------------------- |
| Application                  | Soundtrack Mood Explorer, successfully created            |
| Owner subscription           | Premium Duo screenshot; assumed same account as Dashboard |
| Mode                         | Development mode                                          |
| Client ID                    | Available; value intentionally omitted                    |
| API                          | Web API                                                   |
| Allowlist                    | 1 of 5 users added; owner's testing account               |
| Registered callback          | `http://127.0.0.1:3000/api/spotify/callback`              |
| Refresh-token lifetime shown | 180 days                                                  |
| Client Secret                | Not collected; unnecessary for selected PKCE flow         |

Development Mode requires an owner with Premium and allows five authenticated users. Non-allowlisted users can reach authorization but their Web API calls can return 403. Extended access is not automatic: current partner eligibility includes a registered organization, launched service and at least 250,000 monthly active users, followed by approval. This milestone is an allowlisted portfolio demonstration, not unrestricted public Spotify access. See [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Configuration feasibility is established. Successful authorization, token exchange, basic profile access, and deployed browser behavior remain manual implementation checks. Do not claim end-to-end access is already verified.

## 3. Environment and redirects

| Setting                        | Local                                        | Production                                                                 |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------- |
| Frontend origin                | `http://127.0.0.1:3001`                      | `https://soundtrack-mood-explorer-frontend.vercel.app`                     |
| Backend origin                 | `http://127.0.0.1:3000`                      | `https://soundtrack-mood-explorer-backend.vercel.app`                      |
| Frontend `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:3000/api`                  | `https://soundtrack-mood-explorer-backend.vercel.app/api`                  |
| `SPOTIFY_REDIRECT_URI`         | `http://127.0.0.1:3000/api/spotify/callback` | `https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback` |

The production callback is planned and **not yet confirmed registered**. Register it before deployed testing. Use exact configured values, never construct callbacks or return destinations from Host headers or request query parameters. HTTPS is required except explicit loopback IPs; Spotify rejects `localhost` callbacks. See [redirect requirements](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).

Open both local applications on `127.0.0.1`, update the frontend variable and restart it, and add the exact frontend loopback origin to backend CORS. Sign in again there: a cookie on localhost does not move to 127.0.0.1. Confirm actual server ports; unexpected port fallback requires fixing the port or deliberately updating every corresponding setting.

OAuth is disabled on Vercel Preview deployments, both frontend and backend. Do not inject Spotify credentials into previews or use production OAuth from preview pages. Stable production and local origins alone may start or disconnect Spotify. Existing broad preview CORS matching does not authorize Spotify mutations.

Backend environment names: `SPOTIFY_ENABLED` (default false), `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI`, `SPOTIFY_FRONTEND_ORIGIN`, `SPOTIFY_TOKEN_ENCRYPTION_KEYS`, `SPOTIFY_TOKEN_ACTIVE_KEY_ID`. The keyring maps version identifiers to base64-encoded 32-byte keys. Keep keys outside MongoDB and Git, privately configured in deployment environment settings. Never prefix encryption keys with `NEXT_PUBLIC_`. No actual credentials or keys belong in examples, issues, screenshots or PRs.

## 4. OAuth flow choice

| Flow                         | Token endpoint authentication                                                     | Assessment                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Backend Authorization Code   | Client ID and secret using HTTP Basic                                             | Supported confidential-backend option; requires secret management                     |
| Authorization Code with PKCE | Client ID plus transaction verifier; no client secret in documented PKCE exchange | Selected: code bound to a unique verifier; all exchange and storage remain on backend |

Use Spotify's documented **Authorization Code with PKCE**, S256 only. This is a backend-owned flow even though Spotify's example demonstrates browser storage. Do not copy its browser token-storage pattern. Native Node crypto and fetch suffice; no Spotify SDK is planned. See [Code flow](https://developer.spotify.com/documentation/web-api/tutorials/code-flow) and [PKCE flow](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow).

Connection start requires a valid application cookie AND an existing User record. POST with an exact permitted Origin and JSON content type provides the mutation's CSRF boundary; reject absent, null and unapproved origins. CORS alone is not CSRF protection. Callback is top-level navigation and instead uses transaction checks.

Generate separate random values using Node crypto: 32-byte state, browser binding and PKCE verifier, encoded base64url. Derive the challenge with base64url(SHA-256(verifier)). Store state and browser-binding hashes, encrypted verifier, initiating user ID, application JWT hash, user link generation, exact redirect URI and a ten-minute expiry in a separate OAuth transaction collection. Unique state-hash index; TTL cleanup, with explicit expiry validation because TTL deletion is asynchronous.

Set a ten-minute, host-only `spotify_oauth` browser-binding cookie, HttpOnly, Path=/api/spotify, SameSite=Lax, Secure on HTTPS. Clear it with matching attributes on completion. Permit one current transaction per browser; a new start supersedes the old browser cookie. Use a fixed cookie name, not a cookie per state.

Return the constructed Spotify authorization URL to the frontend, which navigates the current tab. Include client_id, response_type=code, configured redirect_uri, state, code_challenge_method=S256 and challenge. Omit optional scopes initially.

Callback must validate the current application JWT, User existence, initiating user, exact initiating JWT hash, binding cookie hash, state hash, expiry and generation. Session replacement requires restarting the flow. Reject duplicate callback parameters, missing/empty/oversized values, both code and error together, missing state, expired transaction and replay. Atomically consume a matching transaction before any provider request; only one callback wins. Invalid input never exchanges a code or changes an existing connection.

Validate state and binding for denial too. On valid `access_denied`, consume and report denial without altering existing connection data. Code exchange uses the decrypted verifier and configured callback. Require validated token response and successful GET /me before persisting the connection. Timeout or ambiguous code-exchange failure requires a fresh connection attempt, not replaying the code.

## 5. Identity, scopes and account policy

Only GET `https://api.spotify.com/v1/me` is needed to establish identity. Consume `account_id` and nullable `display_name`; discard other response fields. Spotify identifies `account_id` as immutable and warns against linking by `id`. Never link by email or display name. Reject a missing or malformed account_id; do not silently fall back. See [current profile](https://developer.spotify.com/documentation/web-api/reference/get-current-users-profile).

Start with no optional scopes. Private subscription/country and email fields are unnecessary, so omit `user-read-private` and `user-read-email`. The reference lists these scopes alongside field restrictions: verify the minimal request with an allowlisted account during implementation. If basic identity is unavailable without a scope, stop and update this decision with official evidence before expanding permissions.

One Spotify account per application user; one application user per Spotify account, enforced with unique database indexes. Reject linking an account already owned by another application user with a generic conflict. Reauthorization of the same account replaces credentials only on full success. A different Spotify account cannot silently replace an existing link: disconnect first. Failed reconnects preserve the previous connection. No account merging or transfer is included.

## 6. Persistence, encryption and serialization

Use a separate SpotifyConnection collection: unique userId, unique accountId, optional displayName, status, grantedScopes, originalAuthorizedAt, estimatedRefreshExpiry, accessExpiresAt, encrypted access/refresh envelopes, generation, tokenVersion and refresh lease fields. Token envelopes use AES-256-GCM, fresh random 12-byte IV per encryption, authentication tag, key ID and ciphertext. Bind additional authenticated data to user ID, generation and token purpose. Reject tampering, invalid keys or unknown key IDs; never fall back to plaintext.

Select credential fields explicitly only inside backend services (`select: false` by default). Build explicit status DTOs; never serialize Mongoose connection records, encrypted envelopes, provider responses or errors. Change /api/user/me to an explicit existing-public-field allowlist before adding internal User fields. Review all User serialization call sites.

Maintain a monotonic `spotifyLinkGeneration` on User (default zero for existing users). Start transactions capture it. Disconnect increments it. Callback persistence runs in a MongoDB transaction that conditionally writes the same User at the captured generation and creates/updates the connection. Disconnect and account deletion use the same User as their transaction coordination record. A stale callback cannot upsert a connection after disconnect or deletion. Unique indexes must be built and verified before enabling OAuth.

External HTTP calls occur outside database transactions. After HTTP returns, persistence must revalidate ownership, generation and version. Never retry a provider call inside an automatically retried MongoDB transaction. Production and tests for these guarantees require transaction-capable MongoDB; add an isolated MongoMemoryReplSet configuration while preserving the existing safety guards. Fail closed if transactions are unavailable.

## 7. API contract and frontend behavior

| Route                          | Authentication and behavior                                                              | Success                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| POST /api/spotify/connect      | Application cookie, existing User, exact Origin and JSON; create transaction             | 200 `{ "authorizationUrl": "https://accounts.spotify.com/authorize?..." }` |
| GET /api/spotify/callback      | Session, state, binding and transaction ownership; validate, consume, exchange, link     | 303 to fixed frontend destination                                          |
| GET /api/spotify/status        | Application cookie and existing User; database-only read                                 | 200 explicit DTO                                                           |
| DELETE /api/spotify/disconnect | Application cookie, existing User, exact Origin; invalidate transactions and remove data | 204, idempotent                                                            |

Start/status return 401 for absent/invalid session or missing User; mutation origin failures return 403, conflict 409, configuration disabled 503, and unexpected failure 500 with a generic message. No credential appears in any API response. Credentialed OPTIONS requests use exact permitted origins; add Vary: Origin. Connection endpoints use Cache-Control: no-store.

Status DTO: `{ "state": "disconnected", "account": null }`, or connected/reauthorization_required with `{ "displayName": "..." }` (nullable). No refresh is triggered by status polling. Only backend provider operations request a fresh access token. Do not mark provider outages as disconnected.

Before frontend implementation, inspect its actual profile route and select one fixed callback destination within it; document that path here. This route name is still unverified. Return only a bounded result enum: connected, denied, invalid_transaction, session_expired, account_conflict or provider_error. Never include code, state, verifier, provider error text or tokens in frontend redirects. Callback errors use that same trusted destination; frontend fetches status after returning. Callback responses set Referrer-Policy: no-referrer and no-store.

Frontend provides Connect, Reconnect and Disconnect; recognizes all three states; explains allowlisted demonstration access; exposes no token endpoint. Connection does not create or replace application login. Disable OAuth controls in previews.

## 8. Token lifecycle and provider failures

Compute accessExpiresAt from receipt time plus validated expires_in; use a 60-second refresh margin. Preserve refresh token when a successful refresh omits a replacement; encrypt and persist replacements when supplied. Preserve originalAuthorizedAt across refreshes. Dashboard shows 180 days and official docs say six months: record the dashboard lifetime as an estimate from original authorization, never extend it on refresh, and treat provider invalid_grant as authoritative. Fresh authorization starts a new lifetime. See [refresh guide](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens) and [expiry announcement](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration).

Refresh coordination must work across serverless instances: atomically acquire a database lease scoped to connection generation/version, with random owner and bounded expiry. Losers wait only within a short request budget and reread; they do not refresh independently. Persist only if lease owner, generation and tokenVersion still match, without upsert. Fencing/version checks reject late results. On ambiguous refresh failure, do not automatically reuse a possibly rotated refresh token; require reauthorization if recovery cannot be established safely.

On invalid_grant, discard both credentials and set reauthorization_required conditionally at the same generation/version. Keep minimal linking identity until disconnect so a different account cannot bypass the account-switch policy. No refresh loop or automatic authorization redirect.

| Failure                   | Policy                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| API 401                   | Refresh once, retry the read once; persistent 401 requires reauthorization                                  |
| API 403                   | No refresh loop; report access restriction, including possible allowlist or scope issue                     |
| API 429                   | Respect valid Retry-After; return a retryable application failure rather than waiting beyond request budget |
| Network/5xx               | Bounded failure; at most one retry for safe GET, with jitter; token POSTs get no automatic replay           |
| Invalid JSON/token fields | Reject; no partial persistence                                                                              |

Use ten-second per-call timeout and a twenty-second overall provider-operation budget. Never log authorization headers, cookies, codes, verifier, query strings, token bodies or full provider error objects. Check deployment access logging for callback query exposure before enablement. Log only sanitized event names, status and correlation identifiers.

## 9. Disconnect, account deletion and privacy

Disconnect transaction increments User generation, deletes SpotifyConnection and every pending transaction for the user, and clears the current browser binding cookie. Account deletion coordinates through the same User write and removes connections/transactions before deleting User. Existing application data cleanup must remain intact; the inspected deletion route omits custom Playlist cleanup, which should be tracked explicitly as an account-deletion defect rather than silently documented as complete.

In-flight callbacks/refreshes cannot restore deleted credentials. Cancel local HTTP work where possible; cross-instance work already dispatched may finish, but must discard results and never initiate more processing for the disconnected generation. Success is returned only after database cleanup commits; a failure is not reported as successful disconnect.

Local disconnect deletes our data and stops access. It does not promise to revoke Spotify's consent. Explain how users remove access through Spotify's [Apps page](https://www.spotify.com/account/apps/); see [Spotify support](https://support.spotify.com/article/spotify-on-other-apps/).

Before real-user enablement, display a privacy notice covering identity, encrypted tokens, purpose, storage/processors, retention, cookies, contact and deletion; provide the required end-user agreement. Spotify policy requires accessible disconnect and deletion; terms also specify deletion within five days for account-linking disconnection requests. Target immediate active-data deletion. Audit logs, caches and backups, document retention, and prevent restored backups from resurrecting disconnected data. If backup deletion cannot meet obligations, resolve before enablement. No Spotify-derived data is used for advertising or AI features in this milestone. Follow applicable branding for Connect UI. See [policy](https://developer.spotify.com/policy), [terms](https://developer.spotify.com/terms), and [design guidance](https://developer.spotify.com/documentation/design).

## 10. Verification

Reuse Vitest, Node environment, tests/\*_/_.test.ts, sequential files and isolated MongoDB. Use fake provider responses at the fetch boundary, real crypto and persistence, injected clock and test-only keys. No live Spotify calls, real credentials or production database in automated tests. Add guards so unexpected provider HTTP cannot escape mocks.

Cover: URL construction/minimal scopes; state/verifier randomness and S256; cookie flags; missing/expired/mismatched/replayed/wrong-user/replaced-session transactions; denial and duplicate query parameters; missing User; encrypted persistence/tampering/key versions; safe API/profile serialization; unique ownership conflicts; failed reconnect preservation; omitted/replaced refresh tokens; expiry/invalid_grant; timeout/401/403/429/5xx; concurrent callbacks and refreshes; disconnect/reconnect and deletion races. Use the replica-set test foundation for transactional checks. Preserve existing authentication, Favorites, Playlists and database safety tests.

Manual browser checks use allowlisted accounts and a dedicated development database where possible. Verify localhost-to-loopback migration, session cookies, consent/denial, status/reconnect/disconnect, deleted-account rejection, stable deployed callbacks and blocked previews. Test Chrome and Safari/iOS without assuming users will disable privacy protections. If cross-site cookies are blocked, record the integration as unsupported until deployment topology is addressed. Never log real credential material while testing.

Documentation-only validation: review source links, requirement coverage and git diff --check. No application tests need to be rerun solely for this document. Implementation PRs run lint, tests, TypeScript and build checks according to repository workflow.

## 11. Ordered implementation issues

These are proposed titles, not created issues or completed work.

1. **Prepare Spotify configuration, exact origins and cookie handling** — validated config, preview disablement, loopback CORS, mutation Origin checks, transaction cookie helpers and local setup instructions; frontend environment dependency.
2. **Add encrypted Spotify persistence and transactional test foundation** — connections/transactions, indexes, User generation and safe serialization, key lifecycle, replica-set isolation and transaction/concurrency checks.
3. **Implement Spotify PKCE start, callback and stable account linking** — single-use browser/session binding, provider validation, duplicate policy, fixed redirects and callback tests. Requires verified frontend destination.
4. **Implement Spotify token refresh and connection status** — distributed lease/fencing, expiry, invalid_grant, retry budgets, safe status contract and lifecycle tests.
5. **Implement Spotify disconnect and account-deletion cleanup** — generation invalidation, transactional cleanup, in-flight protection, revocation guidance and deletion regression tests. Coordinate separately tracked Playlist deletion defect.
6. **Add frontend Spotify connection controls and required notices** — profile UI, states/errors, fixed return destination, privacy/end-user disclosures, demonstration limits and frontend tests.
7. **Validate deployed Spotify integration and finish milestone documentation** — register production callback, private environment setup, logging/backup review, manual browser checks, regression validation and release notes.

Keep tests with their implementation issues. Open frontend dependencies before callback implementation so the fixed destination and result contract agree. Merge focused PRs into dev, then perform milestone validation before releasing through main.

## 12. Remaining gates

- Verify selected minimal-scope /me access and PKCE exchange with the allowlisted account during implementation.
- Inspect frontend routes and record the exact fixed callback destination before implementing redirects.
- Register production callback before deployed testing.
- Verify transaction support/index creation, secure key configuration, privacy/end-user notices, callback log redaction and backup deletion behavior before enabling real-user OAuth.
- Complete local/deployed browser checks before claiming milestone acceptance.

Issue #33 closes only after this plan is committed/reviewed and the ordered follow-up issues and dependencies are recorded. End-to-end manual verification belongs to implementation/release issues; public Spotify access remains outside this milestone.
