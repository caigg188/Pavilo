# Pavilo

<p align="center">
  <img src="docs/logo/pavilo-lockup.svg" width="520" alt="Pavilo">
</p>

> One command, one chat room for the people around you; compose it on demand to give your product a discussion space.

**English** · [简体中文](README.md)

Pavilo (**Pavilion + Local**) is a lightweight, self-hosted chat tool that runs in the browser, is ephemeral by default, and is evolving toward composable chat and play capabilities that developers can embed in their products. Like a small pavilion you can put up anywhere: start a Node.js process, and anyone on the same local network can open a web page and talk. In the default memory mode, chat history disappears when the service stops.

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.7.0-0f7772">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0f7772">
  <img alt="Node.js" src="https://img.shields.io/badge/node-%3E%3D22-0f7772">
  <img alt="Protocol v4" src="https://img.shields.io/badge/protocol-v4-0f7772">
</p>

Current version: **v1.7.0** — ephemeral group chat by default; optional SQLite via Config Schema v2 (30-day retention, history paging, backup). With sqlite you can open `/admin`, an optional AI gateway, and the Play host, plus per-channel feature flags and host JWT identity. With the operator console, people can report messages, operators can tombstone them, and stable users can be denied. With `embed.ancestors` set, a host page can iframe `/embed`. `embed.direct` lets an app WebView open the same page at the top level; the credential lives only in the URL fragment and is removed immediately. `?pavilo=` cannot sign in. Simplified Chinese and English UI, WebSocket Protocol v4 only. Built for trusted LANs, private networks, and VPNs.

<p align="center">
  <img src="docs/screenshots/overview.png" width="880" alt="Pavilo preview: desktop chat, login, and mobile">
</p>

## Who it serves and where it is going

- **Standalone users**: a browser-ready chat room for a LAN, event, or private team, with no persistence by default and optional SQLite retention.
- **Independent developers and small community maintainers**: run Pavilo yourself, then give your project's agent the prompt in the [integration note](docs/integrate.md) to place it in a web page or an app WebView. This project hosts nothing. Mini programs are out of scope. There is no SDK.
- **Play and extension contributors**: contracts for Play, Agent, moderation policies, and event extensions; maintainers provide infrastructure and a complete reference play.

| Status | Capabilities |
| --- | --- |
| Released: v1.2.0 | Ephemeral chat, optional SQLite retention, paging, backup, and storage operations |
| Released: v1.3.0 | AI gateway, admin console, room/channel configuration, seat mute/kick and IP denylist, Play/Agent host, and echo fixture |
| Released: v1.4.0 | Feature catalog, host JWT identity, and channel authorization |
| Released: v1.5.0 | Governance loop: reports, tombstone removal, stable-user denylist, operator action log |
| Released: v1.7.0 (latest stable) | Copy-paste integration: web iframe and app WebView share one service. A credential in the query cannot sign in. Mini programs are out of scope. No SDK |
| Released: v1.6.0 | Embed preview: a host page iframes `/embed`, and play stays in that frame. That tag has no `embed.direct` and does not read the fragment |

**There is no integration SDK.** Copy the prompt at the top of the [integration note](docs/integrate.md) into the other project's agent. The web example is [examples/host-embed/](examples/host-embed/); the side-by-side config is [examples/alongside/](examples/alongside/).

The default ephemeral mode remains a first-class mode. Official Werewolf is planned as a complete Play reference, developed alongside the infrastructure and required before v2.0. See the [roadmap](ROADMAP.md) and [integration design (planned)](docs/integration.md) for milestones and boundaries. Configuration and capabilities below describe the current stable release.

## Design principles

- **Works out of the box** — one command after install; participants only need a browser.
- **Stays lightweight** — the server uses Node.js built-in modules, with `yaml` as the only required runtime dependency and `better-sqlite3` as an optional SQLite driver; all front-end assets are self-hosted.
- **Ephemeral first** — no database or persisted chat content by default; SQLite retention is an explicit choice.
- **Deployer-controlled** — runs on your own machine or server; no external accounts or cloud services.
- **Grows on demand** — persistence is already optional; permissions, moderation, feature composition, and product integration are being developed without making the default deployment heavier.

## Features

**Chat experience**

