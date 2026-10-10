# Spotify configuration foundation

This document covers the helpers introduced in issue #35.

OAuth routes, token storage, and frontend controls are implemented in later
issues. Setting SPOTIFY_ENABLED does not by itself provide a working integration.

Architecture: [Spotify OAuth plan](spotify-oauth-plan.md).

## Backend configuration

Configuration is read lazily through getSpotifyConfig().
OAuth defaults to disabled when SPOTIFY_ENABLED is absent or false.
An enabled but invalid configuration throws a sanitized error without values.

| Variable                      | Purpose                                                               |
| ----------------------------- | --------------------------------------------------------------------- |
| SPOTIFY_ENABLED               | Explicit true/false switch; defaults to false                         |
| SPOTIFY_CLIENT_ID             | Spotify application's 32-character hexadecimal Client ID              |
| SPOTIFY_FRONTEND_ORIGIN       | Exact permitted frontend origin                                       |
| SPOTIFY_REDIRECT_URI          | Exact registered backend callback                                     |
| SPOTIFY_TOKEN_ENCRYPTION_KEYS | JSON keyring mapping key IDs to canonical base64-encoded 32-byte keys |
| SPOTIFY_TOKEN_ACTIVE_KEY_ID   | Existing keyring ID used for new encryption                           |
| VERCEL_ENV                    | Platform-provided deployment environment                              |

The selected backend-owned PKCE flow does not require a Client Secret.

Keep real keys and credentials in private local environment files or deployment
settings, outside Git. Never expose keys through NEXT*PUBLIC* variables, logs,
screenshots, issues, or pull requests. The configuration object contains key
material and must remain backend-only.

Key IDs use 1–64 letters, digits, underscores, or hyphens.
Encryption and operational key rotation are implemented in issue #36.

## Local development

The supported local pair is:

| Setting                      | Value                                      |
| ---------------------------- | ------------------------------------------ |
| Frontend browser address     | http://127.0.0.1:3001                      |
| Backend browser address      | http://127.0.0.1:3000                      |
| Frontend NEXT_PUBLIC_API_URL | http://127.0.0.1:3000/api                  |
| SPOTIFY_FRONTEND_ORIGIN      | http://127.0.0.1:3001                      |
| SPOTIFY_REDIRECT_URI         | http://127.0.0.1:3000/api/spotify/callback |

Privately configure the frontend environment variable and restart its server
when preparing OAuth browser testing. Open both services using 127.0.0.1 and
sign in again: cookies set on localhost do not transfer to 127.0.0.1.

Confirm the actual development ports. Fix unexpected port fallback before
testing rather than mixing configuration values.

The general application CORS helper continues to support localhost and its
existing preview behavior. It also accepts the exact loopback frontend origin
and returns Vary: Origin.

Spotify mutation helpers deliberately use only the configured exact origin.

## Production

The supported production pair is:

| Setting                      | Value                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ |
| SPOTIFY_FRONTEND_ORIGIN      | https://soundtrack-mood-explorer-frontend.vercel.app                     |
| SPOTIFY_REDIRECT_URI         | https://soundtrack-mood-explorer-backend.vercel.app/api/spotify/callback |
| Frontend NEXT_PUBLIC_API_URL | https://soundtrack-mood-explorer-backend.vercel.app/api                  |

Register the production callback in Spotify before deployed OAuth testing.
Its registration remains a release prerequisite in issue #40.

Mixed local/production pairs, trailing slashes, alternate ports, localhost
callbacks, and unrelated origins are rejected. A Vercel production deployment
requires the production pair.

## Preview deployments

When VERCEL_ENV=preview, configuration is disabled even if SPOTIFY_ENABLED=true.
Enabled configuration values are not required or processed in this case.

Do not supply Spotify credentials or encryption keys to preview deployments.
Frontend preview controls are handled in frontend issue #44.

## Spotify request helpers

assertSpotifyMutationRequest() requires enabled configuration and the exact
frontend Origin. POST requires application/json, optionally with parameters
such as charset=utf-8. DELETE does not require a Content-Type header.

Missing Origin, literal null, preview origins, and lookalike hosts are rejected.
These checks supplement application authentication; they do not authenticate
a user or validate callback transactions.

getSpotifyCorsHeaders() returns credentialed, non-cacheable headers only for
the approved origin. It never falls back to a different permitted origin.

spotifyPreflightResponse() accepts OPTIONS for requested GET, POST, or DELETE.
Requested headers may contain only Content-Type, case-insensitively, or be
absent. Preflight requires no application cookie. Rejected requests throw
SpotifyRequestError; future route handlers must map its status/code to a safe
response rather than allowing an uncaught exception.

Status codes used by these helpers:

- 503: integration disabled
- 403: rejected origin or preflight declaration
- 405: unsupported request method
- 415: POST is not JSON

Future routes must also perform application authentication and return no
credentials. Callback navigation uses OAuth transaction validation instead
of the frontend mutation Origin check.

## Transaction cookie

createSpotifyBrowserBinding() generates 32 random bytes encoded as base64url.

setSpotifyTransactionCookie() sets spotify_oauth with:

- HttpOnly
- SameSite=Lax
- Path=/api/spotify
- Max-Age=600
- Secure for the configured HTTPS callback
- No Domain attribute, making it host-only

clearSpotifyTransactionCookie() uses the same path and security attributes,
an empty value, Max-Age=0, and an expired date.

The cookie contains a random browser binding, not Spotify tokens.
Server-side transaction binding, expiry, and replay protection follow in #37.

## Validation

Automated tests cover configuration, exact-origin rejection, preflight
behavior, and cookie creation/clearing using fake values.

Run the full backend checks:

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

Manual OAuth browser verification follows once the routes and frontend exist.
