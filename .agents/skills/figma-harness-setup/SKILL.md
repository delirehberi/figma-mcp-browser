---
name: figma-harness-setup
description: >-
  Configures, inspects, and repairs Model Context Protocol (MCP) host settings across all
  major AI agent environments: Claude Desktop, Google Antigravity, Cursor IDE, Windsurf,
  VS Code Cline / Roo Code, and Zed Editor.
---

# Figma MCP Bridge Harness Setup Runbook

Use this skill when configuring the Figma MCP server in any AI client or when diagnosing configuration and transport errors.

---

## 1. Quick Automated Setup

Run the zero-dependency harness setup engine:

```bash
# Auto-detect and configure all installed AI harnesses
npm run setup-harness

# Or target a specific client
npm run setup-harness -- --harness claude
npm run setup-harness -- --harness cursor
npm run setup-harness -- --harness antigravity
npm run setup-harness -- --harness windsurf
npm run setup-harness -- --harness cline
npm run setup-harness -- --harness zed

# Preview without writing to disk
npm run setup-harness -- --dry-run
```

---

## 2. Configuration Paths Reference Table

| Harness | Platform | Configuration File Path |
|---|---|---|
| **Claude Desktop** | Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| **Claude Desktop** | macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Claude Desktop** | Linux | `~/.config/Claude/claude_desktop_config.json` |
| **Cursor IDE** | Workspace | `<Workspace>/.cursor/mcp.json` |
| **Cursor IDE** | Global | `%APPDATA%\Cursor\User\globalStorage\mcp.json` |
| **Google Antigravity** | Workspace | `<Workspace>/mcp_config.json` |
| **Google Antigravity** | Global | `~/.gemini/antigravity/mcp_config.json` |
| **Windsurf (Codeium)** | All | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code Cline** | Windows | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` |
| **VS Code Cline** | macOS | `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json` |
| **VS Code Roo Code** | Windows | `%APPDATA%\Code\User\globalStorage\rooveterinaryinc.roo-cline\settings\cline_mcp_settings.json` |
| **Zed Editor** | Windows | `%APPDATA%\Zed\settings.json` |
| **Zed Editor** | macOS/Linux | `~/.config/zed/settings.json` |

---

## 3. Standard JSON Payloads

### For Standard MCP Clients (Claude, Cursor, Antigravity, Windsurf, Cline)
```json
{
  "mcpServers": {
    "figma-browser-bridge": {
      "command": "node",
      "args": [
        "C:/Users/Parallel/Documents/others/figma-mcp-browser/server/index.js"
      ]
    }
  }
}
```

> **CRITICAL RULE**: Always format Windows file paths using forward slashes (`/`) in JSON files. A single unescaped backslash (`C:\Users\...`) causes a JSON syntax parse error and prevents the harness from loading any MCP tools.

### For Zed Editor (`context_servers`)
```json
{
  "context_servers": {
    "figma-browser-bridge": {
      "command": {
        "path": "node",
        "args": [
          "C:/Users/Parallel/Documents/others/figma-mcp-browser/server/index.js"
        ]
      }
    }
  }
}
```

---

## 4. Verification Check

After saving the configuration:
1. Fully quit and restart the host application.
2. In the AI client's tool list or status bar, verify `get_figma_node`, `get_active_selection`, and `get_session_status` appear.
3. If the server fails to start, verify Node 18+ is installed:
   ```bash
   node -v
   ```
