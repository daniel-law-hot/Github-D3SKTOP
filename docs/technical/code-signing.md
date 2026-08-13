# Code signing D3SKTOP on Windows

D3SKTOP ships unsigned today. Windows reports an unknown publisher on
`D3SKTOPSetup-x64.exe`, and SmartScreen warns on it. This is what it would take
to fix, and why the machinery already in the tree doesn't do it.

Everything below was checked against `daniel.law`'s workstation on 2026-08-14.
Re-check before relying on it — PKI templates and SDK paths both move.

## Why the existing signing never runs

`script/package.ts` already builds a complete signtool invocation:

```ts
options.signWithParams = `/v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib "${dlibPath}" /dmdf "${metadataPath}"`
```

electron-winstaller passes that to signtool, so the plumbing is there. Two
things stop it being useful to us:

1. **It is gated on `isGitHubActions() && isPublishable()`.** `isPublishable()`
   is true for a production build, but `isGitHubActions()` tests
   `GITHUB_ACTIONS === 'true'`, so the whole block is skipped when you build
   locally.

2. **It points at GitHub's certificate**, not ours — `CodeSigningAccountName:
   'GitHubInc'`, `CertificateProfileName: 'GitHubInc'`, reading the Azure Code
   Signing dlib out of `$RUNNER_TEMP/acs/`. That came with the fork and is not
   something House of Travel can use.

Also worth knowing: `script/build.ts` configures `osxSign` but **no
`windowsSign`**, so `D3SKTOP.exe` itself is never signed even in CI. Only the
installer, Squirrel's `Update.exe` and the nupkg payload go through
`signWithParams`. `updater.exe` — bundled by `yarn build:updater` via `pkg` and
added to the installer through `additionalFiles` — is unsigned too.

Signing the installer alone leaves the binary people actually run unsigned, so
any real fix covers all three.

## Route taken: House of Travel's internal CA

A publicly trusted certificate is not the obvious answer here. Since the CA/B
Forum tightened its rules in June 2023, publicly trusted code-signing keys have
to live on certified hardware, which rules out a plain `.pfx` and pushes you to
a cloud signing service (Azure Trusted Signing, DigiCert KeyLocker, SSL.com
eSigner) or an HSM. That is the right answer only if D3SKTOP is ever downloaded
from outside the network.

It isn't. It is an internal tool on domain-joined machines, and the internal PKI
already covers that case for free.

### What is already in place

- **`signtool.exe`** — `C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe`
  (also x86 and arm64 alongside it).
- **Domain membership** — `hot.co.nz`.
- **Enterprise roots distributed through AD** — `HoT-IT-CA`, `HoT Cloud Root CA`
  and `HOT Root CA` are all in the enterprise root store, so anything they issue
  is trusted on every domain-joined machine with no Group Policy work.
- **A code-signing template anyone can enrol in** — `InternalCodeSigningCertificate`
  grants Enroll to `HOT\Domain Users` and `NT AUTHORITY\Authenticated Users`.
  Three others exist if it turns out to be unsuitable: `CodeSigningV2` and
  `CodeSigning` (both Domain Users), and `NewCodeSigning` (Authenticated Users).
- **The `PKI` PowerShell module**, so `Get-Certificate` is available.

No IT ticket, no purchase, no root deployment.

### Enrolling

```powershell
Get-Certificate -Template InternalCodeSigningCertificate `
  -CertStoreLocation Cert:\CurrentUser\My
```

Then confirm it really carries the Code Signing EKU — the template's name says so
but its metadata didn't confirm it, and a certificate that lacks
`1.3.6.1.5.5.7.3.3` will not sign code:

```powershell
Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3' } |
  Select-Object Subject, Issuer, NotAfter, Thumbprint
```

If nothing comes back, try the other three templates in turn.

## Signing a build

Set the thumbprint and build as usual:

```powershell
$env:WINDOWS_CODE_SIGNING_THUMBPRINT = '<thumbprint>'
yarn build:prod
yarn package
```

Signing is off unless that variable is set, so an ordinary build still produces
the unsigned output it always did. `WINDOWS_CODE_SIGNING_TIMESTAMP_URL`
overrides the timestamp authority and `SIGNTOOL_PATH` overrides signtool
discovery.

`script/windows-sign.ts` holds the shared pieces: finding the newest SDK
`signtool.exe`, and building the argument list so what we run directly and what
electron-winstaller runs cannot drift apart. That shared list is **options
only** — electron-winstaller prepends its own `sign` subcommand, so direct
callers have to add theirs.

The certificate is chosen by thumbprint (`/sha1`) rather than subject name
(`/n`), because a renewed certificate sits alongside the one it replaces for a
while and signtool would otherwise take whichever it found first.

What gets signed, in order:

1. **`D3SKTOP.exe`**, in `script/build.ts`, straight after electron-packager
   writes it and *before* the installer is built, so the copy inside the
   installer is signed too. By hand rather than through the packager's
   `windowsSign`, which needs `@electron/packager` 18 — this is 17.1.1.
2. **`updater.exe`**, in `script/package.ts`, after `pkg` bundles it. It has to
   be there rather than in `build:updater`, because `pkg` rewrites the executable
   every time and would discard a signature applied earlier.
3. **The setup exe, `Update.exe` and the rest of the payload**, by Squirrel, via
   `signWithParams`.
4. **The msi**, which Squirrel writes but does not sign, so `package.ts` signs it
   separately.

Each is timestamped and then verified with `signtool verify /pa`, and the build
fails rather than handing over something unsigned.

### Non-Windows binaries have to go first

Squirrel signs every binary in the payload it can find, and signtool can only
sign a Portable Executable. Several dependencies ship every platform's native
build and choose between them at runtime, so a Windows package carries Mach-O
and ELF objects — twenty of them, from `foundry-local-sdk` and `koffi` — which
can never load here and stopped the signing dead.

`removeForeignNativeBinaries` in `script/build.ts` strips them before packaging.
It identifies them by reading the file rather than by directory name, because
the naming is no kind of convention — `prebuilds/darwin-arm64` for prebuildify,
`build/koffi/darwin_arm64` for koffi — whereas every binary Windows can load
begins with `MZ`.

### Checking the result

```powershell
signtool verify /pa /v .\dist\D3SKTOPSetup-x64.exe
Get-AuthenticodeSignature .\dist\D3SKTOPSetup-x64.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
```

Worth checking the copy inside the installer too, not just the installer, since
that is the one that ends up on disk — extract `lib/net45/D3SKTOP.exe` from the
nupkg and run the same check.

## Limits of this approach

- **Domain machines only.** Off-network or BYOD installs still see an unknown
  publisher, because those machines don't trust the HoT roots.
- **No SmartScreen benefit.** SmartScreen reputation is built from public CA
  identity and download volume; an internal certificate earns none of it.
- **The certificate expires.** Timestamped builds keep validating, but the
  signing certificate needs re-enrolling before it lapses, and whoever cuts
  releases needs their own.
- **Per-user by default.** A certificate in `Cert:\CurrentUser\My` signs on that
  account only. If more than one person cuts releases, either each enrols their
  own or a shared build identity is needed.
