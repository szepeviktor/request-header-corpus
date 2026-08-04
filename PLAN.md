# HTTP Browser Header Corpus – implementációs feladat

Készíts egy GitHub repositoryt, amely valódi böngészőkből automatikusan rögzíti három tipikus HTTP-kérés request headereit.

A mérések GitHub Actionsből fussanak valódi HTTPS-kapcsolaton. A teszthez generált CA legyen ténylegesen megbízhatóként telepítve az adott böngésző által használt trust store-ba.

## Cél

A generált adatok segítségével támadó GET, POST és AJAX/fetch kérések hasonlíthatók össze legitim böngészők kéréseivel.

A projekt ne próbálja meg bizonyítani, hogy egy kérés támadás. A profilok vészhelyzeti tiltó- és kockázatpontozó szabályok referenciaadatai legyenek.

## Első verzióban támogatott böngészők

* Google Chrome desktop, Ubuntu
* Microsoft Edge desktop, Ubuntu
* Mozilla Firefox desktop, Ubuntu
* Safari desktop, macOS

Későbbi opcionális támogatás:

* Samsung Internet Androidon, Appiummal és valódi Samsung eszközön vagy device cloudban

Ne használj Playwright Chromiumot valódi Chrome helyett, és ne nevezd a Playwright WebKit buildet Safarinak.

## Rögzítendő három profil

### 1. Normál GET navigáció

A böngésző nyisson meg egy HTML-oldalt:

```text
GET https://app.test/capture/navigation
```

Elvárt általános kontextus:

```text
Sec-Fetch-Mode: navigate
Sec-Fetch-Dest: document
```

### 2. HTML form POST

Egy HTML-form küldjön POST-kérést:

```text
POST https://app.test/capture/form
Content-Type: application/x-www-form-urlencoded
```

A küldés valódi DOM form submit legyen, ne JavaScriptes `fetch()`.

Elvárt általános kontextus:

```text
Sec-Fetch-Mode: navigate
Sec-Fetch-Dest: document
```

### 3. AJAX/fetch kérés

Az oldal JavaScriptből küldjön:

```text
POST https://app.test/capture/ajax
Content-Type: application/json
```

Használj natív `fetch()` API-t.

Elvárt általános kontextus:

```text
Sec-Fetch-Dest: empty
Sec-Fetch-Mode: cors vagy same-origin
Sec-Fetch-User: ne legyen jelen
```

## Tesztdomainek

A lokális hostnevek kerüljenek az `/etc/hosts` fájlba:

```text
127.0.0.1 app.test
127.0.0.1 api.app.test
127.0.0.1 attacker.test
```

Az első verzióban a három fő mérés használhatja az `app.test` domaint.

Az `api.app.test` és `attacker.test` maradjon előkészítve későbbi same-site, cross-origin és cross-site tesztekhez.

## HTTPS és CA-kezelés

Minden GitHub Actions job:

1. hozzon létre saját, ideiglenes lokális CA-t;
2. telepítse a CA nyilvános tanúsítványát az adott böngésző trust store-jába;
3. ugyanazzal a CA-val írjon alá szervertanúsítványt;
4. indítsa el a HTTPS capture szervert;
5. ellenőrizze böngészőből, hogy a tanúsítvány valóban megbízható;
6. a job végén hagyja megszűnni a CA-t és annak privát kulcsát.

Tilos:

```text
acceptInsecureCerts: true
--ignore-certificate-errors
--allow-insecure-localhost
curl -k
```

A CA privát kulcsa:

```text
rootCA-key.pem
```

nem kerülhet:

* Git commitba;
* cache-be;
* artifactba;
* logba;
* másik jobba.

### Ubuntu CA létrehozás

