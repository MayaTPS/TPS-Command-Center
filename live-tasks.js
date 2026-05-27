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
    /* Order top-down matches Maya's Tricia-priority sort. New 10-category structure with all Maintenance subs routed to the existing Maintenance container. Legacy categories kept as fallbacks. */
    "Financials & Accounting":     "tasks-financials-accounting",
    "Operations & Admin":          "tasks-operations-admin",
    "Tenant Relations":            "tasks-operations-admin",  /* legacy: fold into Ops */
    "Maintenance & Repairs":       "tasks-maintenance-repairs",  /* legacy fallback */
    "Maintenance — Electrical":   "tasks-maintenance-repairs",
    "Maintenance — Plumbing":     "tasks-maintenance-repairs",
    "Maintenance — HVAC":         "tasks-maintenance-repairs",
    "Maintenance — Pest":         "tasks-maintenance-repairs",
    "Maintenance — Appliance":    "tasks-maintenance-repairs",
    "Maintenance — Landscape":    "tasks-maintenance-repairs",
    "Maintenance — General":      "tasks-maintenance-repairs",
    "Leasing & Marketing":         "tasks-leasing-marketing"
  }

  // Render order within each category (matches handoff doc Phase 04 spec,
  // adjusted for current sheet status values)
  const STATUS_ORDER = [
    /* Maya's priority order: New on top, FYI at bottom. Within each section, tasks sort by this priority. */
    "New",
    "Needs Approval",
    "Maya Needs Help",
    "Stuck",
    "In Progress",
    "FYI Only"
  ]

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
  // Status label normalization — cleaner display names (sheet data unchanged)
