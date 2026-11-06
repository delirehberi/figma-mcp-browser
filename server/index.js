/**
 * Figma MCP Bridge - Local Node.js MCP Server
 * Exposes MCP tools over standard I/O (stdio) to AI clients (Claude, Antigravity, Codex)
 * and bridges queries to the browser extension via a local WebSocket connection.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer } from "ws";
import {
  getFigmaSessionStatus,
  syncFigmaSessionToBrowser,
  getActiveSessionState,
  fetchFigmaFileViaSession,
  fetchFigmaNodeViaSession,
  getLoadedSessionData,
} from "./session_manager.js";

// Local port for the browser extension to connect to
const WEBSOCKET_PORT = 9223;

// Bridge State
let extensionSocket = null;
let lastSelection = null;
let requestCounter = 0;
const pendingRequests = new Map();

// 1. Initialize WebSocket Server (Explicitly bind to IPv4 loopback)
const wss = new WebSocketServer({ port: WEBSOCKET_PORT, host: "127.0.0.1" });
console.error(`[MCP Bridge] WebSocket Server starting on ws://127.0.0.1:${WEBSOCKET_PORT}...`);

wss.on("connection", (ws) => {
  console.error("[MCP Bridge] Browser extension connected.");
  extensionSocket = ws;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      
      // Handle heartbeats
      if (msg.event === "PING") {
        ws.send(JSON.stringify({ event: "PONG" }));
        return;
      }

      // Handle real-time selection updates broadcasted by content script
      if (msg.event === "SELECTION_CHANGED") {
        lastSelection = {
          fileKey: msg.fileKey,
          nodeId: msg.nodeId,
          timestamp: msg.timestamp || Date.now()
        };
        console.error(`[MCP Bridge] Selection update received: File=${msg.fileKey}, Node=${msg.nodeId}`);
        return;
      }

      // Handle response to a pending node query
      if (msg.requestId && pendingRequests.has(msg.requestId)) {
        const { resolve, reject, timeout } = pendingRequests.get(msg.requestId);
        clearTimeout(timeout);
        pendingRequests.delete(msg.requestId);

        if (msg.success) {
          resolve(msg.data);
        } else {
          reject(new Error(msg.error || "Unknown extension query error"));
        }
      }
    } catch (err) {
      console.error("[MCP Bridge] Error parsing WebSocket message:", err);
    }
  });

  ws.on("close", () => {
    console.error("[MCP Bridge] Browser extension disconnected.");
    if (extensionSocket === ws) {
      extensionSocket = null;
    }
  });

  ws.on("error", (error) => {
    console.error("[MCP Bridge] WebSocket client error:", error);
  });
});

// 2. Initialize MCP Server
const mcpServer = new Server(
  {
    name: "figma-browser-bridge",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool listings
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_figma_node",
        description: "Retrieve Figma node layout, geometry, typography, and fill data directly from the active browser tab or seamlessly via the loaded browser/desktop session.",
        inputSchema: {
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "The unique Figma file key from the URL (/design/FILE_KEY/...). Optional: auto-detected from loaded browser session if omitted.",
            },
            nodeId: {
              type: "string",
              description: "The targeted Figma node/layer ID (e.g. '474:10679' or '474-10679'). Optional: auto-detected from loaded browser session if omitted.",
            },
          },
        },
      },
      {
        name: "get_active_selection",
        description: "Retrieve Figma design node details for the layer currently selected by the user in their active Figma browser tab or loaded Figma session.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_session_active_state",
        description: "Get currently active Figma file, selected node, open tabs, and recently viewed files from the loaded browser/desktop session.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_figma_file_info",
        description: "Retrieve Figma file metadata, document title, last modified timestamp, and thumbnail URL for a file using the loaded browser session cookies.",
        inputSchema: {
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "The unique Figma file key. Defaults to active file in loaded browser session if omitted.",
            },
          },
        },
      },
      {
        name: "collect_figma_session_data",
        description: "Comprehensive data collection from the loaded browser session: extracts user credentials, active file metadata, selected node hierarchy, and open tabs.",
        inputSchema: {
          type: "object",
          properties: {
            fileKey: {
              type: "string",
              description: "Target Figma file key (optional, auto-detected from loaded session).",
            },
            nodeId: {
              type: "string",
              description: "Target Figma node ID (optional, auto-detected from loaded session).",
            },
          },
        },
      },
      {
        name: "get_session_status",
        description: "Check the status of the Figma session from the last completed login (user ID, account email, expiration, and cookie validity).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "sync_figma_session",
        description: "Extract active Figma session cookies from the last completed login (Figma Desktop / Chrome) and sync them directly into the MCP browser profile.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Helper to query the browser extension via WebSocket
function queryExtension(fileKey, nodeId, fetchSelection = false) {
  if (!extensionSocket || extensionSocket.readyState !== 1) { // 1 = OPEN
    throw new Error("No active browser extension connection. Please make sure Google Chrome is open, has a Figma tab loaded, and the extension is active.");
  }

  const requestId = `req_${Date.now()}_${++requestCounter}`;
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Figma extension request timeout after 10s (Target: File=${fileKey}, Node=${nodeId})`));
    }, 10000);

    pendingRequests.set(requestId, { resolve, reject, timeout });

    // Send query payload to extension
    extensionSocket.send(
      JSON.stringify({
        action: "GET_NODE_DATA",
        requestId,
        fileKey,
        nodeId,
        fetchSelection
      })
    );
  });
}

// Define tool executions
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_figma_node") {
      let { fileKey, nodeId } = args || {};

      // Auto-detect missing arguments from active browser session
      if (!fileKey || !nodeId) {
        try {
          const activeState = await getActiveSessionState();
          if (!fileKey && activeState?.activeFileKey) {
            fileKey = activeState.activeFileKey;
          }
          if (!nodeId && activeState?.activeNodeId) {
            nodeId = activeState.activeNodeId;
          }
        } catch (_) {}
      }

      if (!fileKey || !nodeId) {
        throw new Error("Missing required arguments: fileKey and nodeId (none active in loaded browser session).");
      }

      console.error(`[MCP Bridge] Tool Call: get_figma_node (File=${fileKey}, Node=${nodeId})`);

      let nodeData = null;
      let source = "live_browser_extension";

      // 1. Try querying extension WebSocket if connected
      if (extensionSocket && extensionSocket.readyState === 1) {
        try {
          nodeData = await queryExtension(fileKey, nodeId, false);
        } catch (extErr) {
          console.error(`[MCP Bridge] Extension query skipped/failed (${extErr.message}). Falling back to loaded session...`);
        }
      }

      // 2. Fall back to loaded browser session
      if (!nodeData) {
        console.error(`[MCP Bridge] Collecting node data via loaded browser session...`);
        const sessionRes = await fetchFigmaNodeViaSession(fileKey, nodeId);
        nodeData = sessionRes.nodeData || sessionRes;
        source = sessionRes.source || "loaded_browser_session";
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              source,
              fileKey,
              nodeId,
              nodeData,
            }, null, 2),
          },
        ],
      };
    } else if (name === "get_active_selection") {
      console.error("[MCP Bridge] Tool Call: get_active_selection");
      
      let nodeData = null;
      let fileKey = null;
      let nodeId = null;
      let source = "live_browser_extension";

      // 1. Try extension if connected
      if (extensionSocket && extensionSocket.readyState === 1) {
        try {
          let fetchSelection = true;
          if (lastSelection) {
            fileKey = lastSelection.fileKey;
            nodeId = lastSelection.nodeId;
            fetchSelection = false;
            console.error(`[MCP Bridge] Active Selection mapped to File=${fileKey}, Node=${nodeId}`);
          } else {
            console.error("[MCP Bridge] No selection tracked yet. Querying active tab selection dynamically...");
          }
          nodeData = await queryExtension(fileKey, nodeId, fetchSelection);
        } catch (extErr) {
          console.error(`[MCP Bridge] Extension selection query failed (${extErr.message}). Falling back to loaded session...`);
        }
      }

      // 2. Fall back to loaded browser session
      if (!nodeData) {
        console.error("[MCP Bridge] Reading active selection from loaded browser session...");
        const activeState = await getActiveSessionState();
        fileKey = activeState?.activeFileKey;
        nodeId = activeState?.activeNodeId;
        source = "loaded_browser_session";

        if (!fileKey) {
          throw new Error("No active Figma file found in loaded browser session or Chrome extension.");
        }

        console.error(`[MCP Bridge] Active session detected: File=${fileKey}, Node=${nodeId || '(default)'}`);
        const sessionRes = await fetchFigmaNodeViaSession(fileKey, nodeId || "0:1");
        nodeData = sessionRes.nodeData || sessionRes;
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                source,
                mcpSelectionContext: {
                  fileKey: fileKey || (nodeData ? nodeData.fileKey : null),
                  nodeId: nodeId || (nodeData ? nodeData.id : null),
                  trackedAt: lastSelection ? new Date(lastSelection.timestamp).toISOString() : new Date().toISOString(),
                },
                nodeData,
              },
              null,
              2
            ),
          },
        ],
      };
    } else if (name === "get_session_active_state") {
      console.error("[MCP Bridge] Tool Call: get_session_active_state");
      const activeState = await getActiveSessionState();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(activeState, null, 2),
          },
        ],
      };
    } else if (name === "get_figma_file_info") {
      let { fileKey } = args || {};
      if (!fileKey) {
        const activeState = await getActiveSessionState();
        fileKey = activeState?.activeFileKey;
      }
      if (!fileKey) {
        throw new Error("Missing fileKey (and no active file found in loaded browser session).");
      }
      console.error(`[MCP Bridge] Tool Call: get_figma_file_info (File=${fileKey})`);
      const fileInfo = await fetchFigmaFileViaSession(fileKey);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(fileInfo, null, 2),
          },
        ],
      };
    } else if (name === "collect_figma_session_data") {
      let { fileKey, nodeId } = args || {};
      console.error("[MCP Bridge] Tool Call: collect_figma_session_data");

      const [status, activeState, fullSession] = await Promise.all([
        getFigmaSessionStatus().catch(err => ({ error: err.message })),
        getActiveSessionState().catch(err => ({ error: err.message })),
        getLoadedSessionData().catch(err => ({ error: err.message }))
      ]);

      const targetFileKey = fileKey || activeState?.activeFileKey;
      const targetNodeId = nodeId || activeState?.activeNodeId;

      let fileInfo = null;
      let nodeData = null;

      if (targetFileKey) {
        try {
          fileInfo = await fetchFigmaFileViaSession(targetFileKey);
        } catch (e) {
          fileInfo = { error: e.message };
        }

        if (targetNodeId) {
          try {
            const nodeRes = await fetchFigmaNodeViaSession(targetFileKey, targetNodeId);
            nodeData = nodeRes.nodeData || nodeRes;
          } catch (e) {
            nodeData = { error: e.message };
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              collectedFrom: "loaded_browser_session",
              userSession: status,
              activeState,
              targetFileKey,
              targetNodeId,
              fileInfo,
              nodeData,
              hasDiscoveredPat: fullSession?.hasDiscoveredPat || false
            }, null, 2),
          },
        ],
      };
    } else if (name === "get_session_status") {
      console.error("[MCP Bridge] Tool Call: get_session_status");
      const status = await getFigmaSessionStatus();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    } else if (name === "sync_figma_session") {
      console.error("[MCP Bridge] Tool Call: sync_figma_session");
      const syncResult = await syncFigmaSessionToBrowser();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(syncResult, null, 2),
          },
        ],
      };
    } else {
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    console.error(`[MCP Bridge] Error executing tool '${name}':`, error.message);
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error: ${error.message}`,
        },
      ],
    };
  }
});

// 3. Connect to Stdio Transport
async function runServer() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error("[MCP Bridge] Bridge MCP Server connected to stdio transport successfully.");
}

runServer().catch((error) => {
  console.error("[MCP Bridge] Fatal error running MCP Server:", error);
  process.exit(1);
});