Telepítsd:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates libnss3-tools
```

Használj `mkcert`-et, lehetőleg rögzített verzióval és SHA-256 checksum-ellenőrzéssel.

Állíts be jobonként külön CA könyvtárat:

```bash
export CAROOT="$RUNNER_TEMP/mkcert-ca"
mkdir -p "$CAROOT"
mkcert -install
```

Generálj tanúsítványt:

```bash
mkdir -p "$RUNNER_TEMP/tls"

mkcert \
  -cert-file "$RUNNER_TEMP/tls/server.crt" \
  -key-file "$RUNNER_TEMP/tls/server.key" \
  app.test \
  "*.app.test" \
  attacker.test \
  localhost \
  127.0.0.1 \
  ::1
```

### Chrome és Edge trust store

Importáld a root CA-t mindkét lehetséges Chromium NSS-adatbázisba:

```text
$HOME/.local/share/pki/nssdb
$HOME/.pki/nssdb
```

Példa:

```bash
for NSS_DB in \
  "$HOME/.local/share/pki/nssdb" \
  "$HOME/.pki/nssdb"
do
  mkdir -p "$NSS_DB"

  if [ ! -f "$NSS_DB/cert9.db" ]; then
    certutil \
      -N \
      --empty-password \
      -d "sql:$NSS_DB"
  fi

  certutil \
    -D \
    -d "sql:$NSS_DB" \
    -n "GHA Header Capture Root CA" \
    2>/dev/null || true

  certutil \
    -A \
    -d "sql:$NSS_DB" \
    -n "GHA Header Capture Root CA" \
    -t "C,," \
    -i "$CAROOT/rootCA.pem"
done
```

### Firefox trust store

Hozz létre dedikált Firefox-profilt:

```bash
export FIREFOX_PROFILE="$RUNNER_TEMP/firefox-profile"
mkdir -p "$FIREFOX_PROFILE"

certutil \
  -N \
  --empty-password \
  -d "sql:$FIREFOX_PROFILE"

certutil \
  -A \
  -d "sql:$FIREFOX_PROFILE" \
  -n "GHA Header Capture Root CA" \
  -t "CT,CT," \
  -i "$CAROOT/rootCA.pem"
```

A Selenium ezt a profilt használja a Firefox indításakor.

### Safari trust store

A Safari job `macos-15` runneren fusson.

A CA kerüljön a macOS System Keychainbe:

```bash
sudo security add-trusted-cert \
  -d \
  -r trustRoot \
  -p ssl \
  -k /Library/Keychains/System.keychain \
  "$CAROOT/rootCA.pem"
```

Használd a rendszer Safari böngészőjét és a `safaridriver` programot:

```bash
sudo safaridriver --enable
```

A Safari ne kapjon insecure-certificate felülbírálást.

## Capture szerver

Implementálj egy kis Node.js HTTPS szervert.

Elvárások:

* közvetlenül TLS-en figyeljen;
* ne vesszen el a headerek sorrendje;
* rögzítse a Node által elérhető raw headereket;
* mentse a HTTP-verziót;
* adjon vissza HTML-t a navigációs, form és AJAX tesztekhez;
* legyen `/health` endpointja;
* minden kérés kapjon egyedi mérési azonosítót;
* a mérési token külön headerben vagy query paraméterben kapcsolja össze a böngészőtesztet a szerveroldali rekorddal.

Használd a következő Node.js adatokat, amennyiben elérhetők:

```js
request.method
request.url
request.httpVersion
request.headers
request.rawHeaders
request.socket.alpnProtocol
```

A capture szerver csak loopback interfészen figyeljen.

## WebDriver

Használj:

```text
selenium-webdriver
```

Böngészők:

* Chrome: `google-chrome` és `chromedriver`
* Edge: `microsoft-edge` és `msedgedriver`
* Firefox: `firefox` és `geckodriver`
* Safari: `Safari.app` és `safaridriver`

Linuxon a Chrome, Edge és Firefox futhat headless módban.

Safari ne legyen headless.

A WebDriver sessionben az `acceptInsecureCerts` maradjon `false`, vagy ne legyen beállítva.

## Böngészőszintű TLS-ellenőrzés

Minden mérés előtt a WebDriver nyissa meg:

```text
https://app.test/health
```

Ellenőrizze:

```js
const secure = await driver.executeScript(
  "return window.isSecureContext"
);

