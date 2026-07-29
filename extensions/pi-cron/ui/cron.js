// ── State ──────────────────────────────────────────────

let jobs = [];
let status = {};

// ── API ────────────────────────────────────────────────

async function api(method, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api/cron', opts);
  return res.json();
}

async function loadAll() {
  const data = await api('GET');
  jobs = data.jobs || [];
  status = data.status || {};
  render();
}

// ── Render ─────────────────────────────────────────────

function render() {
  renderStatus();
  renderStats();
  renderJobs();
}

function renderStatus() {
  const active = status.schedulerActive;
  document.getElementById('statusDot').className = 'status-dot ' + (active ? 'active' : 'inactive');
  document.getElementById('statusText').textContent = active ? 'Scheduler Active' : 'Scheduler Inactive';
  document.getElementById('statusMeta').innerHTML = [
    `<span>PID: ${status.pid || '—'}</span>`,
    status.lockHolder ? `<span>Lock: PID ${status.lockHolder}</span>` : '<span>Lock: free</span>',
    `<span>Jobs: ${status.jobCount ?? jobs.length}</span>`,
  ].join('');
  document.getElementById('toggleBtn').textContent = active ? '⏸ Stop' : '▶ Start';
  document.getElementById('toggleBtn').className = 'btn ' + (active ? 'btn-warning' : 'btn-success');
}

function renderStats() {
  const total = jobs.length;
  const active = jobs.filter(j => !j.disabled).length;
  const disabled = jobs.filter(j => j.disabled).length;
  const running = jobs.filter(j => j.running).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statActive').textContent = active;
  document.getElementById('statDisabled').textContent = disabled;
  document.getElementById('statRunning').textContent = running;
}

