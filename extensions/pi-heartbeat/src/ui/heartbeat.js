// ── State ──────────────────────────────────────────────

let status = {};
let history = [];

// ── API ────────────────────────────────────────────────

async function api(method, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch("/api/heartbeat", opts);
  return res.json();
}

async function loadAll() {
  try {
    const data = await api("GET");
    status = data.status || {};
    history = data.history || [];
    render();
  } catch (e) {
    toast("Failed to load status", "error");
  }
}

// ── Render ─────────────────────────────────────────────

function render() {
  renderStatus();
  renderStats();
  renderLastResult();
  renderHistory();
}

function renderStatus() {
  const active = status.active;
  const running = status.running;
  const dotClass = running ? "running" : active ? "active" : "inactive";
  const label = running ? "Running Check…" : active ? "Active" : "Inactive";

  document.getElementById("statusDot").className = "status-dot " + dotClass;
  document.getElementById("statusText").textContent = label;

  const meta = [];
  meta.push(`<span>Interval: ${status.intervalMinutes ?? "—"}m</span>`);
  if (status.lastRun) {
    meta.push(`<span>Last: ${formatTime(status.lastRun)}</span>`);
  }
  document.getElementById("statusMeta").innerHTML = meta.join("");

  const btn = document.getElementById("toggleBtn");
  btn.textContent = active ? "⏸ Stop" : "▶ Start";
  btn.className = "btn btn-sm " + (active ? "btn-warning" : "btn-success");
}

function renderStats() {
  const runs = status.runCount ?? 0;
  const ok = status.okCount ?? 0;
  const alerts = status.alertCount ?? 0;
  const rate = runs > 0 ? ((ok / runs) * 100).toFixed(0) + "%" : "—";

  document.getElementById("statRuns").textContent = runs;
  document.getElementById("statOk").textContent = ok;
  document.getElementById("statAlerts").textContent = alerts;
  document.getElementById("statUptime").textContent = rate;
}

function renderLastResult() {
  const el = document.getElementById("lastResult");
  const contentEl = document.getElementById("lastResultContent");

  if (!status.lastResult) {
    el.className = "last-result";
    contentEl.innerHTML = '<span style="color: var(--fg3);">No checks yet. Click "Run Now" or start the heartbeat.</span>';
    return;
  }

  const r = status.lastResult;
  el.className = "last-result " + (r.ok ? "ok" : "alert");

  let html = "";
  if (r.ok) {
    html += '<span style="color: var(--green); font-weight: 600;">✅ HEARTBEAT_OK</span>';
  } else {
    html += '<span style="color: var(--red); font-weight: 600;">🫀 Alert</span>\n';
    html += esc(r.response);
  }

  const metaHtml =
    '<div class="last-result-meta">' +
    `<span>${formatDuration(r.durationMs)}</span>` +
    (status.lastRun ? `<span>${formatTime(status.lastRun)}</span>` : "") +
    "</div>";

  contentEl.innerHTML = html + metaHtml;
}

function renderHistory() {
  const container = document.getElementById("historyList");

  if (history.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No history yet</p></div>';
    return;
  }

  container.innerHTML = history
    .map(
      (h, i) => `
    <div class="history-entry" onclick="toggleExpand(this)">
      <div class="history-icon">${h.ok ? "✅" : "🫀"}</div>
      <div class="history-body">
        <div class="history-summary">
          <span class="history-status ${h.ok ? "ok" : "alert"}">${h.ok ? "OK" : "Alert"}</span>
          <span class="history-time">${formatTime(h.time)}</span>
          <span class="history-duration">${formatDuration(h.durationMs)}</span>
        </div>
        <div class="history-response">${h.ok ? "HEARTBEAT_OK" : esc(h.response)}</div>
      </div>
    </div>`,
    )
    .join("");
}

// ── Actions ────────────────────────────────────────────

async function toggleHeartbeat() {
  const action = status.active ? "stop" : "start";
  const res = await api("POST", { action });
  if (res.error) {
    toast(res.error, "error");
    return;
  }
  toast(res.message || `Heartbeat ${action}ed`, "success");
  await loadAll();
}

async function runNow() {
  const btn = document.getElementById("runBtn");
  btn.disabled = true;
  btn.textContent = "⟳ Running…";
  toast("Running heartbeat check…", "");

  try {
    const res = await api("POST", { action: "run" });
    if (res.error) {
      toast(res.error, "error");
    } else if (res.ok) {
      toast("✅ HEARTBEAT_OK (" + formatDuration(res.durationMs) + ")", "success");
    } else {
      toast("🫀 Alert: " + (res.response || "").slice(0, 100), "error");
    }
    await loadAll();
  } catch (e) {
    toast("Failed to run check", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Run Now";
  }
}

function toggleExpand(el) {
  el.classList.toggle("expanded");
}

// ── Helpers ────────────────────────────────────────────

function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function toast(msg, type) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show " + (type || "");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => (el.className = "toast"), 3000);
}

function formatTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();

  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (sameDay) return time;
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" }) + " " + time;
}

function formatDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return ms + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

// ── Init ───────────────────────────────────────────────

loadAll();
setInterval(loadAll, 15000);
