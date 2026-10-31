# v2.2.0 — Spotify OAuth Integration

Status: DRAFT — unreleased.
Last updated: 23 October 2026.

Deployed Spotify OAuth remains disabled. These notes describe implemented
work on dev and remaining release requirements, not a completed rollout.

## Implemented

- Signed-in application users can connect a Spotify account through
  backend-owned Authorization Code with PKCE.
- Profile controls support connection status, connect, reconnect, and disconnect.
- Spotify connection remains separate from application login.
- Connection status reads use the database without triggering token refresh.
- Backend token refresh coordinates concurrent callers and rejects stale results.
- Credentials are encrypted and remain backend-only.
- Disconnect removes active Spotify connection data and pending transactions.
- Application-account deletion transactionally removes Spotify data,
  Favorites, and owned custom Playlists.
- In-flight callbacks, refreshes, and reads cannot restore invalidated links.
- Privacy/Terms pages, agreement controls, and disconnect instructions are implemented.
- Contact failures are reported accurately when Resend rejects a message.

## Development Mode and reauthorization

Official requirements were rechecked on 22 October 2026.

The Spotify app remains in Development Mode, requiring a Premium app
owner and allowing up to five authenticated, allowlisted Spotify users.
This release does not provide unrestricted public Spotify access.

Spotify documents a six-month refresh-token lifetime starting at user
authorization. Refreshing an access token does not extend that lifetime.
Expired, revoked, or otherwise unusable credentials require reauthorization.

Switching the linked Spotify account requires disconnecting first.
Application disconnect does not promise to revoke Spotify consent:
users can separately remove access through Spotify's Apps page.

## Validation completed

On 22 October 2026:
- Backend: 680 tests across 60 files.
- Frontend: 223 tests across 22 suites.
- Both repositories passed lint, TypeScript, build, and whitespace checks.
- Automated provider boundaries use mocks and database tests use
  isolated temporary MongoDB instances.

Local allowlisted-account linking and connection controls were checked.
Saved Production configuration passed format validation. Required
Production indexes and a transactional read were independently verified.

These results do not establish successful deployed OAuth or browser compatibility.

## Release blockers and remaining checks

- Vercel Runtime Logs displayed fake callback code/state query values.
  No verified pre-storage exclusion control has been established.
- Human clarification of platform logging and retention remains pending.
- Final privacy/agreement and retention/deletion/restore review is incomplete.
- A historical manual database snapshot is documented but has not been located;
  its current existence and deletion status are unverified.
- Deployed cookie/redirect behavior and OAuth lifecycle checks remain pending.
- Chrome and Safari/iOS checks with normal privacy protections remain pending.
- Manual login, Profile, Favorites, and Playlist regressions remain pending.

Do not enable deployed OAuth or publish these notes as a completed release
until the applicable gates are resolved and the dev-to-main process succeeds.

## Scope

This milestone adds account linking and connection management.
It adds no playback controls, Spotify playlist import/synchronization,
or Spotify-based recommendations.

## References

- [Release validation evidence](spotify-release-validation.md)
- [Architecture](spotify-oauth-plan.md)
- [Disconnect and deletion](spotify-disconnect-deletion.md)
- [Backend issue #40](https://github.com/Frantisek82/soundtrack-mood-explorer-backend/issues/40)
- [Frontend issue #44](https://github.com/Frantisek82/soundtrack-mood-explorer-frontend/issues/44)
- [Spotify quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- [Spotify refresh tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)
- [Spotify Apps page](https://www.spotify.com/account/apps/)