if (secure !== true) {
  throw new Error("Browser does not trust the test CA");
}
```

A body pontosan:

```text
ok
```

legyen.

Ha tanúsítványhiba vagy warning oldal jelenik meg, a job hibával álljon le.

## Kimeneti formátum

Minden böngészőhöz és profilhoz külön JSON-fájl készüljön.

Példa útvonal:

```text
observations/
  chrome/
    150.0.0.0/
      ubuntu-24.04/
        navigation-get.json
        form-post.json
        ajax-post.json
```

Példa JSON:

```json
{
  "schema_version": 1,
  "client": {
    "name": "chrome",
    "version": "150.0.0.0",
    "engine": "chromium",
    "channel": "stable"
  },
  "environment": {
    "os": "ubuntu-24.04",
    "architecture": "x64",
    "headless": true,
    "runner_image": "ubuntu-24.04",
    "runner_image_version": "unknown"
  },
  "tls": {
    "trusted_by_browser": true,
    "alpn": "h2",
    "secure_context": true
  },
  "scenario": {
    "id": "ajax-post",
    "method": "POST",
    "url": "https://app.test/capture/ajax"
  },
  "request": {
    "http_version": "2.0",
    "headers": {
      "content-type": "application/json"
    },
    "raw_headers": [
      "content-type",
      "application/json"
    ]
  },
  "observed_at": "2026-08-04T00:00:00Z"
}
```

Ne normalizáld vagy töröld a következőket a nyers adatból:

* header-sorrend;
* headernevek eredeti alakja, ha elérhető;
* duplikált headerek;
* teljes `User-Agent`;
* `Sec-CH-UA-*`;
* `Sec-Fetch-*`;
* `Accept`;
* `Accept-Encoding`;
* `Accept-Language`;
* `Origin`;
* `Referer`;
* `Content-Type`.

Készíts külön normalizált nézetet is diffeléshez, de a raw mérés mindig maradjon meg.

## Repo-struktúra

```text
.
├── .github/
│   └── workflows/
│       └── capture.yml
├── collector/
│   ├── server.mjs
│   ├── capture.mjs
│   ├── create-driver.mjs
│   └── scenarios/
│       ├── navigation-get.mjs
│       ├── form-post.mjs
│       └── ajax-post.mjs
├── schema/
│   └── observation.schema.json
├── observations/
├── scripts/
│   ├── normalize.mjs
│   ├── validate.mjs
│   └── generate-report.mjs
├── reports/
│   └── latest.md
├── package.json
├── package-lock.json
├── README.md
├── SECURITY.md
└── .gitignore
```

## GitHub Actions workflow

Készíts két jobcsoportot.

### Ubuntu matrix

```yaml
runs-on: ubuntu-24.04
```

Mátrix:

```yaml
browser:
  - chrome
  - edge
  - firefox
```

### Safari

```yaml
runs-on: macos-15
```

A workflow induljon:

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * 1"
```

Használj minimális jogosultságokat:

```yaml
permissions:
  contents: read
```

Első verzióban az eredmények artifactként töltődjenek fel.

Később külön workflow vagy GitHub App nyithat automatikus pull requestet.

## Workflow lépések

Minden jobban:

1. checkout;
2. Node.js telepítése;
3. `npm ci`;
4. böngésző és driver verziójának mentése;
5. runner metadata mentése;
6. ideiglenes CA létrehozása;
7. CA böngésző trust store-ba importálása;
8. HTTPS szervertanúsítvány létrehozása;
9. `/etc/hosts` vagy macOS `/etc/hosts` frissítése;
10. capture szerver indítása;
11. HTTPS health check;
12. böngészőszintű secure-context ellenőrzés;
13. három scenario futtatása;
14. JSON Schema validáció;
15. normalizált diff és Markdown riport készítése;
16. artifact feltöltése.

