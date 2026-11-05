// Standalone operator entry point; never load Next.js or dotenv configuration.
const args = process.argv.slice(2);

if (args.length === 1 && args[0] === "--help") {
  process.stdout.write([
    "Account deletion reconciliation",
    "",
    "Usage:",
    "  npm run deletions:reconcile -- --help",
    "  npm run deletions:reconcile -- --confirm reconcile-accepted-account-deletions",
    "",
    "Required private environment:",
    "  MONGODB_URI",
    "  DELETION_HISTORY_MONGODB_URI",
    "  DELETION_HISTORY_NAMESPACE",
    "  DELETION_HISTORY_ACTIVE_KEY_VERSION",
    "  DELETION_HISTORY_HMAC_KEYS",
    "  DELETION_RECONCILIATION_TARGETS",
    "",
    "Target expectations must come from independently verified operator inventory.",
    "No .env files are loaded. Run only from a controlled operator environment.",
    "This processes accepted live deletions; it is not recovery replay or cutover.",
    "Success covers enumerated candidates, not every unmatched pending obligation.",
    "Earlier account commits may remain after a failure.",
    "",
  ].join("\n"));
} else if (
  args.length === 2 &&
  args[0] === "--confirm" &&
  args[1] === "reconcile-accepted-account-deletions"
) {
  try {
    const { executeReconciliationOperator } = await import(
      "../src/lib/deletion-history/reconcile-operator"
    );
    const result = await executeReconciliationOperator(args[1]);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch {
    process.stderr.write(
      "Deletion reconciliation incomplete; earlier commits may remain. Review and retry.\n",
    );
    process.exitCode = 1;
  }
} else {
  process.stderr.write("Invalid invocation. Use --help.\n");
  process.exitCode = 1;
}
