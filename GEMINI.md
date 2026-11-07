# GEMINI.md — Antigravity Workspace Guidelines

> Canonical instructions for this repository live in [AGENTS.md](AGENTS.md).
> All AI agents working in this project must follow the invariants specified in `AGENTS.md`.

---

## Critical Invariants for Antigravity

1. **Stdio Safety in MCP Server**:
   Never use `console.log()` inside `server/index.js` or `server/session_manager.js`. Any output to `stdout` breaks the MCP JSON-RPC protocol framing. Always use `console.error()` for diagnostic and error messages.

2. **Strict 4-Hop Pipeline**:
   The bridge operates through four hops: `server/index.js` (stdio) ↔ `127.0.0.1:9223` (WebSocket) ↔ `background.js` (Service Worker) ↔ `content.js` (ISOLATED) ↔ `inject.js` (MAIN) ↔ `window.figma`. Never bypass `content.js` or attempt to read `window.figma` from the ISOLATED world.

3. **CSP-Safe Main World Injection**:
   Figma blocks inline `<script>` tags via CSP. Always use `chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"], world: "MAIN" })`.

4. **IPv4 Loopback Binding**:
   Always bind WebSocket to `127.0.0.1` explicitly. Do not bind to `localhost` or `0.0.0.0` due to Windows IPv6 dual-stack resolution conflicts.

5. **Windows Locked Database Handling**:
   Do not read running Chrome/Figma SQLite files directly. Always use the Win32 handle duplication and DPAPI routines in `server/session_sync.py`.

---

## Workspace Tools & Skills

- Local Antigravity skills live in `.agents/skills/`:
  - `figma-mcp-debug`: Step-by-step diagnostic runbook for testing the WebSocket bridge, checking extension injection, and validating session status.
- Coding standards are defined in `.agents/rules/coding-standards.md`.
