# CLAUDE.md

Canonical agent instructions for this repository live in **AGENTS.md** — imported below so all agents (Antigravity, Claude Code, Cursor, Copilot, Cline, …) share one single source of truth.

@AGENTS.md

---

## Claude-Specific Notes

- **Subagents**: Specialized domain agents live in `.claude/agents/`:
  - `extension-architect.md`: Expert in Chrome Extension MV3, service worker lifecycle, keep-alive ports, content scripts, and MAIN world script injection.
  - `mcp-protocol.md`: Expert in Model Context Protocol SDK, JSON-RPC over stdio, WebSocket bridge (`127.0.0.1:9223`), and Figma node tree serialization.
  - `session-security.md`: Expert in Windows DPAPI decryption, Win32 handle duplication, SQLite cookie stores, and Chrome DevTools MCP synchronization.
- **Logging Rule**: NEVER output unstructured text or `console.log` from `server/index.js` or `server/session_manager.js`. MCP uses `stdout` for JSON-RPC message framing; use `console.error` for all diagnostic logging.
- **Verification**:
  - MCP Server check: run `node server/index.js` (verify WebSocket binds on `127.0.0.1:9223` and stdio connects).
  - Session status check: run `npm run session-status` or `python server/session_sync.py --status`.
  - Extension syntax & integrity check: verify `manifest.json`, `background.js`, `content.js`, and `inject.js` have zero syntax errors.
