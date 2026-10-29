# Account deletion history and recovery design

Status: PARTIALLY IMPLEMENTED — application recording and synthetic recovery are implemented; operational deployment and release validation remain incomplete.
Tracking: backend #51; release gates: backend #40.
Related restore runbook: pending draft PR #50.

This document does not authorize Production provisioning, restore, cutover,
or OAuth enablement. PR #50 remains open and draft. Deployed Spotify OAuth
remains disabled while logging and restore/privacy gates are unresolved.

## 1. Scope and guarantees

Preserve application accounts, Favorites, and owned Playlists during recovery
without resurrecting accounts covered by accepted deletion obligations.

Persist authenticated deletion intent before live transactional cleanup.
Both pending and completed obligations apply during recovery.
Spotify connections and pending OAuth transactions are never recovered
for reuse; remove them and require fresh authorization.

A newly created register cannot reconstruct historical deletions.
Copies predating trustworthy coverage are ineligible for personal-data
recovery without independent reconciliation. The unlocated 5 October
snapshot remains unresolved.

## 2. Independent storage

Proposed location: a dedicated Atlas project and cluster outside the
application database and VM restore boundary. The separate project has
been created; no cluster or deletion register has been provisioned.

Use a separate database connection and credentials. Never bind register
models to the application's default Mongoose connection or include the
register in application reset, restore, seed, or test-cleanup operations.

Separate application recording, reconciliation, recovery-read, and
administrative permissions. The application must not delete obligations.
Exact roles and supported deployment options require verification.

Recover the register independently. Never roll it back alongside the
application. Register recovery must reconcile any lost history before
application recovery can proceed. A separate cluster alone does not prove
complete, durable, or independently recoverable history.

## 3. Minimal identifiers and keys

Identify an account using HMAC-SHA-256 over a versioned, unambiguous encoding
of a stable dataset namespace and canonical lowercase application User ID.

The namespace identifies the logical dataset, remains stable across its
recovery, and separates development, production, and synthetic tests.

Store only the digest, identifier-key version, schema version, accepted
timestamp, pending/completed state, and optional live-cleanup completion
timestamp. Do not store email, names, Spotify identity, tokens, saved
content, raw database errors, or raw User IDs.

Use a dedicated secret independent of JWT and Spotify encryption keys.
Keep required key versions recoverable outside VM snapshots and application
restores. Never print keys or identifiers in operational output.

Key rotation must preserve lookup of existing obligations, avoid resetting
completed records to pending, and retain older keys while relevant copies
or obligations require them. Do not implement ad hoc rotation.

These identifiers are pseudonymous personal data, not anonymous data.

## 4. Intent lifecycle and consistency

Authenticate and validate an existing application User before recording intent.
Use an atomic idempotent insert with a unique key over namespace, key version,
and digest. Preserve the original accepted timestamp and completed state
on retries. Resolve concurrent duplicate inserts without creating new intent.

Use explicit durable write acknowledgement and bounded driver timeouts.
No transaction spans the independent clusters.

Order:
1. Durably acknowledge pending intent in the register.
2. Run the existing application cleanup transaction.
3. After commit, retain existing local cancellation and cookie behavior.
4. Mark live cleanup completed outside the transaction callback.

Register operations and other external effects must never occur inside
retryable application transaction callbacks.

Pending means an accepted deletion obligation. It is not cancelled when
cleanup fails, the client disconnects, or the response is lost.
Completed describes confirmed live cleanup, not removal of the obligation.

An ambiguous register acknowledgement may mean intent exists. Do not begin
cleanup without acknowledgement; a later reconciliation may enforce the
persisted intent even though the request received a failure response.

An ambiguous application commit must not be reported as confirmed rollback.
Leave intent pending until reconciliation establishes the database outcome.

## 5. HTTP behavior

Preserve existing successful deletion:
200 {"message":"Account deleted successfully"}.
Preserve CORS, no-store, and existing cookie attributes.

Authentication rejection remains 401 without clearing cookies.
Register failure or uncertain acknowledgement returns a sanitized 503,
without starting cleanup or clearing cookies.
Application cleanup failure preserves the generic 500 response and does
not clear cookies. Keep the accepted intent pending.

Confirmed cleanup commit remains success even if the completion-marker
write fails. Bound that write; leave pending for reconciliation.
Post-commit bookkeeping failure must not report committed deletion as rollback.

No Spotify or email request is needed. Deletion remains independent of
Spotify enablement and Spotify configuration validity.

User-facing documentation must explain that a request may complete later
despite an interrupted or failed response, and retrying is safe.
Do not promise that an uncertain response means no request was accepted.

## 6. Pending cleanup and reconciliation

For this focused design, existing authenticated account-access behavior
remains unchanged until cleanup commits. A pending account may remain
usable after cleanup failure. Do not claim immediate suspension.

Provide an explicit operator-run live reconciliation tool. No background
worker is assumed. Operational ownership, execution cadence, and escalation
must be established before deployment relies on this mechanism.

Because HMAC digests cannot be reversed, reconciliation enumerates candidate
User IDs and owner references from the explicitly selected application
dataset, computes digests for relevant keys, and matches obligations.

For existing Users, preserve transactional generation fencing and
post-commit cancellation. Handle missing Users and orphaned records without
upserting accounts. Missing-User cleanup must not silently bypass fencing
for an existing User with invalid counters; such cases require investigation.

