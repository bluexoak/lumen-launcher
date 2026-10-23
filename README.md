<p align="center"><img src="build/icon.png" width="96" alt=""></p>

<h1 align="center">Lumen</h1>

<p align="center">A Minecraft: Java Edition launcher for Windows that shows your instances like an art book.<br>
<a href="https://lumenlauncher.app">lumenlauncher.app</a> · English &amp; Deutsch</p>

<p align="center"><img src="site/public/img/en/layout-book.jpg" width="820" alt="Lumen in the Art Book layout"></p>

## Download

Get the latest **installer** or **ZIP** (no installation) from [Releases](https://github.com/bluexoak/lumen-launcher/releases/latest) or [lumenlauncher.app](https://lumenlauncher.app). Windows 10/11, 64-bit.

The builds aren't code-signed yet: if SmartScreen says *"Windows protected your PC"*, click **More info → Run anyway**. Each release lists SHA-256 checksums.

## Features

- **Instances** for any Minecraft version – vanilla, Fabric or Quilt – each with its own worlds, mods and settings
- **Modpacks** from Modrinth in one click (`.mrpack`, every file checksum-verified)
- **Mod browser per instance** with automatic dependencies and one-click updates (stable releases only)
- **Java handled for you**: an installed JDK/JRE of the right version is used, otherwise Eclipse Temurin is downloaded and verified
- **Five layouts** – Art Book, Carousel, List, Shelf, Terminal – and **five colour schemes**, freely combinable
- **Controller support**: d-pad to browse, A to play, B to go back, Y to switch views
- **Offline play** with a player name, or **Microsoft sign-in** (needs your own Azure app approved for the Minecraft API, see below)
- **English and German** UI, following the system language by default

Forge and NeoForge are not supported yet.

## Run from source

Requires [Node.js](https://nodejs.org) 20 or newer, on Windows 10/11 (64-bit).

```bash
npm install
npm start
```

Build the installer and a portable `.exe` into `dist/`:

```bash
npm run dist
```

Self-checks: `npm test` (launcher logic), `node auth.js` (Microsoft sign-in flow against a fake backend), `node i18n.js` (both languages have the same strings).

## Microsoft sign-in

Lumen uses the device-code flow, so no secret is involved, but Microsoft only lets approved apps talk to the Minecraft services:

1. Register an app in the [Microsoft Entra admin center](https://entra.microsoft.com) → *App registrations* → *New registration*, account type **Personal Microsoft accounts only**.
2. Under *Authentication*, set **Allow public client flows** to **Yes**.
3. Apply for Minecraft API access for that app (Microsoft/Mojang review form: `aka.ms/mce-reviewappid`).
4. Paste the app's *Application (client) ID* into Lumen → Settings → Microsoft account.

Tokens are stored encrypted with Windows DPAPI (`%APPDATA%\.lumen\account.bin`).

## Data

Everything Lumen downloads or creates lives in `%APPDATA%\.lumen` (instances, shared libraries and assets, Java runtimes, settings). Uninstalling Lumen leaves it in place.

Lumen talks to Mojang/Microsoft (game files, sign-in), Modrinth (modpacks, mods, icons), Fabric/Quilt (loader metadata) and Adoptium (Java). It has no analytics or tracking.

## Project layout

| Path | What it is |
|---|---|
| `main.js`, `preload.js` | Electron main process and the IPC bridge (channel allow-list) |
| `launcher.js` | versions, downloads, Java, launching, instances, Modrinth |
| `auth.js` | Microsoft → Xbox Live → Minecraft sign-in |
| `i18n.js` | all UI strings, German and English |
| `app.js`, `layouts.js`, `index.html`, `style.css` | the interface |
| `site/` | the website, a Cloudflare Worker with static assets |

## License

[GPL-3.0](LICENSE). Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
