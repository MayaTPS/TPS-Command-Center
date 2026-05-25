/* TPS Dashboard — Live Tasks (Sprint 1 + Sprint 2)
 * --------------------------------------------------------------
 * Sprint 1 (Phase 1A): replaced once-a-day Python rebuild with
 *   client-side fetch. On page load + every 5 min, calls getTasks
 *   and getWins, renders into containers, re-wires button handlers.
 *
 * Sprint 2 additions:
 *   Phase 02 — greeting banner (time/day/person aware + stat chips)
 *   Phase 03 — wires Add Task quick card to status-widget wizard
 *   Phase 04 — filter bar logic (client-side, persists in localStorage)
 *   Phase 09 — already done in HTML (Quick Wins → All Done ✓)
 *
 * Pairs with the merged Apps Script (with getTasks + getWins endpoints).
 * -------------------------------------------------------------- */

(function () {
  // ============================== CONFIG ==============================
  const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxbNL6TKDf1z2SS9HAczKvYN1oSnY1WOEuMPa4Qv9VY76OuewyeBLvADNQiJI4wtppP/exec";
  const SECRET_TOKEN = "TPSMAYA4321";
  const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  const STORAGE_KEY_LAST_SYNCED = "tps-last-synced";
  const STORAGE_KEY_FILTER = "tps-current-filter";
  const STORAGE_KEY_ACTOR = "tps-comms:actor"; // matches status-widget-client.js
  const DEFAULT_VIEWER_NAME = "Maya";

  // Statuses we count for the greeting banner stat chips
  const APPROVAL_STATUSES = ["Needs Approval", "Approval"];
  const STUCK_STATUSES = ["Stuck"];

  // Current active filter (persisted in localStorage)
  let currentFilter = "all";
  try {
    const stored = localStorage.getItem(STORAGE_KEY_FILTER);
    if (stored) currentFilter = stored;
  } catch (e) {}

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

    // data-status is the RAW sheet status — used by Phase 04 filter bar
    const dataStatus = escapeHtml(task.sheetStatus || "");
    return (
      '<div class="task-item" data-id="' + id + '" data-status="' + dataStatus + '">' +
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

  // ============================== GREETING BANNER (Phase 02) ==============================
  /**
   * Returns the current viewer's first name. Reads from localStorage
   * (set by status-widget-client.js's actor picker). Defaults to "Maya".
   */
  function getViewerName() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ACTOR);
      if (stored && stored.trim()) return stored.trim();
    } catch (e) {}
    return DEFAULT_VIEWER_NAME;
  }

  /**
   * Time-aware + day-aware greeting message.
   * Examples: "Good morning, Maya" / "Good afternoon, Tricia" / "Good evening, Maya"
   */
  function buildGreetingHello(name) {
    const hour = new Date().getHours();
    if (hour < 12)  return "Good morning, " + name;
    if (hour < 17)  return "Good afternoon, " + name;
    return "Good evening, " + name;
  }

  /**
   * Day-of-week + task-count-aware sub-message.
   * Returns a short contextual line under the greeting.
   */
  function buildGreetingMessage(taskCount) {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon, ... 5=Fri, 6=Sat
    const hour = now.getHours();

    // Weekend
    if (day === 0 || day === 6) {
      return "Quick look at what's on deck for next week.";
    }
    // Monday morning
    if (day === 1 && hour < 12) {
      return "New week, fresh start. Here's what needs your attention first.";
    }
    // Friday
    if (day === 5) {
      if (hour < 12)  return "Last day of the week — let's finish strong.";
      return "Almost there. Close off what you can — Monday-you will thank you.";
    }
    // High task count
    if (taskCount > 8) {
      return "Big board today. Pick one thing, finish it, build momentum from there.";
    }
    // Default
    return "Here's where things stand — let's keep the momentum going.";
  }

  /**
   * Compute the three stat chip counts: approval, stuck, total.
   */
  function computeStatCounts(tasks) {
    let approval = 0, stuck = 0;
    tasks.forEach(function (t) {
      const s = t.status || t.sheetStatus || "";
      if (APPROVAL_STATUSES.indexOf(s) > -1) approval++;
      if (STUCK_STATUSES.indexOf(s) > -1) stuck++;
    });
    return { approval: approval, stuck: stuck, total: tasks.length };
  }

  /**
   * Update the greeting banner with current name, time-of-day message, and stat chips.
   */
  function updateGreeting(tasks) {
    const name = getViewerName();
    const hi  = document.getElementById("greeting-hi");
    const msg = document.getElementById("greeting-msg");
    if (hi)  hi.textContent  = buildGreetingHello(name);
    if (msg) msg.textContent = buildGreetingMessage(tasks.length);

    // Stat chips
    const counts = computeStatCounts(tasks);
    const chipApproval = document.getElementById("chip-approval");
    const chipStuck    = document.getElementById("chip-stuck");
    const chipTotal    = document.getElementById("chip-total");

    if (chipApproval) {
      if (counts.approval > 0) {
        chipApproval.textContent = counts.approval + (counts.approval === 1 ? " needs approval" : " need approval");
        chipApproval.style.display = "";
      } else {
        chipApproval.style.display = "none";
      }
    }
    if (chipStuck) {
      if (counts.stuck > 0) {
        chipStuck.textContent = counts.stuck + (counts.stuck === 1 ? " stuck" : " stuck");
        chipStuck.style.display = "";
      } else {
        chipStuck.style.display = "none";
      }
    }
    if (chipTotal) {
      chipTotal.textContent = counts.total + (counts.total === 1 ? " total task" : " total tasks");
    }
  }

  // ============================== FILTER BAR (Phase 04) ==============================
  /**
   * Apply the current filter to all task cards in the DOM.
   * Hides tasks whose data-status doesn't match. Hides empty category sections.
   * Called after every render and on every filter button click.
   */
  function applyFilter(filter) {
    if (filter) currentFilter = filter;
    try { localStorage.setItem(STORAGE_KEY_FILTER, currentFilter); } catch (e) {}

    // Update active state on filter buttons
    document.querySelectorAll(".tps-filter-btn").forEach(function (btn) {
      if (btn.getAttribute("data-filter") === currentFilter) btn.classList.add("active");
      else btn.classList.remove("active");
    });

    // Show/hide task items
    document.querySelectorAll(".task-item").forEach(function (item) {
      if (currentFilter === "all") {
        item.classList.remove("filter-hidden");
        return;
      }
      const status = item.getAttribute("data-status") || "";
      if (status === currentFilter) item.classList.remove("filter-hidden");
      else item.classList.add("filter-hidden");
    });

    // Hide category sections with no visible task items
    document.querySelectorAll(".category-section").forEach(function (section) {
      const visibleTasks = section.querySelectorAll(".task-item:not(.filter-hidden)").length;
      if (currentFilter === "all" || visibleTasks > 0) {
        section.classList.remove("filter-empty");
      } else {
        section.classList.add("filter-empty");
      }
    });
  }

  function wireFilterBar() {
    document.querySelectorAll(".tps-filter-btn").forEach(function (btn) {
      if (btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        applyFilter(btn.getAttribute("data-filter"));
      });
    });
  }

  // ============================== ADD TASK QUICK CARD (Phase 03) ==============================
  function wireAddTaskQuickCard() {
    const btn = document.getElementById("quick-add-task");
    if (!btn || btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (window.tpsComms && typeof window.tpsComms.openWizard === "function") {
        window.tpsComms.openWizard();
      } else {
        console.warn("[live-tasks] window.tpsComms.openWizard not available — Add Task can't open");
      }
    });
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
        updateGreeting(tasks);   // Sprint 2 — Phase 02: greeting banner
        reWireWidget();
        applyFilter();           // Sprint 2 — Phase 04: re-apply filter to freshly rendered DOM
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

    // Sprint 2 — Phase 02: show greeting with cached name BEFORE first fetch finishes
    const name = getViewerName();
    const hi = document.getElementById("greeting-hi");
    if (hi) hi.textContent = buildGreetingHello(name);

    // Sprint 2 — Phase 03: wire Add Task quick card
    wireAddTaskQuickCard();

    // Sprint 2 — Phase 04: wire filter bar
    wireFilterBar();

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
