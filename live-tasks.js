/* TPS Dashboard — Live Tasks (Sprint 1, Phase 1A)
 * --------------------------------------------------------------
 * Replaces the once-a-day Python rebuild with client-side fetch.
 * On page load + every 5 minutes, calls the Apps Script Web App's
 * getTasks + getWins endpoints, renders into the placeholder
 * containers, then re-wires the status-widget-client.js handlers.
 *
 * Pairs with apps-script-additions.gs and the modified index.html.
 * -------------------------------------------------------------- */

(function () {
  // ============================== CONFIG ==============================
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxbNL6TKDf1z2SS9HAczKvYN1oSnY1WOEuMPa4Qv9VY76OuewyeBLvADNQiJI4wtppP/exec";
  const SECRET_TOKEN = "TPSMAYA4321";
  const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const STORAGE_KEY_LAST_SYNCED = "tps-last-synced";

  // Category name → container ID in index.html
  const CATEGORY_CONTAINERS = {
    "Operations & Admin":      "tasks-operations-admin",
    "Leasing & Marketing":     "tasks-leasing-marketing",
    "Maintenance & Repairs":   "tasks-maintenance-repairs",
    "Financials & Accounting": "tasks-financials-accounting",
    "Tenant Relations":        "tasks-tenant-relations"
  };

  // Render order within each category (matches handoff doc Phase 04 spec,
  // adjusted for current sheet status values)
  const STATUS_ORDER = [
    "Stuck",
    "Maya Needs Help",
    "Needs Approval",
    "New",
    "In Progress",
    "FYI Only"
  ];

  // Status name → CSS class (matches existing status-widget.css + index.html styles)
  const STATUS_CLASS_MAP = {
    "Needs Approval":  "status-approval",
    "Approval":        "status-approval",
    "Maya Needs Help": "status-maya-help",
    "New":             "status-new",
    "In Progress":     "status-in-progress",
    "Stuck":           "status-stuck",
    "FYI Only":        "status-fyi",
    "FYI":             "status-fyi",
    "Tricia on it":    "status-in-progress",
    "Maya on it":      "status-in-progress",
    "Craig on it":     "status-in-progress",
    "Approved":        "status-approval",
    "On Hold":         "status-in-progress",
    "Rejected":        "status-stuck",
    "Done":            "status-fyi",
    "Note added":      "status-fyi"
  };

  // ============================== HELPERS ==============================
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function nowFormatted() {
    const d = new Date();
    return d.toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit"
    });
  }

  // ============================== FETCH ==============================
  function fetchTasks() {
    return fetch(
      WEB_APP_URL + "?action=getTasks&token=" + encodeURIComponent(SECRET_TOKEN),
      { method: "GET", redirect: "follow" }
    )
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        if (data && data.tasks) return data.tasks;
        if (data && data.error) throw new Error(data.error);
        return [];
      });
  }

  function fetchWins() {
    return fetch(
      WEB_APP_URL + "?action=getWins&token=" + encodeURIComponent(SECRET_TOKEN) + "&limit=9",
      { method: "GET", redirect: "follow" }
    )
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        if (data && data.wins) return data.wins;
        return [];
      });
  }

  // ============================== RENDER ==============================
  /**
   * Build a single task card HTML. Matches the structure that Python's
   * build_task_item() produces, so status-widget-client.js can wire button
   * handlers using the same .btn-tricia / .btn-maya / .task-checkbox /
   * .comment-save-btn / data-id selectors.
   */
  function buildTaskHtml(task) {
    const id = escapeHtml(task.id);
    const propertyHtml = task.property
      ? '<div class="task-property">' + escapeHtml(task.property) + '</div>'
      : "";
    const statusClass = STATUS_CLASS_MAP[task.status] || "status-fyi";

    const notesBlock = task.notes
      ? '<div class="task-description">' + escapeHtml(task.notes) + '</div>'
      : "";

    const overlayBlock = (task.overlayNote && task.overlayNote.trim())
      ? '<div class="task-description" style="opacity:.85;font-style:italic">Latest note from ' +
        escapeHtml(task.overlayBy || "someone") + ": " + escapeHtml(task.overlayNote) + "</div>"
      : "";

    // Status-specific buttons (mirrors Python's logic)
    let buttonsHtml = "";
    const rawStatus = task.sheetStatus;

    if (rawStatus === "Needs Approval") {
      buttonsHtml =
        '<button class="btn-outlined btn-approve">Approve</button>' +
        '<button class="btn-outlined btn-hold">Hold Off</button>' +
        '<button class="btn-outlined btn-reject">Rejected</button>';
    } else if (
      rawStatus === "New" || rawStatus === "In Progress" ||
      rawStatus === "FYI Only" || rawStatus === "Maya Needs Help" ||
      rawStatus === "Stuck"
    ) {
      if (rawStatus === "New" || rawStatus === "Stuck" || rawStatus === "Maya Needs Help") {
        buttonsHtml =
          '<button class="btn-outlined btn-tricia">Tricia on it</button>' +
          '<button class="btn-outlined btn-maya">Maya on it</button>';
      }
      // Done checkbox — always included for these statuses
      buttonsHtml +=
        '<div class="checkbox-container">' +
          '<input type="checkbox" id="cb-' + id + '" class="task-checkbox">' +
          '<label for="cb-' + id + '" class="checkbox-label">' +
            '<div class="checkbox-box">' +
              '<div class="checkbox-fill"></div>' +
              '<div class="checkmark">' +
                '<svg class="check-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' +
              '</div>' +
              '<div class="success-ripple"></div>' +
            '</div>' +
            '<span class="checkbox-text">Done</span>' +
          '</label>' +
        '</div>';
    }

    return (
      '<div class="task-item" data-id="' + id + '">' +
        '<div class="task-row">' +
          '<div class="task-info">' +
            '<button class="task-expand-btn">▼</button>' +
            '<div class="task-title">' + escapeHtml(task.task) + '</div>' +
            propertyHtml +
          '</div>' +
          '<div class="task-status">' +
            '<div class="task-status-badge ' + statusClass + '">' + escapeHtml(task.status) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="task-expanded">' +
          notesBlock +
          overlayBlock +
          '<div class="task-actions">' +
            '<div class="task-buttons">' + buttonsHtml + '</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px;">' +
              '<textarea class="task-comment-input" placeholder="Leave a quick note (auto-saves when you click Save Note)...">' +
                escapeHtml(task.overlayNote || "") +
              '</textarea>' +
              '<button class="comment-save-btn">Save Note</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function buildWinHtml(win) {
    const propertyText = (win.property && win.property.toUpperCase() !== "GENERAL")
      ? win.property + ": "
      : "";
    let text = propertyText + win.task + " — " + (win.status || "Done");
    if (text.length > 110) text = text.substring(0, 107) + "...";
    return (
      '<div class="win-item">' +
        '<div class="win-check">✓</div>' +
        '<div class="win-item-text">' + escapeHtml(text) + '</div>' +
      '</div>'
    );
  }

  function renderTasks(tasks) {
    // Group by category, then by status
    const byCategory = {};
    Object.keys(CATEGORY_CONTAINERS).forEach(function (cat) { byCategory[cat] = {}; });

    tasks.forEach(function (task) {
      const cat = (task.category && CATEGORY_CONTAINERS[task.category])
        ? task.category
        : "Operations & Admin"; // fall back if category unknown
      if (!byCategory[cat]) byCategory[cat] = {};
      const status = task.status || task.sheetStatus || "New";
      if (!byCategory[cat][status]) byCategory[cat][status] = [];
      byCategory[cat][status].push(task);
    });

    // Render each category's container
    Object.keys(CATEGORY_CONTAINERS).forEach(function (category) {
      const container = document.getElementById(CATEGORY_CONTAINERS[category]);
      if (!container) return;

      const categoryTasks = byCategory[category] || {};
      let html = "";

      // First, status-ordered groups
      STATUS_ORDER.forEach(function (status) {
        const group = categoryTasks[status];
        if (!group) return;
        group.forEach(function (task) { html += buildTaskHtml(task); });
      });

      // Then anything not in STATUS_ORDER
      Object.keys(categoryTasks).forEach(function (status) {
        if (STATUS_ORDER.indexOf(status) === -1) {
          categoryTasks[status].forEach(function (task) { html += buildTaskHtml(task); });
        }
      });

      container.innerHTML = html || '<div class="empty-state">No items in this category</div>';
    });
  }

  function renderWins(wins) {
    const container = document.getElementById("tasks-quick-wins");
    if (!container) return;
    if (!wins.length) {
      container.innerHTML = '<div class="empty-state">No recent completions</div>';
      return;
    }
    container.innerHTML = wins.map(buildWinHtml).join("");
  }

  function updateLastSyncedDisplay() {
    const el = document.getElementById("last-synced-timestamp");
    if (el) {
      const ts = nowFormatted();
      el.textContent = "Last updated: " + ts;
      try { localStorage.setItem(STORAGE_KEY_LAST_SYNCED, ts); } catch (e) {}
    }
  }

  function showCachedTimestamp() {
    const el = document.getElementById("last-synced-timestamp");
    if (!el) return;
    try {
      const cached = localStorage.getItem(STORAGE_KEY_LAST_SYNCED);
      if (cached) el.textContent = "Last updated: " + cached;
    } catch (e) {}
  }

  // ============================== RE-WIRE WIDGET ==============================
  function reWireWidget() {
    // Re-trigger status-widget-client.js's button wiring on freshly rendered DOM.
    // Requires the small patch to status-widget-client.js that exposes wireTasks
    // on window.tpsComms (Sprint 1 modification).
    if (window.tpsComms && typeof window.tpsComms.wireTasks === "function") {
      try { window.tpsComms.wireTasks(); }
      catch (err) { console.error("[live-tasks] reWireWidget error:", err); }
    } else {
      console.warn("[live-tasks] window.tpsComms.wireTasks is not available — buttons may not respond. Check that the modified status-widget-client.js is loaded.");
    }
  }

  // ============================== REFRESH ==============================
  let isRefreshing = false;

  function setRefreshButtonState(state) {
    const btn = document.getElementById("tps-refresh-btn");
    if (!btn) return;
    if (state === "syncing") {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin-icon">↻</span> Syncing…';
    } else if (state === "error") {
      btn.disabled = false;
      btn.innerHTML = '⚠ Retry';
      btn.classList.add("error-state");
      setTimeout(function () {
        btn.classList.remove("error-state");
        btn.innerHTML = '↻ Refresh';
      }, 3000);
    } else {
      btn.disabled = false;
      btn.innerHTML = '↻ Refresh';
      btn.classList.remove("error-state");
    }
  }

  function refresh() {
    if (isRefreshing) return Promise.resolve();
    isRefreshing = true;
    setRefreshButtonState("syncing");

    return Promise.all([fetchTasks(), fetchWins()])
      .then(function (results) {
        const tasks = results[0];
        const wins = results[1];
        renderTasks(tasks);
        renderWins(wins);
        updateLastSyncedDisplay();
        reWireWidget();
        setRefreshButtonState("idle");
        console.log("[live-tasks] Refreshed: " + tasks.length + " tasks, " + wins.length + " wins.");
      })
      .catch(function (err) {
        console.error("[live-tasks] refresh failed:", err);
        setRefreshButtonState("error");
      })
      .finally(function () { isRefreshing = false; });
  }

  // ============================== INIT ==============================
  function init() {
    showCachedTimestamp(); // show last-known timestamp before first fetch finishes

    // Wire the refresh button
    const refreshBtn = document.getElementById("tps-refresh-btn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function (e) {
        e.preventDefault();
        refresh();
      });
    }

    // Initial fetch
    refresh();

    // Poll every 5 minutes
    setInterval(refresh, POLL_INTERVAL_MS);

    // Re-fetch when tab becomes visible again (in case it's been backgrounded > 5 min)
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });

    // Expose for debugging in DevTools console
    window.tpsLive = { refresh: refresh, fetchTasks: fetchTasks, fetchWins: fetchWins };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
