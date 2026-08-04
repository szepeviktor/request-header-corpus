# HTTP Browser Request Header Corpus

This repository records three real HTTPS requests from stable desktop browsers:

- a normal document navigation (`GET`);
- a native HTML form submission (`POST`);
- a native JavaScript `fetch()` request (`POST`).

The corpus is reference data for emergency blocking and risk-scoring rules. It does
not classify requests as attacks and must not be used as proof that a client is
malicious.

## Browsers and schedule

The GitHub Actions workflow runs every Monday at 03:17 UTC and can also be started
with **Run workflow**:

| Browser | Runner | Driver |
|---|---|---|
| Google Chrome stable | `windows-2025` | ChromeDriver |
| Microsoft Edge stable | `windows-2025` | MSEdgeDriver |
| Mozilla Firefox stable | `ubuntu-24.04` | GeckoDriver |
| System Safari | `macos-15` | SafariDriver |

Successful runs commit the refreshed corpus to the default branch and also upload a
30-day artifact. The repository or organization must allow GitHub Actions to write
repository contents, and branch protection must permit the bot commit.

## Repository data

Each request is stored in two separate files:

```text
raw/<browser>/<version>/<os>/<scenario>.json
observations/<browser>/<version>/<os>/<scenario>.json
```

`raw/` is the authoritative request record. It retains:

- the original raw header array exposed by Node.js;
- header order and duplicate headers;
- original header-name casing where the protocol/runtime exposes it;
- the complete browser and Fetch Metadata values;
- HTTP version and negotiated ALPN.

`observations/` contains browser, driver, operating-system, runner, TLS and scenario
metadata, plus a relative reference to the raw file. `normalized/` contains a
deterministic, lower-cased view intended only for diffs. `reports/latest.md`
compares observations and highlights security-relevant header changes.

`Cookie`, `Authorization`, `Proxy-Authorization`, and `Set-Cookie` values are
replaced with `[REDACTED]` in both parsed and raw header views.

## Trusted HTTPS design

Every job creates a disposable mkcert v1.4.4 CA under `RUNNER_TEMP`. The CA is
installed into the operating-system trust store and into the browser-specific NSS
database:

- Chrome and Edge use the Windows Current User Root certificate store;
- Firefox uses a dedicated profile with an explicitly imported root CA;
- Safari uses the macOS System Keychain.

The same CA signs a certificate for `app.test`, `*.app.test`, `attacker.test`,
`localhost`, and loopback IP addresses. The HTTPS server listens only on
`127.0.0.1`. Before capture, Selenium checks the exact `/health` body and requires
`window.isSecureContext === true`.

No insecure-certificate WebDriver capability or browser flag is used. In
particular, the project does not use `acceptInsecureCerts`,
`--ignore-certificate-errors`, `--allow-insecure-localhost`, or `curl -k`.

## Local development

Requirements:

- Node.js 22 or newer;
- OpenSSL (for the integration test);
- mkcert and `certutil`;
- at least one supported browser and matching WebDriver;
- permission to update `/etc/hosts`, browser trust stores, and bind local port 443.

Install dependencies and run the non-browser checks:

```bash
npm ci
npm test
npm run validate
npm run normalize
npm run report
npm run check:keys
```

For a local capture, first map the test names:

```text
127.0.0.1 app.test api.app.test attacker.test
```

Create a disposable CA outside the repository, trust it using the same browser
procedure shown in `.github/workflows/capture.yml`, and generate a server
certificate. Then start the server with absolute paths:

```bash
TLS_CERT=/tmp/header-corpus/tls/server.crt \
TLS_KEY=/tmp/header-corpus/tls/server.key \
CAPTURE_DIR=/tmp/header-corpus/captures \
node collector/server.mjs
```

In another terminal, run one browser:

```bash
CAPTURE_DIR=/tmp/header-corpus/captures \
OBSERVATION_OS=local \
node collector/capture.mjs --browser chrome
```

Supported values are `chrome`, `edge`, `firefox`, and `safari`. Linux captures are
headless by default; set `HEADLESS=false` to show the browser. Safari is always
non-headless.

## Validation

The validator checks both JSON Schemas, raw/observation cross-references,
measurement IDs, redaction, methods, URLs, content types and expected Fetch
Metadata context. In CI, it also requires all three scenarios for each browser.
The private-key guard scans all publishable output paths by filename and PEM
marker.

The automated tests cover raw header ordering and duplicates, redaction, schema
validation, deterministic normalization, trusted-TLS failure handling, complete
scenario coverage, and private-key detection.
