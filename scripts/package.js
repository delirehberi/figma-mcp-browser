#!/usr/bin/env node

/**
 * Cross-platform packaging bridge
 * Runs scripts/package.py to build distribution zip and tarball
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptPath = path.join(__dirname, "package.py");

const pythonCmd = process.env.PYTHON_PATH || "python";
const proc = spawn(pythonCmd, [scriptPath], { stdio: "inherit" });

proc.on("close", (code) => {
  process.exit(code);
});
