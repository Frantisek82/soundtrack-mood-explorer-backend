# Spotify restore safeguards

Status: DRAFT — procedure not yet validated.
Last updated: 25 October 2026.
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

Sanitization and session invalidation require a separately reviewed and
tested implementation. This document does not supply a Production command.

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

A durable deletion-history source and restore replay process have not
been verified. They remain open decisions and enablement blockers.

## 5. Validate before any cutover

Required isolated drills:
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
