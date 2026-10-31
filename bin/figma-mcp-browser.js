#!/usr/bin/env node

/**
 * Figma MCP Bridge - CLI Launcher
 * Direct entry point for running the local MCP Server via npx or global install.
 */

import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import and launch local MCP server
import("../server/index.js").catch((err) => {
  console.error("[Figma MCP CLI] Fatal error starting server:", err);
  process.exit(1);
});
