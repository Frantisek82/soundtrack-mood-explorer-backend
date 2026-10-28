# Spotify restore safeguards

Status: DRAFT — synthetic evidence exists; operational procedure not validated.
Last updated: 28 October 2026.
Tracking: backend #40.
Deletion-history and recovery implementation: backend #51.

This is a project recovery procedure, not evidence that a restore is safe
or that deletion obligations have been completed. No Production restore
is authorized or performed by this document.

## Known inventory

- Atlas Backups was recorded as OFF on the Free cluster.
- A historical roadmap records a retained pre-seed EJSON snapshot from
  5 October. Its current existence and location remain unverified.
- Historical VirtualBox snapshots are also recorded.
- A VM restore may restore old configuration and credential files.
- These records do not establish physical erasure or complete inventory.

See spotify-release-validation.md for dated evidence.

## 1. Establish quarantine before restoring

- Use an isolated recovery database, never the active application database.
- Restore no real data during automated drills; use synthetic fixtures.
- Keep deployed and recovered Spotify integration disabled.
- Prevent the recovered application from serving users, sending email,
  or making provider requests.
- Do not boot a restored VM with an application server automatically running.
- Inspect restored configuration privately before permitting network access.
- Never print connection strings, keys, tokens, cookies, or user records.

## 2. Establish the recovery boundary

Record privately:
- Source, age, and ownership of the recovery copy.
- Collections and configuration included.
- Which deletion/disconnection requests occurred after its capture.
- Whether a trustworthy record of those requests exists independently
  of the database history being restored.

A restored generation counter cannot prove that later deletions or
disconnects did not happen.

If deletion history cannot be reconciled, keep affected personal data
quarantined. Do not return it to service or assume nobody requested deletion.

## 3. Sanitize restored Spotify state

Before any restored application is allowed to use Spotify:
- Remove restored Spotify connection records, including credentials/profile data.
- Remove every restored pending OAuth transaction.
- Require fresh Spotify authorization for any future connection.
- Review recovered encryption and application-session configuration.
- Invalidate recovered application sessions before serving restored accounts.
- Ensure old application instances cannot write late results into the
  recovered database during any eventual cutover.

Generation increments alone are insufficient after a rollback of database
history. Process-local cancellation also does not coordinate other instances.

Draft PR #52 implements synthetic recovery replay that removes all restored
Spotify connections and OAuth transactions, including those of retained users.
It does not release quarantine. Its recovery targets are restricted to opted-in
loopback test databases; it is not a supported Production restore command.

Synthetic signing-secret tests establish that fresh verifiers reject old
sessions after rotation, while already loaded verifiers retain the old secret.
Operational session invalidation requires privately replacing JWT_SECRET,
restarting or replacing every signing/verifying instance, and verifying old
sessions fail and new sessions work on every accepting instance. Stop old
writers and establish a final write/deletion barrier before final reconciliation.
Secret rotation alone does not exclude stale database writers.

Live sanitization, coordinated session invalidation, and writer exclusion
remain unverified. This document supplies no Production execution command.

## 4. Reconcile application-account deletions

- Reapply applicable account deletions before returning affected data to service.
- Include Users, Favorites, owned Playlists, Spotify connections, and OAuth transactions.
- Preserve unrelated users and the shared Soundtrack catalogue.
- Test repeated processing, missing Users, orphaned records, and rollback.
- Keep deletion evidence outside the restore history it must correct,
  with appropriate access and retention controls.

The existing deleteApplicationAccount service requires an existing User.
It must not be assumed to provide a complete idempotent restore-replay
mechanism for missing Users or orphaned data.

Draft PR #52 records pending intent before live transactional cleanup in
an independently owned MongoDB client. Its synthetic replay applies pending
and completed obligations, including missing Users and orphaned owner records.
Each matched account is cleaned in a separate transaction. A later failure may
leave earlier transactions committed; failed-account cleanup rolls back and
the whole recovery dataset remains quarantined. Replay can be repeated safely.
Recovery replay never marks live obligations completed.

Coverage preflight checks supplied namespace, dates, history epoch,
interruptions, and required keys. These claims do not independently prove
complete history. A new register cannot reconstruct earlier deletions:
pre-coverage copies remain ineligible for personal-data recovery without
independent reconciliation. Incomplete history keeps recovery quarantined.

Independent register durability/recovery, permissions, key custody, complete
coverage, retention, monitoring, and operational acceptance remain blockers.

The separate tsx reconciliation launcher enforces existing obligations against
verified connected targets. It does not restore data, replay recovery,
invalidate sessions, or release quarantine. Its success covers enumerated
candidates, not every pending obligation. Unmatched HMAC digests cannot be
reversed; retain them and do not infer completion. Connected-target checks
do not prove physical isolation, independent recovery, or writer exclusion.

Implementation and evidence are on draft PR #52 at fa4b5f5:
- docs/account-deletion-history-design.md
- docs/account-deletion-history-validation.md
- docs/account-deletion-reconciliation.md

These documents are branch evidence, not assumed present on this PR branch.
PRs #50/#52 remain draft; issues #40/#51 remain open.

## 5. Validate before any cutover

Recorded synthetic evidence on draft PR #52:
- Replay covered pending/completed obligations, missing Users, orphaned
  ownership records, unaffected-data preservation, partial failure, and resume.
- All restored Spotify connections and OAuth transactions were removed.
- Session tests covered fresh-secret rejection and loaded-verifier limitations.
- Separate operator CLI drills covered wrong-target rejection, deletion
  enforcement, completion marking, and repeated processing.
- Full validation at fa4b5f5 passed 906 tests across 79 files, ESLint,
  TypeScript, whitespace checks, and both Next.js 16.4.3 production builds.
  Both builds loaded .env.local; they do not establish environment isolation.
- All four PR checks passed at that head.

This evidence does not validate deployment-specific quarantine, a final
write/deletion barrier, coordinated session invalidation, stale-writer
exclusion, register recovery, permissions, or complete history coverage.
Those checks remain required before operational acceptance.

Required isolated drills and deployment-specific verification:
- Synthetic restored credentials and transactions become unusable.
- Removed records cannot be recreated by simulated old-generation work.
- Post-snapshot account deletions are reapplied, including owned Playlists.
- Repeated recovery processing is safe.
- Failed cleanup leaves recovery quarantined.
- Other users and shared catalogue data are preserved as intended.
- No live Spotify or email requests occur.
- Results contain no credentials or personal-data contents.

After successful drills, inspect required indexes and transaction support
on the intended recovery database using a reviewed target-specific procedure.
The current Production inspection script is guarded for the Production
database and is not a general recovery-database tool.

## 6. Cutover and closure

Any cutover is a separate reviewed operational action.
Do not enable Spotify until logging, privacy, retention/deletion, and
browser requirements are resolved.

Record drill evidence, unresolved limitations, operator, date, and outcome.
This runbook's existence alone does not complete the backup/restore
checklist item in #40.
