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
  const STORAGE_KEY_FILTER = "tps-current-filter";
  let currentFilter = "all";
  try { const stored = localStorage.getItem(STORAGE_KEY_FILTER); if (stored) currentFilter = stored; } catch (e) {}
  const STORAGE_KEY_ACTOR = "tps-comms:actor";
  const DEFAULT_VIEWER_NAME = "Maya";
  const APPROVAL_STATUSES = ["Needs Approval", "Approval"];
  const STUCK_STATUSES = ["Stuck"];

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
      '<div class="task-item" data-id="' + id + '" data-status="' + escapeHtml(task.sheetStatus || "") + '">' +
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
  

  
  // ===== GREETING BANNER (Phase 02) =====
  function getViewerName() {
    try { const stored = localStorage.getItem(STORAGE_KEY_ACTOR); if (stored && stored.trim()) return stored.trim(); } catch (e) {}
    return DEFAULT_VIEWER_NAME;
  }
  function buildGreetingHello(name) {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning, " + name;
    if (hour < 17) return "Good afternoon, " + name;
    return "Good evening, " + name;
  }
  // ===== MESSAGE LIBRARY (Phase 12) =====
  const MSG_KEY_LAST = "tps_msg_last";
  const MSG_KEY_DIYK_IDX = "tps_diyk_idx";
  const MSG_KEY_DIYK_LAST = "tps_diyk_last";
  const MSG_GREETINGS = {
    mondayMorning: [
      "New week, fresh slate. Let’s see what needs your attention first.",
      "Monday kick-off. Your board’s ready — let’s get moving."
    ],
    midweekMorning: [
      "Good morning. Here’s where things stand — let’s keep the momentum going."
    ],
    fridayMorning: [
      "Last day of the week. Let’s finish strong and head into the weekend lighter."
    ],
    fridayAfternoon: [
      "Almost there. Close off what you can — Monday-you will thank you."
    ],
    weekend: [
      "It’s the weekend — quick look at what’s waiting for Monday."
    ],
    evening: [
      "Still going? Here’s a quick look before you wrap up for the night."
    ]
  };
  const MSG_CARING = {
    lunch: [
      "It’s noon — step away from the screen. Grab some lunch. The tasks will still be here.",
      "Midday check-in: have you eaten? Seriously. Close the laptop for 20 minutes."
    ],
    afternoon: [
      "3pm slump is real. Quick stretch, glass of water — you’ll be sharper in 5 minutes.",
      "Mid-afternoon. Before you dive back in — have you had water today?"
    ],
    evening: [
      "Still working? You’ve put in a full day. Wrap up what you can and rest — tomorrow’s fresh.",
      "It’s evening. Anything that can wait until morning — let it wait."
    ],
    earlyMorning: [
      "Early bird! Before you dive in — take a breath, make a coffee. You’ve got this."
    ]
  };
  const MSG_MOTIVATIONAL = {
    monday: [
      "Every task you close today is one less thing weighing on the rest of the week.",
      "Pick one stuck item this morning. Clear it. Build from there."
    ],
    midweek: [
      "Progress over perfection. A task moved forward is still a win.",
      "You’re halfway through the week. What’s one thing that would make Friday feel lighter?"
    ],
    friday: [
      "Done is better than perfect. Clear what you can and head into the weekend lighter."
    ],
    bigBoard: [
      "Big board today. Pick one thing, finish it, and build momentum from there."
    ],
    general: [
      "Raising the bar in industry standards — one task at a time."
    ]
  };
  const MSG_DIYK = [
    "Hit Remind Me on any task and pick a date. You’ll get a nudge when it’s time to follow up — so nothing falls through the cracks.",
    "When you archive a task, it moves to the Archive tab in your sheet — not deleted. Every win is saved. Check it anytime.",
    "Dashboard refreshes automatically every 5 minutes. Added something to the sheet just now? Hit Refresh to sync it instantly.",
    "Use the filter bar to focus on just one status — great for quickly seeing what’s stuck or what needs approval without scrolling.",
    "FYI tasks only need one thing from you: click Got it to acknowledge and clear it from the board.",
    "The All Done box at the top shows your last 6 completed tasks — pulled live from the Archive tab. A good reminder of how much actually gets done.",
    "Click the Maya/switch pill at the bottom-right to switch viewer between Maya and Tricia — your greeting and notes attribution will update.",
    "The little stat chips at the top of the banner are live counts — red “X need approval” means action items on your plate right now."
  ];
  function pickFromPool(pool) {
    if (!pool || !pool.length) return null;
    if (pool.length === 1) return pool[0];
    let last = null;
    try { last = localStorage.getItem(MSG_KEY_LAST); } catch (e) {}
    let pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick === last && pool.length > 1) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
    try { localStorage.setItem(MSG_KEY_LAST, pick); } catch (e) {}
    return pick;
  }
  function pickDidYouKnow() {
    let idx = 0;
    try { const stored = localStorage.getItem(MSG_KEY_DIYK_IDX); if (stored !== null) idx = parseInt(stored, 10) || 0; } catch (e) {}
    const tip = MSG_DIYK[idx % MSG_DIYK.length];
    try {
      localStorage.setItem(MSG_KEY_DIYK_IDX, String((idx + 1) % MSG_DIYK.length));
      localStorage.setItem(MSG_KEY_DIYK_LAST, String(Date.now()));
    } catch (e) {}
    return tip;
  }
  function shouldShowDidYouKnow() {
    try {
      const last = localStorage.getItem(MSG_KEY_DIYK_LAST);
      if (!last) return true;
      const days = (Date.now() - parseInt(last, 10)) / (1000 * 60 * 60 * 24);
      return days >= 3;
    } catch (e) { return false; }
  }
  function buildGreetingMessage(taskCount) {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const min = now.getMinutes();
    // 1) Caring time windows override everything
    if (hour < 7) return pickFromPool(MSG_CARING.earlyMorning);
    if ((hour === 11 && min >= 45) || hour === 12 || (hour === 13 && min <= 15)) return pickFromPool(MSG_CARING.lunch);
    if (hour === 15) return pickFromPool(MSG_CARING.afternoon);
    if (hour >= 18 && (hour > 18 || min >= 30)) return pickFromPool(MSG_CARING.evening);
    // 2) Day-of-week messages
    if (day === 0 || day === 6) return pickFromPool(MSG_GREETINGS.weekend);
    if (day === 1 && hour < 12) return pickFromPool([].concat(MSG_GREETINGS.mondayMorning, MSG_MOTIVATIONAL.monday));
    if (day === 5) {
      if (hour < 12) return pickFromPool(MSG_GREETINGS.fridayMorning);
      return pickFromPool([].concat(MSG_GREETINGS.fridayAfternoon, MSG_MOTIVATIONAL.friday));
    }
    // 3) High task count nudges toward big board
    if (taskCount > 8) return pickFromPool(MSG_MOTIVATIONAL.bigBoard);
    // 4) Did You Know rotates every 3 days
    if (shouldShowDidYouKnow()) return pickDidYouKnow();
    // 5) Default: midweek greeting/motivational pool
    return pickFromPool([].concat(MSG_GREETINGS.midweekMorning, MSG_MOTIVATIONAL.midweek, MSG_MOTIVATIONAL.general));
  }
  function computeStatCounts(tasks) {
    let approval = 0, stuck = 0;
    tasks.forEach(function (t) { const s = t.status || t.sheetStatus || ""; if (APPROVAL_STATUSES.indexOf(s) > -1) approval++; if (STUCK_STATUSES.indexOf(s) > -1) stuck++; });
    return { approval: approval, stuck: stuck, total: tasks.length };
  }
  function updateGreeting(tasks) {
    const name = getViewerName();
    const hi = document.getElementById("greeting-hi");
    const msg = document.getElementById("greeting-msg");
    if (hi) hi.textContent = buildGreetingHello(name);
    if (msg) msg.textContent = buildGreetingMessage(tasks.length);
    const counts = computeStatCounts(tasks);
    const chipApproval = document.getElementById("chip-approval");
    const chipStuck = document.getElementById("chip-stuck");
    const chipTotal = document.getElementById("chip-total");
    if (chipApproval) { if (counts.approval > 0) { chipApproval.textContent = counts.approval + (counts.approval === 1 ? " needs approval" : " need approval"); chipApproval.style.display = ""; } else { chipApproval.style.display = "none"; } }
    if (chipStuck) { if (counts.stuck > 0) { chipStuck.textContent = counts.stuck + " stuck"; chipStuck.style.display = ""; } else { chipStuck.style.display = "none"; } }
    if (chipTotal) { chipTotal.textContent = counts.total + (counts.total === 1 ? " total task" : " total tasks"); }
  }

  // ===== FILTER BAR (Phase 04) =====
  function applyFilter(filter) {
    if (filter) currentFilter = filter;
    try { localStorage.setItem(STORAGE_KEY_FILTER, currentFilter); } catch (e) {}
    document.querySelectorAll(".tps-filter-btn").forEach(function (btn) {
      if (btn.getAttribute("data-filter") === currentFilter) btn.classList.add("active");
      else btn.classList.remove("active");
    });
    document.querySelectorAll(".task-item").forEach(function (item) {
      if (currentFilter === "all") { item.classList.remove("filter-hidden"); return; }
      const status = item.getAttribute("data-status") || "";
      if (status === currentFilter) item.classList.remove("filter-hidden");
      else item.classList.add("filter-hidden");
    });
    document.querySelectorAll(".category-section").forEach(function (section) {
      const visibleTasks = section.querySelectorAll(".task-item:not(.filter-hidden)").length;
      if (currentFilter === "all" || visibleTasks > 0) section.classList.remove("filter-empty");
      else section.classList.add("filter-empty");
    });
  }

  function wireFilterBar() {
    document.querySelectorAll(".tps-filter-btn").forEach(function (btn) {
      if (btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function (e) { e.preventDefault(); applyFilter(btn.getAttribute("data-filter")); });
    });
  }

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
        updateGreeting(tasks);
        reWireWidget();
        applyFilter();
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

    wireFilterBar();

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