- Enter a username to join the default channel; with multiple channels configured you can switch between them in the UI, and the channel list shows live occupancy per channel
- The UI language can be switched between Simplified Chinese and English; first visit uses `room.defaultLanguage` (default `zh-CN`), then the choice is remembered locally
- Channels isolate messages, online members, typing state, and reactions; each channel has its own ephemeral history and member cap
- Read-only channels (`readOnly: true`): joinable and readable, reactions allowed, but nobody can post — useful for announcements and rules maintained by the deployer
- Channel welcome text (`welcome`): an intro card shown at the top of a channel
- Reloading keeps you in the chat: your session identity lives only in the current tab's `sessionStorage` and is restored automatically. Only an explicit "Leave" (with confirmation) returns you to the login screen
- Text, emoji, and images (PNG / JPEG / GIF / WebP, 300 KB per image by default); paste, drop, or pick a file to stage a thumbnail, then send it with an optional caption in the same bubble; the emoji picker supports search, skin tones, and localized keywords
- Message replies, with second-precision timestamps on every message
- `@` mentions of channel members, highlighted when you are mentioned, clickable to view a member's profile
- Randomly generated avatars; click one to see username, IP (shown by default, configurable), and online duration
- Online member list, join/leave notices, and typing indicators
- Images open in an in-page viewer: zoom, rotate, reset, download; arrow keys page through multiple images; drag to pan and scroll to zoom on desktop
- Reactions are fixed to six emoji (👍 ❤️ 😂 🎉 👀 🔥)
- Responsive mobile layout, keyboard operation, and reduced-motion support

**Interface and assets**

