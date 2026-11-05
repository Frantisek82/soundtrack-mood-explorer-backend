# Account deletion reconciliation operator guide

Status: implemented and tested with isolated synthetic databases.
Operational acceptance remains pending. Tracking: #51; release gates: #40.
PRs #50/#52 remain draft. Deployed Spotify OAuth remains disabled.

This guide does not authorize live execution, provisioning, restore, or cutover.

## Purpose

The command enforces existing pending and completed deletion obligations.
It does not insert intent, restore data, replay recovery, release quarantine,
or invalidate sessions. No accounts are upserted.

Success covers enumerated candidates. Unmatched pending HMAC digests cannot
be reversed and must remain retained. Success does not prove every pending
obligation was completed.

## Runtime and configuration

Use Node 24 and lockfile dependencies, including development dependencies.
The launcher uses tsx and does not automatically load .env files.

Required private environment variables:
- MONGODB_URI
- DELETION_HISTORY_MONGODB_URI
- DELETION_HISTORY_NAMESPACE
- DELETION_HISTORY_ACTIVE_KEY_VERSION
- DELETION_HISTORY_HMAC_KEYS
- DELETION_RECONCILIATION_TARGETS

Supply credentials through the approved private operator mechanism.
Never place credentials in command arguments, logs, or documentation.

## Target expectations

DELETION_RECONCILIATION_TARGETS must contain exactly these fields.
This example describes the structure, not actual deployment inventory:

```json
{
  "expectedDatabaseName": "application-database",
  "expectedRegisterDatabaseName": "sme-deletion-history",
  "expectedNamespace": "dataset-namespace",
  "applicationTopology": {
    "setName": "application-replica-set",
    "hosts": ["application-member.example.invalid:27017"]
  },
  "registerTopology": {
    "setName": "register-replica-set",
    "hosts": ["register-member.example.invalid:27017"]
  }
}
```

Obtain expectations from independently verified deployment inventory.
Do not derive operational expectations from whichever server is reached.
Include all expected replica-set hosts, lowercase, with explicit ports.
Legitimate membership changes require reviewed inventory updates.

Outside tests, only credentialed Atlas SRV URIs with restricted options
are accepted. The register database is fixed to sme-deletion-history.
Tests permit only the designated loopback test databases.

Both connected deployments must match their database names, replica-set
names, and member endpoints. The configured namespace must match.
Overlapping application/register members are rejected before enumeration.

These checks do not prove cryptographic cluster identity, physical isolation,
independent recovery, complete history, permissions, or writer exclusion.

## Invocation and results

Help opens no database connection:

```bash
npm run deletions:reconcile -- --help
```

After separate operational authorization and private configuration:

```bash
npm run deletions:reconcile -- --confirm reconcile-accepted-account-deletions
```

Use a dedicated operator process with minimum required permissions.
The command refuses an existing application connection and disables
automatic collection/index creation before importing models.

Exit zero returns only candidateCount, matchedAccounts, and
completedObligations. The latter counts matched obligations verified
completed during processing, including previously completed obligations.

A nonzero exit returns a sanitized error. Earlier account transactions
or completion updates may have committed. Do not infer rollback.
Investigate privately before retrying against the verified intended dataset.

One register handle is retained throughout processing. The command closes
its register and application handles. Interrupted work may leave obligations
pending; they remain retained and processing can be repeated safely.

## Outstanding operational requirements

Before deployment reliance, establish ownership, cadence, escalation,
monitoring, permission enforcement, key custody, independent register
recovery, complete-history evidence, justified retention, and disclosures.

Topology checks do not establish operational readiness. No background
scheduling is installed. Recovery replay and session invalidation remain
separate procedures. The unlocated historical 5 October copy remains
unresolved. Issue #51 and the v2.2.0 milestone remain open.
