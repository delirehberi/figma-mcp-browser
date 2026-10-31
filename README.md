# Figma MCP Bridge Chrome Extension & Server

An open-source Chromium extension and local Model Context Protocol (MCP) server that bridges live Figma node data directly from an active browser tab to AI coding agents (Claude, Antigravity, Cursor, Codex) — **without requiring a Figma REST API token or Personal Access Token (PAT)**.

Instead of hitting the rate-limited REST API, this extension injects a script into the Figma page's MAIN JavaScript world and reads node data directly from `window.figma` — the same in-memory Plugin API that native Figma plugins use. This gives your AI agents instant access to the live document tree: auto-layout, geometry, typography, fills, strokes, accessibility annotations, and the full recursive child hierarchy.

---

## Features

- **No API Token Required** — No Figma PAT, no OAuth permissions, and zero rate limits.
- **Full Recursive Node Tree** — Serializes entire layer hierarchies: frames, text layers, vector shapes, components, and instances.
- **Accessibility & Dev Mode Metadata** — Serializes Figma Dev Mode annotations, accessibility notes, descriptions, semantic role hints, and visual contrast parameters (`opacity`, `blendMode`, `isMask`, `clipsContent`).
- **Interactive Extension Popup & Toolbar Badges** — Chrome toolbar badge reflects WebSocket status (`ON` green / `OFF` red / `...` yellow) with a popup dashboard showing connected server, active Figma tab, and session state.
- **Direct CLI / NPX Launcher** — Start the MCP server instantly with `npx figma-mcp-browser` without manual cloning or configuration.
- **Plugin API Access** — Direct in-memory access via `window.figma` with multi-tier iframe and DevTools fallback discovery.
- **WebSocket Bridge** — Communicates with the local MCP server over `ws://127.0.0.1:9223` with auto-reconnect and exponential backoff.
- **Real-Time Selection Tracking** — Emits `SELECTION_CHANGED` events when the designer clicks or navigates layers in Figma.
- **Windows Session Auto-Sync** — Extracts authenticated session cookies (`figma.session`, `__Host-figma.authn`, etc.) from running Figma Desktop or Chrome processes via DPAPI and Win32 handle duplication, syncing them into headless browser profiles.
- **Automated Packaging** — Single command `npm run package` builds clean distribution `.zip` and `.tar.gz` bundles locally and in CI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Figma Browser Tab (figma.com)                                              │
│                                                                             │
│  ┌───────────────┐   postMessage    ┌────────────────────────────────────┐  │
│  │  content.js   │ ◄──────────────► │  inject.js (MAIN world)            │  │
│  │ (ISOLATED)    │                  │  • window.figma Plugin API         │  │
│  │ • URL polling │                  │  • getNodeByIdAsync()              │  │
│  │ • keep-alive  │                  │  • currentPage.selection           │  │
│  │ • popup state │                  │  • recursive traversal & a11y specs│  │
│  └───────┬───────┘                  └────────────────────────────────────┘  │
│          │ chrome.tabs.sendMessage                                          │
└──────────┼──────────────────────────────────────────────────────────────────┘
           │
┌──────────▼──────────┐    WebSocket     ┌──────────────────┐
│   background.js     │ ◄──────────────► │  server/index.js │ ◄── AI Client
│  (Service Worker)   │  ws://127.0.0.1  │  (MCP Server)    │     (Claude, etc.)
│  • popup controller │  :9223           └──────────────────┘
│  • badge status     │
└─────────────────────┘
```

### Request Flow

1. AI client triggers a tool call (e.g. `get_figma_node` or `get_active_selection`) via MCP stdio.
2. MCP server sends a `GET_NODE_DATA` message to the background service worker over WebSocket.
3. Background injects `inject.js` into the Figma tab's **MAIN world** via `chrome.scripting.executeScript` (exempt from Figma's strict CSP).
4. Background dispatches `FETCH_NODE_DATA` to `content.js`.
5. `content.js` forwards the request to `inject.js` via `window.postMessage`.
6. `inject.js` reads from `window.figma`, serializes the node tree along with styling, geometry, and accessibility specs.
7. The response traverses back: `inject.js` → `content.js` → `background.js` → MCP server → AI client.

---

## Quick Start & Installation

### 1. Load the Chrome Extension

1. Download **`figma-mcp-bridge-{version}.zip`** from the [Releases page](../../releases/latest) (or clone this repository).
2. Unzip the file into a local folder.
3. In Chrome, open `chrome://extensions/` and enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the extension folder.
5. The **Figma MCP Bridge** icon will appear in your toolbar. Pin it to see live connection status (`ON` / `OFF`).

