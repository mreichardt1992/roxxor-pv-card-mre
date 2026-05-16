# Publishing Guide

This document explains how to publish the RoxXor-PV-Card to GitHub and optionally make it installable via HACS.

## Step 1: Create the GitHub repository

1. Log in to [GitHub](https://github.com)
2. Click **+ → New repository** (top right)
3. Settings:
   - **Repository name:** `roxxor-pv-card`
   - **Description:** `A modern, comprehensive energy flow card for Home Assistant`
   - **Visibility:** Public
   - **Initialize:** Leave all checkboxes unchecked (we already have files)
4. Click **Create repository**

## Step 2: Upload the files

### Option A — via Web UI (easiest)

1. On the empty repo page, click **uploading an existing file**
2. Drag and drop all files from this folder:
   - `roxxor-pv-card.js`
   - `README.md`
   - `LICENSE`
   - `CHANGELOG.md`
   - `hacs.json`
   - `info.md`
   - `.gitignore`
   - The `examples/` folder (drag the entire folder)
   - The `images/` folder (drag the entire folder)
3. Commit message: `Initial release v5.1`
4. Click **Commit changes**

### Option B — via git CLI

```bash
cd /path/to/this/folder
git init
git add .
git commit -m "Initial release v5.1"
git branch -M main
git remote add origin https://github.com/RoxXorPro/roxxor-pv-card.git
git push -u origin main
```

## Step 3: Add screenshots

1. Take screenshots of your card (see `images/README.md` for guidance)
2. Upload them to the `images/` folder via the GitHub web UI
3. Or use git CLI to push them

## Step 4: Create a release

A tagged release is required for HACS and gives users a stable download point.

1. On your repo page, click **Releases** (right sidebar)
2. Click **Create a new release**
3. Fill in:
   - **Tag:** `v5.1` (must start with `v`, follows semver)
   - **Target:** `main`
   - **Release title:** `v5.1 — Wallbox layout polish`
   - **Description:** Copy from `CHANGELOG.md`
4. Click **Publish release**

For each future update:
1. Bump the version in `roxxor-pv-card.js` (search for the `console.info` line at the bottom)
2. Add an entry to `CHANGELOG.md`
3. Create a new release with the new tag

## Step 5 (optional): Make it HACS-installable

There are two paths:

### Easier: Custom repository

Users can already install your card as a custom HACS repo without any official listing. Just direct them to:

> HACS → Frontend → ⋮ → Custom repositories → Add: `https://github.com/RoxXorPro/roxxor-pv-card`, Category: `Lovelace`

This works immediately. You're done.

### Official HACS default listing

To get listed in the default HACS catalog (so users find it without adding a custom repo), you'll need to:

1. Make sure `hacs.json` is in your repo root (it is)
2. Make sure you have at least one tagged release (you do)
3. Make sure your `README.md` is good (it is)
4. Submit a PR to [hacs/default](https://github.com/hacs/default) adding your repo to the `plugin` list

This usually takes a few days for review. See HACS docs: https://www.hacs.xyz/docs/publish/start

## Step 6: Promote it

Optional but recommended:
- Post on the [Home Assistant Community Forum](https://community.home-assistant.io/c/projects/frontend/14)
- Add a topic to your repo for discoverability (e.g. `home-assistant`, `lovelace`, `lovelace-custom-card`, `solar`, `pv`, `energy`, `hacs`)

## Step 7: Configure repo settings

On your repo page → **Settings**:

- **About** (right sidebar gear icon) → add description, topics, website if you have one
- **Issues** → enable, allows users to report bugs
- **Discussions** → optional, nice for Q&A

## Maintenance tips

- When users open issues, ask for: HA version, browser, sensor configuration, browser console output
- Use semantic versioning: bump patch (5.1 → 5.2) for fixes, minor (5.1 → 5.2.0 → 5.3.0... or 5.x → 5.y) for features, major (5.x → 6.0) for breaking changes
- Keep the `CHANGELOG.md` up to date — HACS shows it to users
- Pin a "known issues" issue if there's a recurring question

## Files in this repo

```
roxxor-pv-card/
├── roxxor-pv-card.js       # The card itself
├── README.md               # Main documentation
├── LICENSE                 # MIT license
├── CHANGELOG.md            # Version history
├── hacs.json               # HACS metadata
├── info.md                 # Short description shown in HACS
├── .gitignore              # Git ignore rules
├── PUBLISHING.md           # This file (you can delete it after publishing)
├── examples/
│   ├── minimal.yaml        # Smallest working config
│   └── full-example.yaml   # All options demonstrated
└── images/
    └── README.md           # Placeholder, replace with actual screenshots
```
