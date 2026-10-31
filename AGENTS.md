# AGENTS.md — Figma MCP Bridge

> **Instructions for AI coding agents** (Antigravity, Cline, Claude Code, Cursor, Copilot, Codex, …).  
> This file is the single source of truth for how to work in this repository.  
> `CLAUDE.md` and `GEMINI.md` reference this file; subagent definitions live in `.claude/agents/` and workspace skills live in `.agents/skills/`.

---

## 1. Project Overview

**Figma MCP Bridge** is a developer tool and Chromium extension that bridges live Figma node and design data from an active browser tab directly into local Model Context Protocol (MCP) clients (Claude Desktop, Antigravity, Cursor, etc.) **without requiring a Figma REST API token or Personal Access Token (PAT)**.

Instead of hitting the rate-limited REST API, this project injects a script into the Figma page's **`MAIN` JavaScript world** to read node trees directly from `window.figma` — the exact in-memory Plugin API used by native Figma plugins. It also includes an automated Windows session sync engine that extracts authenticated Figma session cookies (`figma.session`, `__Host-figma.authn`, etc.) from running Figma Desktop or Google Chrome processes using Windows DPAPI decryption and Win32 handle duplication, syncing them into `chrome-devtools-mcp` browser profiles.

### Tech Stack

- **Chrome Extension**: Vanilla JavaScript (ES2022+), Chromium Manifest V3 (Service Worker, Content Script, `chrome.scripting` MAIN world injection).
- **MCP Server**: Node.js 22+ (ES Modules), `@modelcontextprotocol/sdk` (stdio transport), `ws` (WebSocket server on `127.0.0.1:9223`).
- **Session Sync**: Python 3.10+ (Win32 `kernel32` ctypes, DPAPI via PowerShell `ProtectedData`, `cryptography` AES-GCM, SQLite3).

Package name: `figma-mcp-browser` (v1.1.0).

---

## 2. Commands & Workflow

| Task | Command | Notes |
|---|---|---|
| Start MCP Server | `npm start` (or `node server/index.js`) | Starts WebSocket server on `127.0.0.1:9223` and connects MCP over stdio |
| Build Release Packages | `npm run package` | Builds distributable archives in `dist/` (`.zip` and `.tar.gz`) |
| Sync Figma Session | `npm run sync-session` | Runs `python server/session_sync.py --sync-mcp` to sync cookies to MCP browser |
| Check Session Status | `npm run session-status` | Runs `python server/session_sync.py --status` to inspect valid session metadata |
| Install Server Deps | `cd server && npm install` | Installs `@modelcontextprotocol/sdk` and `ws` |
| Load Extension in Chrome | Open `chrome://extensions` → Enable Developer Mode → **Load unpacked** | Select root repository directory `c:\Users\Parallel\Documents\others\figma-mcp-browser` |

### AI Host Configuration

#### Claude Desktop
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "figma-browser-bridge": {
      "command": "node",
      "args": ["c:/Users/Parallel/Documents/others/figma-mcp-browser/server/index.js"]
    }
  }
}
```

#### Antigravity / Gemini CLI (`mcp_config.json`)
```json
{
  "mcpServers": {
    "figma-browser-bridge": {
      "command": "node",
      "args": ["c:/Users/Parallel/Documents/others/figma-mcp-browser/server/index.js"]
    }
  }
}
```

---

## 3. Repository Map

```text
figma-mcp-browser/
├── manifest.json            # Chrome MV3 manifest (permissions: scripting, alarms, tabs, cookies)
├── background.js           # MV3 background service worker: WebSocket client, keep-alive, tab router, badge controller
├── content.js              # Content script (ISOLATED world): URL poller, keep-alive port, postMessage bridge
├── inject.js               # Page script (MAIN world): accesses window.figma, serializes node tree & a11y specs
├── popup.html              # Extension toolbar popup dashboard UI
├── popup.js                # Extension popup controller (queries background state & Chrome tabs)
├── popup.css               # Extension popup styling (dark mode, responsive cards)
├── icons/                  # Extension PNG and SVG icons (16px, 48px, 128px)
├── bin/
│   └── figma-mcp-browser.js # CLI / npx executable entry point
├── scripts/
│   ├── package.js          # Cross-platform Node packaging wrapper
│   └── package.py          # Python zip & tar release packager
├── package.json            # Root npm package metadata & scripts
├── README.md               # User documentation, architecture diagrams, installation guide
├── LICENSE                 # MIT License
├── .gitignore              # Git ignore rules
│
├── server/                 # Local MCP Server & Session Engine
│   ├── index.js            # Node MCP server (stdio) + WebSocket server (127.0.0.1:9223)
│   ├── session_manager.js  # Node subprocess bridge to session_sync.py
│   ├── session_sync.py     # Python Win32 DPAPI + handle duplication + SQLite cookie sync
│   ├── package.json        # Server dependencies (@modelcontextprotocol/sdk, ws)
│   └── package-lock.json   # Locked server dependencies
│
├── .github/
│   └── workflows/
│       └── release.yml     # GitHub Actions workflow for extension zip & server tarball releases
│
├── .claude/
│   └── agents/             # Specialized Claude subagents (extension, protocol, session)
│
└── .agents/
    ├── rules/              # Antigravity project rules
    └── skills/             # On-demand Antigravity diagnostic skills
