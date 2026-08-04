# Security policy

## Corpus limitations

Browser headers are signals, not authentication. Attackers can reproduce common
header sets, and legitimate clients can differ because of version, policy,
extensions, locale, proxies, privacy settings, experiments, or platform changes.
Use this corpus only as one input to reversible emergency controls or risk scoring.

## Sensitive data handling

The capture pages do not set cookies or request credentials. The collector
redacts authorization and cookie-family values in decoded JSON records. The
byte-exact `.h2` files are intentionally unmodified and therefore cannot be
redacted. Capture only disposable browser profiles against the local scenarios;
never use an authenticated profile. Do not add authenticated scenarios because
their secrets would be preserved in the HPACK-encoded binary capture.

Each workflow job creates a new CA and server private key under `RUNNER_TEMP`.
Private keys must never be committed, cached, logged, transferred between jobs, or
uploaded as artifacts. `.gitignore` blocks common key paths, and
`npm run check:keys` scans all publishable directories before upload and commit.

Never weaken TLS verification to make a failed job pass. Certificate warnings,
`window.isSecureContext !== true`, or a failed trusted health request indicate a
CA installation defect and must fail the capture.

## Reporting a vulnerability

Please use the repository's private security-advisory feature. Include the affected
file, impact, reproduction details that do not contain secrets, and a suggested
mitigation when available. Do not open a public issue for an unpatched secret leak
or code-execution vulnerability.
