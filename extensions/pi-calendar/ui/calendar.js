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

const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_NAMES_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const HOURS_START = 6;
const HOURS_END = 23;
const MS_PER_DAY = 86400000;
const MAX_MONTH_EVENTS = 3; // max event chips per month-view cell

// ── State ──────────────────────────────────────────────

let currentView = 'week'; // 'week' | 'month' | 'year' | 'table'
let currentWeekStart = getWeekStart(new Date());
let currentMonthDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let currentYear = new Date().getFullYear();
let events = [];
let selectedColor = COLORS[0].value;

// Recurrence UI state
let selectedDows = new Set();
let selectedWeekPositions = new Set();
let selectedYearlyWeekPositions = new Set();
let exclusionDates = [];

// ── Date helpers ───────────────────────────────────────

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

function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
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

/** Get the Monday-based grid range for a month (always 42 cells = 6 rows). */
function getMonthGridRange(year, month) {
  const first = new Date(year, month, 1);
  const firstDay = first.getDay();
  const startOffset = firstDay === 0 ? -6 : 1 - firstDay;
  const gridStart = new Date(year, month, 1 + startOffset);
  gridStart.setHours(0, 0, 0, 0);
  const gridEnd = addDays(gridStart, 42);
  return { start: gridStart, end: gridEnd };
}

// ── View switching ─────────────────────────────────────

function switchView(view) {
  if (view === currentView) return;
  currentView = view;
  // Sync state: when switching, anchor to "today" context
  const now = new Date();
  if (view === 'week') currentWeekStart = getWeekStart(now);
  if (view === 'month') currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  if (view === 'year') currentYear = now.getFullYear();
  // Update button active state
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  loadAndRender();
}

// ── Navigation (view-aware) ────────────────────────────

function navPrev() {
  switch (currentView) {
    case 'week': currentWeekStart = addDays(currentWeekStart, -7); break;
    case 'month': currentMonthDate = addMonths(currentMonthDate, -1); break;
    case 'year': currentYear--; break;
    case 'table': currentMonthDate = addMonths(currentMonthDate, -1); break;
  }
  loadAndRender();
}

function navNext() {
  switch (currentView) {
    case 'week': currentWeekStart = addDays(currentWeekStart, 7); break;
    case 'month': currentMonthDate = addMonths(currentMonthDate, 1); break;
    case 'year': currentYear++; break;
    case 'table': currentMonthDate = addMonths(currentMonthDate, 1); break;
  }
  loadAndRender();
}

function navToday() {
  const now = new Date();
  currentWeekStart = getWeekStart(now);
  currentMonthDate = new Date(now.getFullYear(), now.getMonth(), 1);
  currentYear = now.getFullYear();
  loadAndRender();
}

// ── Period label ───────────────────────────────────────

function updatePeriodLabel() {
  const el = document.getElementById('periodLabel');
  const sel = document.getElementById('yearSelect');

  if (currentView === 'year') {
    el.style.display = 'none';
    sel.style.display = '';
    // Populate ±10 years around current
    const thisYear = new Date().getFullYear();
    const from = Math.min(currentYear, thisYear) - 5;
    const to = Math.max(currentYear, thisYear) + 5;
    sel.innerHTML = '';
    for (let y = from; y <= to; y++) {
      sel.innerHTML += `<option value="${y}"${y === currentYear ? ' selected' : ''}>${y}</option>`;
    }
  } else {
    el.style.display = '';
    sel.style.display = 'none';
    switch (currentView) {
      case 'week': {
        const end = addDays(currentWeekStart, 6);
        el.textContent = `${fmtDate(currentWeekStart)} — ${fmtDate(end)}, ${end.getFullYear()}`;
        break;
      }
      case 'month':
      case 'table':
        el.textContent = `${MONTH_NAMES[currentMonthDate.getMonth()]} ${currentMonthDate.getFullYear()}`;
        break;
    }
  }
}

function onYearSelectChange() {
  const sel = document.getElementById('yearSelect');
  currentYear = parseInt(sel.value);
  loadAndRender();
}

// ── Fetch range (view-aware) ───────────────────────────

function getViewRange() {
  switch (currentView) {
    case 'week':
      return { start: currentWeekStart, end: addDays(currentWeekStart, 7) };
    case 'month':
    case 'table': {
      const { start, end } = getMonthGridRange(currentMonthDate.getFullYear(), currentMonthDate.getMonth());
      return { start, end };
    }
    case 'year':
      return { start: new Date(currentYear, 0, 1), end: new Date(currentYear + 1, 0, 1) };
  }
}