- Full **dark mode** that follows the system theme
- Modern **glassmorphism** design with translucent surfaces and blur
- Smooth **micro-interactions**: springy button feedback, emoji bounces, pulse animations
- A considered color and spacing system — see the [design language doc](docs/design-language.md) (Chinese)
- Icons from self-hosted [Lucide](https://lucide.dev) (`vendor/lucide`, ISC)
- Emoji picker from self-hosted `vendor/emoji-picker` (Apache-2.0)
- The static allowlist serves the chat page, stylesheet, explicitly listed `client/` modules, and required `vendor/` assets; with sqlite and an operator token it also serves the admin console, and enabled plays serve only that play’s `page/` and `assets/`, never arbitrary repository files
- Text assets negotiate gzip via `Accept-Encoding`, cache by ETag, and send `Vary: Accept-Encoding`; clients without gzip still receive raw bytes

**Reliability**

- Messages are acknowledged by the server (ACK); unacknowledged or failed content can be retried in the same page
- Identical message IDs are deduplicated, and brief disconnects or reloads restore your ephemeral identity
- Images are downsampled in the browser to a 1600 px long edge and encoded at a quality that converges between 0.5–0.82 to fit the size budget; GIFs keep their animation and are never downsampled, but share the same size cap
- A graceful shutdown returns the page to the login state; an unexpected disconnect keeps reconnecting. A new memory-mode process produces a new channel epoch; SQLite keeps it across normal restarts. When the epoch changes, stale unacknowledged content is never silently delivered into the new room
- YAML configuration is validated for version, strict types, unknown keys, duplicate keys, aliases, and cross-field capacity relationships
- **Protocol v4 only**: `join.protocolVersion` must be `4`. An unrefreshed tab after a server upgrade is asked to reload

**Admin, gateway, and plays (optional, off by default)**

- `/admin` exists when sqlite is on and `operator.token` is at least 16 characters: overview, room, chat channels, seats, and the AI gateway
- Room, chat-channel, IP-denylist, and stable-user denylist saves take effect immediately; claimed YAML sections are ignored until reverted. Open chat tabs need a refresh
- The people page manages ephemeral seats in this process: mute, kick, IP denylist, open reports, identity denial, and the recent action log. It is not a member directory or host identity. An operator can tombstone a seat's messages
- Model channels and API keys are configured only in Admin → AI gateway, never in YAML; the chat core does not depend on AI
- Optional `plays` and `channels[].play` (sqlite required) open a dedicated play page. In-repo `echo` is a contract fixture and should stay off by default; official Werewolf is still being built by a collaborator

**Current read-only boundaries**

- People in the room cannot edit or delete a sent message; reactions are how they respond. With the operator console, an operator can tombstone a message: the body, images, and reply previews are no longer shown, but the row remains. Memory mode has no report or removal console
- History persistence is off by default (optional SQLite via Config Schema v2, 30-day retention); no direct messages, search, accounts, or role permissions
- Channels with `enabled: false` cannot be joined at all; `readOnly: true` channels can be joined, read, and reacted to, but nobody can post (no exceptions, no admin bypass)
- Read-only channels are for deployer-maintained announcements; YAML changes need a restart, admin channel saves apply immediately (open tabs still need a refresh)
- `config.js` and `pavilo.yaml` are never served by the app; `index.html` is the public chat entry point

## Quick start

### Run locally

Requires Node.js 22+. Clone the repository and install from the lockfile:

```bash
npm ci
npm start
```

It listens on `0.0.0.0:4173` by default and prints local and LAN addresses on startup:

- Local: `http://localhost:4173`
- LAN: `http://<host-LAN-IP>:4173`

Share the LAN address with anyone on the same Wi-Fi or private network. To change the port temporarily:

```bash
PORT=8080 npm start
```

### Docker

With Docker Compose (recommended):

```bash
git clone https://github.com/caigg188/Pavilo.git
cd Pavilo
docker compose up -d
```

Or build and run manually:

```bash
docker build -t pavilo .
docker run -d -p 4173:4173 --name pavilo pavilo
```

See the [Docker deployment guide](docs/deployment/docker.md) (Chinese).

### Production deployment

- **Reverse proxy** — see the [Nginx/Caddy guide](docs/deployment/reverse-proxy.md) (Chinese)
- **Health checks** — see the [health check contract](docs/healthcheck.md) (Chinese)

Press `Ctrl-C` to stop the service.

## Protocol stability

From v1.0 the server accepts only [Protocol v4](docs/api/websocket-protocol.md), and v4 stays stable throughout v1.x. v1–v3 have been removed. Third-party clients: see the [migration notes](docs/api/websocket-protocol.md#从旧协议迁移).

## Configuration

Pavilo loads configuration in this order (later entries win):

1. Built-in defaults;
2. `./pavilo.yaml`, falling back silently to defaults when the file is absent;
3. the YAML file pointed to by `PAVILO_CONFIG`;
4. the `PORT` environment variable, which overrides only the final port.

Once `PAVILO_CONFIG` is set explicitly, a missing, unreadable, oversized, non-regular, or invalid target fails startup instead of falling back. `PORT` accepts only a strict decimal string between `1` and `65535` — `4173.0`, `0x105d`, spaces, and signs are all invalid.

There are two copy-ready examples:

```bash
# Memory mode (default; gone after restart)
cp pavilo.example.yaml pavilo.yaml

# Or SQLite retention (last 30 days by default; model channels are configured in /admin)
cp pavilo.sqlite.example.yaml pavilo.yaml
mkdir -p data

npm run config:check
npm start
```

You can also keep the file outside the repository:

```bash
PAVILO_CONFIG=/etc/pavilo/config.yaml npm run config:check
PAVILO_CONFIG=/etc/pavilo/config.yaml npm start
```

YAML changes require a **process restart**; a running service never hot-reloads YAML. `npm run config:check` validates and reports the actual configuration source (including whether room / chat channels come from YAML or the admin overlay) without starting the service. Room and chat-channel edits saved in `/admin` are stored in SQLite, take effect immediately, and become the source of truth for that section.

Configuration must declare `version: 1` or `2` (`3` is read as `2`). Version 1 is memory mode and forbids `storage` / `operator` / `plays`. Version 2 is the SQLite family: optional `storage`, `operator.token`, and `plays`; the admin console, gateway, and plays all require sqlite. Model channels are configured in `/admin`, not in YAML. SQLite without a token still starts, but the process warns that `/admin` is unavailable. YAML uses strict types: write booleans as `true` / `false` and numbers as integers; unknown keys, duplicate keys, unknown tags, anchors/aliases, and non-object roots are rejected. There are two copy-paste examples: memory [`pavilo.example.yaml`](./pavilo.example.yaml), and the SQLite family (retention, admin, plays, host identity) [`pavilo.sqlite.example.yaml`](./pavilo.sqlite.example.yaml). Field reference: [docs/configuration.md](docs/configuration.md) (Chinese).

### Channel and capacity semantics

- Without `channels`, the built-in `general` and `project` channels are kept, and each channel's `maxUsers` is tightened to `server.maxUsers` — so lowering the global cap is enough.
- Once `channels` is provided, the list is a full replacement rather than a merge with `general`. A **non-`general` default channel** must appear in the list, be enabled, and be named by `room.defaultChannel`.
- `server.maxUsers` is the global member cap; `channels[].maxUsers` is the per-channel cap and may not exceed the global one.
- Both global and per-channel counts include members who are temporarily disconnected but can still resume within `timeouts.sessionLeaseMs`. Total connections are limited separately by `server.maxConnections`.
- At least one writable channel must be enabled (`enabled: true` and `readOnly` not `true`); read-only channels are readable but do not satisfy that minimum.

```yaml
version: 1
room:
  defaultChannel: projects
channels:
  - id: projects
    name: Projects
    enabled: true
    maxUsers: 24
```

_Note: the built-in default channels are `general` and `project` (singular)._

### Configuration file safety

Pavilo's HTTP server uses a static allowlist, so `pavilo.yaml`, `pavilo.example.yaml`, and `pavilo.sqlite.example.yaml` are never served by the app; the config loader also refuses to use `index.html`, `chat.css`, or any file inside `vendor/` or `client/` (including symlinks pointing at them) as configuration. This is not an authentication mechanism: the chat page, room metadata, and front-end assets are open to anyone who can reach the listening port.

- Never place real configuration in `vendor/`, `client/`, another web root, a public object-storage bucket, or a reverse proxy's static directory.
- A reverse proxy must forward only Pavilo's application port; never expose the whole repository as a static site, which would bypass the app allowlist and leak raw YAML, source, or other files.
- Raw YAML must **not** be downloadable. If it contains internal hostnames or network policy, keep it outside the repository with OS file permissions.
- `allowedOrigins` validates only the WebSocket browser Origin — it is **not** user authentication or access control. `allowNoOrigin: true` additionally permits clients with no Origin at all.
- Direct connections see real IPs; behind a reverse proxy this version does not trust `X-Forwarded-For`, so members may see the proxy IP and the per-IP connection limit aggregates by proxy IP. Do not "fix" the display by exposing the repository, and never put an unprotected port directly on the public internet.

## Capacity and ephemeral data boundaries

A message **ACK** means acceptance by the current process in memory mode and is sent after transaction commit in SQLite mode. Neither means every member received or read it. Default capacities include up to 300 messages of history per channel, roughly a 32 MB message budget, 300 KB per image, 64 members and 80 connections globally, 12 connections per IP, and a slow-connection write-buffer ceiling; when exceeded, the oldest messages are evicted first.

The per-image cap directly determines how many images a channel can hold: at 300 KB, about 79 images; at the old 1.5 MB default, only 16 — a single original photo would consume roughly 5% of a channel's capacity, so raising `limits.maxImageBytes` should be considered together with `limits.maxChannelBytes`. The client downsamples to a 1600 px long edge before upload, so phone photos are usually far below this cap; GIFs are not downsampled and may therefore be rejected.

Validation ensures the largest base64 image / longest text message, the roster JSON at the global member cap, WebSocket frames, and the write buffer can all contain one another. These are conservative lower bounds that prevent self-contradictory configuration, not a memory-usage promise; raising member, image, history, or buffer limits significantly increases memory needs.

**Ephemeral data**: sessions and presence remain runtime state. Messages and reactions are also ephemeral in memory mode; SQLite persists them according to retention settings. The browser does not use `localStorage`, Cache Storage, or IndexedDB for chat content. Language preferences use `localStorage`; cached emoji data and frequently-used counts use IndexedDB. Neither contains chat content.

So that a reload stays in the chat, the current tab stores the room-issued random resume token and username in `sessionStorage` — never messages. It disappears when the tab closes, is cleared immediately by "Leave", and becomes invalid after a service restart.

**Notification boundary**: system notifications require browser permission and a secure context; `http://<LAN-IP>` usually cannot provide them, in which case Pavilo falls back to in-page notifications. Permissions themselves are managed by the browser and may persist after the service stops.

## Running on a server

Pavilo runs on any server that can execute Node.js, but **the current deployment boundary remains trusted networks** (intranets, VPNs, or other private networks with access control). There is no chat-user authentication, built-in TLS, end-to-end encryption, or complete public-internet abuse protection — do not expose the port directly to the public internet.

Member profiles show the full connection IP to channel participants by default; set `room.exposeMemberIps: false` to hide it. Either way, the service still needs connection IPs to enforce per-IP limits. Use it only in trusted environments.

`/room-info` lists all of the host's LAN addresses by default so you can share the entry point with your subnet; set `room.exposeLanUrls: false` to return an empty array instead. `/healthz` reports current member count, connection count, and in-memory message bytes for liveness checks and observability. None of these endpoints require authentication, and like the chat page they are open to anyone who can reach the listening port.

## Development and testing

```bash
npm ci                  # install strictly from package-lock.json
npm run config:check    # validate the configuration that would actually load
npm test                # run test/*.test.js
node --check config.js
node --check server.js
```

Tests cover configuration, client protocol/state/pending/image rules, and the network-free chat core, plus HTTP/WebSocket history chunking, ACK, idempotent deduplication, identity resume, Origin checks, heartbeats, reactions, static assets, and lifecycle. Channel tests cover isolation, atomic switching, member leases, and capacity eviction.

Browser acceptance uses an installed Google Chrome; Playwright is installed outside the repository and stays out of runtime dependencies:

```bash
npm install --prefix /tmp/pavilo-browser-verify --no-package-lock playwright
PAVILO_PLAYWRIGHT_PATH=/tmp/pavilo-browser-verify/node_modules/playwright npm run test:browser
```

The script creates a temporary YAML outside the repository, allocates loopback ports, drives two pages, and only stops processes it started itself. It covers channel isolation and failed switches, reload/disconnect recovery, IME, the image viewer, reading position, the mobile drawer, and graceful shutdown.

Module boundaries and maintenance conventions: [architecture overview](docs/architecture/overview.md), [protocol contract](docs/architecture/chat-protocol.md), [state contract](docs/architecture/state-model.md), [design language](docs/design-language.md), [browser compatibility](docs/v0.5.0-browser-compatibility.md) (all Chinese).

Architecture decisions and evolution strategy:

- [Architecture principles](docs/architecture/principles.md) — core philosophy and invariants
- [Architecture evolution](docs/evolution.md) — future extension boundaries
- [Integration note](docs/integrate.md) — the prompt to give another project's agent. No SDK
- [Integration design (planned)](docs/integration.md) — earlier notes. Do not implement the SDK table
- [Play contract](docs/play.md) — channel binding and standalone play pages (v1.3)
- [Architecture decision records](docs/adr/) — context and trade-offs behind major decisions
- [Roadmap](ROADMAP.md) — version planning and release gates
- [v1.3 closeout checklist](docs/v1.3-closeout.md) — completed with v1.3.0 (Chinese)
- [v1.4 design](docs/v1.4-design.md) — feature catalog and host identity (Chinese)

## Project structure

```text
.
├── config.js           # YAML / environment configuration loading and validation
├── pavilo.example.yaml        # memory-mode example (cp to pavilo.yaml)
├── pavilo.sqlite.example.yaml # SQLite family example (retention; plays/identity as comments)
├── index.html          # page skeleton, asset references, and boot entry
├── chat.css            # page styles (dark mode, glassmorphism, micro-interactions)
├── client/             # protocol, connection, state, pending, and view modules
├── admin/              # operator console (sqlite + operator.token)
├── server.js           # configuration, core/transport composition, compatible entry
├── src/core/           # network-free rooms, sessions, commands, and domain events
├── src/storage/        # ConversationStore; npm run storage maintenance CLI
├── src/transport/      # HTTP static allowlist, WebSocket connections, frame protocol
├── src/gateway/        # in-process AI gateway (optional, off by default)
├── src/operator/       # admin auth, config overlay, and seat moderation
├── src/play/           # Play/Agent host
├── plays/              # echo contract fixture; official Werewolf still planned
├── vendor/             # self-hosted third-party front-end assets
├── scripts/            # Lucide asset build script
├── test/               # Node unit/integration tests and standalone browser acceptance
├── docs/
│   ├── architecture/   # current architecture, protocol, and state contracts
│   ├── evolution.md    # target architecture (planned)
│   ├── integration.md  # host integration boundaries (planned)
│   └── design-language.md  # design language, color system, component conventions
├── package.json        # metadata, dependencies, scripts
├── ROADMAP.md          # released / implemented-on-main / planned
└── LICENSE             # MIT license
```

## License

Pavilo is open source under the [MIT License](./LICENSE).