```

---

## 4. Architecture Invariants — NEVER Break These

### 1. The Strict 4-Hop Request/Response Pipeline
Data retrieval strictly follows this sequence:
```text
AI Client (stdio)
   │
   ▼
MCP Server (`server/index.js`)
   │  (WebSocket: ws://127.0.0.1:9223)
   ▼
Background Service Worker (`background.js`)
   │  (`chrome.tabs.sendMessage`)
   ▼
Content Script (`content.js` — ISOLATED world)
   │  (`window.postMessage` with source "figma-mcp-isolated")
   ▼
Injected Script (`inject.js` — MAIN world)
   │  (direct access to `window.figma`)
   ▼
`window.figma.getNodeByIdAsync()` / `currentPage.selection`
```
- **Never attempt to access `window.figma` directly from `content.js`**: Content scripts run in an isolated JavaScript execution context where `window.figma` is `undefined`.
- **Never bypass `content.js` from `background.js`**: Direct evaluation of complex multi-step promises via `chrome.scripting.executeScript` causes serialization bottlenecks; the message bridge ensures streaming stability.

### 2. CSP-Compliant Main World Injection
- Figma enforces a strict Content Security Policy (`script-src`) on `figma.com`. Creating `<script>` elements dynamically in the DOM is blocked by CSP.
- `inject.js` **MUST** be injected into the MAIN world using privileged browser API:
  ```javascript
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["inject.js"],
    world: "MAIN"
  });
  ```
- The `injectedTabs` Set tracks tabs to avoid duplicate injection, and is cleared on tab navigation (`loading`) or removal (`onRemoved`).

### 3. MV3 Service Worker Keep-Alive Invariants
- Manifest V3 background service workers automatically terminate after 30 seconds of idle time.
- To maintain uninterrupted WebSocket communication, two keep-alive mechanisms MUST remain active:
  1. **Long-lived port connection**: `content.js` opens `chrome.runtime.connect({ name: "figma-keep-alive" })` with auto-reconnect on disconnect.
  2. **Chrome Alarm**: `background.js` registers a 1-minute alarm (`mcp-keepalive`) that pings the server or reconnects if the socket is closed.

### 4. IPv4 Loopback Explicit Binding
- The WebSocket server in `server/index.js` **MUST** bind explicitly to `127.0.0.1`:
  ```javascript
  const wss = new WebSocketServer({ port: WEBSOCKET_PORT, host: "127.0.0.1" });
  ```
- Do **not** bind to `localhost` or `0.0.0.0`. On Windows, `localhost` frequently resolves to IPv6 `::1`, while the browser extension resolves `127.0.0.1`, resulting in connection drops (`ECONNREFUSED`).

### 5. Stdio Cleanliness (MCP Transport Invariant)
- `server/index.js` communicates with AI clients over `stdio` using JSON-RPC.
- **NEVER use `console.log()` inside `server/index.js` or `server/session_manager.js`**. Any arbitrary text sent to `stdout` corrupts the MCP JSON-RPC message framing and crashes the client connection.
- **All debug and operational logging MUST use `console.error()`**, which outputs to `stderr` and is safely displayed in client debug logs.

### 6. Windows DPAPI & Locked Database Access
- Google Chrome and Figma Desktop lock their SQLite databases (`Cookies`, `Network/Cookies`) with exclusive file locks (`FILE_SHARE_READ` denied or strict locks) while running.
- Attempting to copy or open these SQLite databases directly using standard Python `open()` or `sqlite3.connect()` will raise `PermissionError` (Windows Error 32: sharing violation).
- `server/session_sync.py` uses `kernel32.DuplicateHandle` on open process handles to read locked SQLite files in memory, combined with Windows DPAPI (`System.Security.Cryptography.ProtectedData::Unprotect`) to decrypt the master key. **Do not replace this with raw file reads**.

### 7. Node Tree Recursion & Visibility Invariants
- In `inject.js`, the `visible` attribute must be evaluated as `node.visible !== false`. A node is only hidden if explicitly set to `false`; if `undefined`, it must default to `true` (e.g. root frames, pages).
- All color fills must serialize normalized 0-255 RGB integer values (`Math.round(fill.color.r * 255)`) and float alpha.
- Geometry dimensions must prioritize `absoluteBoundingBox` coordinates when available.

### 8. Proper Async Awaiting in Message Handlers
- `queryActiveSelection()` and `queryNodeById()` in `inject.js` are asynchronous functions returning Promises.
- Handlers in `inject.js` must `await` them before sending `FETCH_NODE_DATA_RESPONSE` via `window.postMessage`, otherwise an unresolved Promise object is passed to structured cloning.

---

## 5. Code Conventions & Style

- **Chrome Extension Code (`background.js`, `content.js`, `inject.js`)**:
  - Pure vanilla JavaScript (ES2022+).
  - No bundlers (Webpack, Vite, Rollup) and no transpilation — keeps the extension inspectable, lightweight, and instantly editable.
  - Wrap all message event listeners in `try / catch` blocks and provide structured error responses (`{ success: false, error: err.message }`).
  - Prefix all console logs with the component name: `[Figma MCP]`, `[Figma MCP Content]`, or `[Figma MCP Main]`.
- **MCP Server Code (`server/`)**:
  - Node.js ES Modules (`import/export`).
  - Strict input schema validation on all MCP tool calls (`CallToolRequestSchema`).
  - Timeout protection: All WebSocket queries forwarded to the browser have an explicit 10-second timeout promise rejection.
  - Return formatted JSON strings within standard MCP content objects: `{ content: [{ type: "text", text: JSON.stringify(...) }] }`.
- **Python Utility Code (`server/session_sync.py`)**:
  - Python 3.10+ compatible, strictly type-annotated where possible.
  - Windows ctypes error checking (`ctypes.windll.kernel32`).
  - CLI supports both human-readable stdout and machine-readable `--json` flag for IPC with `session_manager.js`.

---

## 6. Common Pitfalls & Edge Cases

1. **Figma Canvas in `<iframe>`**:
   The Figma canvas frequently renders within a same-origin iframe rather than the top-level window. `inject.js` implements a multi-tier resolution strategy (`findFigma`):
   - Priority 1: `window.figma`
   - Priority 2: `window.__figmaMCPInstance` (DevTools manual registration hook)
   - Priority 3: Same-origin `<iframe>` elements (`frame.contentWindow.figma`)
   Never assume `window.figma` exists immediately on the top-level window.
2. **Tab Navigation / Reloading**:
   When a user navigates between Figma files or reloads the tab, the MAIN world context is reset. `background.js` listens to `chrome.tabs.onUpdated` and `chrome.tabs.onRemoved` to invalidate the injection cache and automatically re-inject `inject.js` on `status === "complete"`.
3. **Figma Node ID Format**:
   Figma URLs use hyphens for node IDs (e.g. `node-id=474-10679`), but the Figma Plugin API requires colons (e.g. `474:10679`). Both `content.js` and `inject.js` normalize hyphens to colons: `.replace(/-/g, ":")`.
4. **Packaging Incomplete Releases**:
   When updating GitHub Actions (`.github/workflows/release.yml`), ensure that `server/session_manager.js` and `server/session_sync.py` are included in the server distribution tarball alongside `index.js`.

---

## 7. Security & Privacy Boundaries

- **Localhost Loopback Only**:
  The WebSocket server binds strictly to `127.0.0.1:9223`. It must never be exposed to public networks, external interfaces, or remote IP addresses.
- **Credential & Cookie Isolation**:
  Extracted session cookies (`figma.session`, `__Host-figma.authn`) are only transferred locally to the local Chrome DevTools MCP user profile. They are **never** logged to stdout, never sent over the WebSocket bridge, and never transmitted to external servers.
- **PostMessage Scoping**:
  `content.js` and `inject.js` validate message origins and action tags (`source === "figma-mcp-isolated"` / `source === "figma-mcp-main"`), ignoring unrelated page messages or third-party iframe events.

---

## 8. Subagent Specialists

When undertaking specialized tasks in this repository, delegate to or adopt the mindset of these domain agents:

| Subagent | Scope | Defined In |
|---|---|---|
| `extension-architect` | MV3 service worker lifecycle, alarms, keep-alive ports, content scripts, MAIN world injection, and DOM postMessage bridging | `.claude/agents/extension-architect.md` |
| `mcp-protocol` | MCP SDK tools (`get_figma_node`, `get_active_selection`), stdio JSON-RPC transport, WebSocket server coordination, and node tree serialization | `.claude/agents/mcp-protocol.md` |
| `session-security` | Windows DPAPI decryption, process handle duplication, locked SQLite database extraction, and Chrome DevTools MCP session synchronization | `.claude/agents/session-security.md` |