### 2. Configure Your AI Client

#### Claude Desktop
Add to your Claude configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

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

> **Tip**: You can also use `npx -y figma-mcp-browser` once published or run the binary launcher `bin/figma-mcp-browser.js`.

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

## Usage

### Step 1 — Open a Figma Tab
Open any Figma design file in Chrome (URL containing `/design/`, `/file/`, or `/board/`). The extension auto-injects `inject.js` into the page's MAIN execution world upon page load.

### Step 2 — Check Extension Popup
Click the **Figma MCP Bridge** icon in Chrome's toolbar to open the popup dashboard:
- **Local MCP Server**: Verify connection to `ws://127.0.0.1:9223`. If disconnected, click **Reconnect**.
- **Active Figma Tab**: Displays current file key, active layer ID, and injection status.
- **Session Sync**: Displays authenticated user email and cookie status with a one-click **Sync Session** button.

### Step 3 — Register Figma Object (If Required)
If the Figma canvas is isolated in an internal iframe, open DevTools (`F12`) on the Figma tab and run:

```js
injectFigma(window.figma)
```

The console will confirm:
```text
[Figma MCP] figma object registered. Bridge is ready.
```

---

## MCP Tools Reference

| Tool Name | Arguments | Description |
|---|---|---|
| `get_figma_node` | `fileKey` (string), `nodeId` (string) | Recursively fetches complete layout, styling, text, strokes, dimensions, and accessibility data for the targeted layer. |
| `get_active_selection` | *(none)* | Dynamically retrieves the layer currently selected by the designer in their active Figma browser tab. |
| `get_session_status` | *(none)* | Checks local Figma session status (account email, subscription plan, expiration, and valid cookie count). |
| `sync_figma_session` | *(none)* | Decrypts active cookies from local Figma Desktop or Chrome and syncs them directly into the MCP browser profile. |

---

## Output Format & Accessibility Specs

The node data is recursively serialized with full styling and accessibility context:

```json
{
  "id": "482:9088",
  "name": "🟪 Submit Button",
  "type": "FRAME",
  "visible": true,
  "opacity": 1,
  "blendMode": "NORMAL",
  "isMask": false,
  "clipsContent": true,
  "dimensions": {
    "width": 240,
    "height": 48,
    "absoluteBoundingBox": { "x": 120, "y": 450, "width": 240, "height": 48 }
  },
  "cornerRadius": 8,
  "autoLayout": {
    "direction": "HORIZONTAL",
    "itemSpacing": 8,
    "padding": { "left": 16, "right": 16, "top": 12, "bottom": 12 }
  },
  "fills": [
    { "type": "SOLID", "visible": true, "opacity": 1, "color": { "r": 135, "g": 79, "b": 255, "a": 1 } }
  ],
  "strokes": [
    { "type": "SOLID", "visible": true, "opacity": 1, "color": { "r": 255, "g": 255, "b": 255, "a": 0.2 } }
  ],
  "strokeWeight": 1,
  "strokeAlign": "INSIDE",
  "textContext": null,
  "accessibility": {
    "description": "Primary action button for form submission",
    "inferredRole": "button",
    "annotations": [
      { "label": "Accessibility: WCAG AA compliant contrast ratio" }
    ]
  },
  "children": [
    {
      "id": "482:9089",
      "name": "Submit",
      "type": "TEXT",
      "visible": true,
      "textContext": {
        "characters": "Submit",
        "fontSize": 16,
        "fontFamily": "Inter",
        "fontWeight": "Semi Bold"
      },
      "accessibility": {
        "inferredRole": "text"
      },
      "children": null
    }
  ]
}
```

---

## Developer Commands

| Command | Action |
|---|---|
| `npm start` | Launches the local WebSocket and MCP server (`node server/index.js`) |
| `npm run package` | Builds clean release archives in `dist/` (`.zip` and `.tar.gz`) |
| `npm run sync-session` | Extracts and syncs local Figma session cookies to the MCP browser profile |
| `npm run session-status` | Displays authenticated Figma account metadata |

---

## License

This project is licensed under the [MIT License](LICENSE).
