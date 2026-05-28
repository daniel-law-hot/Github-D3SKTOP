# GitHub D3SKTOP

> **This is a fork of [GitHub Desktop](https://desktop.github.com/)** maintained at
> [daniel-law-hot/Github-D3SKTOP](https://github.com/daniel-law-hot/Github-D3SKTOP).
> It installs side-by-side with the official GitHub Desktop, tracks its own
> release feed, and adds a handful of helpers tuned for our workflow.

[GitHub Desktop](https://desktop.github.com/) is an open-source [Electron](https://www.electronjs.org/)-based
GitHub app. It is written in [TypeScript](https://www.typescriptlang.org) and
uses [React](https://reactjs.org/).

## D3SKTOP fork

### What's different from upstream

- **Side-by-side install** — installs to `%LOCALAPPDATA%\D3SKTOP\` and runs as `D3SKTOP.exe`, so it does not overwrite an existing GitHub Desktop installation.
- **Fork-tracked auto-updates** — the in-app "Update available" prompt polls this fork's [GitHub Releases](https://github.com/daniel-law-hot/Github-D3SKTOP/releases) instead of GitHub's private update feed. New releases tagged `v1.2026.x` are detected, downloaded, and applied automatically. See [`app/src/main-process/github-release-updater.ts`](app/src/main-process/github-release-updater.ts) and the bundled `updater.exe` ([`updater/src/main.ts`](updater/src/main.ts)).
- **CalVer versioning** — releases follow `MAJOR.YEAR.PATCH` (e.g. `1.2026.3`) rather than upstream's `3.x.y`.
- **Open in Visual Studio** — extra helper button on the repository page that launches the current repo in Visual Studio when a `.sln` is found.

### Installation

1. Download the latest `D3SKTOPSetup-x64.exe` from [Releases](https://github.com/daniel-law-hot/Github-D3SKTOP/releases/latest).
2. Run it. Windows SmartScreen will warn that the publisher is unknown (the fork's builds are currently unsigned) — click **More info** → **Run anyway**.
3. The app installs to `%LOCALAPPDATA%\D3SKTOP\app-<version>\D3SKTOP.exe` and creates a Start menu shortcut titled **GitHub D3SKTOP**.

### How updates work

While the app is running it polls `api.github.com/repos/daniel-law-hot/Github-D3SKTOP/releases/latest`. When a tag newer than the installed version appears, the existing "Update available" banner shows up. Clicking **Restart and Update** does the following:

1. The app downloads the release's `D3SKTOP-win32-x64.zip` asset to a temp folder.
2. It hands off to the bundled `updater.exe`, which waits for the main app to exit, extracts the new zip over the install folder (with a `.bak` snapshot for rollback), and relaunches the new build.
3. `updater.exe` cleans up after itself.

No admin rights required, no Squirrel update feed needed.

### Building from source

```powershell
yarn install
yarn build:updater     # produces dist/updater.exe (~57 MB)
yarn build:prod        # bundles the Electron app to dist/D3SKTOP-win32-x64/
yarn package           # produces dist/D3SKTOPSetup-x64.exe + .msi + portable .zip
```

The full toolchain matches upstream — see [`docs/contributing/setup.md`](docs/contributing/setup.md) for Node/Yarn versions and required Windows build tools. The fork adds a single root-level workspace at [`updater/`](updater/) that builds a standalone Node-packaged updater binary.

### Cutting a release

1. Bump `app/package.json` "version" to the next `1.2026.x`.
2. Commit and push, then tag: `git tag v1.2026.x && git push origin v1.2026.x`.
3. The [`Publish Release` workflow](.github/workflows/publish-release.yml) builds the artifacts and creates a GitHub Release with the installer + portable zip attached.
4. Existing installs of the previous version will see the update within ~4 hours (or immediately via *File → Check for Updates*).

---

Below this line is the original upstream README, unmodified.

---

<picture>
  <source
    srcset="https://user-images.githubusercontent.com/634063/202742848-63fa1488-6254-49b5-af7c-96a6b50ea8af.png"
    media="(prefers-color-scheme: dark)"
  />
  <img
    width="1072"
    src="https://user-images.githubusercontent.com/634063/202742985-bb3b3b94-8aca-404a-8d8a-fd6a6f030672.png"
    alt="A screenshot of the GitHub Desktop application showing changes being viewed and committed with two attributed co-authors"
  />
</picture>

## Where can I get it?

Download the official installer for your operating system:

 - [macOS](https://central.github.com/deployments/desktop/desktop/latest/darwin)
 - [macOS (Apple silicon)](https://central.github.com/deployments/desktop/desktop/latest/darwin-arm64)
 - [Windows](https://central.github.com/deployments/desktop/desktop/latest/win32)
 - [Windows machine-wide install](https://central.github.com/deployments/desktop/desktop/latest/win32?format=msi)

Linux is not officially supported; however, you can find installers created for Linux from a fork of GitHub Desktop in the [Community Releases](https://github.com/desktop/desktop#community-releases) section.

### Beta Channel

Want to test out new features and get fixes before everyone else? Install the
beta channel to get access to early builds of Desktop:

 - [macOS](https://central.github.com/deployments/desktop/desktop/latest/darwin?env=beta)
 - [macOS (Apple silicon)](https://central.github.com/deployments/desktop/desktop/latest/darwin-arm64?env=beta)
 - [Windows](https://central.github.com/deployments/desktop/desktop/latest/win32?env=beta)
 - [Windows (ARM64)](https://central.github.com/deployments/desktop/desktop/latest/win32-arm64?env=beta)

The release notes for the latest beta versions are available [here](https://desktop.github.com/release-notes/?env=beta).

### Past Releases
You can find past releases at https://desktop.githubusercontent.com. After installation of a past version, the auto update functionality will attempt to download the latest version. 

### Community Releases

There are several community-supported package managers that can be used to
install GitHub Desktop:
 - Windows users can install using [winget](https://docs.microsoft.com/en-us/windows/package-manager/winget/) `c:\> winget install github-desktop` or [Chocolatey](https://chocolatey.org/) `c:\> choco install github-desktop`
 - macOS users can install using [Homebrew](https://brew.sh/) package manager:
      `$ brew install --cask github`

Installers for various Linux distributions can be found on the
[`shiftkey/desktop`](https://github.com/shiftkey/desktop) fork.

## Is GitHub Desktop right for me? What are the primary areas of focus?

[This document](https://github.com/desktop/desktop/blob/development/docs/process/what-is-desktop.md) describes the focus of GitHub Desktop and who the product is most useful for.

## I have a problem with GitHub Desktop

Note: The [GitHub Desktop Code of Conduct](https://github.com/desktop/desktop/blob/development/CODE_OF_CONDUCT.md) applies in all interactions relating to the GitHub Desktop project.

First, please search the [open issues](https://github.com/desktop/desktop/issues?q=is%3Aopen)
and [closed issues](https://github.com/desktop/desktop/issues?q=is%3Aclosed)
to see if your issue hasn't already been reported (it may also be fixed).

There is also a list of [known issues](https://github.com/desktop/desktop/blob/development/docs/known-issues.md)
that are being tracked against Desktop, and some of these issues have workarounds.

If you can't find an issue that matches what you're seeing, open a [new issue](https://github.com/desktop/desktop/issues/new/choose),
choose the right template and provide us with enough information to investigate
further.

## The issue I reported isn't fixed yet. What can I do?

If nobody has responded to your issue in a few days, you're welcome to respond to it with a friendly ping in the issue. Please do not respond more than a second time if nobody has responded. The GitHub Desktop maintainers are constrained in time and resources, and diagnosing individual configurations can be difficult and time consuming. While we'll try to at least get you pointed in the right direction, we can't guarantee we'll be able to dig too deeply into any one person's issue.

## How can I contribute to GitHub Desktop?

The [CONTRIBUTING.md](./.github/CONTRIBUTING.md) document will help you get setup and
familiar with the source. The [documentation](docs/) folder also contains more
resources relevant to the project.

If you're looking for something to work on, check out the [help wanted](https://github.com/desktop/desktop/issues?q=is%3Aissue+is%3Aopen+label%3A%22help%20wanted%22) label.

## Building Desktop

To setup your development environment for building Desktop, check out: [`setup.md`](./docs/contributing/setup.md).

## More Resources

See [desktop.github.com](https://desktop.github.com) for more product-oriented
information about GitHub Desktop.

See our [getting started documentation](https://docs.github.com/en/desktop/overview/getting-started-with-github-desktop) for more information on how to set up, authenticate, and configure GitHub Desktop.

## License

**[MIT](LICENSE)**

The MIT license grant is not for GitHub's trademarks, which include the logo
designs. GitHub reserves all trademark and copyright rights in and to all
GitHub trademarks. GitHub's logos include, for instance, the stylized
Invertocat designs that include "logo" in the file title in the following
folder: [logos](app/static/logos).

GitHub® and its stylized versions and the Invertocat mark are GitHub's
Trademarks or registered Trademarks. When using GitHub's logos, be sure to
follow the GitHub [logo guidelines](https://github.com/logos).