Live reconciliation may mark completion only after confirmed cleanup and
verification. Repeated requests and reconciliation must be safe. Do not
downgrade completed records or treat a stale generation as proof of cleanup.

## 7. Recovery replay

Use a separately guarded connection to an explicitly quarantined target.
Never reuse the Production inspection script as a general recovery tool.

Reject the active application target, the register target, and ambiguous
targets. Require explicit target identity and operator opt-in. A database
name or environment flag alone does not establish isolation.

Keep recovered servers offline and deny provider/email egress.
Use synthetic data only in automated drills.

Enumerate User IDs and owner references, including Favorites and Playlists.
Apply both pending and completed obligations regardless of whether the
restored User exists. Do not upsert Users or delete shared Soundtracks.
Validate identifier types; malformed ownership data requires investigation.

Use transactions for each account's scoped cleanup. Repeated replay must
be safe. Earlier successful batches may remain committed after a later
failure; the entire target stays quarantined until validation succeeds.

Remove all restored Spotify connections and OAuth transactions, including
those belonging to unaffected users. Verify their absence before cutover.

Recovery processing must never mark a live pending obligation completed.
Keep recovery evidence separate from live intent lifecycle state.

## 8. Coverage, sessions, and cutover

Maintain independently controlled coverage evidence: dataset identity,
capture activation, known interruptions, key availability, and register
recovery history. Application deletion paths that bypass recording invalidate
the coverage claim unless independently reconciled.

A timestamp or successful register query alone does not prove completeness.
Reject incomplete, unreadable, or unverifiable history and keep quarantine.

Before cutover, stop old writers and establish a write/deletion barrier.
Perform final reconciliation against current history so deletions accepted
during recovery are not missed.

Invalidate pre-recovery application sessions using a separately tested
procedure. A restored database counter alone cannot invalidate older JWTs.
If JWT signing-secret rotation is selected, coordinate all accepting
instances and verify that no old secret remains accepted.

Retain quarantine unless sanitization, deletion replay, sessions, indexes,
transaction support, and writer isolation all pass. Cutover remains a
separate reviewed operational action.

## 9. Retention and disclosures

Do not enable automatic TTL expiry initially.
Retain obligations and required keys while any eligible copy can resurrect
the corresponding account, including copies of the register itself.

Before operational deployment, define a finite recovery-copy retention
policy, retirement evidence, review ownership, and a justified obligation
retention policy. Do not describe indefinite retention as a settled policy.

Document the pseudonymous register, purpose, access controls, pending
behavior, and retention in privacy disclosures. Do not claim physical
erasure or verified retention for the unknown historical snapshot.

## 10. Required validation

Use isolated transaction-capable MongoDB and mocked external boundaries.
Never use Production credentials, persistent user data, Spotify, or email.

Cover:
- Idempotent and concurrent recording; no completed-to-pending regression.
- Register unavailability, uncertain writes, and bounded timeouts.
- Transaction retries without repeated external effects.
- Cleanup rollback, uncertain commits, and failed completion marking.
- Existing cookie, response, owner-isolation, and generation contracts.
- Live pending reconciliation and repeated processing.
- Recovery with missing Users, orphaned records, and malformed identifiers.
- Preservation of unaffected accounts, saved collections, and catalogue.
- Removal of every restored Spotify connection and OAuth transaction.
- Incomplete coverage, missing keys, unsafe targets, and partial failures.
- Quarantine retention and sanitized output without live external requests.
- Session invalidation and rejection of stale writers.

Run focused tests, the full backend suite, lint, TypeScript, production build
with safe validation configuration, and git diff --check after implementation.

## 11. Outstanding operational decisions

- Verify the independent storage deployment option and exact permissions.
- Define register backup, recovery, and completeness evidence.
- Establish reconciliation ownership, cadence, and escalation.
- Define recovery-copy retirement and obligation retention.
- Verify key custody and rotation procedures.
- Validate operational session invalidation and target inventory; isolated
  session tests and reconciliation topology guards are implemented.
- Validate recovery-target isolation separately; reconciliation guards do
  not make synthetic replay a supported operational restore tool.
- Update the pending restore runbook and privacy disclosures.

This proposal does not complete #51, #40, the unknown-copy investigation,
the callback logging gate, or the v2.2.0 release.

## 12. Atlas inspection — 25–26 October 2026

Manual dashboard inspection by the maintainer established:

- Created the separate Soundtrack Mood Explorer Deletion History project.
- Its deployment form offered the Free tier at $0/hour.
- No cluster was deployed and no database user or custom role was created.
- The custom-role form supports named database and collection resources.
- Individual find, insert, and update actions were visible and selectable.
- These are UI observations, not verified permission enforcement.
- The empty project's Backup page contained no cluster entries.
- The existing application project's Backup page offered cluster upgrades
  for daily or continuous backups and displayed general pricing examples.
- No Free-cluster backup subscription or account-specific price was verified.
- No backup, network, or application configuration was changed.

The dedicated cluster remains a candidate, not an operationally accepted
deletion-history store. Register recovery, complete history coverage,
permission enforcement, and key custody remain unresolved.

A register snapshot can omit obligations accepted after its capture.
If register recovery loses such history, application recovery must remain
quarantined until the missing obligations are independently reconciled.
Replication or a successful snapshot restore alone does not prove coverage.

PRs #50 and #52 remain draft. Deployed Spotify OAuth remains disabled.
