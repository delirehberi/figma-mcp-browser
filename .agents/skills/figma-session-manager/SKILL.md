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

# Push active session cookies directly to the local MCP Chrome profile
npm run sync-session

# Run underlying Python utility directly
python server/session_sync.py --status
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
