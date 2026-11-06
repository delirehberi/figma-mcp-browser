---
name: figma-mcp-debug
description: >-
  Diagnostic and troubleshooting runbook for the Figma MCP Bridge.
  Use when diagnosing WebSocket connection issues, script injection failures,
  Figma node query timeouts, toolbar badge states, or session synchronization errors.
---

# Figma MCP Bridge Diagnostic Runbook

Follow these step-by-step diagnostic workflows to troubleshoot and verify each hop of the Figma MCP Bridge across all AI host harnesses.

---

## 1. Verify MCP Server & WebSocket Listener

Check if the local MCP server starts and binds cleanly to port `9223`:

```powershell
# Run the server test
node server/index.js
```

**Expected output on stderr**:
```text
[MCP Bridge] WebSocket Server starting on ws://127.0.0.1:9223...
[MCP Bridge] Bridge MCP Server connected to stdio transport successfully.
```

**Validation**:
- Ensure port 9223 is listening:
  ```powershell
  Test-NetConnection -ComputerName 127.0.0.1 -Port 9223
  ```
  `TcpTestSucceeded` should be `True`.

---

## 2. Verify Extension Popup & Toolbar Badges

1. Look at the **Figma MCP Bridge** icon in Chrome's extension toolbar:
   - 🟢 **`ON` (Green)**: Connected to `ws://127.0.0.1:9223`. Service worker is active with 20s heartbeat ping.
   - 🟡 **`...` (Amber)**: Reconnecting with exponential backoff.
   - 🔴 **`OFF` (Red)**: Disconnected. Local MCP server is not running.
2. Click the extension icon to inspect the **Dashboard Popup**:
   - **Local MCP Server**: Confirms connection to `ws://127.0.0.1:9223`. If offline, start server and click **Reconnect**.
   - **Active Figma Tab**: Shows active file key and selected layer ID.
   - **Session Status**: Shows logged-in email and provides a one-click **Sync Session** button.

---

## 3. Verify & Maintain Active Figma Session

Verify that an active, authenticated Figma session is continuously maintained on the local system:

```powershell
# 1. Check account authentication & cookie health
npm run session-status

# 2. Inspect active file, selected layer, and open tabs
npm run session-state

# 3. Dump full session data (metadata, active state, tokens)
npm run collect-session
```

**Checks**:
- Is `authenticated: true`?
- Is `sessionExpires` in the future?
- Is `activeFileKey` and `activeNodeId` correctly detected in `session-state`?
- Is cookie count > 0?

**Maintain and refresh the session**:
1. If cookies are locked or the session is expired, log into Figma in Figma Desktop or Chrome.
2. Run `npm run sync-session` to push fresh decrypted cookies into the MCP browser profile.
3. Test tool `get_session_active_state` to ensure the active document context is preserved.

---

## 4. Diagnose Browser Extension & Service Worker

1. Open Chrome and navigate to `chrome://extensions`.
2. Find **Figma MCP Bridge**.
3. Check the **Service Worker** link:
   - If it says `Inactive`, click the service worker link to inspect logs.
   - Look for:
     ```text
     [Figma MCP] Connecting to WebSocket at ws://127.0.0.1:9223...
     [Figma MCP] WebSocket connection established successfully.
     ```
   - Verify that heartbeats are transmitted every 20 seconds.

---

## 5. Diagnose Figma Tab & Script Injection

1. Open a Figma design file in Chrome (e.g. `https://www.figma.com/design/...`).
2. Open the browser DevTools Console (`F12`).
3. Check for the injection banner:
   ```text
   [Figma MCP Main] Script injected into main world context.
   ```
4. Check if `window.figma` is accessible:
   - Run `window.figma` in the console.
   - If `undefined` (because canvas runs in an internal iframe):
     - Select the canvas iframe context in the DevTools console dropdown, or run:
       ```javascript
       window.top.injectFigma(figma)
       ```
     - You should see:
       ```text
       [Figma MCP] figma object registered. Bridge is ready.
       ```

---

## 6. Multi-Harness Verification

To diagnose whether your AI client is properly connected:

```bash
# Verify harness configurations
npm run setup-harness -- --dry-run
```

**Client-Specific Checklist**:
- **Claude Desktop**: Check `%APPDATA%\Claude\logs\mcp.log` (Windows) or `~/Library/Logs/Claude/mcp.log` (macOS).
- **Cursor IDE**: Check Cursor Settings -> Features -> MCP for a green indicator beside `figma-browser-bridge`.
- **Antigravity**: Check `mcp_config.json` in project root or `~/.gemini/antigravity/mcp_config.json`.
- **Windsurf**: Check `~/.codeium/windsurf/mcp_config.json`.
- **VS Code Cline**: Check Cline MCP Server view for `figma-browser-bridge` status.
