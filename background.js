/**
 * Figma MCP Bridge - Background Service Worker
 * Establishes a persistent WebSocket connection to the local MCP server,
 * and routes node requests to active content scripts.
 */

const MCP_WEBSOCKET_URL = "ws://127.0.0.1:9223";
let socket = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 16000;
let activePorts = new Set();
let latestSelection = null;
let heartbeatInterval = null;

// Tracks tabs that have already had inject.js injected into the MAIN world.
// Prevents redundant re-injection on repeated requests to the same tab.
const injectedTabs = new Set();

// Active 20-second heartbeat ping to keep Manifest V3 Service Worker alive
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ event: "PING" }));
      } catch (_) {}
    }
  }, 20000);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Update toolbar icon badge status
function updateBadge(status) {
  if (!chrome.action) return;
  try {
    if (status === "connected") {
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#0ACF83" });
      chrome.action.setTitle({ title: "Figma MCP Bridge: Connected (ws://127.0.0.1:9223)" });
    } else if (status === "reconnecting") {
      chrome.action.setBadgeText({ text: "..." });
      chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" });
      chrome.action.setTitle({ title: "Figma MCP Bridge: Reconnecting..." });
    } else {
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
      chrome.action.setTitle({ title: "Figma MCP Bridge: Disconnected" });
    }
  } catch (_) {}
}

// 1. Establish WebSocket Connection with Auto-reconnect & Exponential Backoff
function connectWebSocket() {
  console.log(`[Figma MCP] Connecting to WebSocket at ${MCP_WEBSOCKET_URL}...`);
  updateBadge("reconnecting");
  
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
  }

  socket = new WebSocket(MCP_WEBSOCKET_URL);

  socket.onopen = () => {
    console.log("[Figma MCP] WebSocket connection established successfully.");
    updateBadge("connected");
    reconnectDelay = 1000; // Reset backoff on successful connection
    startHeartbeat();
  };

  socket.onmessage = async (event) => {
    console.log("[Figma MCP] Received message from server:", event.data);
    try {
      const message = JSON.parse(event.data);
      
      if (message.action === "GET_NODE_DATA") {
        const { nodeId, fileKey, fetchSelection } = message;
        const requestId = message.requestId || message.id || "default_id";
        await handleGetNodeData(requestId, fileKey, nodeId, fetchSelection);
      }
    } catch (err) {
      console.error("[Figma MCP] Failed to parse message:", err);
    }
  };

  socket.onclose = (event) => {
    console.warn(`[Figma MCP] WebSocket disconnected (Code: ${event.code}). Reconnecting in ${reconnectDelay}ms...`);
    stopHeartbeat();
    updateBadge("disconnected");
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error("[Figma MCP] WebSocket error:", error);
    stopHeartbeat();
    updateBadge("disconnected");
  };
}

function scheduleReconnect() {
  socket = null;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  setTimeout(() => {
    connectWebSocket();
  }, delay);
}

// 2. Respond back to WebSocket
function sendWebSocketResponse(requestId, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.error("[Figma MCP] Cannot send response: WebSocket is not open.");
    return;
  }
  const response = JSON.stringify({
    requestId,
    timestamp: Date.now(),
    ...payload
  });
  console.log("[Figma MCP] Sending response:", response);
  socket.send(response);
}

// 3. Inject inject.js into the page's MAIN world via chrome.scripting (bypasses Figma's CSP).
async function injectMainWorldScript(tabId) {
  if (injectedTabs.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["inject.js"],
      world: "MAIN"
    });
    injectedTabs.add(tabId);
    console.log(`[Figma MCP] inject.js injected into MAIN world for tab ${tabId}.`);
  } catch (err) {
    console.warn(`[Figma MCP] MAIN world injection skipped for tab ${tabId}:`, err.message);
  }
}