// ── API ────────────────────────────────────────────────

async function fetchEvents() {
  const range = getViewRange();
  const start = range.start.toISOString();
  const end = range.end.toISOString();
  const res = await fetch(`/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  const rawEvents = await res.json();

  const expanded = [];
  for (const evt of rawEvents) {
    const rule = evt.recurrence_rule || null;
    expanded.push(evt);

    if (evt.recurrence) {
      const evtStart = new Date(evt.start_time);
      const evtEnd = new Date(evt.end_time);
      const durationMs = evtEnd - evtStart;
      const recurrences = generateRecurrences(evt, range.start, range.end);

      for (const rStart of recurrences) {
        if (rStart.getTime() === evtStart.getTime()) continue;
        const dateKey = toLocalISODate(rStart);
        const override = rule && rule.overrides ? rule.overrides[dateKey] : null;
        expanded.push({
          ...evt,
          _virtual: true,
          start_time: (override && override.start_time) || rStart.toISOString(),
          end_time: (override && override.end_time) || new Date(rStart.getTime() + durationMs).toISOString(),
          title: (override && override.title) || evt.title,
          description: (override && override.description !== undefined) ? override.description : evt.description,
        });
      }
    }
  }
  events = expanded;
}

// ── Recurrence expansion (client-side) ─────────────────

function generateRecurrences(evt, rangeStart, rangeEnd) {
  const originalStart = new Date(evt.start_time);
  const recurrence = evt.recurrence;
  const rule = evt.recurrence_rule || {};
  const interval = rule.interval || (recurrence === 'biweekly' ? 2 : 1);
  const exclusionSet = new Set(rule.exclusions || []);

  let effectiveEnd = new Date(rangeEnd);
  const ruleEnd = rule.endType === 'date' && rule.endDate
    ? new Date(rule.endDate + 'T23:59:59')
    : evt.recurrence_end ? new Date(evt.recurrence_end + 'T23:59:59') : null;
  if (ruleEnd && ruleEnd < effectiveEnd) effectiveEnd = ruleEnd;

  const maxCount = (rule.endType === 'count' && rule.count) ? rule.count : Infinity;
  const results = [];
  let totalCount = 0;
  const MAX_ITER = 10000;

  function collect(d) {
    if (d < originalStart) return true;
    totalCount++;
    if (totalCount > maxCount) return false;
    if (d >= effectiveEnd) return false;
    const dk = toLocalISODate(d);
    if (d >= rangeStart && !exclusionSet.has(dk)) results.push(new Date(d));
    return true;
  }

  switch (recurrence) {
    case 'daily': {
      const stepMs = interval * MS_PER_DAY;
      let cur = new Date(originalStart), i = 0;
      while (cur < effectiveEnd && i++ < MAX_ITER) { if (!collect(cur)) break; cur = new Date(cur.getTime() + stepMs); }
      break;
    }
    case 'weekly': case 'biweekly': {
      const daysOfWeek = (rule.daysOfWeek || [originalStart.getDay()]).slice().sort((a, b) => a - b);
      const weekInt = recurrence === 'biweekly' && !rule.interval ? 2 : interval;
      const baseMonday = getMondayOfWeek(originalStart);
      const msPerWeek = 7 * MS_PER_DAY;
      let weekNum = 0, iter = 0;
      while (iter++ < MAX_ITER) {
        const wm = new Date(baseMonday.getTime() + weekNum * msPerWeek);
        if (wm.getTime() > effectiveEnd.getTime() + 7 * MS_PER_DAY) break;
        for (const dow of daysOfWeek) {
          const dfm = dow === 0 ? 6 : dow - 1;
          const d = new Date(wm.getTime() + dfm * MS_PER_DAY);
          d.setHours(originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds(), 0);
          if (d >= effectiveEnd) break;
          if (!collect(d)) { iter = MAX_ITER; break; }
        }
        weekNum += weekInt;
      }
      break;
    }
    case 'monthly': {
      const byType = rule.byType || 'dayOfMonth';
      let mOff = 0, iter = 0;
      while (iter++ < MAX_ITER) {
        const tm = originalStart.getMonth() + mOff;
        const y = originalStart.getFullYear() + Math.floor(tm / 12);
        const m = ((tm % 12) + 12) % 12;
        const cands = [];
        if (byType === 'dayOfMonth') {
          const day = rule.dayOfMonth || originalStart.getDate();
          if (day <= new Date(y, m + 1, 0).getDate()) cands.push(new Date(y, m, day, originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds()));
        } else {
          const wd = rule.weekday != null ? rule.weekday : originalStart.getDay();
          for (const pos of (rule.weekPositions || [Math.ceil(originalStart.getDate() / 7)])) {
            const d = getNthWeekdayOfMonth(y, m, wd, pos);
            if (d) { d.setHours(originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds()); cands.push(d); }
          }
        }
        cands.sort((a, b) => a - b);
        for (const d of cands) { if (d >= effectiveEnd) { iter = MAX_ITER; break; } if (!collect(d)) { iter = MAX_ITER; break; } }
        mOff += interval;
        if (new Date(y, m, 1) > effectiveEnd) break;
      }
      break;
    }
    case 'yearly': {
      const byType = rule.byType || 'dayOfMonth';
      const tgtM = rule.month != null ? rule.month - 1 : originalStart.getMonth();
      let yOff = 0, iter = 0;
      while (iter++ < MAX_ITER) {
        const y = originalStart.getFullYear() + yOff;
        if (y > effectiveEnd.getFullYear() + 1) break;
        const cands = [];
        if (byType === 'dayOfMonth') {
          const day = rule.dayOfMonth || originalStart.getDate();
          if (day <= new Date(y, tgtM + 1, 0).getDate()) cands.push(new Date(y, tgtM, day, originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds()));
        } else {
          const wd = rule.weekday != null ? rule.weekday : originalStart.getDay();
          for (const pos of (rule.weekPositions || [Math.ceil(originalStart.getDate() / 7)])) {
            const d = getNthWeekdayOfMonth(y, tgtM, wd, pos);
            if (d) { d.setHours(originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds()); cands.push(d); }
          }
        }
        cands.sort((a, b) => a - b);
        for (const d of cands) { if (d >= effectiveEnd) { iter = MAX_ITER; break; } if (!collect(d)) { iter = MAX_ITER; break; } }
        yOff += interval;
      }
      break;
    }
  }
  return results;
}

function getMondayOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getNthWeekdayOfMonth(year, month, weekday, position) {
  if (position === -1) {
    const lastDay = new Date(year, month + 1, 0);
    const diff = (lastDay.getDay() - weekday + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }
  const first = new Date(year, month, 1);
  const firstWeekday = first.getDay();
  let day = 1 + ((weekday - firstWeekday + 7) % 7);
  day += (position - 1) * 7;
  if (day > new Date(year, month + 1, 0).getDate()) return null;
  return new Date(year, month, day);
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

// ── Event helpers ──────────────────────────────────────

/** Group events by date key (YYYY-MM-DD). */
function groupByDate(evts) {
  const map = {};
  for (const e of evts) {
    const s = new Date(e.start_time);
    const key = toLocalISODate(s);
    if (!map[key]) map[key] = [];
    map[key].push(e);
  }
  // Sort events within each day by start time
  for (const key in map) map[key].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  return map;
}

// ── Render dispatch ────────────────────────────────────

async function loadAndRender() {
  await fetchEvents();
  render();
}

function render() {
  updatePeriodLabel();
  const grid = document.getElementById('calGrid');
  grid.className = 'cal-grid'; // reset classes

  switch (currentView) {
    case 'week': grid.classList.add('week-view'); renderWeek(grid); break;
    case 'month': renderMonth(grid); break;
    case 'year': renderYear(grid); break;
    case 'table': renderTable(grid); break;
  }
}

// ═══════════════════════════════════════════════════════
// WEEK VIEW
// ═══════════════════════════════════════════════════════

function renderWeek(grid) {
  const today = new Date();
  let html = '';

  // Header
  html += '<div class="cal-header"><div class="cal-header-corner"></div>';
  for (let i = 0; i < 7; i++) {
    const day = addDays(currentWeekStart, i);
    html += `<div class="cal-day-header ${isSameDay(day, today) ? 'today' : ''}">
      <span class="day-name">${DAY_NAMES_SHORT[i]}</span>
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
    html += `<div class="cal-allday-cell" onclick="openCreateModalForDate(new Date(${day.getTime()}), true)">`;
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
      const day = addDays(currentWeekStart, d);
      html += `<div class="cal-cell" id="cell-${d}-${h}" onclick="openCreateModalForDate(new Date(${day.getTime()}), false, ${h})"></div>`;
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

// ═══════════════════════════════════════════════════════
// MONTH VIEW
// ═══════════════════════════════════════════════════════

function renderMonth(grid) {
  const today = new Date();
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const { start: gridStart } = getMonthGridRange(year, month);
  const byDate = groupByDate(events);

  let html = '<div class="month-grid">';

  // Day-name headers
  for (const name of DAY_NAMES_SHORT) {
    html += `<div class="month-header-cell">${name}</div>`;
  }

  // 42 day cells
  for (let i = 0; i < 42; i++) {
    const day = addDays(gridStart, i);
    const isOutside = day.getMonth() !== month;
    const isToday = isSameDay(day, today);
    const key = toLocalISODate(day);
    const dayEvts = byDate[key] || [];

    let cls = 'month-cell';
    if (isOutside) cls += ' outside';
    if (isToday) cls += ' today';

    html += `<div class="${cls}" onclick="onMonthCellClick(${day.getTime()})">`;
    html += `<div class="month-day-num">${day.getDate()}</div>`;

    const shown = dayEvts.slice(0, MAX_MONTH_EVENTS);
    for (const evt of shown) {
      const s = new Date(evt.start_time);
      const timeLabel = evt.all_day ? '' : fmtTime(s) + ' ';
      html += `<div class="month-event" style="background:${evt.color || COLORS[0].value}" onclick="event.stopPropagation(); openEditModal(${evt.id})" title="${esc(evt.title)}">${timeLabel}${esc(evt.title)}</div>`;
    }
    if (dayEvts.length > MAX_MONTH_EVENTS) {
      html += `<div class="month-more">+${dayEvts.length - MAX_MONTH_EVENTS} more</div>`;
    }

    html += '</div>';
  }

  html += '</div>';
  grid.innerHTML = html;
}

function onMonthCellClick(ts) {
  const day = new Date(ts);
  openCreateModalForDate(day, false, 9);
}

// ═══════════════════════════════════════════════════════
// YEAR VIEW
// ═══════════════════════════════════════════════════════

function renderYear(grid) {
  const today = new Date();
  const todayKey = toLocalISODate(today);
  const byDate = groupByDate(events);
  const thisMonth = today.getFullYear() === currentYear ? today.getMonth() : -1;
  const nowMonth = today.getFullYear() === currentYear ? today.getMonth() : 12;

  let html = '<div class="year-grid">';

  for (let m = 0; m < 12; m++) {
    const isCurrent = m === thisMonth;
    const isPast = m < nowMonth;

    // Count events for this month
    const firstOfMonth = new Date(currentYear, m, 1);
    const lastOfMonth = new Date(currentYear, m + 1, 0);
    let monthEventCount = 0;
    let d = new Date(firstOfMonth);
    while (d <= lastOfMonth) {
      const k = toLocalISODate(d);
      if (byDate[k]) monthEventCount += byDate[k].length;
      d = addDays(d, 1);
    }

    let cls = 'year-month';
    if (isCurrent) cls += ' current-month';
    else if (isPast) cls += ' past-month';

    html += `<div class="${cls}" onclick="goToMonth(${m})">`;
    html += '<div class="year-month-header">';
    html += `<div class="year-month-name">${MONTH_NAMES[m]}</div>`;
    if (monthEventCount > 0) {
      html += `<div class="year-month-count">${monthEventCount} event${monthEventCount !== 1 ? 's' : ''}</div>`;
    }
    html += '</div>';
    html += '<div class="mini-grid">';

    // Mini headers — mark weekends
    const miniDays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    for (let i = 0; i < 7; i++) {
      const isWeekend = i >= 5;
      html += `<div class="mini-header${isWeekend ? ' weekend' : ''}">${miniDays[i]}</div>`;
    }

    // Grid cells — padded to Monday start
    const { start: gStart } = getMonthGridRange(currentYear, m);
    for (let i = 0; i < 42; i++) {
      const day = addDays(gStart, i);
      const outside = day.getMonth() !== m;
      const key = toLocalISODate(day);
      const dayEvts = (!outside && byDate[key]) ? byDate[key] : [];
      const isToday = key === todayKey;
      const dow = (i % 7); // 0=Mon .. 6=Sun in our grid
      const isWeekend = dow >= 5;

      let dcls = 'mini-day';
      if (outside) dcls += ' outside';
      if (isToday) dcls += ' today';
      if (isWeekend && !outside) dcls += ' weekend';

      html += `<div class="${dcls}">`;
      html += `<span class="mini-day-num">${day.getDate()}</span>`;

      // Colored dots for events (max 3)
      if (dayEvts.length > 0) {
        html += '<div class="mini-dots">';
        const uniqueColors = [];
        for (const e of dayEvts) {
          const c = e.color || COLORS[0].value;
          if (!uniqueColors.includes(c)) uniqueColors.push(c);
          if (uniqueColors.length >= 3) break;
        }
        for (const c of uniqueColors) {
          html += `<div class="mini-dot" style="background:${c}"></div>`;
        }
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div></div>';
  }

  html += '</div>';
  grid.innerHTML = html;
}

function goToMonth(m) {
  currentMonthDate = new Date(currentYear, m, 1);
  currentView = 'month';
  document.querySelectorAll('.view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'month'));
  loadAndRender();
}

// ═══════════════════════════════════════════════════════
// TABLE / AGENDA VIEW
// ═══════════════════════════════════════════════════════

function renderTable(grid) {
  const today = new Date();
  const todayKey = toLocalISODate(today);
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  const byDate = groupByDate(events);

  // Collect only days within the month that have events
  const daysWithEvents = [];
  let d = new Date(firstOfMonth);
  while (d <= lastOfMonth) {
    const key = toLocalISODate(d);
    if (byDate[key] && byDate[key].length > 0) {
      daysWithEvents.push({ date: new Date(d), key, events: byDate[key] });
    }
    d = addDays(d, 1);
  }

  let html = '<div class="table-view">';

  if (daysWithEvents.length === 0) {
    html += '<div class="table-empty">No events this month</div>';
  }

  for (const dayGroup of daysWithEvents) {
    const isToday = dayGroup.key === todayKey;
    const dayName = DAY_NAMES_LONG[dayGroup.date.getDay()];
    const dateStr = dayGroup.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    // Relative label
    let relative = '';
    const diffDays = Math.round((dayGroup.date.setHours(0,0,0,0) - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / MS_PER_DAY);
    if (diffDays === 0) relative = 'Today';
    else if (diffDays === 1) relative = 'Tomorrow';
    else if (diffDays === -1) relative = 'Yesterday';
    else if (diffDays > 1 && diffDays <= 7) relative = `In ${diffDays} days`;
    else if (diffDays < -1 && diffDays >= -7) relative = `${Math.abs(diffDays)} days ago`;

    html += '<div class="table-day-group">';
    html += `<div class="table-day-header${isToday ? ' today' : ''}">`;
    html += `<span class="table-day-name">${dayName}</span>`;
    html += `<span class="table-day-date">${dateStr}</span>`;
    if (relative) html += `<span class="table-day-relative">${relative}</span>`;
    html += '</div>';

    for (const evt of dayGroup.events) {
      const s = new Date(evt.start_time);
      const e = new Date(evt.end_time);
      const timeStr = evt.all_day ? 'All day' : `${fmtTime(s)} – ${fmtTime(e)}`;
      const recLabel = evt.recurrence ? formatRecurrenceShort(evt) : '';

      html += `<div class="table-event" onclick="openEditModal(${evt.id})">`;
      html += `<div class="table-event-color" style="background:${evt.color || COLORS[0].value}"></div>`;
      html += `<span class="table-event-time">${timeStr}</span>`;
      html += `<span class="table-event-title">${esc(evt.title)}</span>`;
      if (recLabel) html += `<span class="table-event-recurrence">🔁 ${recLabel}</span>`;
      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div>';
  grid.innerHTML = html;
}

function formatRecurrenceShort(evt) {
  const r = evt.recurrence;
  const rule = evt.recurrence_rule || {};
  const interval = rule.interval || (r === 'biweekly' ? 2 : 1);
  switch (r) {
    case 'daily': return interval === 1 ? 'Daily' : `Every ${interval}d`;
    case 'weekly': return interval === 1 ? 'Weekly' : `Every ${interval}w`;
    case 'biweekly': return 'Bi-weekly';
    case 'monthly': return interval === 1 ? 'Monthly' : `Every ${interval}mo`;
    case 'yearly': return interval === 1 ? 'Yearly' : `Every ${interval}y`;
    default: return r || '';
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

// ── Recurrence UI helpers ──────────────────────────────

const UNIT_LABELS = { daily: 'day(s)', weekly: 'week(s)', biweekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' };

function onRecurrenceChange() {
  const rec = document.getElementById('evtRecurrence').value;
  const hasRec = !!rec;
  document.getElementById('intervalGroup').style.display = (rec && rec !== 'biweekly') ? 'block' : 'none';
  document.getElementById('weeklyGroup').style.display = (rec === 'weekly' || rec === 'biweekly') ? 'block' : 'none';
  document.getElementById('monthlyGroup').style.display = rec === 'monthly' ? 'block' : 'none';
  document.getElementById('yearlyGroup').style.display = rec === 'yearly' ? 'block' : 'none';
  document.getElementById('endConditionGroup').style.display = hasRec ? 'block' : 'none';
  document.getElementById('exclusionsGroup').style.display = hasRec ? 'block' : 'none';
  if (rec) document.getElementById('intervalUnit').textContent = UNIT_LABELS[rec] || 'period(s)';
  if ((rec === 'weekly' || rec === 'biweekly') && selectedDows.size === 0) {
    const sv = document.getElementById('evtStart').value || document.getElementById('evtStartDate').value;
    if (sv) { selectedDows.add(new Date(sv).getDay()); renderDowPicker(); }
  }
  if (rec === 'monthly') {
    const sv = document.getElementById('evtStart').value || document.getElementById('evtStartDate').value;
    if (sv) {
      const d = new Date(sv);
      document.getElementById('evtDayOfMonth').value = d.getDate();
      document.getElementById('evtWeekday').value = d.getDay();
      if (selectedWeekPositions.size === 0) { selectedWeekPositions.add(Math.ceil(d.getDate() / 7)); renderWeekPosPicker(); }
    }
  }
  if (rec === 'yearly') {
    const sv = document.getElementById('evtStart').value || document.getElementById('evtStartDate').value;
    if (sv) {
      const d = new Date(sv);
      document.getElementById('evtYearlyMonth').value = d.getMonth() + 1;
      document.getElementById('evtYearlyDayOfMonth').value = d.getDate();
      document.getElementById('evtYearlyWeekday').value = d.getDay();
      if (selectedYearlyWeekPositions.size === 0) { selectedYearlyWeekPositions.add(Math.ceil(d.getDate() / 7)); renderYearlyWeekPosPicker(); }
    }
  }
}

function onMonthlyTypeChange() {
  const type = document.querySelector('input[name="monthlyType"]:checked').value;
  document.getElementById('monthlyDayGroup').style.display = type === 'dayOfMonth' ? 'block' : 'none';
  document.getElementById('monthlyPositionGroup').style.display = type === 'weekPosition' ? 'block' : 'none';
}
function onYearlyTypeChange() {
  const type = document.querySelector('input[name="yearlyType"]:checked').value;
  document.getElementById('yearlyDayGroup').style.display = type === 'dayOfMonth' ? 'block' : 'none';
  document.getElementById('yearlyPositionGroup').style.display = type === 'weekPosition' ? 'block' : 'none';
}
function onEndTypeChange() {
  const endType = document.getElementById('evtEndType').value;
  document.getElementById('endCountGroup').style.display = endType === 'count' ? 'block' : 'none';
  document.getElementById('endDateGroup').style.display = endType === 'date' ? 'block' : 'none';
}

function toggleDow(dow) { if (selectedDows.has(dow)) selectedDows.delete(dow); else selectedDows.add(dow); renderDowPicker(); }
function renderDowPicker() { document.querySelectorAll('#dowPicker .dow-btn').forEach(btn => btn.classList.toggle('active', selectedDows.has(parseInt(btn.dataset.dow)))); }
function toggleWeekPos(pos) { if (selectedWeekPositions.has(pos)) selectedWeekPositions.delete(pos); else selectedWeekPositions.add(pos); renderWeekPosPicker(); }
function renderWeekPosPicker() { document.querySelectorAll('#weekPosPicker .weekpos-btn').forEach(btn => btn.classList.toggle('active', selectedWeekPositions.has(parseInt(btn.dataset.pos)))); }
function toggleYearlyWeekPos(pos) { if (selectedYearlyWeekPositions.has(pos)) selectedYearlyWeekPositions.delete(pos); else selectedYearlyWeekPositions.add(pos); renderYearlyWeekPosPicker(); }
function renderYearlyWeekPosPicker() { document.querySelectorAll('#yearlyWeekPosPicker .weekpos-btn').forEach(btn => btn.classList.toggle('active', selectedYearlyWeekPositions.has(parseInt(btn.dataset.pos)))); }

function addExclusion() {
  const input = document.getElementById('exclusionDate');
  const val = input.value;
  if (!val || exclusionDates.includes(val)) return;
  exclusionDates.push(val); exclusionDates.sort(); input.value = ''; renderExclusions();
}
function removeExclusion(date) { exclusionDates = exclusionDates.filter(d => d !== date); renderExclusions(); }
function renderExclusions() {
  document.getElementById('exclusionList').innerHTML = exclusionDates.map(d =>
    `<span class="exclusion-tag">${d}<span class="remove-excl" onclick="removeExclusion('${d}')">×</span></span>`
  ).join('');
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
  document.getElementById('evtReminder').value = defaults.reminder || '';
  document.getElementById('deleteBtn').style.display = defaults.showDelete ? 'inline-block' : 'none';
  selectedColor = defaults.color || COLORS[0].value;

  const rule = defaults.recurrenceRule || {};
  document.getElementById('evtInterval').value = rule.interval || 1;
  selectedDows = new Set(rule.daysOfWeek || []);
  selectedWeekPositions = new Set(rule.weekPositions || []);
  selectedYearlyWeekPositions = new Set(rule.yearlyWeekPositions || []);
  exclusionDates = (rule.exclusions || []).slice();

  const monthlyType = rule.byType || 'dayOfMonth';
  document.querySelectorAll('input[name="monthlyType"]').forEach(r => { r.checked = r.value === monthlyType; });
  document.getElementById('evtDayOfMonth').value = rule.dayOfMonth || '';
  document.getElementById('evtWeekday').value = rule.weekday != null ? rule.weekday : '';

  const yearlyType = rule.yearlyByType || 'dayOfMonth';
  document.querySelectorAll('input[name="yearlyType"]').forEach(r => { r.checked = r.value === yearlyType; });
  document.getElementById('evtYearlyMonth').value = rule.month || '';
  document.getElementById('evtYearlyDayOfMonth').value = rule.yearlyDayOfMonth || '';
  document.getElementById('evtYearlyWeekday').value = rule.yearlyWeekday != null ? rule.yearlyWeekday : '';

  document.getElementById('evtEndType').value = rule.endType || defaults.recurrenceEndType || 'never';
  document.getElementById('evtEndCount').value = rule.count || 10;
  document.getElementById('evtEndDate').value = rule.endDate || defaults.recurrenceEnd || '';

  toggleAllDay();
  onRecurrenceChange();
  onMonthlyTypeChange();
  onYearlyTypeChange();
  onEndTypeChange();
  renderDowPicker();
  renderWeekPosPicker();
  renderYearlyWeekPosPicker();
  renderExclusions();
  renderColors();

  document.getElementById('eventModal').classList.add('open');
  setTimeout(() => document.getElementById('evtTitle').focus(), 100);
}

function openCreateModal() {
  const now = new Date(); now.setMinutes(0, 0, 0);
  const end = new Date(now); end.setHours(end.getHours() + 1);
  resetModal({ start: toLocalISODatetime(now), end: toLocalISODatetime(end) });
}

/** Universal create-from-date — used by all views. */
function openCreateModalForDate(date, allDay, hour) {
  const start = new Date(date);
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
  const rule = evt.recurrence_rule || {};
  resetModal({
    title: 'Edit Event', id: evt.id, evtTitle: evt.title, desc: evt.description || '',
    allDay: evt.all_day,
    start: toLocalISODatetime(start), end: toLocalISODatetime(end),
    startDate: toLocalISODate(start), endDate: toLocalISODate(end),
    recurrence: evt.recurrence || '',
    recurrenceEnd: evt.recurrence_end || '',
    recurrenceEndType: rule.endType || (evt.recurrence_end ? 'date' : 'never'),
    reminder: evt.reminder_minutes != null ? String(evt.reminder_minutes) : '',
    color: evt.color || COLORS[0].value,
    showDelete: true,
    recurrenceRule: {
      interval: rule.interval || 1,
      daysOfWeek: rule.daysOfWeek || [],
      byType: rule.byType || 'dayOfMonth',
      dayOfMonth: rule.dayOfMonth || start.getDate(),
      weekPositions: rule.weekPositions || [],
      weekday: rule.weekday != null ? rule.weekday : start.getDay(),
      yearlyByType: rule.byType || 'dayOfMonth',
      month: rule.month || (start.getMonth() + 1),
      yearlyDayOfMonth: rule.dayOfMonth || start.getDate(),
      yearlyWeekPositions: rule.weekPositions || [],
      yearlyWeekday: rule.weekday != null ? rule.weekday : start.getDay(),
      endType: rule.endType || (evt.recurrence_end ? 'date' : 'never'),
      count: rule.count || 10,
      endDate: rule.endDate || evt.recurrence_end || '',
      exclusions: rule.exclusions || [],
    },
  });
}

function closeModal() { document.getElementById('eventModal').classList.remove('open'); }

function toggleAllDay() {
  const allDay = document.getElementById('evtAllDay').checked;
  document.getElementById('dateTimeRow').style.display = allDay ? 'none' : 'flex';
  document.getElementById('dateOnlyRow').style.display = allDay ? 'flex' : 'none';
}

function buildRecurrenceRule() {
  const rec = document.getElementById('evtRecurrence').value;
  if (!rec) return null;
  const rule = {};
  const interval = parseInt(document.getElementById('evtInterval').value) || 1;
  if (interval > 1 && rec !== 'biweekly') rule.interval = interval;
  if (rec === 'weekly' || rec === 'biweekly') {
    if (selectedDows.size > 0) rule.daysOfWeek = [...selectedDows].sort((a, b) => a - b);
  }
  if (rec === 'monthly') {
    const type = document.querySelector('input[name="monthlyType"]:checked').value;
    rule.byType = type;
    if (type === 'dayOfMonth') { const dom = parseInt(document.getElementById('evtDayOfMonth').value); if (dom) rule.dayOfMonth = dom; }
    else { if (selectedWeekPositions.size > 0) rule.weekPositions = [...selectedWeekPositions].sort((a, b) => a - b); const wd = parseInt(document.getElementById('evtWeekday').value); if (!isNaN(wd)) rule.weekday = wd; }
  }
  if (rec === 'yearly') {
    const month = parseInt(document.getElementById('evtYearlyMonth').value); if (month) rule.month = month;
    const type = document.querySelector('input[name="yearlyType"]:checked').value;
    rule.byType = type;
    if (type === 'dayOfMonth') { const dom = parseInt(document.getElementById('evtYearlyDayOfMonth').value); if (dom) rule.dayOfMonth = dom; }
    else { if (selectedYearlyWeekPositions.size > 0) rule.weekPositions = [...selectedYearlyWeekPositions].sort((a, b) => a - b); const wd = parseInt(document.getElementById('evtYearlyWeekday').value); if (!isNaN(wd)) rule.weekday = wd; }
  }
  const endType = document.getElementById('evtEndType').value;
  if (endType !== 'never') {
    rule.endType = endType;
    if (endType === 'count') rule.count = parseInt(document.getElementById('evtEndCount').value) || 10;
    else if (endType === 'date') rule.endDate = document.getElementById('evtEndDate').value || null;
  }
  if (exclusionDates.length > 0) rule.exclusions = exclusionDates.slice();
  return Object.keys(rule).length > 0 ? rule : null;
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
  const recurrence = document.getElementById('evtRecurrence').value || null;
  const recurrence_rule = buildRecurrenceRule();
  let recurrence_end = null;
  if (recurrence_rule && recurrence_rule.endType === 'date' && recurrence_rule.endDate) recurrence_end = recurrence_rule.endDate;
  const data = {
    title, description: document.getElementById('evtDesc').value.trim() || null,
    start_time, end_time, all_day: allDay, color: selectedColor,
    recurrence, recurrence_rule, recurrence_end,
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
  // Only auto-refresh if viewing a range that includes today
  if (currentView === 'week' && today >= currentWeekStart && today < addDays(currentWeekStart, 7)) render();
  if (currentView === 'month' && today.getMonth() === currentMonthDate.getMonth() && today.getFullYear() === currentMonthDate.getFullYear()) render();
}, 60000);
