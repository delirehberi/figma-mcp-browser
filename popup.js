/**
 * Figma MCP Bridge - Extension Popup Controller
 * Displays bridge connectivity, active Figma document metadata, and session status.
 */

document.addEventListener("DOMContentLoaded", () => {
  const wsDot = document.getElementById("wsDot");
  const wsStatusText = document.getElementById("wsStatusText");
  const bridgeStatusBadge = document.getElementById("bridgeStatusBadge");
  const figmaDot = document.getElementById("figmaDot");
  const figmaFileKey = document.getElementById("figmaFileKey");
  const figmaNodeId = document.getElementById("figmaNodeId");
  const figmaInjected = document.getElementById("figmaInjected");
  const sessionDot = document.getElementById("sessionDot");
  const sessionUser = document.getElementById("sessionUser");
  const sessionStatus = document.getElementById("sessionStatus");
  const btnReconnect = document.getElementById("btnReconnect");
  const btnRefreshTabs = document.getElementById("btnRefreshTabs");
  const btnSyncSession = document.getElementById("btnSyncSession");
  const toast = document.getElementById("statusToast");

  function showToast(message, type = "success", duration = 3000) {
    toast.textContent = message;
    toast.className = `toast toast-${type}`;
    setTimeout(() => {
      toast.className = "toast hidden";
    }, duration);
  }

  async function updateUI() {
    try {
      // 1. Query background service worker state
      const state = await chrome.runtime.sendMessage({ action: "GET_POPUP_STATE" }).catch(() => null);

      if (state && state.wsConnected) {
        wsDot.className = "status-dot dot-green";
        wsStatusText.textContent = "Connected (Ready)";
        bridgeStatusBadge.textContent = "Connected";
        bridgeStatusBadge.className = "badge badge-connected";
      } else {
        wsDot.className = "status-dot dot-red";
        wsStatusText.textContent = state?.isConnecting ? "Reconnecting..." : "Offline (Port 9223)";
        bridgeStatusBadge.textContent = state?.isConnecting ? "Connecting" : "Offline";
        bridgeStatusBadge.className = state?.isConnecting ? "badge badge-reconnecting" : "badge badge-disconnected";
      }

      // 2. Query active tabs for Figma
      const tabs = await chrome.tabs.query({ url: "https://*.figma.com/*" });
      const figmaTabs = tabs.filter(t => t.url && (t.url.includes("/design/") || t.url.includes("/file/") || t.url.includes("/board/")));

      if (figmaTabs.length > 0) {
        const activeTab = figmaTabs[0];
        figmaDot.className = "status-dot dot-green";
        
        // Parse File Key and Node ID from tab URL
        try {
          const url = new URL(activeTab.url);
          const parts = url.pathname.split("/");
          const idx = parts.indexOf("design") !== -1 ? parts.indexOf("design") :
                      parts.indexOf("file") !== -1 ? parts.indexOf("file") :
                      parts.indexOf("board");
          
          if (idx !== -1 && idx + 1 < parts.length) {
            figmaFileKey.textContent = parts[idx + 1].substring(0, 16) + "...";
            figmaFileKey.title = parts[idx + 1];
          } else {
            figmaFileKey.textContent = "Detected";
          }

          const nodeParam = url.searchParams.get("node-id");
          if (nodeParam) {
            figmaNodeId.textContent = nodeParam.replace(/-/g, ":");
          } else if (state?.lastSelection?.nodeId) {
            figmaNodeId.textContent = state.lastSelection.nodeId;
          } else {
            figmaNodeId.textContent = "(None selected)";
          }

          const isInjected = state?.injectedTabs?.includes(activeTab.id);
          figmaInjected.textContent = isInjected ? "Active (MAIN world)" : "Pending Tool Call";
          figmaInjected.style.color = isInjected ? "#10b981" : "#94a3b8";
        } catch (_) {
          figmaFileKey.textContent = "Figma Tab Active";
          figmaNodeId.textContent = "-";
        }
      } else {
        figmaDot.className = "status-dot dot-gray";
        figmaFileKey.textContent = "No tab found";
        figmaNodeId.textContent = "None";
        figmaInjected.textContent = "No";
        figmaInjected.style.color = "#94a3b8";
      }

      // 3. Query cookies for active Figma session
      try {
        const cookie = await chrome.cookies.get({ url: "https://www.figma.com", name: "figma.session" });
        if (cookie && cookie.value) {
          sessionDot.className = "status-dot dot-green";
          sessionStatus.textContent = "Authenticated Cookie Active";
          
          // Check user identity if available
          const didCookie = await chrome.cookies.get({ url: "https://www.figma.com", name: "__Host-figma.user_prefs" });
          sessionUser.textContent = didCookie ? "Logged In (Chrome)" : "Active Session";
        } else {
          sessionDot.className = "status-dot dot-amber";
          sessionStatus.textContent = "No Web Cookie (Sync Desktop?)";
          sessionUser.textContent = "Not logged in (Web)";
        }
      } catch (err) {
        sessionDot.className = "status-dot dot-gray";
        sessionStatus.textContent = "Cookie inspection unavailable";
        sessionUser.textContent = "Unknown";
      }
    } catch (err) {
      console.error("[Figma MCP Popup] Error updating UI:", err);
    }
  }

  // Action listeners
  btnReconnect.addEventListener("click", async () => {
    btnReconnect.disabled = true;
    showToast("Reconnecting WebSocket...", "success", 2000);
    try {
      await chrome.runtime.sendMessage({ action: "TRIGGER_RECONNECT" });
    } catch (_) {}
    setTimeout(() => {
      btnReconnect.disabled = false;
      updateUI();
    }, 1200);
  });

  btnRefreshTabs.addEventListener("click", async () => {
    btnRefreshTabs.disabled = true;
    await updateUI();
    showToast("Tabs & status refreshed", "success", 1500);
    setTimeout(() => {
      btnRefreshTabs.disabled = false;
    }, 500);
  });

  btnSyncSession.addEventListener("click", async () => {
    btnSyncSession.disabled = true;
    showToast("Syncing session from Desktop / Chrome...", "success", 2500);
    try {
      const res = await chrome.runtime.sendMessage({ action: "TRIGGER_SYNC_SESSION" });
      if (res && res.success) {
        showToast("Session synced successfully!", "success", 3000);
      } else {
        showToast(res?.error || "Sync request delivered", "success", 3000);
      }
    } catch (e) {
      showToast("Sync triggered via background bridge", "success", 2000);
    }
    setTimeout(() => {
      btnSyncSession.disabled = false;
      updateUI();
    }, 2000);
  });

  // Initial load
  updateUI();
  // Refresh interval while popup is open
  setInterval(updateUI, 2000);
});
