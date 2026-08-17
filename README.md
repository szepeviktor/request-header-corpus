# HTTP Browser Request Header Corpus

This repository records three real HTTPS requests over both HTTP/1.1 and HTTP/2
from stable desktop browsers:

- a normal document navigation (`GET`);
- a native HTML form submission (`POST`);
- a native JavaScript `fetch()` request (`POST`).

The corpus is reference data for emergency blocking and risk-scoring rules. It does
not classify requests as attacks and must not be used as proof that a client is
malicious.

## Browsers and schedule

The GitHub Actions workflow runs every Monday at 03:17 UTC and can also be started
with **Run workflow**:

<!-- navigation-links:start -->
| Browser | Runner | Driver | Raw `navigation-get` |
|---|---|---|---|
| Google Chrome stable | `windows-2025` | ChromeDriver | [HTTP/1.1](raw/chrome/151.0.7922.109/windows-2025/http1/navigation-get.txt) · [HTTP/2](raw/chrome/151.0.7922.109/windows-2025/http2/navigation-get.txt) |
| Google Chrome stable | `macos-15` | ChromeDriver | [HTTP/1.1](raw/chrome/151.0.7922.77/macos-15/http1/navigation-get.txt) · [HTTP/2](raw/chrome/151.0.7922.77/macos-15/http2/navigation-get.txt) |
| Microsoft Edge stable | `windows-2025` | MSEdgeDriver | [HTTP/1.1](raw/edge/151.0.4129.72/windows-2025/http1/navigation-get.txt) · [HTTP/2](raw/edge/151.0.4129.72/windows-2025/http2/navigation-get.txt) |
| Mozilla Firefox stable | `ubuntu-24.04` | GeckoDriver | [HTTP/1.1](raw/firefox/153.0.4/ubuntu-24.04/http1/navigation-get.txt) · [HTTP/2](raw/firefox/153.0.4/ubuntu-24.04/http2/navigation-get.txt) |
| System Safari | `macos-15` | SafariDriver | [HTTP/1.1](raw/safari/26.5.2/macos-15/http1/navigation-get.txt) · [HTTP/2](raw/safari/26.5.2/macos-15/http2/navigation-get.txt) |
<!-- navigation-links:end -->

Successful runs commit the refreshed corpus to the default branch and also upload a
30-day artifact. The repository or organization must allow GitHub Actions to write
repository contents, and branch protection must permit the bot commit.

## Repository data

Each request is stored as a protocol-decoded raw header file. All measurement
metadata is stored in one repository-level manifest:

```text
raw/<browser>/<version>/<os>/<http1|http2>/<scenario>.txt
manifest.json
```

Each raw file is directly readable text with one `name: value` header per line.
Lines are written in exactly the order exposed by Node.js after HTTP/1.1 parsing
or HTTP/2 HPACK decoding; they are never sorted or combined, and duplicate
headers remain separate lines. HTTP/2 pseudo-headers such as `:method` are
retained. `manifest.json` stores the browser, driver, operating system, protocol,
scenario, HTTP version, ALPN, measurement ID, timestamp, and raw-file reference
for all observations.

`normalized/` contains a deterministic, lower-cased view intended only for
Git diffs.

Capture correlation tokens are deterministic per protocol and scenario. This
keeps request paths and referrers byte-faithful while preventing weekly token
rotation from creating meaningless Git diffs.

`Cookie`, `Authorization`, `Proxy-Authorization`, and `Set-Cookie` values are
replaced with `[REDACTED]` in the raw text files.

## Trusted HTTPS design

Every job installs the latest available mkcert package from the runner's package
manager and creates a disposable CA under `RUNNER_TEMP`. The CA is installed into
the operating-system trust store and into the browser-specific NSS database:

- Chrome and Edge use the Windows Local Machine Root certificate store;
- Firefox uses a dedicated profile with an explicitly imported root CA;
- Safari uses the macOS System Keychain.

The same CA signs a certificate for `app.test` and `http1.app.test`. The HTTP/2
endpoint listens on port 443; a separate HTTPS endpoint advertises only HTTP/1.1
on port 444. Both listen only on `127.0.0.1`. Before capture, Selenium checks the
exact `/health` body and requires `window.isSecureContext === true` for both
origins.

No insecure-certificate WebDriver capability or browser flag is used. In
particular, the project does not use `acceptInsecureCerts`,
`--ignore-certificate-errors`, `--allow-insecure-localhost`, or `curl -k`.

## Local development

Requirements:

- Node.js 22 or newer;
- OpenSSL (for the integration test);
- mkcert and `certutil`;
- at least one supported browser and matching WebDriver;
- permission to update `/etc/hosts`, browser trust stores, and bind local ports
  443 and 444.

Install dependencies and run the non-browser checks:

```bash
npm ci
npm test
npm run validate
npm run normalize
npm run check:keys
```

For a local capture, first map the test names:

```text
127.0.0.1 app.test http1.app.test
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

The capture writes a browser-specific temporary manifest fragment. Convert it to
the single repository manifest before validation:

```bash
npm run manifest
```

Supported values are `chrome`, `edge`, `firefox`, and `safari`. Linux captures are
headless by default; set `HEADLESS=false` to show the browser. Safari is always
non-headless.

## Validation

The validator checks the central manifest JSON Schema, manifest/raw
cross-references, raw `name: value` syntax, redaction, HTTP version and ALPN
negotiation, content types and expected Fetch Metadata context. In CI, it
requires all three scenarios over both protocols for each browser.
The private-key guard scans all publishable output paths by filename and PEM
marker.

The automated tests cover HTTP/1.1 and HPACK-decoded HTTP/2 header ordering and
duplicates, redaction, schema validation, deterministic normalization,
trusted-TLS failure handling, complete scenario coverage, and private-key
detection.