var STATUS_LABEL_MAP = {
  "Needs Approval": "Approval",
  "FYI Only":       "FYI"
};
function normalizeStatusLabel(s) {
  if (!s) return "";
  return STATUS_LABEL_MAP[s] || s;
}

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
          ? '<div class="task-planning-note"><div class="task-planning-note-label">📋 Task description</div><div class="task-planning-note-text">' + escapeHtml(task.notes) + '</div></div>'
          : "";
    
        const overlayBlock = (task.overlayNote && task.overlayNote.trim())
          ? '<div class="task-overlay-note"><div class="task-overlay-note-label">💬 Latest update from ' + escapeHtml(task.overlayBy || "someone") + '</div><div class="task-overlay-note-text">' + escapeHtml(task.overlayNote) + '</div></div>'
          : "";

    // Phase 06 button rules per status (locked 2026-05-26 with Maya revisions)
    let buttonsHtml = "";
    const rawStatus = task.sheetStatus;
    const archiveBtn = '<button class="btn-outlined btn-archive" data-task-id="' + id + '" title="Move to Archive">📦 Archive</button>';
    const remindBtn  = '<button class="btn-outlined btn-remind-expanded" title="Set a reminder for this task">⏰ Remind me</button>';
    const doneBtn    = '<button class="btn-outlined btn-done">✓ Done</button>';
    const triciaBtn  = '<button class="btn-outlined btn-tricia">Tricia on it</button>';
    const mayaBtn    = '<button class="btn-outlined btn-maya">Maya on it</button>';
    const ACTIVE_WORK = ["In Progress", "Tricia on it", "Maya on it", "Craig on it", "Approved", "On Hold"];
    if (rawStatus === "Needs Approval") {
      buttonsHtml =
        '<button class="btn-outlined btn-approve">Approve</button>' +
        '<button class="btn-outlined btn-reject">Reject</button>' +
        triciaBtn + archiveBtn;
    } else if (rawStatus === "New") {
      buttonsHtml = triciaBtn + mayaBtn + remindBtn + archiveBtn;
    } else if (ACTIVE_WORK.indexOf(rawStatus) !== -1) {
      buttonsHtml = doneBtn + remindBtn + archiveBtn;
    } else if (rawStatus === "Maya Needs Help") {
      buttonsHtml = triciaBtn + doneBtn + remindBtn + archiveBtn;
    } else if (rawStatus === "Stuck" || rawStatus === "Stuck on it") {
      buttonsHtml = triciaBtn + doneBtn + remindBtn + archiveBtn;
    } else if (rawStatus === "FYI Only" || rawStatus === "FYI") {
      buttonsHtml = '<button class="btn-outlined btn-gotit" title="Acknowledge this FYI item">👁 Got it</button>';
    } else {
      buttonsHtml = archiveBtn;  // unknown status fallback
    }

    return (
      '<div class="task-item" data-id="' + id + '" data-status="' + escapeHtml(task.sheetStatus || "") + '" data-overlay-note="' + escapeHtml(task.overlayNote || "") + '">' +
        '<div class="task-row">' +
          '<div class="task-info">' +
            '<button class="task-expand-btn">▼</button>' +
            '<div class="task-title">' + escapeHtml(task.task) + '</div>' +
            propertyHtml +
          '</div>' +
          '<div class="task-status">' +
            '<div class="task-status-badge ' + statusClass + '">' + escapeHtml(normalizeStatusLabel(task.status)) + '</div>' +
            (function () { const overlay = String(task.overlayNote || "").trim(); if (!overlay) return ""; let seen = ""; try { const m = JSON.parse(localStorage.getItem("tps_seen_notes") || "{}"); seen = String(m[id] || ""); } catch (e) {} return (overlay !== seen) ? '<span class="task-note-added-badge">Note added</span>' : ""; })() +
          '</div>' +
        '</div>' +
        '<div class="task-expanded">' +
          notesBlock +
          overlayBlock +
          '<div class="task-actions">' +
            '<div class="task-buttons">' + buttonsHtml + '</div>' +
          '</div>' +
          '<div class="task-quick-note-section" style="display:flex;flex-direction:column;gap:8px;margin-top:12px;">' +
            '<label class="task-quick-note-label">💬 Leave a quick note</label>' +
            '<textarea class="task-comment-input" placeholder="Leave a quick note (auto-saves when you click Save Note)...">' +
              escapeHtml(task.overlayNote || "") +
            '</textarea>' +
            '<button class="comment-save-btn">Save Note</button>' +
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
      if (!el) return;
      window.__lastSyncedAt = Date.now();
      el.textContent = "Last updated " + formatRelativeTime(window.__lastSyncedAt);
      try { localStorage.setItem(STORAGE_KEY_LAST_SYNCED, String(window.__lastSyncedAt)); } catch (e) {}
    }

  function showCachedTimestamp() {
      const el = document.getElementById("last-synced-timestamp");
      if (!el) return;
      try {
        const cached = localStorage.getItem(STORAGE_KEY_LAST_SYNCED);
        if (cached) {
          const cachedNum = Number(cached);
          if (!isNaN(cachedNum) && cachedNum > 1000000000000) {
            window.__lastSyncedAt = cachedNum;
            el.textContent = "Last updated " + formatRelativeTime(cachedNum);
          } else {
            el.textContent = "Last updated: " + cached;
          }
        }
      } catch (e) {}
    }
  
    // Relative time formatter ("2 min ago", "just now", etc.)
    function formatRelativeTime(ts) {
      if (!ts) return "just now";
      const diffSec = Math.floor((Date.now() - ts) / 1000);
      if (diffSec < 10) return "just now";
      if (diffSec < 60) return diffSec + " sec ago";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return diffMin + (diffMin === 1 ? " min ago" : " min ago");
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return diffHr + (diffHr === 1 ? " hr ago" : " hrs ago");
      const diffDay = Math.floor(diffHr / 24);
      return diffDay + (diffDay === 1 ? " day ago" : " days ago");
    }
  
    // Keep the timestamp fresh every 30 seconds without re-fetching
    if (!window.__tpsRelTimer) {
      window.__tpsRelTimer = setInterval(function () {
        const el = document.getElementById("last-synced-timestamp");
        if (el && window.__lastSyncedAt) el.textContent = "Last updated " + formatRelativeTime(window.__lastSyncedAt);
      }, 30000);
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
      btn.classList.toggle("active", btn.getAttribute("data-filter") === currentFilter);
    });

    document.querySelectorAll(".task-item").forEach(function (item) {
      item.classList.remove("filter-hidden");
    });

    var bundleContainer = document.getElementById("tps-bundle-view");
    if (!bundleContainer) {
      bundleContainer = document.createElement("div");
      bundleContainer.id = "tps-bundle-view";
      bundleContainer.style.display = "none";
      var filterBar = document.getElementById("tps-filter-bar");
      if (filterBar && filterBar.parentNode) {
        filterBar.parentNode.insertBefore(bundleContainer, filterBar.nextSibling);
      }
    }

    if (currentFilter === "bundle-property" || currentFilter === "bundle-problem") {
      document.querySelectorAll(".category-section").forEach(function (s) { if (!s.classList.contains("bundle-group")) s.style.display = "none"; });
      var allTasks = Array.from(document.querySelectorAll(".category-section:not(.bundle-group) .task-item"));
      var groups = {};
      allTasks.forEach(function (task) {
        var key;
        if (currentFilter === "bundle-property") {
          var propEl = task.querySelector(".task-property");
          key = propEl ? propEl.textContent.trim() : "(no property)";
        } else {
          var dataCat = task.getAttribute("data-category");
          if (dataCat) { key = dataCat; } else {
            var parentSection = task.closest(".category-section");
            var titleEl = parentSection ? parentSection.querySelector(".category-title, h2") : null;
            key = titleEl ? titleEl.textContent.trim() : "(uncategorized)";
          }
        }
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
      });
      var keys = Object.keys(groups).sort();
      bundleContainer.innerHTML = "";
      keys.forEach(function (key) {
        var groupEl = document.createElement("div");
        groupEl.className = "category-section bundle-group";
        groupEl.innerHTML = '<h2 class=\"category-title\">' + escapeHtml(key) + ' <span style=\"font-size:12px;color:#9a9a9a;font-weight:500;\">' + groups[key].length + ' task' + (groups[key].length > 1 ? "s" : "") + '</span></h2>';
        var tasksDiv = document.createElement("div");
        tasksDiv.className = "category-tasks";
        groups[key].forEach(function (task) {
          var clone = task.cloneNode(true);
          clone.classList.add("bundle-clone");
          tasksDiv.appendChild(clone);
        });
        groupEl.appendChild(tasksDiv);
        bundleContainer.appendChild(groupEl);
      });
      bundleContainer.style.display = "block";
    } else {
      document.querySelectorAll(".category-section").forEach(function (s) { if (!s.classList.contains("bundle-group")) s.style.display = ""; });
      bundleContainer.style.display = "none";
    }

    var any = document.querySelectorAll(".task-item:not(.filter-hidden)").length > 0;
    var msg = document.getElementById("tps-filter-empty-msg");
    if (msg) msg.style.display = any ? "none" : "block";
    document.querySelectorAll(".category-section").forEach(function (section) {
      if (section.classList.contains("bundle-group")) return;
      var visible = section.querySelectorAll(".task-item:not(.filter-hidden)").length;
      section.classList.toggle("category-empty", visible === 0);
    });
  }

  // =============================================================
    // Phase 07 — branded 2-step modal system (replaces browser prompt/confirm)
    // =============================================================
    function tpsEscapeHtml(s) {
      return String(s == null ? "" : s).replace(/[&<>"\'`]/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "\'": "&#39;", "`": "&#96;" })[c];
      });
    }
  
    const MODAL_CONFIGS = {
      archive: {
        step1: { icon: "🗑", title: "Archive this task?", body: "You\'re cancelling this task. This is NOT the same as Done. It moves to the 📦 Archive tab, out of sight for good.", leftLabel: "Cancel", confirmLabel: "Discard task", confirmClass: "tps-mbtn-confirm-amber" },
        step2: { icon: "💬", title: "Leave a note for Maya", body: "Why is this being archived?", placeholder: "e.g. Vendor resolved it directly — no further action needed.", required: true, leftLabel: "Back", confirmLabel: "Confirm archive", confirmClass: "tps-mbtn-confirm-amber" }
      },
      gotit: {
        step1: { icon: "👁", title: "Got it?", body: "This task stays in Maya\'s queue — it\'s not cancelled. This will disappear from your dashboard.", leftLabel: "No", confirmLabel: "Yes", confirmClass: "tps-mbtn-confirm-neutral" },
        step2: { icon: "💬", title: "Leave a note for Maya", body: "Before this disappears, leave Maya a note if needed.", placeholder: "Optional — e.g. Tenant confirmed receipt, no further action needed.", required: false, leftLabel: "Skip", confirmLabel: "Done", confirmClass: "tps-mbtn-confirm-neutral" }
      },
      reject: {
        step1: { icon: "✗", title: "Reject this task?", body: "Maya will be notified, and this task will be removed from your dashboard.", leftLabel: "Cancel", confirmLabel: "Yes, reject", confirmClass: "tps-mbtn-confirm-danger" },
        step2: { icon: "💬", title: "Leave a note for Maya", body: "Why is this being rejected?", placeholder: "e.g. Vendor quote too high — Maya to find alternatives.", required: true, leftLabel: "Back", confirmLabel: "Confirm reject", confirmClass: "tps-mbtn-confirm-danger" }
      },
      remind: {
        step1: { icon: "⏰", title: "Set a reminder", body: "Pick a date and we\'ll remind you to follow up on this task.", datePicker: true, leftLabel: "Cancel", confirmLabel: "Set reminder", confirmClass: "tps-mbtn-confirm-gold" }
      }
    };
  
    function openTpsModal(opts) {
      return new Promise(function (resolve) {
        const cfg = MODAL_CONFIGS[opts.type];
        if (!cfg) { resolve(null); return; }
        const chip = (opts.property ? opts.property + " — " : "") + (opts.taskTitle || "");
        const wrap = document.createElement("div");
        wrap.className = "tps-modal-wrap";
        wrap.innerHTML = '<div class="tps-modal"></div>';
        document.body.appendChild(wrap);
        const modal = wrap.querySelector(".tps-modal");
        const stepData = {};
  
        function close(result) {
          document.removeEventListener("keydown", onKey);
          wrap.remove();
          resolve(result);
        }
        function onKey(e) { if (e.key === "Escape") close(null); }
        wrap.addEventListener("click", function (e) { if (e.target === wrap) close(null); });
        document.addEventListener("keydown", onKey);
  
        function renderStep(n) {
          const step = cfg["step" + n];
          let html = "";
          html += '<div class="tps-modal-icon">' + step.icon + '</div>';
          html += '<div class="tps-modal-title">' + tpsEscapeHtml(step.title) + '</div>';
          html += '<div class="tps-modal-chip">' + tpsEscapeHtml(chip) + '</div>';
          if (step.body) html += '<div class="tps-modal-body">' + tpsEscapeHtml(step.body) + '</div>';
          if (step.datePicker) {
            const tom = new Date(); tom.setDate(tom.getDate() + 1); tom.setHours(9, 0, 0, 0);
            const pad = function (x) { return x < 10 ? "0" + x : x; };
            const defVal = tom.getFullYear() + "-" + pad(tom.getMonth() + 1) + "-" + pad(tom.getDate()) + "T" + pad(tom.getHours()) + ":" + pad(tom.getMinutes());
            html += '<input type="datetime-local" class="tps-modal-date" value="' + defVal + '">';
          } else if (n === 2) {
            html += '<textarea class="tps-modal-textarea" placeholder="' + tpsEscapeHtml(step.placeholder || "") + '"' + (step.required ? " required" : "") + '></textarea>';
          }
          html += '<div class="tps-modal-btns">';
          const leftClass = (n === 1) ? "tps-mbtn-cancel" : "tps-mbtn-back";
          html += '<button type="button" class="' + leftClass + '">' + tpsEscapeHtml(step.leftLabel) + '</button>';
          html += '<button type="button" class="' + step.confirmClass + '">' + tpsEscapeHtml(step.confirmLabel) + '</button>';
          html += '</div>';
          modal.innerHTML = html;
  
          const leftBtn = modal.querySelector("." + leftClass);
          const confirmBtn = modal.querySelector("." + step.confirmClass);
          const textarea = modal.querySelector(".tps-modal-textarea");
          const dateInput = modal.querySelector(".tps-modal-date");
  
          if (textarea && step.required) {
            confirmBtn.disabled = true;
            textarea.addEventListener("input", function () { confirmBtn.disabled = textarea.value.trim().length === 0; });
          }
          if (textarea) setTimeout(function () { textarea.focus(); }, 50);
          else if (dateInput) setTimeout(function () { dateInput.focus(); }, 50);
  
          leftBtn.addEventListener("click", function () {
            if (n === 1) close(null);
            else if (opts.type === "gotit") { stepData.note = ""; close(stepData); }  // Skip on gotit step 2 = submit empty note
            else renderStep(1);  // Back
          });
  
          confirmBtn.addEventListener("click", function () {
            if (textarea) stepData.note = textarea.value.trim();
            if (dateInput) stepData.when = (dateInput.value || "").replace("T", " ");
            if (cfg.step2 && n === 1) renderStep(2);
            else close(stepData);
          });
        }
  
        renderStep(1);
      });
    }
  
    function handleActionClick(btn, modalType, apiAction) {
      const taskItem = btn.closest(".task-item");
      if (!taskItem) return;
      const taskId = btn.getAttribute("data-task-id") || taskItem.getAttribute("data-id");
      if (!taskId) return;
      const titleEl = taskItem.querySelector(".task-title");
      const taskTitle = titleEl ? titleEl.textContent.trim() : taskId;
      const propEl = taskItem.querySelector(".task-property");
      const property = propEl ? propEl.textContent.trim() : "";
      const actor = (typeof getViewerName === "function") ? getViewerName() : (localStorage.getItem(STORAGE_KEY_ACTOR) || DEFAULT_VIEWER_NAME);
      const originalLabel = btn.textContent;
  
      openTpsModal({ type: modalType, taskTitle: taskTitle, property: property }).then(function (result) {
        if (!result) return;
        btn.disabled = true;
        btn.textContent = "Saving…";
        let body;
        if (apiAction === "remindMe") {
          body = { id: taskId, title: (property ? property + " — " : "") + taskTitle, property: property, task: taskTitle, when: result.when, durationMin: 30, description: "Follow up on this task", by: actor, token: SECRET_TOKEN };
        } else if (apiAction === "update") {
          body = { id: taskId, property: property, task: taskTitle, status: "Rejected", note: result.note, by: actor, token: SECRET_TOKEN, source: "Dashboard" };
        } else {
          body = { id: taskId, by: actor, token: SECRET_TOKEN, property: property, task: taskTitle, note: result.note };
        }
        fetch(WEB_APP_URL + "?action=" + apiAction, { method: "POST", body: JSON.stringify(body) })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            const ok = res && (res.ok || res.eventId);
            if (ok) {
              if (apiAction === "remindMe") {
                btn.disabled = false;
                btn.textContent = originalLabel;
                alert("Reminder set! Calendar event created.");
              } else {
                if (taskItem) { taskItem.style.transition = "opacity 250ms"; taskItem.style.opacity = "0"; }
                setTimeout(function () { refreshTasks(); }, 300);
              }
            } else {
              alert("Could not complete action: " + ((res && (res.reason || res.error)) || "unknown error"));
              btn.disabled = false;
              btn.textContent = originalLabel;
            }
          })
          .catch(function (err) {
            alert("Network error: " + err.message);
            btn.disabled = false;
            btn.textContent = originalLabel;
          });
      });
    }
  
    function wireRejectModal() {
      document.querySelectorAll(".btn-reject").forEach(function (btn) {
        if (btn.dataset.wired === "1") return;
        // Clone wipes SWC\'s existing click listener (Round 3 confirm + triggerAction)
        const fresh = btn.cloneNode(true);
        btn.parentNode.replaceChild(fresh, btn);
        fresh.dataset.wired = "1";
        fresh.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          handleActionClick(fresh, "reject", "update");
        });
      });
    }
  
    function wireGotitButtons() {
    document.querySelectorAll(".btn-gotit").forEach(function (btn) {
      if (btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleActionClick(btn, "gotit", "gotit");
      });
    });
  }
  
    function wireRemindExpandedButtons() {
    document.querySelectorAll(".btn-remind-expanded").forEach(function (btn) {
      if (btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleActionClick(btn, "remind", "remindMe");
      });
    });
  }
  
    function wireArchiveButtons() {
    document.querySelectorAll(".btn-archive").forEach(function (btn) {
      if (btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleActionClick(btn, "archive", "archive");
      });
    });
  }

  // Global "coming soon" handler for Phase 06 Round 1 placeholder buttons (Got it, Remind me)
  if (!window.__tpsComingSoonWired) {
    window.__tpsComingSoonWired = true;
    document.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-soon='1']");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        alert("Coming soon — wiring up in the next round of button updates.");
      }
    }, true);
  }
  
    function openNoteModal(opts) {
      return new Promise(function (resolve) {
        const chip = (opts.property ? opts.property + " — " : "") + (opts.taskTitle || "");
        const wrap = document.createElement("div");
        wrap.className = "tps-modal-wrap";
        wrap.innerHTML = '<div class="tps-modal"></div>';
        document.body.appendChild(wrap);
        const modal = wrap.querySelector(".tps-modal");
        function close(result) { document.removeEventListener("keydown", onKey); wrap.remove(); resolve(result); }
        function onKey(e) { if (e.key === "Escape") close(null); }
        wrap.addEventListener("click", function (e) { if (e.target === wrap) close(null); });
        document.addEventListener("keydown", onKey);
        modal.innerHTML =
          '<div class="tps-modal-icon">💬</div>' +
          '<div class="tps-modal-title">Leave a note for Maya</div>' +
          '<div class="tps-modal-chip">' + tpsEscapeHtml(chip) + '</div>' +
          '<div class="tps-modal-body">' + tpsEscapeHtml(opts.sub || "") + '</div>' +
          '<textarea class="tps-modal-textarea" placeholder="' + tpsEscapeHtml(opts.placeholder || "") + '" required></textarea>' +
          '<div class="tps-modal-btns"><button type="button" class="tps-mbtn-cancel">Cancel</button><button type="button" class="tps-mbtn-confirm-gold">' + tpsEscapeHtml(opts.confirmLabel || "Save") + '</button></div>';
        const cancelBtn = modal.querySelector(".tps-mbtn-cancel");
        const confirmBtn = modal.querySelector(".tps-mbtn-confirm-gold");
        const ta = modal.querySelector(".tps-modal-textarea");
        confirmBtn.disabled = true;
        ta.addEventListener("input", function () { confirmBtn.disabled = ta.value.trim().length === 0; });
        setTimeout(function () { ta.focus(); }, 50);
        cancelBtn.addEventListener("click", function () { close(null); });
        confirmBtn.addEventListener("click", function () { const n = ta.value.trim(); if (n) close({ note: n }); });
      });
    }
  
    function handleSWCAction(btn, status, sub, placeholder, confirmLabel) {
      const taskItem = btn.closest(".task-item");
      if (!taskItem) return;
      const taskId = taskItem.getAttribute("data-id");
      if (!taskId) return;
      const titleEl = taskItem.querySelector(".task-title");
      const taskTitle = titleEl ? titleEl.textContent.trim() : taskId;
      const propEl = taskItem.querySelector(".task-property");
      const property = propEl ? propEl.textContent.trim() : "";
      const actor = (typeof getViewerName === "function") ? getViewerName() : (localStorage.getItem(STORAGE_KEY_ACTOR) || DEFAULT_VIEWER_NAME);
      const originalLabel = btn.textContent;
      openNoteModal({ taskTitle: taskTitle, property: property, sub: sub, placeholder: placeholder, confirmLabel: confirmLabel }).then(function (r) {
        if (!r) return;
        btn.disabled = true; btn.textContent = "Saving…";
        fetch(WEB_APP_URL + "?action=update", { method: "POST", body: JSON.stringify({ id: taskId, property: property, task: taskTitle, status: status, note: r.note, by: actor, token: SECRET_TOKEN, source: "Dashboard" }) })
          .then(function (resp) { return resp.json(); })
          .then(function (res) {
            if (res && res.ok) { setTimeout(function () { refreshTasks(); }, 200); }
            else { alert("Could not save: " + ((res && (res.reason || res.error)) || "unknown error")); btn.disabled = false; btn.textContent = originalLabel; }
          })
          .catch(function (err) { alert("Network error: " + err.message); btn.disabled = false; btn.textContent = originalLabel; });
      });
    }
  
    function wireSWCActionButtons() {
      const cfgs = [
        { sel: ".btn-tricia",  status: "Tricia on it",  sub: "What are you working on for this task?",        placeholder: "e.g. Calling the vendor today, will update by Friday",      confirmLabel: "Save" },
        { sel: ".btn-maya",    status: "Maya on it",    sub: "What are you working on for this task?",        placeholder: "e.g. Reached out to tenant, waiting on photo",            confirmLabel: "Save" },
        { sel: ".btn-approve", status: "Approved",      sub: "What are you approving? (vendor, cost, plan...)",   placeholder: "e.g. Approved Mike’s quote of $400 for the faucet",  confirmLabel: "Approve" },
        { sel: ".btn-done",    status: "Done",          sub: "Why is this done? What got resolved?",              placeholder: "e.g. Tenant confirmed leak fixed, photo received",        confirmLabel: "Mark Done" }
      ];
      cfgs.forEach(function (cfg) {
        document.querySelectorAll(cfg.sel).forEach(function (btn) {
          if (btn.dataset.wired === "1") return;
          const fresh = btn.cloneNode(true);  // wipes SWC's listener
          btn.parentNode.replaceChild(fresh, btn);
          fresh.dataset.wired = "1";
          fresh.addEventListener("click", function (e) {
            e.preventDefault(); e.stopPropagation();
            handleSWCAction(fresh, cfg.status, cfg.sub, cfg.placeholder, cfg.confirmLabel);
          });
        });
      });
    }
  
    function wireMoveHistoryToggle() {
      // Place SWC-appended chat-history INSIDE .task-expanded with the layout:
      //   ...task description / overlay / action buttons → chat thread → quick-note textarea → toggle (hide) at bottom.
      // SWC's own .open class controls visibility; the toggle hides/shows as the user expects.
      document.querySelectorAll(".task-item").forEach(function (item) {
        const expanded = item.querySelector(":scope > .task-expanded");
        if (!expanded) return;
        const noteSection = expanded.querySelector(":scope > .task-quick-note-section");
        const threadSelectors = [".tps-history-thread", ".tps-history-list", ".tps-chat", ".tps-chat-thread"];
        threadSelectors.forEach(function (sel) {
          const el = item.querySelector(":scope > " + sel);
          if (el && el.parentNode === item) {
            if (noteSection) {
              expanded.insertBefore(el, noteSection);
            } else {
              expanded.appendChild(el);
            }
          }
        });
        const toggle = item.querySelector(":scope > .tps-history-toggle");
        if (toggle && toggle.parentNode === item) {
          expanded.appendChild(toggle);
        }
        // Auto-trigger SWC fetch when the card is expanded so the user never sees a stuck "Loading…".
        // Watch this task-item's class list; when .expanded is added, simulate a toggle click
        // (SWC's handler is what kicks off the history fetch and renders bubbles).
        if (!item.__historyObs) {
          const autoOpenIfNeeded = function () {
            if (!item.classList.contains("expanded")) return;
            // Mark the current overlay note as seen and hide the "Note added" badge in place.
            // The next render will check localStorage and skip rendering the badge for this overlay text.
            try {
              const taskId = item.getAttribute("data-id");
              const overlay = item.dataset.overlayNote || "";
              if (taskId) {
                let seenMap = {};
                try { seenMap = JSON.parse(localStorage.getItem("tps_seen_notes") || "{}"); } catch (e) {}
                if (seenMap[taskId] !== overlay) {
                  seenMap[taskId] = overlay;
                  localStorage.setItem("tps_seen_notes", JSON.stringify(seenMap));
                  const badge = item.querySelector(".task-note-added-badge");
                  if (badge) badge.style.display = "none";
                }
              }
            } catch (e) {}
            const listEl = item.querySelector(".tps-history-list");
            const toggleBtn = item.querySelector(".tps-history-toggle");
            if (!listEl || !toggleBtn) return;
            if (listEl.classList.contains("open")) return;
            if (item.dataset.historyAutoOpened === "1") return;
            item.dataset.historyAutoOpened = "1";
            toggleBtn.click();
          };
          const obs = new MutationObserver(autoOpenIfNeeded);
          obs.observe(item, { attributes: true, attributeFilter: ["class"] });
          item.__historyObs = obs;
          autoOpenIfNeeded();
        }
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
      try { window.tpsComms.wireTasks();
      wireArchiveButtons();
      wireGotitButtons();
      wireRemindExpandedButtons();
      wireRejectModal();
      wireSWCActionButtons();
      wireMoveHistoryToggle(); }
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
    wireArchiveButtons();
    wireGotitButtons();
    wireRemindExpandedButtons();
    wireRejectModal();

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
