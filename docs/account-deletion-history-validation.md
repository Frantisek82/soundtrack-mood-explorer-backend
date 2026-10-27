# Account deletion history — implementation and validation

Status: IN PROGRESS.
Evidence updated: 27 October 2026.
Tracking: backend #51; release gates: backend #40.
Related draft PRs: #50 and #52.

This document records branch implementation and isolated test evidence.
It does not authorize register provisioning, Production restore, cutover,
or Spotify OAuth enablement. The standalone roadmap will be updated later.

## Implemented behavior

- Versioned HMAC identifiers use a dataset namespace and canonical User ID.
- Register configuration and connection targets are validated.
- The register uses an independently owned MongoDB client with bounded
  driver timeouts and majority reads and writes.
- Pending intent is acknowledged before the live cleanup transaction starts.
- Duplicate recording preserves the original timestamp and existing state.
- Application cleanup retains its transaction, generation fencing, and
  post-commit local cancellation.
- Completion marking occurs outside the retryable application transaction.
- Authentication rejection remains 401 without cookie clearing.
- Register configuration/storage failure returns sanitized 503 without cleanup.
- Application cleanup failure retains pending intent and the generic 500 response.
- Confirmed cleanup remains successful if completion marking fails.
- Cookie cleanup remains tied to successful live deletion.
- No automatic expiry of deletion obligations is implemented.

## Synthetic recovery boundaries

Recovery tooling currently accepts only explicitly opted-in synthetic test
targets. It requires a loopback URI, the fixed recovery test database name,
and a port distinct from both protected application and register ports.

These checks support isolated drills. They do not prove live network isolation,
physical cluster identity, writer exclusion, or operational quarantine.

Coverage preflight checks the supplied namespace, date ordering, history epoch,
unresolved interruptions, and required key availability. These supplied claims
are not independent proof of complete deletion history.

Replay additionally validates stored obligations and candidate identifiers
before its first recovery mutation. It enumerates Users and Favorite/Playlist
owner references, including owners whose User record is missing.

Both pending and completed obligations apply. Each matched account's Users,
Favorites, and Playlists are cleaned in a separate transaction. Shared
Soundtracks and unaffected accounts and saved collections are preserved.

All restored Spotify connections and OAuth transactions are removed, including
those belonging to retained users. Recovery never marks a live obligation
completed and never releases quarantine.

A later failure may leave earlier account transactions committed. The failed
account transaction rolls back; the whole dataset remains quarantined.
Repeating replay safely finishes remaining work.

## Recorded test evidence

- The integration baseline passed 761 backend tests across 64 files before
  subsequent recovery and session-rotation additions.
- The deletion-history suite passed 140 tests across 10 files before the
  additional partial-batch replay test.
- All 7 replay tests subsequently passed, including partial failure and resume.
- All 3 session signing-secret rotation tests passed.
- TypeScript, ESLint, and whitespace checks passed for those changes.
- Updated full-suite evidence is recorded below; production build validation is recorded below.

Tests use temporary transaction-capable MongoDB replica sets and synthetic
records. Provider HTTP is mocked/rejected in the recovery replay tests.
No live register, Production restore, Spotify request, or email delivery
was exercised by these drills.

## Session invalidation procedure and limits

The application verifier and both signing helpers capture JWT_SECRET when
their modules load.

The isolated tests establish:
- Both old signers produce tokens rejected by a fresh verifier using a new secret.
- An already loaded verifier still accepts old tokens after environment mutation.
- The main verifier refuses to load without its signing secret.

Before any eventual cutover:
1. Keep the recovery application offline and deny provider/email egress.
2. Stop old writers and establish a final write/deletion barrier.
3. Reconcile through current, independently verified deletion history.
4. Privately replace the application signing secret with a fresh dedicated secret.
5. Restart or replace every instance that signs or accepts application sessions.
6. Verify old sessions fail and new sessions work on every accepting instance.
7. Prevent old deployments, processes, and credentials from writing to recovery.
8. Verify restored Spotify credentials and transactions remain absent.
9. Keep quarantine until every operational check has passed.

These are required operational steps, not evidence they have been performed.
Signing-secret rotation alone does not stop stale database writers.
No live signing secret has been changed by this implementation.

## Remaining work before reliance or release

- Validate deployment-specific operator permissions, target inventory,
  and failure behavior before relying on the implemented launcher.
- Validate deployment-specific failure behavior; isolated uncertainty tests
  simulate service-boundary failures, not actual network partitions or failover.
- Verify independent register storage, least-privilege permission enforcement,
  backup/recovery, complete-history evidence, and required key custody.
- Define reconciliation ownership, cadence, escalation, and monitoring.
- Define finite recovery-copy retirement and justified obligation retention.
- Complete user disclosures, including accepted requests that may finish later
  despite an interrupted or failed response.
- Establish independently verified operational coverage and writer isolation.
- Verify coordinated session invalidation and stale-writer exclusion.
- Resolve the unlocated historical 5 October copy; absence is not proof of deletion.
- Update the restore runbook on draft PR #50 and the description of draft PR #52.
- Run final full-suite, TypeScript, lint, safe production build, and whitespace checks.
- Resolve remaining logging, privacy, deployed/browser, and release gates in #40.

