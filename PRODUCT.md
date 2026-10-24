# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (website lumenlauncher.app); the product itself is an Electron desktop app for Windows

## Users

Minecraft: Java Edition players on Windows who find Lumen through search, Reddit or GitHub and don't know the developer. They compare it with launchers they already use (official launcher, ATLauncher, Prism, CurseForge) and decide whether it is worth installing an unsigned app from a hobby project.

## Product Purpose

Lumen is a free, open-source (GPL-3.0) Minecraft launcher: instances for any version (vanilla, Fabric, Quilt, Forge 1.13+, NeoForge), Modrinth modpacks in one click, a per-instance browser for mods, resource packs and shaders with updates, import from other launchers, .mrpack export, automatic Java, offline play or Microsoft sign-in. Success on the website: a visitor understands what is different, trusts it enough to download, and gets past SmartScreen.

## Positioning

A launcher that doesn't look like a settings dialog: five complete layouts (Art Book, Carousel, List, Shelf, Terminal) inspired by ES-DE's Art Book Next frontend, colour taken from each instance's icon, controller navigation. Made by one developer (GitHub: bluexoak) as a hobby project because existing launchers look generic.

## Operating Context

Visitors arrive on desktop mostly, some on phones (link shared in chats). German and English, auto-routed by browser language. Downloads come from GitHub releases; the Setup version updates itself from 0.1.3 on.

## Capabilities and Constraints

- Not supported: Forge before 1.13, CurseForge-only and Technic modpacks, data packs (per world).
- Microsoft sign-in works only once Mojang approves the app for the Minecraft API (pending as of 2026-10).
- Builds are not code-signed: SmartScreen warning on first start.
- Site: static HTML built from `site/src/page.html` + `site/src/strings.js`, served by a Cloudflare Worker; self-hosted fonts, no trackers.

## Brand Commitments

- Name Lumen, green app icon (`build/icon.png`).
- Voice: the developer speaks in first person, honest about it being a hobby project (confirmed 2026-10-23).
- The developer's real name and personal email are not published.

## Evidence on Hand

Real screenshots of the app in `site/public/img/de|en/` (layouts, colour schemes, discover, mods). No users, testimonials, download counts or press exist; never fabricate them.

## Product Principles

1. Show the real app, never mockups or invented data.
2. Be upfront about limits (unsigned, sign-in pending, what isn't supported).
3. Privacy by default: nothing loads from third parties.
