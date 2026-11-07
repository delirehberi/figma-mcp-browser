# Coding Standards & Guidelines — Figma MCP Bridge

These rules apply across the entire repository for all AI agents and developers.

## 1. Stdio Cleanliness in Server Code
- In `server/index.js`, `server/session_manager.js`, or any file loaded by the Node MCP server:
  - **NEVER** call `console.log()`. The Model Context Protocol (MCP) uses `stdout` for framing JSON-RPC protocol messages.
  - **ALWAYS** use `console.error()` for diagnostic, progress, or error logging. This writes to `stderr` and preserves protocol integrity.

## 2. Chrome Extension Invariants
- Extension code in `background.js`, `content.js`, and `inject.js` must be pure vanilla JavaScript (ES2022+).
- Do not introduce build tools, bundlers, or compilation steps for the extension.
- Never attempt to read `window.figma` inside `content.js` — it only exists in the `MAIN` execution world (`inject.js`).
- Never inject scripts using dynamic `<script>` elements; always use `chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"], world: "MAIN" })` to comply with Figma's Content Security Policy.
- Never remove keep-alive mechanisms (`figma-keep-alive` port or `mcp-keepalive` alarm in `background.js`).

## 3. Asynchronous Execution Invariants
- Functions that query Figma (`queryActiveSelection()` and `queryNodeById()`) return Promises. Handlers in `inject.js` must `await` their results before sending message responses via `window.postMessage`.
- WebSocket queries from `server/index.js` to the browser extension must include a timeout (10 seconds) with clean rejection.

## 4. Localhost Security & DPAPI
- WebSocket server must explicitly bind to `127.0.0.1` (never `0.0.0.0` or `localhost`).
- Session synchronization must use Win32 handle duplication (`DuplicateHandle`) and DPAPI decryption in `session_sync.py`. Never attempt raw file access on locked SQLite databases.
