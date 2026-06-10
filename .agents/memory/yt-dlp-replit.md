---
name: yt-dlp n-challenge in Replit
description: How to make yt-dlp work in Replit for YouTube audio extraction (2026+)
---

## The Rule
Always pass `--js-runtimes node:PROCESS_EXECPATH` to yt-dlp when calling it from Node.js server code.

**Why:** yt-dlp 2026+ requires a JS runtime for n-challenge solving (YouTube's anti-bot). It defaults to `deno` which is not installed. Node.js IS available at `process.execPath` but yt-dlp won't find it automatically — you must pass `--js-runtimes node:/path/to/node` explicitly.

**How to apply:**
- In processor.ts: `const jsRuntimesArgs = ["--js-runtimes", \`node:\${process.execPath}\`];` — spread into every execFileAsync yt-dlp call
- In cookies.ts validate: same pattern with `process.execPath`
- Also install `yt-dlp[default]` (installs `yt-dlp-ejs-0.8.0`) for the challenge solver script distribution

## Broken clients in yt-dlp 2026.06.09
- `tv_embedded` — "Skipping unsupported client"
- `android_embedded` — "Skipping unsupported client"
- `android` — "does not support cookies"
- `ios` — "does not support cookies" (but works without cookies for public videos)

## Working strategy
1. `web` client with cookies + `--js-runtimes node:PATH` (primary — cookies bypass bot check, node solves n-challenge)
2. `ios` client without cookies (fallback — no n-challenge needed, no cookies)
3. `mweb` with cookies (last resort)

## Required packages
```bash
pip install yt-dlp          # yt-dlp binary
pip install "yt-dlp[default]"  # adds yt-dlp-ejs for JS challenge solver
```

Node.js binary is at `process.execPath` in the server process (~`/nix/store/.../bin/node`).
