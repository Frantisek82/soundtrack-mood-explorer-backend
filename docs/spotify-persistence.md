# Spotify encrypted persistence foundation

Implemented for issue #36. Connection-start and callback integration is
documented in [account linking](spotify-account-linking.md). Refresh coordination
is documented in [refresh and status](spotify-refresh-status.md).
Disconnect route integration follows in #39.

See [configuration](spotify-configuration.md) and
[architecture](spotify-oauth-plan.md).

## Models and public responses

SpotifyConnection stores account ownership, lifecycle metadata, encrypted
credentials, link generation, token version, and refresh-lease metadata.

Unique indexes enforce one connection per application user and one application
user per Spotify account. Credential and lease fields are excluded from
ordinary queries. Direct document JSON serialization is blocked.

SpotifyOAuthTransaction stores user ownership, generation, hashed state,
hashed browser binding, hashed application session, encrypted PKCE verifier,
the configured callback, and expiry.

Indexes provide unique state hashes, user-based cleanup, and TTL expiry.
Hashes and verifier are excluded from ordinary queries, and direct document
JSON serialization is blocked.

TTL deletion is asynchronous. The #37 callback explicitly validates expiry
and atomically consumes matching transactions; TTL is only housekeeping.

toSpotifyConnectionStatus() creates an explicit public DTO containing only
state and nullable displayName. It never spreads or serializes a database record.
A missing connection maps to disconnected.

GET /api/user/me now explicitly selects and returns its existing public fields:
\_id, name, email, createdAt, updatedAt, and \_\_v. Internal Spotify fields and
unexpected database fields are excluded. Login and registration retain their
existing response contracts.

Never return raw records, lean records, encrypted envelopes, hashes, credentials,
or database errors from Spotify routes. Lean queries bypass document JSON
transforms, so an explicit DTO remains mandatory.

## Authenticated encryption

encryptSpotifyCredential() and decryptSpotifyCredential() use AES-256-GCM:

- A fresh random 12-byte IV per encryption.
- A 16-byte authentication tag.
- A versioned envelope with key ID and canonical base64 fields.
- Authenticated context binding the envelope version, key ID, application user,
  link generation, and credential purpose.
- Separate purposes for access tokens, refresh tokens, and PKCE verifiers.
- Nonempty credentials limited to 16 KiB.

Decryption returns plaintext only after authentication succeeds.
Malformed envelopes, incorrect ownership, tampering, unknown keys, and invalid
key material fail closed with a sanitized error. There is no plaintext fallback.

Backend services must explicitly select credential fields. Do not log selected
records, envelopes, decrypted values, or unsanitized underlying errors.

## Key rotation and retirement

Key material remains outside MongoDB and Git. Key IDs identify versions; they
are not secret values.

Rotation procedure:

1. Privately generate a new independent 32-byte key under a new key ID.
2. Deploy a keyring containing both old and new keys, initially retaining the
   previous active key. Confirm all instances have the expanded keyring.
3. Switch the active key and retire old application instances that could still
   produce old-key envelopes.
4. Keep old keys available while existing credentials or pending transactions
   still reference them.
5. Re-encrypt stored credentials using their original user, generation, and
   purpose. Coordinate maintenance writes with generation and token-version
   checks and refresh leases; never overwrite a newer refresh or restored link.
6. Let pending OAuth transactions complete or expire, and verify their cleanup.
   Waiting for the TTL alone is not proof that old-key records are gone.
7. Verify that no active envelope references the old key before removing it from
   the online keyring. Account for backup recovery and deletion obligations.

The encryption helpers support old-key reads and new-key writes. This issue
does not provide a bulk rotation command. Operational maintenance must be
reviewed and validated before execution against a persistent database.

Removing a referenced key makes the affected envelope unusable. There is no
automatic fallback. Never retire keys merely because a new key became active.

## Transactional generation coordination

User has two internal, default-zero counters:

- spotifyLinkGeneration: invalidates previously initiated linking work.
- spotifyLinkWriteVersion: forces competing operations to write the same User.

Both are excluded from ordinary queries. Legacy users without stored counters
are handled explicitly; hydration defaults alone are not used as database
comparison predicates. No bulk User migration is required.

withSpotifyLinkGeneration() conditionally writes the User at the expected
generation, then executes database work in the same transaction. A stale
generation or missing User rejects the operation.

invalidateSpotifyLinkGeneration() increments generation and executes cleanup
atomically. Cleanup failure rolls back both changes. The callback may also
delete the User during coordinated account deletion.

Every callback must use the supplied session for every database operation.
MongoDB can retry transaction callbacks: do not perform Spotify HTTP calls,
email delivery, or other external side effects inside them.

Provider requests occur outside transactions. Afterwards, persistence must
revalidate generation and, where relevant, token version and lease ownership.
Refresh fencing is implemented in #38; disconnect and account-deletion routes
follow in #39.

The coordination helpers do not automatically delete connections or pending
OAuth transactions. Route services must supply the complete cleanup callback.
Deleting a User without coordinating these operations is not equivalent to
the tested deletion workflow.

## Persistence readiness

Connection-start and callback routes call assertSpotifyPersistenceReady()
before OAuth transaction/link persistence. Refresh coordination also requires
transaction-capable MongoDB; failed transactions prevent refresh persistence.

It verifies writable transaction-capable topology and sessions, creates the
declared Spotify indexes without removing existing indexes, verifies their
definitions, and performs a read-only transaction probe.

Failure raises a sanitized error and must prevent OAuth persistence.
Do not catch readiness failures and continue without transactions or indexes.

Tests verify this against isolated MongoDB. Production capability, permissions,
indexes, and deployment behavior remain release checks in #40.

## Test database

Global setup uses a single-member MongoMemoryReplSet with wiredTiger.
Existing NODE_ENV, loopback-host, protocol, exact database-name, and
active-connection cleanup guards remain intact.

Tests use real isolated persistence and crypto with fake credentials and keys.
They cover commit/rollback, encryption and key versions, ownership uniqueness,
safe serialization, readiness failures, legacy counters, stale writes,
concurrent invalidation, and coordinated deletion.

No real Spotify credentials, provider calls, or production database are used.
