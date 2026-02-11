// ── Constants ──────────────────────────────────────────

const COLORS = [
  { name: 'Purple', value: '#7c6ff0' },
  { name: 'Blue', value: '#60a5fa' },
  { name: 'Green', value: '#4ade80' },
  { name: 'Yellow', value: '#fbbf24' },
  { name: 'Red', value: '#f87171' },
  { name: 'Pink', value: '#f472b6' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Orange', value: '#fb923c' },
];

const HOURS_START = 6;
const HOURS_END = 23;

let currentWeekStart = getWeekStart(new Date());
let events = [];
let selectedColor = COLORS[0].value;

// ── Helpers ────────────────────────────────────────────

function getWeekStart(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(d) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function toLocalISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toLocalISODatetime(d) {
  return toLocalISODate(d) + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Navigation ─────────────────────────────────────────

function navWeek(dir) {
  if (dir === 0) {
    currentWeekStart = getWeekStart(new Date());
  } else {
    currentWeekStart = addDays(currentWeekStart, dir * 7);
  }
  loadAndRender();
}

// ── API ────────────────────────────────────────────────

async function fetchEvents() {
  const start = currentWeekStart.toISOString();
  const end = addDays(currentWeekStart, 7).toISOString();
  const res = await fetch(`/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  events = await res.json();

  const expanded = [];
  const weekEnd = addDays(currentWeekStart, 7);
  for (const evt of events) {
    expanded.push(evt);
    if (evt.recurrence) {
      const evtStart = new Date(evt.start_time);
      const evtEnd = new Date(evt.end_time);
      const durationMs = evtEnd - evtStart;
      const recEnd = evt.recurrence_end ? new Date(evt.recurrence_end + 'T23:59:59') : null;
      const recurrences = generateRecurrences(evtStart, evt.recurrence, currentWeekStart, weekEnd, recEnd);
      for (const rStart of recurrences) {
        if (rStart.getTime() === evtStart.getTime()) continue;
        expanded.push({
          ...evt,
          _virtual: true,
          start_time: rStart.toISOString(),
          end_time: new Date(rStart.getTime() + durationMs).toISOString(),
        });
      }
    }
  }
  events = expanded;
}

function generateRecurrences(originalStart, recurrence, rangeStart, rangeEnd, recurrenceEnd) {
  const dates = [];
  const effectiveEnd = recurrenceEnd && recurrenceEnd < rangeEnd ? recurrenceEnd : rangeEnd;
  const step = recurrence === 'daily' ? 1 : recurrence === 'weekly' ? 7 : recurrence === 'biweekly' ? 14 : 0;

  if (recurrence === 'monthly') {
    for (let i = -12; i < 24; i++) {
      const candidate = new Date(originalStart);
      candidate.setMonth(candidate.getMonth() + i);
      if (candidate >= rangeStart && candidate < effectiveEnd) dates.push(candidate);
    }
  } else if (step > 0) {
    let start = new Date(originalStart);
    while (start > rangeStart) start = addDays(start, -step);
    for (let cur = start; cur < effectiveEnd; cur = addDays(cur, step)) {
      if (cur >= rangeStart) dates.push(new Date(cur));
    }
  }
  return dates;
}

async function apiCreate(data) {
  const res = await fetch('/api/calendar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.json();
}

async function apiUpdate(data) {
  const res = await fetch('/api/calendar', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.json();
}

async function apiDelete(id) {
  const res = await fetch('/api/calendar', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  return res.json();
}

// ── Rendering ──────────────────────────────────────────

async function loadAndRender() {
  await fetchEvents();
  render();
}

function render() {
  const grid = document.getElementById('calGrid');
  const today = new Date();
  const weekEnd = addDays(currentWeekStart, 6);

  document.getElementById('weekLabel').textContent =
    `${fmtDate(currentWeekStart)} — ${fmtDate(weekEnd)}, ${weekEnd.getFullYear()}`;

  let html = '';

  // Header
  html += '<div class="cal-header"><div class="cal-header-corner"></div>';
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  for (let i = 0; i < 7; i++) {
    const day = addDays(currentWeekStart, i);
    html += `<div class="cal-day-header ${isSameDay(day, today) ? 'today' : ''}">
      <span class="day-name">${dayNames[i]}</span>
      <span class="day-num">${day.getDate()}</span></div>`;
  }
  html += '</div>';

  // All-day row
  html += '<div class="cal-allday-row"><div class="cal-allday-label">ALL<br>DAY</div>';
  for (let i = 0; i < 7; i++) {
    const day = addDays(currentWeekStart, i);
    const dayEvents = events.filter(e => {
      if (!e.all_day) return false;
      const s = new Date(e.start_time), en = new Date(e.end_time);
      return day >= new Date(s.getFullYear(), s.getMonth(), s.getDate()) &&
             day <= new Date(en.getFullYear(), en.getMonth(), en.getDate());
    });
    html += `<div class="cal-allday-cell" onclick="openCreateModalAt(${i}, null, true)">`;
    for (const evt of dayEvents) {
      const bell = evt.reminder_minutes ? '🔔 ' : '';
      html += `<div class="allday-chip" style="background:${evt.color || COLORS[0].value}" onclick="event.stopPropagation(); openEditModal(${evt.id})">${bell}${esc(evt.title)}</div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  // Time slots
  html += '<div class="cal-body">';
  for (let h = HOURS_START; h <= HOURS_END; h++) {
    html += '<div class="cal-time-slot">';
    html += `<div class="cal-time-label">${String(h).padStart(2, '0')}:00</div>`;
    for (let d = 0; d < 7; d++) {
      html += `<div class="cal-cell" id="cell-${d}-${h}" onclick="openCreateModalAt(${d}, ${h})"></div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  grid.innerHTML = html;

  // Place timed event chips
  for (const evt of events.filter(e => !e.all_day)) {
    const start = new Date(evt.start_time), end = new Date(evt.end_time);

    for (let d = 0; d < 7; d++) {
      const day = addDays(currentWeekStart, d);
      if (!isSameDay(start, day) && !isSameDay(end, day) && !(start < day && end > addDays(day, 1))) continue;

      let startHour = isSameDay(start, day) ? start.getHours() + start.getMinutes() / 60 : 0;
      let endHour = isSameDay(end, day) ? end.getHours() + end.getMinutes() / 60 : 24;
      startHour = Math.max(startHour, HOURS_START);
      endHour = Math.min(endHour, HOURS_END + 1);
      if (endHour <= startHour) continue;

      const cellHeight = 48;
      const height = Math.max((endHour - startHour) * cellHeight, 18);
      const targetHour = Math.max(Math.floor(startHour), HOURS_START);
      const targetCell = document.getElementById(`cell-${d}-${targetHour}`);
      if (!targetCell) continue;

      const chip = document.createElement('div');
      chip.className = 'event-chip' + (height > 36 ? ' multi-line' : '');
      chip.style.background = evt.color || COLORS[0].value;
      chip.style.top = ((startHour - targetHour) * cellHeight) + 'px';
      chip.style.height = height + 'px';

      const timeStr = fmtTime(start) + '–' + fmtTime(end);
      const bell = evt.reminder_minutes ? '🔔 ' : '';
      chip.innerHTML = height > 36
        ? `<div>${bell}${esc(evt.title)}</div><div class="chip-time">${timeStr}</div>`
        : `<span class="chip-time">${fmtTime(start)}</span> ${bell}${esc(evt.title)}`;

      chip.onclick = (e) => { e.stopPropagation(); openEditModal(evt.id); };
      targetCell.style.position = 'relative';
      targetCell.appendChild(chip);
    }
  }

  // Now line
  if (today >= currentWeekStart && today < addDays(currentWeekStart, 7)) {
    const dayIndex = (today.getDay() + 6) % 7;
    const nowHour = today.getHours() + today.getMinutes() / 60;
    if (nowHour >= HOURS_START && nowHour <= HOURS_END + 1) {
      const targetCell = document.getElementById(`cell-${dayIndex}-${Math.max(Math.floor(nowHour), HOURS_START)}`);
      if (targetCell) {
        const line = document.createElement('div');
        line.className = 'now-line';
        line.style.top = ((nowHour - Math.max(Math.floor(nowHour), HOURS_START)) * 48) + 'px';
        targetCell.style.position = 'relative';
        targetCell.appendChild(line);
      }
    }
  }
}

// ── Color picker ───────────────────────────────────────

function renderColors() {
  document.getElementById('colorOptions').innerHTML = COLORS.map(c =>
    `<div class="color-swatch ${c.value === selectedColor ? 'selected' : ''}"
          style="background:${c.value}" title="${c.name}"
          onclick="selectColor('${c.value}')"></div>`
  ).join('');
}

function selectColor(c) {
  selectedColor = c;
  renderColors();
}

// ── Modal ──────────────────────────────────────────────

function resetModal(defaults) {
  document.getElementById('modalTitle').textContent = defaults.title || 'New Event';
  document.getElementById('evtId').value = defaults.id || '';
  document.getElementById('evtTitle').value = defaults.evtTitle || '';
  document.getElementById('evtDesc').value = defaults.desc || '';
  document.getElementById('evtAllDay').checked = !!defaults.allDay;
  document.getElementById('evtStart').value = defaults.start || '';
  document.getElementById('evtEnd').value = defaults.end || '';
  document.getElementById('evtStartDate').value = defaults.startDate || '';
  document.getElementById('evtEndDate').value = defaults.endDate || '';
  document.getElementById('evtRecurrence').value = defaults.recurrence || '';
  document.getElementById('evtRecurrenceEndType').value = defaults.recurrenceEndType || 'forever';
  document.getElementById('evtRecurrenceEnd').value = defaults.recurrenceEnd || '';
  document.getElementById('evtReminder').value = defaults.reminder || '';
  document.getElementById('deleteBtn').style.display = defaults.showDelete ? 'inline-block' : 'none';
  selectedColor = defaults.color || COLORS[0].value;
  toggleAllDay();
  toggleRecurrenceEnd();
  if (defaults.recurrenceEndType === 'date') toggleRecurrenceEndDate();
  renderColors();
  document.getElementById('eventModal').classList.add('open');
  setTimeout(() => document.getElementById('evtTitle').focus(), 100);
}

function openCreateModal() {
  const now = new Date(); now.setMinutes(0, 0, 0);
  const end = new Date(now); end.setHours(end.getHours() + 1);
  resetModal({ start: toLocalISODatetime(now), end: toLocalISODatetime(end) });
}

function openCreateModalAt(dayIndex, hour, allDay) {
  const day = addDays(currentWeekStart, dayIndex);
  const start = new Date(day);
  start.setHours(hour != null ? hour : 9, 0, 0, 0);
  const end = new Date(start);
  if (allDay) end.setDate(end.getDate() + 1); else end.setHours(end.getHours() + 1);
  resetModal({
    allDay: !!allDay,
    start: toLocalISODatetime(start), end: toLocalISODatetime(end),
    startDate: toLocalISODate(start), endDate: toLocalISODate(end),
  });
}

function openEditModal(id) {
  const evt = events.find(e => e.id === id);
  if (!evt) return;
  const start = new Date(evt.start_time), end = new Date(evt.end_time);
  resetModal({
    title: 'Edit Event', id: evt.id, evtTitle: evt.title, desc: evt.description || '',
    allDay: evt.all_day,
    start: toLocalISODatetime(start), end: toLocalISODatetime(end),
    startDate: toLocalISODate(start), endDate: toLocalISODate(end),
    recurrence: evt.recurrence || '',
    recurrenceEndType: evt.recurrence_end ? 'date' : 'forever',
    recurrenceEnd: evt.recurrence_end || '',
    reminder: evt.reminder_minutes != null ? String(evt.reminder_minutes) : '',
    color: evt.color || COLORS[0].value,
    showDelete: true,
  });
}

function closeModal() { document.getElementById('eventModal').classList.remove('open'); }

function toggleAllDay() {
  const allDay = document.getElementById('evtAllDay').checked;
  document.getElementById('dateTimeRow').style.display = allDay ? 'none' : 'flex';
  document.getElementById('dateOnlyRow').style.display = allDay ? 'flex' : 'none';
}

function toggleRecurrenceEnd() {
  const has = !!document.getElementById('evtRecurrence').value;
  document.getElementById('recurrenceEndGroup').style.display = has ? 'block' : 'none';
  if (!has) {
    document.getElementById('evtRecurrenceEndType').value = 'forever';
    document.getElementById('evtRecurrenceEnd').value = '';
    document.getElementById('evtRecurrenceEnd').style.display = 'none';
  }
}

function toggleRecurrenceEndDate() {
  const isDate = document.getElementById('evtRecurrenceEndType').value === 'date';
  document.getElementById('evtRecurrenceEnd').style.display = isDate ? 'block' : 'none';
  if (!isDate) document.getElementById('evtRecurrenceEnd').value = '';
}

async function saveEvent() {
  const id = document.getElementById('evtId').value;
  const title = document.getElementById('evtTitle').value.trim();
  if (!title) { document.getElementById('evtTitle').focus(); return; }

  const allDay = document.getElementById('evtAllDay').checked;
  let start_time, end_time;
  if (allDay) {
    start_time = new Date(document.getElementById('evtStartDate').value + 'T00:00:00').toISOString();
    end_time = new Date(document.getElementById('evtEndDate').value + 'T23:59:59').toISOString();
  } else {
    start_time = new Date(document.getElementById('evtStart').value).toISOString();
    end_time = new Date(document.getElementById('evtEnd').value).toISOString();
  }

  const data = {
    title,
    description: document.getElementById('evtDesc').value.trim() || null,
    start_time, end_time, all_day: allDay, color: selectedColor,
    recurrence: document.getElementById('evtRecurrence').value || null,
    recurrence_end: document.getElementById('evtRecurrenceEnd').value || null,
    reminder_minutes: document.getElementById('evtReminder').value ? parseInt(document.getElementById('evtReminder').value) : null,
  };

  if (id) await apiUpdate({ id: parseInt(id), ...data }); else await apiCreate(data);
  closeModal();
  loadAndRender();
}

async function deleteEvent() {
  const id = document.getElementById('evtId').value;
  if (!id || !confirm('Delete this event?')) return;
  await apiDelete(parseInt(id));
  closeModal();
  loadAndRender();
}

// ── Keyboard shortcuts ─────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'n' && !e.ctrlKey && !e.metaKey && !document.querySelector('.modal-overlay.open')) openCreateModal();
});

// ── Init ───────────────────────────────────────────────

renderColors();
loadAndRender();
setInterval(() => {
  const today = new Date();
  if (today >= currentWeekStart && today < addDays(currentWeekStart, 7)) render();
}, 60000);