function renderJobs() {
  const container = document.getElementById('jobList');
  if (jobs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No cron jobs configured</p>
        <p style="margin-top: 8px; font-size: 12px; color: var(--fg3);">Click "+ New Job" to get started</p>
      </div>`;
    return;
  }

  container.innerHTML = jobs.map(j => {
    const statusClass = j.running ? 'running' : j.disabled ? 'disabled' : '';
    const badgeClass = j.running ? 'running' : j.disabled ? 'disabled' : 'active';
    const badgeText = j.running ? '⟳ Running' : j.disabled ? 'Disabled' : 'Active';
    const human = cronToHuman(j.schedule);

    return `
      <div class="job-card ${statusClass}">
        <div class="job-header">
          <span class="job-name">${esc(j.name)}</span>
          <span class="job-badge ${badgeClass}">${badgeText}</span>
          ${j.channel !== 'cron' ? `<span class="job-channel">${esc(j.channel)}</span>` : ''}
          <span class="spacer"></span>
        </div>
        <div>
          <span class="job-schedule">${esc(j.schedule)}</span>
          <span class="job-schedule-human">${esc(human)}</span>
        </div>
        <div class="job-prompt">${esc(j.prompt)}</div>
        <div class="job-actions">
          <button class="btn btn-sm" onclick="editJob('${esc(j.name)}')">✏️ Edit</button>
          ${j.disabled
            ? `<button class="btn btn-sm btn-success" onclick="toggleJob('${esc(j.name)}', false)">▶ Enable</button>`
            : `<button class="btn btn-sm btn-warning" onclick="toggleJob('${esc(j.name)}', true)">⏸ Disable</button>`}
          <button class="btn btn-sm" onclick="runJob('${esc(j.name)}')" ${!status.schedulerActive ? 'disabled title="Scheduler not active"' : ''}>▶ Run Now</button>
          <button class="btn btn-sm btn-danger" onclick="deleteJob('${esc(j.name)}')">🗑️ Delete</button>
        </div>
      </div>`;
  }).join('');
}

// ── Actions ────────────────────────────────────────────

async function toggleScheduler() {
  const action = status.schedulerActive ? 'stop' : 'start';
  const res = await api('POST', { action: 'scheduler', value: action });
  if (res.error) { toast(res.error, 'error'); return; }
  toast(res.message || `Scheduler ${action}ed`, 'success');
  await loadAll();
}

async function toggleJob(name, disable) {
  const res = await api('POST', { action: disable ? 'disable' : 'enable', name });
  if (!res.ok) { toast(res.message || 'Failed', 'error'); return; }
  toast(res.message, 'success');
  await loadAll();
}

async function runJob(name) {
  const res = await api('POST', { action: 'run', name });
  if (!res.ok) { toast(res.message || 'Failed', 'error'); return; }
  toast(res.message, 'success');
  setTimeout(loadAll, 500);
}

async function deleteJob(name) {
  if (!confirm(`Delete cron job "${name}"?`)) return;
  const res = await api('DELETE', { name });
  if (!res.ok) { toast(res.message || 'Failed', 'error'); return; }
  toast(res.message, 'success');
  await loadAll();
}

// ── Modal ──────────────────────────────────────────────

function showAddModal() {
  document.getElementById('modalTitle').textContent = 'New Cron Job';
  document.getElementById('jobFormName').value = '';
  document.getElementById('jobFormName').disabled = false;
  document.getElementById('jobFormSchedule').value = '';
  document.getElementById('jobFormPrompt').value = '';
  document.getElementById('jobFormChannel').value = 'cron';
  document.getElementById('jobFormMode').value = 'add';
  document.getElementById('jobModal').classList.add('show');
  setTimeout(() => document.getElementById('jobFormName').focus(), 100);
}

function editJob(name) {
  const job = jobs.find(j => j.name === name);
  if (!job) return;
  document.getElementById('modalTitle').textContent = 'Edit Cron Job';
  document.getElementById('jobFormName').value = job.name;
  document.getElementById('jobFormName').disabled = true;
  document.getElementById('jobFormSchedule').value = job.schedule;
  document.getElementById('jobFormPrompt').value = job.prompt;
  document.getElementById('jobFormChannel').value = job.channel;
  document.getElementById('jobFormMode').value = 'update';
  document.getElementById('jobModal').classList.add('show');
  setTimeout(() => document.getElementById('jobFormSchedule').focus(), 100);
}

function closeModal() {
  document.getElementById('jobModal').classList.remove('show');
}

async function saveJob(e) {
  e.preventDefault();
  const mode = document.getElementById('jobFormMode').value;
  const data = {
    action: mode,
    name: document.getElementById('jobFormName').value.trim(),
    schedule: document.getElementById('jobFormSchedule').value.trim(),
    prompt: document.getElementById('jobFormPrompt').value.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim(),
    channel: document.getElementById('jobFormChannel').value.trim() || 'cron',
  };
  if (!data.name || !data.schedule || !data.prompt) {
    toast('Name, schedule, and prompt are required', 'error');
    return;
  }
  const res = await api(mode === 'add' ? 'PUT' : 'PATCH', data);
  if (res.error || res.ok === false) {
    toast(res.error || res.message || 'Failed to save', 'error');
    return;
  }
  toast(res.message || 'Saved', 'success');
  closeModal();
  await loadAll();
}

// ── Helpers ────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (type || '');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.className = 'toast', 3000);
}

function cronToHuman(expr) {
  const [min, hour, dom, month, dow] = expr.split(/\s+/);

  // Common patterns
  if (expr === '* * * * *') return 'Every minute';
  if (min.startsWith('*/')) return `Every ${min.slice(2)} minutes`;
  if (hour === '*' && dom === '*' && month === '*' && dow === '*') return `At minute ${min}, every hour`;
  if (dom === '*' && month === '*' && dow === '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && month === '*' && dow === '1-5') return `Weekdays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && month === '*' && dow === '0,6') return `Weekends at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && month === '*' && dow === '0') return `Sundays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '*' && month === '*' && dow === '1') return `Mondays at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom === '1' && month === '*' && dow === '*') return `Monthly on the 1st at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (month === '*' && dow === '*') return `At ${hour.padStart(2, '0')}:${min.padStart(2, '0')} on day ${dom}`;

  // Dow names
  const dowNames = { '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat' };
  if (dom === '*' && month === '*' && dowNames[dow]) return `${dowNames[dow]} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  return expr;
}

// ── Keyboard ───────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !document.querySelector('.modal.show')) showAddModal();
});

// ── Init ───────────────────────────────────────────────

loadAll();
// Auto-refresh every 30s
setInterval(loadAll, 30000);
