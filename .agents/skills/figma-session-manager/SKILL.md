---
name: figma-session-manager
description: >-
  Extracts, inspects, and synchronizes authenticated Figma login session cookies from
  Figma Desktop and Google Chrome into headless MCP browser profiles using Windows DPAPI
  and Win32 process handle duplication.
---

# Figma Session Synchronization & Security Skill

Use this skill to diagnose session cookie extraction, inspect login validity, and synchronize credentials into local MCP browser automation environments (`chrome-devtools-mcp`).

---

## 1. Quick CLI Commands

```bash
# Inspect current session validity and user metadata
npm run session-status

# Inspect currently active Figma file, selected node, and open tabs
npm run session-state

# Push active session cookies directly to the local MCP Chrome profile
npm run sync-session

# Dump full session data (metadata, active state, cookie count, tokens)
npm run collect-session

# Run underlying Python utility directly
python server/session_sync.py --status
python server/session_sync.py --active-state
python server/session_sync.py --session-data
python server/session_sync.py --sync-mcp
python server/session_sync.py --export figma_session.json
python server/session_sync.py --json
```

---

## 2. Extraction Mechanism & Windows Security Invariants

### 1. Locked Database Handling (Win32 Handle Duplication)
- Chrome and Figma Desktop place exclusive locks on SQLite databases (`Network/Cookies`) while active.
- Raw file reads (`open()` or `sqlite3.connect()`) fail with `PermissionError` (Windows Error 32: sharing violation).
- `session_sync.py` uses `kernel32.DuplicateHandle` on the running process's open file handle to clone the read stream into memory without requiring the user to close Chrome or Figma.

### 2. Windows DPAPI Decryption
- Encryption key is stored in Chrome's `Local State` file protected by DPAPI.
- The Python script invokes `System.Security.Cryptography.ProtectedData::Unprotect` via PowerShell with CurrentUser scope to decrypt the master AES-GCM key.
- Cookies beginning with `v10` or `v11` are decrypted using AES-GCM (12-byte nonce, 16-byte authentication tag).

---

## 3. Session Health Criteria

A valid Figma session requires:
1. `authenticated: true`
2. `availableCookies` contains `figma.session` and `__Host-figma.authn`.
3. `sessionExpires` timestamp is in the future.

**If the session is expired or missing**:
1. Open Figma Desktop or Chrome.
2. Log in at `https://www.figma.com/login`.
3. Run `npm run sync-session`.

---

## 4. Mandatory Active Session Maintenance Policy

All AI agents operating within this workspace MUST strictly enforce active session preservation:

1. **Continuous Active Session Maintenance**:
   - The AI agent MUST always verify that the active session is maintained before querying Figma nodes or performing design-to-code workflows.
   - Run `npm run session-state` (or call MCP tool `get_session_active_state`) to confirm the active file key and layer selection.
   - Validate session health with `get_session_status` to ensure `authenticated: true` and that `sessionExpires` has not passed.

2. **Session Sync Keep-Alive**:
   - Whenever session cookies are updated, restarted, or approaching expiration, immediately run `npm run sync-session` (or tool `sync_figma_session`) to keep the MCP browser profile synchronized with decrypted credentials (`figma.session`, `__Host-figma.authn`).

3. **Session-First Fallback Invariant**:
   - If the Chrome extension WebSocket is offline or disconnected, **NEVER abort or prompt the user for an API token / PAT**.
   - The agent MUST fall back directly to the maintained active session (`fetchFigmaFileViaSession`, `fetchFigmaNodeViaSession`, `get_active_selection`).
   - Active file key, node ID, and open tabs must be read directly from the maintained session state (`%APPDATA%\Figma\settings.json` / `desktop_state.json`).

4. **Preserve Selection Context Across Turns**:
   - Retain the active `fileKey`, `nodeId`, document title, and thumbnail URL in conversation context across multiple turns. Do not force the user to re-select or re-paste Figma links between component generation steps.
