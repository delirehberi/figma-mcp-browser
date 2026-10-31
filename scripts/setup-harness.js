#!/usr/bin/env node

/**
 * Figma MCP Bridge - Multi-Harness Auto-Configurator
 * Detects installed AI host clients across Windows, macOS, and Linux
 * and safely injects the Figma MCP server configuration without syntax errors.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.dirname(__dirname);

// Forward-slash normalized path to server/index.js (safe for Windows, macOS, Linux JSON configs)
const SERVER_INDEX_PATH = path.join(ROOT_DIR, "server", "index.js").replace(/\\/g, "/");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const homeDir = os.homedir();
const appData = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");

// Supported Harness Definitions
function getHarnessConfigs() {
  const configs = [];

  // 1. Claude Desktop
  let claudePath = null;
  if (isWin) {
    claudePath = path.join(appData, "Claude", "claude_desktop_config.json");
  } else if (isMac) {
    claudePath = path.join(homeDir, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  } else {
    claudePath = path.join(homeDir, ".config", "Claude", "claude_desktop_config.json");
  }
  configs.push({
    id: "claude",
    name: "Claude Desktop",
    configPath: claudePath,
    type: "mcpServers",
  });

  // 2. Cursor IDE
  // Global & Workspace Cursor MCP configs
  const cursorGlobal = isWin
    ? path.join(appData, "Cursor", "User", "globalStorage", "mcp.json")
    : isMac
    ? path.join(homeDir, "Library", "Application Support", "Cursor", "User", "globalStorage", "mcp.json")
    : path.join(homeDir, ".config", "Cursor", "User", "globalStorage", "mcp.json");
  
  configs.push({
    id: "cursor",
    name: "Cursor IDE (Global)",
    configPath: cursorGlobal,
    type: "mcpServers",
  });

  // Cursor workspace config
  configs.push({
    id: "cursor-workspace",
    name: "Cursor IDE (Workspace .cursor/mcp.json)",
    configPath: path.join(ROOT_DIR, ".cursor", "mcp.json"),
    type: "mcpServers",
  });

  // 3. Windsurf (Codeium)
  const windsurfPath = path.join(homeDir, ".codeium", "windsurf", "mcp_config.json");
  configs.push({
    id: "windsurf",
    name: "Windsurf (Codeium)",
    configPath: windsurfPath,
    type: "mcpServers",
  });

  // 4. Google Antigravity & Gemini CLI
  const antigravityGlobal = path.join(homeDir, ".gemini", "antigravity", "mcp_config.json");
  configs.push({
    id: "antigravity-global",
    name: "Google Antigravity (Global)",
    configPath: antigravityGlobal,
    type: "mcpServers",
  });

  configs.push({
    id: "antigravity",
    name: "Antigravity / Gemini CLI (Workspace)",
    configPath: path.join(ROOT_DIR, "mcp_config.json"),
    type: "mcpServers",
  });

  // 5. VS Code AI Extensions (Cline & Roo Code)
  let clinePath = null;
  let rooPath = null;
  if (isWin) {
    clinePath = path.join(appData, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    rooPath = path.join(appData, "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
  } else if (isMac) {
    clinePath = path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    rooPath = path.join(homeDir, "Library", "Application Support", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
  } else {
    clinePath = path.join(homeDir, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
    rooPath = path.join(homeDir, ".config", "Code", "User", "globalStorage", "rooveterinaryinc.roo-cline", "settings", "cline_mcp_settings.json");
  }

  configs.push({
    id: "cline",
    name: "VS Code Cline",
    configPath: clinePath,
    type: "mcpServers",
  });

  configs.push({
    id: "roo",
    name: "VS Code Roo Code",
    configPath: rooPath,
    type: "mcpServers",
  });

  // 6. Zed Editor
  let zedPath = null;
  if (isWin) {
    zedPath = path.join(appData, "Zed", "settings.json");
  } else {
    zedPath = path.join(homeDir, ".config", "zed", "settings.json");
  }
  configs.push({
    id: "zed",
    name: "Zed Editor",
    configPath: zedPath,
    type: "zed",
  });

  return configs;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[Setup] Warning: Could not parse ${filePath}: ${err.message}`);
    return null;
  }
}

function writeJsonFile(filePath, data, dryRun = false) {
  if (dryRun) {
    console.log(`[DRY-RUN] Would write to ${filePath}:\n${JSON.stringify(data, null, 2)}\n`);
    return true;
  }
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error(`[Setup] Failed to write ${filePath}: ${err.message}`);
    return false;
  }
}

function configureHarness(harness, dryRun = false) {
  const filePath = harness.configPath;
  if (!filePath) return false;

  let config = readJsonFile(filePath) || {};

  if (harness.type === "zed") {
    // Zed context servers structure
    if (!config.context_servers) {
      config.context_servers = {};
    }
    config.context_servers["figma-browser-bridge"] = {
      command: {
        path: "node",
        args: [SERVER_INDEX_PATH],
      },
    };
  } else {
    // Standard mcpServers structure
    if (!config.mcpServers) {
      config.mcpServers = {};
    }
    config.mcpServers["figma-browser-bridge"] = {
      command: "node",
      args: [SERVER_INDEX_PATH],
    };
  }

  const success = writeJsonFile(filePath, config, dryRun);
  if (success && !dryRun) {
    console.log(`[✓] Configured ${harness.name} -> ${filePath}`);
  }
  return success;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targetIdx = args.indexOf("--harness");
  const targetHarness = targetIdx !== -1 && targetIdx + 1 < args.length ? args[targetIdx + 1].toLowerCase() : "all";

  console.log("==================================================");
  console.log("   Figma MCP Bridge — Multi-Harness Setup Engine  ");
  console.log("==================================================");
  console.log(`Server Entry : ${SERVER_INDEX_PATH}`);
  console.log(`Platform     : ${process.platform} (${os.arch()})`);
  console.log(`Mode         : ${dryRun ? "DRY-RUN (Simulated)" : "ACTIVE CONFIGURATION"}`);
  console.log(`Target       : ${targetHarness}\n`);

  const allHarnesses = getHarnessConfigs();
  let configuredCount = 0;

  for (const harness of allHarnesses) {
    const matchesTarget = targetHarness === "all" || harness.id.toLowerCase() === targetHarness || targetHarness === "any";
    if (!matchesTarget) continue;

    // Check if harness host directory or parent exists (or if target is specific)
    const hostDir = path.dirname(harness.configPath);
    const parentDir = path.dirname(hostDir);
    const exists = fs.existsSync(hostDir) || (isWin && fs.existsSync(parentDir)) || targetHarness !== "all";

    if (exists || targetHarness !== "all") {
      const ok = configureHarness(harness, dryRun);
      if (ok) configuredCount++;
    } else {
      console.log(`[-] Skipped ${harness.name} (Client not installed / directory absent)`);
    }
  }

  console.log("\n--------------------------------------------------");
  if (configuredCount > 0) {
    console.log(`[OK] Successfully configured ${configuredCount} AI harness client(s).`);
    console.log("Next steps:");
    console.log(" 1. Restart your AI client (Claude, Antigravity, Cursor, etc.).");
    console.log(" 2. Load the unpacked extension in Chrome from the root directory.");
    console.log(" 3. Ask your AI agent to fetch a Figma layer (e.g. get_active_selection).");
  } else {
    console.log("[!] No active AI client directories found for automatic injection.");
    console.log("You can manually copy the preset from harnesses/ into your client config.");
  }
  console.log("==================================================\n");
}

main();