The synthetic recovery helpers are not a supported Production restore command.
Issue #51 and the v2.2.0 milestone remain open.

## Reconciliation and uncertainty evidence — 27 October 2026

Implemented internal candidate reconciliation and an explicitly invoked runner.
No public endpoint, startup hook, background worker, or timer was added.

Read-only enumeration collects distinct User IDs and owner references from
Users, Favorites, Playlists, Spotify connections, and OAuth transactions.
It validates identifiers before candidate cleanup begins and checks the
expected database name and dataset namespace.

Present Users use generation-fenced transactional cleanup and post-commit
local cancellation. Missing Users use transactional orphan cleanup with an
in-transaction absence check. Invalid counters on a present User are rejected.

Reconciliation matches existing obligations across configured identifier keys,
does not insert intent, and verifies scoped record absence before completion
marking. Completed obligations are also enforced. The runner returns aggregate
counts and stops on the first failure without claiming earlier commits rolled back.

Recorded focused validation:
- 22 deletion-route tests passed, including transaction callback retry,
  lost intent acknowledgement, and an uncertain committed outcome.
- 16 account-deletion service tests passed.
- 10 read-only candidate enumeration tests passed.
- 11 candidate/persistence-backed reconciliation tests passed.
- 8 runner boundary tests passed.
- TypeScript, ESLint, and whitespace checks passed for these changes.

The uncertainty tests inject failures at service boundaries. They do not
reproduce an actual MongoDB failover or network partition.

### Pending markers without candidate records

If cleanup commits but completion marking fails, all User and owner records
may already be absent. HMAC digests cannot be reversed, so enumeration cannot
recover that candidate ID. The pending obligation remains retained and applies
to recovery replay.

A trusted candidate ID permits explicit reconciliation and verification.
Without it, do not infer completion or delete the obligation. Runner success
means its enumerated candidates were processed; it does not establish that
every pending register record was matched or completed.

### Operational limits

The original runner is an internal callable function. An explicit operator
launcher now adds connected-target checks; see the operator evidence below.
These checks do not prove writer isolation or complete history coverage.

No live register was provisioned or reconciled. Operational permissions,
key custody, retention, reconciliation ownership/cadence, monitoring, and
deployment-specific operator validation remain unresolved.

Full backend validation on 27 October 2026 passed:
- 845 tests across 72 files.
- Standalone TypeScript validation.
- ESLint and whitespace checks.

The enumeration fixture supplies distinct synthetic accountId/stateHash values
so it remains compatible with unique indexes retained across test files.
Production build validation passed on 27 October 2026 with Next.js 16.3.6.
The command supplied the CI loopback MongoDB URI and placeholder JWT secret,
disabled Spotify, and supplied empty register and contact-provider settings.
Next.js reported loading .env.local; the listed command values override those
settings, but this was not a fully isolated environment build.
Compilation, TypeScript, page-data collection, and static generation passed.
No deployment or operator reconciliation command was run.

## Operator launcher evidence — 27 October 2026

Implemented the explicit tsx-based operator launcher.
See [operator guide](account-deletion-reconciliation.md).

The launcher validates confirmation and private configuration without loading
.env files. Automatic model collection/index creation is disabled. Application
connection settings are bounded, and owned connections are closed on failure.

Before enumeration, both connected targets must match expected database names,
replica-set names, member endpoints, and the configured namespace. Overlapping
members are rejected. Historical key availability is checked even for an empty
dataset. One register handle is retained throughout candidate processing.

Validation passed:
- 906 backend tests across 79 files.
- Standalone TypeScript, full ESLint, and whitespace checks.
- CLI subprocess help, argument rejection, and sanitized configuration failure.
- Mocked connection ownership, connection/run failure, and disposal failure.
- Complete CLI processing against temporary synthetic replica sets.
- Wrong register identity rejected without cleanup.
- Pending deletion enforced, unaffected saved data/catalogue preserved.
- Completion marking and repeated execution verified.

These checks do not prove physical isolation, independent register recovery,
permission enforcement, writer exclusion, or complete deletion-history coverage.
Operational expectations require independently verified deployment inventory.
Success covers enumerated candidates, not every unmatched pending obligation.

No live operator run, provisioning, restore, cutover, or OAuth enablement occurred.
Production build validation passed with Next.js 16.3.6 using webpack.
The build ran in a temporary source copy excluding all .env files, with a
minimal environment containing only loopback MongoDB and placeholder JWT
configuration. Installed dependencies were reused through a symlink.
Compilation, TypeScript, page-data collection, static generation, and build
tracing passed. This does not validate the default Turbopack build.

The dependency audit reported eight existing findings: two moderate, five high,
and one critical. A lockfile comparison confirmed the affected versions predate
the tsx addition. No finding was reported for tsx or esbuild in that audit.
The findings remain unresolved; no automatic audit fix was applied.