## Biztonsági követelmények

A `.gitignore` tartalmazza:

```gitignore
.tls/
.mkcert/
**/rootCA-key.pem
**/*.key
artifacts/
tmp/
```

A workflow ellenőrizze, hogy privát kulcs nem került a kimeneti könyvtárba:

```bash
if find artifacts observations -type f \
  \( -name "*.key" -o -name "rootCA-key.pem" \) \
  | grep -q .
then
  echo "Private key found in output"
  exit 1
fi
```

Ne logold:

* CA privát kulcsát;
* szerver privát kulcsát;
* cookie-kat;
* authorization headereket;
* GitHub tokeneket.

A capture szerver a `Cookie` és `Authorization` mezők értékeit maszkolja:

```json
{
  "authorization": "[REDACTED]",
  "cookie": "[REDACTED]"
}
```

## Riport

Generálj `reports/latest.md` fájlt, amely böngészőnként megmutatja:

* böngészőverzió;
* operációs rendszer;
* HTTP-verzió;
* ALPN;
* scenario;
* jelen lévő headernevek;
* előző méréshez képesti hozzáadott headerek;
* eltávolított headerek;
* megváltozott headerértékek.

A riport jelezze külön a következő változásokat:

```text
Sec-Fetch-Site
Sec-Fetch-Mode
Sec-Fetch-Dest
Sec-Fetch-User
Origin
Content-Type
User-Agent
Sec-CH-UA
Sec-CH-UA-Mobile
Sec-CH-UA-Platform
```

## Tesztek

Készíts automatizált teszteket legalább ezekre:

* a capture szerver megőrzi a `rawHeaders` tömböt;
* a JSON megfelel a sémának;
* a normalizáló determinisztikus;
* a redactálás eltávolítja az authorization és cookie értékeket;
* a TLS-ellenőrzés elbukik nem trusted CA esetén;
* minden böngészőhöz létrejön mindhárom scenario;
* a kimeneti fájlok között nincs privát kulcs.

## Elfogadási kritériumok

A feladat akkor kész, ha:

* a workflow manuálisan elindítható;
* Chrome, Edge és Firefox Ubuntu runneren lefut;
* Safari macOS runneren lefut;
* egyik böngésző sem használ insecure TLS override-ot;
* mindegyik böngésző `window.isSecureContext === true` eredményt ad;
* minden böngésző három külön request-profilt generál;
* a szerveroldalon látott raw headerek JSON-ba kerülnek;
* minden mérés tartalmaz böngésző-, driver-, OS- és runner-verziót;
* a JSON-fájlok séma szerint validak;
* elkészül az összesített Markdown riport;
* egyetlen CA- vagy szerverprivát kulcs sem kerül artifactba vagy repositoryba;
* a README dokumentálja a helyi futtatást és a GitHub Actions működését.

## Implementációs sorrend

1. Hozd létre a repository struktúráját.
2. Implementáld a HTTPS capture szervert.
3. Implementáld a három scenariót Chrome-mal.
4. Add hozzá a CA és Chromium NSS trust-store kezelését.
5. Add hozzá Edge támogatását.
6. Add hozzá a dedikált Firefox-profilt és CA-importot.
7. Add hozzá a Safari macOS jobot.
8. Implementáld a JSON Schema validációt.
9. Implementáld a normalizált diffet és riportot.
10. Add hozzá a biztonsági ellenőrzéseket és teszteket.
11. Futtasd a teljes workflow-t, és javítsd az összes platformfüggő hibát.

A megvalósítás során készíts kis, áttekinthető commitokat. Ne commitolj generált privát kulcsot vagy lokális CA-t.
