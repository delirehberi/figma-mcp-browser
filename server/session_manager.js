import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.join(__dirname, "session_sync.py");

/**
 * Intelligent Python interpreter auto-discovery across Windows, macOS, and Linux
 */
function getPythonCandidateCommands() {
  if (process.env.PYTHON_PATH) {
    return [process.env.PYTHON_PATH];
  }
  if (process.platform === "win32") {
    return ["python", "py", "python3"];
  }
  return ["python3", "python"];
}

/**
 * Execute session_sync.py with interpreter fallback and return parsed JSON
 */
function runSessionSync(args = []) {
  const candidates = getPythonCandidateCommands();

  return new Promise((resolve, reject) => {
    let index = 0;

    function tryNext() {
      if (index >= candidates.length) {
        return reject(
          new Error("Python interpreter not found on system. Please ensure Python 3.10+ is installed.")
        );
      }

      const candidate = candidates[index++];
      let proc;

      try {
        proc = spawn(candidate, [SCRIPT_PATH, "--json", ...args], {
          windowsHide: true,
        });
      } catch (_) {
        return tryNext();
      }

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", () => {
        tryNext();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          return reject(new Error(stderr.trim() || `Session sync failed with exit code ${code}`));
        }
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Failed to parse session sync output: ${stdout || stderr}`));
        }
      });
    }

    tryNext();
  });
}

/**
 * Get active Figma session metadata from last completed login
 */
export async function getFigmaSessionStatus() {
  const result = await runSessionSync(["--status"]);
  if (!result.success) {
    throw new Error(result.error || "Unable to retrieve Figma session status");
  }
  return result.metadata;
}

/**
 * Sync active Figma session cookies into MCP Chrome Profile
 */
export async function syncFigmaSessionToBrowser() {
  const result = await runSessionSync(["--sync-mcp"]);
  if (!result.success) {
    throw new Error(result.error || "Unable to sync Figma session cookies to browser");
  }
  return result.metadata;
}