// 4. Route request to active Figma tab content script
async function handleGetNodeData(requestId, fileKey, nodeId, fetchSelection = false) {
  try {
    const tabs = await chrome.tabs.query({ url: "https://*.figma.com/*" });
    const figmaTabs = tabs.filter(t => t.url && (t.url.includes("/design/") || t.url.includes("/file/") || t.url.includes("/board/")));
    
    let targetTab = null;
    if (fileKey && figmaTabs.length > 0) {
      targetTab = figmaTabs.find(t => t.url && t.url.includes(fileKey));
    }
    
    if (!targetTab && figmaTabs.length > 0) {
      targetTab = figmaTabs[0];
    }

    if (targetTab) {
      console.log(`[Figma MCP] Dispatching query to tab ID: ${targetTab.id} (${targetTab.url})`);

      await injectMainWorldScript(targetTab.id);

      chrome.tabs.sendMessage(targetTab.id, { action: "FETCH_NODE_DATA", fileKey, nodeId, fetchSelection }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Figma MCP] Content script unavailable:", chrome.runtime.lastError.message);
          sendWebSocketResponse(requestId, { success: false, error: `Content script unavailable: ${chrome.runtime.lastError.message}` });
          return;
        }

        if (response && response.success) {
          sendWebSocketResponse(requestId, { success: true, data: response.data });
        } else {
          console.warn("[Figma MCP] Content script failed node fetch. Error:", response?.error);
          sendWebSocketResponse(requestId, { success: false, error: response?.error || "Content script failed to retrieve node data." });
        }
      });
    } else {
      console.log("[Figma MCP] No active Figma tab found.");
      sendWebSocketResponse(requestId, { success: false, error: "No active Figma tab found in Google Chrome. Please open Figma to enable extraction." });
    }
  } catch (error) {
    console.error("[Figma MCP] Error processing node request:", error);
    sendWebSocketResponse(requestId, { success: false, error: error.message });
  }
}

// 5. Manifest V3 Service Worker Keep-Alive Management

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "figma-keep-alive") {
    console.log("[Figma MCP] Keep-alive channel connected.");
    activePorts.add(port);
    
    port.onDisconnect.addListener(() => {
      console.log("[Figma MCP] Keep-alive channel disconnected.");
      activePorts.delete(port);
    });
  }
});

chrome.alarms.create("mcp-keepalive", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "mcp-keepalive") {
    console.log("[Figma MCP] Heartbeat alarm fired.");
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log("[Figma MCP] WebSocket inactive. Reconnecting...");
      connectWebSocket();
    } else {
      try {
        socket.send(JSON.stringify({ event: "PING" }));
      } catch (e) {}
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "SELECTION_CHANGED") {
    latestSelection = {
      fileKey: message.fileKey,
      nodeId: message.nodeId,
      timestamp: Date.now()
    };
    console.log("[Figma MCP] Broadcast selection change:", message.nodeId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        event: "SELECTION_CHANGED",
        fileKey: message.fileKey,
        nodeId: message.nodeId,
        timestamp: Date.now()
      }));
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "GET_POPUP_STATE") {
    sendResponse({
      wsConnected: Boolean(socket && socket.readyState === WebSocket.OPEN),
      isConnecting: Boolean(!socket && reconnectDelay > 1000),
      injectedTabs: Array.from(injectedTabs),
      lastSelection: latestSelection
    });
    return true;
  }

  if (message.action === "TRIGGER_RECONNECT") {
    console.log("[Figma MCP] Manual reconnect requested from popup.");
    reconnectDelay = 1000;
    connectWebSocket();
    sendResponse({ success: true });
    return true;
  }
});

// 6. Clear injection guard on tab navigation or closure
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    injectedTabs.delete(tabId);
  }

  if (
    changeInfo.status === "complete" &&
    tab.url &&
    (tab.url.includes("figma.com/design/") ||
      tab.url.includes("figma.com/file/") ||
      tab.url.includes("figma.com/board/"))
  ) {
    injectMainWorldScript(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

// Initialize connection on start
connectWebSocket();
