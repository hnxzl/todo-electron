'use strict';

/**
 * Kalender Task Manager — renderer.js v2
 * Fitur: Multi-view | Holiday API | Priority | Subtask | Reminder | Detail Panel | Quick Input
 * Vanilla JS — tanpa framework, DOM update minimal
 */

// ============================================================
// CONSTANTS
// ============================================================

const STORAGE_TASKS    = 'ctm_tasks_v2';
const STORAGE_STICKIES = 'ctm_stickies_v2';
const STORAGE_LAYOUT   = 'ctm_sticky_layout';
const STORAGE_HOLIDAYS = 'ctm_holidays_v2_'; // + year suffix (v2 = libur.deno.dev)
// Sumber: https://libur.deno.dev | https://github.com/radyakaze/api-hari-libur
const HOLIDAY_API      = 'https://libur.deno.dev/api?year={year}';

const MONTHS_ID   = ['Januari','Februari','Maret','April','Mei','Juni',
                     'Juli','Agustus','September','Oktober','November','Desember'];
const DAYS_SHORT  = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const DAYS_FULL   = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

const PRIO_LABEL  = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
const CAT_LABEL   = { work: 'Kerja', personal: 'Pribadi', urgent: 'Mendesak' };

const REPEAT_LABEL = { none: 'Tidak ada', daily: 'Setiap hari', weekly: 'Setiap minggu', monthly: 'Setiap bulan' };

// ============================================================
// STATE
// ============================================================

const state = {
  year:         new Date().getFullYear(),
  month:        new Date().getMonth(),
  view:         'monthly',  // 'monthly' | 'weekly' | 'agenda'
  weekOffset:   0,          // minggu ke-N dari minggu ini
  tasks:        {},         // { "YYYY-MM-DD": [task, ...] }
  holidays:     {},         // { "YYYY-MM-DD": "Nama Libur" }
  filters:      { work: true, personal: true, urgent: true },
  prioFilters:  { high: true, medium: true, low: true },
  selectedDate: null,       // untuk modal tambah/edit
  editingTask:  null,       // { dateStr, taskId } | null (null = mode tambah)
  detailTask:   null,       // { dateStr, taskId } | null
  dragData:     null,
  stickies:     [],         // array of { id, text, color, x, y }
  scatteredLayout: false,   // false=grid, true=scattered (berantakan)
};

// ============================================================
// STORAGE
// ============================================================

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_TASKS);
    const parsed = raw ? JSON.parse(raw) : {};
    // Migrasi task lama (v1 schema → v2)
    state.tasks = {};
    for (const [date, tasks] of Object.entries(parsed)) {
      state.tasks[date] = Array.isArray(tasks) ? tasks.map(migrateTask) : [];
    }
  } catch {
    state.tasks = {};
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_TASKS, JSON.stringify(state.tasks));
  } catch {
    console.warn('[CTM] Gagal simpan localStorage');
  }
}

function loadStickies() {
  try {
    const raw = localStorage.getItem(STORAGE_STICKIES);
    state.stickies = raw ? JSON.parse(raw) : [];
  } catch { state.stickies = []; }
}

function saveStickies() {
  try { localStorage.setItem(STORAGE_STICKIES, JSON.stringify(state.stickies)); } catch {}
}

/**
 * Migrasi task lama ke schema v2 (backward compatible)
 */
function migrateTask(t) {
  return {
    id:             t.id        || genId(),
    text:           t.text      || '',
    cat:            t.cat       || 'work',
    priority:       t.priority  || 'medium',
    done:           t.done      || false,
    subtasks:       Array.isArray(t.subtasks) ? t.subtasks : [],
    reminder:       t.reminder  || null,
    reminderRepeat: t.reminderRepeat || 'none',
    reminderLastFired: t.reminderLastFired || null,
    createdAt:      t.createdAt || new Date().toISOString(),
  };
}

// ============================================================
// HOLIDAYS
// ============================================================

async function loadHolidays(year) {
  const key = STORAGE_HOLIDAYS + year;
  try {
    const cached = localStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      Object.assign(state.holidays, parsed);
      return;
    }
  } catch {}

  // Fetch via Electron main process (bypass CORS)
  if (!window.electronAPI) return;
  try {
    const url = HOLIDAY_API.replace('{year}', year);
    const result = await window.electronAPI.fetchUrl(url);
    if (result && result.ok && Array.isArray(result.data)) {
      const map = {};
      // Format libur.deno.dev: { date: "YYYY-MM-DD", name: "Nama Libur" }
      result.data.forEach(h => {
        if (map[h.date]) {
          // Gabungkan jika ada > 1 libur di tanggal sama (cuti bersama setelah hari raya)
          map[h.date] += ' & ' + h.name;
        } else {
          map[h.date] = h.name;
        }
      });
      // Cache ke localStorage
      localStorage.setItem(key, JSON.stringify(map));
      Object.assign(state.holidays, map);
      // Re-render kalender setelah data libur dimuat
      renderCurrentView();
      updateHolidayInfoSidebar();
    }
  } catch {}
}

function isHoliday(dateStr) {
  return !!state.holidays[dateStr];
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isRedDay(dateStr) {
  return isHoliday(dateStr) || isWeekend(dateStr);
}

function updateHolidayInfoSidebar() {
  // Tampilkan libur bulan ini di sidebar
  const { year, month } = state;
  const mm = String(month + 1).padStart(2, '0');
  const prefix = `${year}-${mm}-`;
  
  const thisMonthHolidays = Object.entries(state.holidays)
    .filter(([d]) => d.startsWith(prefix))
    .map(([d, name]) => {
      const day = parseInt(d.split('-')[2], 10);
      return `<div class="holiday-item"><span class="holiday-date">${day}</span> <span class="holiday-name">${name}</span></div>`;
    });

  const el = document.getElementById('holidayInfo');
  const txt = document.getElementById('holidayInfoText');
  if (thisMonthHolidays.length > 0) {
    txt.innerHTML = `<div class="holiday-list">${thisMonthHolidays.join('')}</div>`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// ============================================================
// UTILS
// ============================================================

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const dObj = new Date(y, m - 1, d);
  return `${DAYS_FULL[dObj.getDay()]}, ${d} ${MONTHS_ID[m - 1]} ${y}`;
}

function getTodayKey() {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

/** Mendapatkan tanggal awal minggu (Minggu) dari weekOffset */
function getWeekStart(offset = 0) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const sundayMs = now.getTime() - day * 86400000;
  return new Date(sundayMs + offset * 7 * 86400000);
}

function formatReminderDisplay(reminderStr) {
  if (!reminderStr) return '';
  try {
    const d = new Date(reminderStr);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm2 = String(d.getMinutes()).padStart(2, '0');
    return `${d.getDate()}/${d.getMonth()+1} ${hh}:${mm2}`;
  } catch { return ''; }
}

function getFilteredTasks(dateStr) {
  const tasks = state.tasks[dateStr] || [];
  return tasks.filter(t =>
    state.filters[t.cat] !== false &&
    state.prioFilters[t.priority] !== false
  );
}

// ============================================================
// DOM CACHE
// ============================================================

const $ = id => document.getElementById(id);

const DOM = {
  // Views
  viewMonthly:      $('viewMonthly'),
  viewWeekly:       $('viewWeekly'),
  viewAgenda:       $('viewAgenda'),
  viewNotepad:      $('viewNotepad'),
  boardGrid:        $('boardGrid'),
  btnOpenNotepad:   $('btnOpenNotepad'),
  btnAddSticky:     $('btnAddSticky'),
  btnLayoutToggle:  $('btnLayoutToggle'),
  layoutLabel:      $('layoutLabel'),
  calendarGrid:     $('calendarGrid'),
  weeklyDayHeaders: $('weeklyDayHeaders'),
  weeklyGrid:       $('weeklyGrid'),
  agendaList:       $('agendaList'),
  // Sidebar
  monthName:        $('monthName'),
  yearName:         $('yearName'),
  statTotal:        $('statTotal'),
  statDone:         $('statDone'),
  statHigh:         $('statHigh'),
  statPending:      $('statPending'),
  // Modal
  modalOverlay:     $('modalOverlay'),
  taskInput:        $('taskInput'),
  modalDateDisplay: $('modalDateDisplay'),
  modalTitle:       $('modalTitle'),
  reminderInput:    $('reminderInput'),
  reminderRepeat:   $('reminderRepeat'),
  // Detail panel
  detailPanel:      $('detailPanel'),
  detailBody:       $('detailBody'),
  // Toast
  toast:            $('toast'),
  // Controls
  btnPin:           $('btnPin'),
  btnMinimize:      $('btnMinimize'),
  btnClose:         $('btnClose'),
};

// ============================================================
// REMINDER SYSTEM
// ============================================================

let _reminderInterval = null;

function startReminderPolling() {
  checkReminders(); // langsung cek saat start
  _reminderInterval = setInterval(checkReminders, 30_000); // setiap 30 detik
}

function checkReminders() {
  const now = new Date();
  const nowMs = now.getTime();
  let changed = false;

  for (const [dateStr, tasks] of Object.entries(state.tasks)) {
    tasks.forEach(task => {
      if (!task.reminder || task.done) return;

      const reminderMs = new Date(task.reminder).getTime();
      if (isNaN(reminderMs)) return;

      // Cek apakah sudah waktunya (dalam window 35 detik)
      const diffMs = nowMs - reminderMs;
      if (diffMs >= 0 && diffMs < 35_000) {
        // Apakah sudah pernah dikirimkan?
        if (task.reminderLastFired && (nowMs - new Date(task.reminderLastFired).getTime()) < 60_000) return;

        // Tampilkan notifikasi
        fireReminder(task, dateStr);
        task.reminderLastFired = now.toISOString();

        // Jadwal ulang jika berulang
        if (task.reminderRepeat !== 'none') {
          task.reminder = calcNextReminder(task.reminder, task.reminderRepeat);
        }
        changed = true;
      }
    });
  }

  if (changed) saveTasks();
}

function fireReminder(task, dateStr) {
  doNotify(task, dateStr);
}

function doNotify(task, dateStr) {
  const prioLabel = { high: '[Tinggi]', medium: '[Sedang]', low: '[Rendah]' }[task.priority] || '';
  const title = `Pengingat Task ${prioLabel}`;
  const body  = `${task.text}\n${formatDisplayDate(dateStr)}`;
  
  // Gunakan Native Windows Notification jika tersedia di desktop
  if (window.electronAPI && window.electronAPI.showNotification) {
    window.electronAPI.showNotification({ title, body });
    // Juga mainkan suara alarm di web sebagai penekanan
    playAlarmSound();
  } else {
    // Fallback web
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') {
          new Notification(title, { body, silent: false });
          playAlarmSound();
        }
      });
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body, silent: false });
      playAlarmSound();
    }
  }
}

// Fungsi sederhana untuk menghasilkan suara beep/alarm menggunakan Web Audio API
function playAlarmSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Bunyi 1
    const osc1 = audioCtx.createOscillator();
    const gainNode1 = audioCtx.createGain();
    osc1.connect(gainNode1);
    gainNode1.connect(audioCtx.destination);
    
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, audioCtx.currentTime);
    gainNode1.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode1.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc1.start();
    osc1.stop(audioCtx.currentTime + 0.3);
    
    // Bunyi 2
    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gainNode2 = audioCtx.createGain();
      osc2.connect(gainNode2);
      gainNode2.connect(audioCtx.destination);
      
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1000, audioCtx.currentTime);
      gainNode2.gain.setValueAtTime(0.5, audioCtx.currentTime);
      gainNode2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc2.start();
      osc2.stop(audioCtx.currentTime + 0.3);
    }, 200);

  } catch (e) {
    // Abaikan jika tidak didukung
  }
}

function calcNextReminder(reminderStr, repeat) {
  const d = new Date(reminderStr);
  switch (repeat) {
    case 'daily':   d.setDate(d.getDate() + 1); break;
    case 'weekly':  d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
  }
  return d.toISOString().slice(0, 16);
}

// ============================================================
// VIEW MANAGEMENT
// ============================================================

function switchView(viewName) {
  state.view = viewName;

  DOM.viewMonthly.hidden = viewName !== 'monthly';
  DOM.viewWeekly.hidden  = viewName !== 'weekly';
  DOM.viewAgenda.hidden  = viewName !== 'agenda';
  DOM.viewNotepad.hidden = viewName !== 'notepad';

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.view === viewName);
  });
  
  if (DOM.btnOpenNotepad) {
    DOM.btnOpenNotepad.classList.toggle('is-active', viewName === 'notepad');
  }

  updateSidebarHeader();
  renderCurrentView();
}

function renderCurrentView() {
  switch (state.view) {
    case 'monthly': renderMonthly(); break;
    case 'weekly':  renderWeekly();  break;
    case 'agenda':  renderAgenda();  break;
    case 'notepad': renderNotepad(); break;
  }
}

function updateSidebarHeader() {
  const { view, year, month, weekOffset } = state;
  if (view === 'monthly' || view === 'agenda' || view === 'notepad') {
    DOM.monthName.textContent = MONTHS_ID[month];
    DOM.yearName.textContent  = year;
  } else if (view === 'weekly') {
    const wStart = getWeekStart(weekOffset);
    const wEnd   = new Date(wStart.getTime() + 6 * 86400000);
    const mStart = MONTHS_ID[wStart.getMonth()];
    const mEnd   = MONTHS_ID[wEnd.getMonth()];
    DOM.monthName.textContent = mStart === mEnd ? mStart : `${mStart.slice(0,3)}-${mEnd.slice(0,3)}`;
    DOM.yearName.textContent  = wStart.getFullYear();
  }
}

// ============================================================
// MONTHLY VIEW
// ============================================================

function renderMonthly() {
  const { year, month } = state;

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev  = new Date(year, month, 0).getDate();
  const todayKey    = getTodayKey();

  const frag = document.createDocumentFragment();

  for (let i = 0; i < 42; i++) {
    let cellDay, cellMonth, cellYear, isOtherMonth;

    if (i < firstDay) {
      cellDay = daysInPrev - firstDay + i + 1;
      cellMonth = month - 1; cellYear = year;
      if (cellMonth < 0) { cellMonth = 11; cellYear--; }
      isOtherMonth = true;
    } else if (i < firstDay + daysInMonth) {
      cellDay = i - firstDay + 1;
      cellMonth = month; cellYear = year;
      isOtherMonth = false;
    } else {
      cellDay = i - firstDay - daysInMonth + 1;
      cellMonth = month + 1; cellYear = year;
      if (cellMonth > 11) { cellMonth = 0; cellYear++; }
      isOtherMonth = true;
    }

    const key     = dateKey(cellYear, cellMonth, cellDay);
    const isToday = key === todayKey;
    const holiday = state.holidays[key] || '';
    const weekend = isWeekend(key);

    frag.appendChild(buildMonthCell(key, cellDay, isOtherMonth, isToday, holiday, weekend));
  }

  DOM.calendarGrid.textContent = '';
  DOM.calendarGrid.appendChild(frag);
  updateStats();
  updateHolidayInfoSidebar();
}

function buildMonthCell(dateStr, dayNum, isOtherMonth, isToday, holiday, weekend) {
  const cell = document.createElement('div');
  let cls = 'cal-cell';
  if (isOtherMonth) cls += ' cal-cell--other-month';
  if (isToday)      cls += ' cal-cell--today';
  if (holiday)      cls += ' cal-cell--holiday';
  else if (weekend) cls += ' cal-cell--weekend';
  cell.className = cls;
  cell.dataset.date = dateStr;

  // Header
  const header = document.createElement('div');
  header.className = 'cell-date';

  const dateNum = document.createElement('span');
  dateNum.className = 'date-num';
  dateNum.textContent = dayNum;

  header.appendChild(dateNum);

  // Holiday badge (hanya untuk sel bulan ini)
  if (holiday && !isOtherMonth) {
    const badge = document.createElement('span');
    badge.className = 'holiday-badge';
    badge.title = holiday;
    badge.textContent = holiday;
    header.appendChild(badge);
  } else if (!isOtherMonth) {
    // Tombol tambah
    const addBtn = document.createElement('button');
    addBtn.className = 'cell-add-btn';
    addBtn.title = 'Tambah task';
    addBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><line x1="5" y1="1" x2="5" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    addBtn.addEventListener('click', e => { e.stopPropagation(); if (!isOtherMonth) openModal(dateStr); });
    header.appendChild(addBtn);
  }

  cell.appendChild(header);

  // Task area
  const taskArea = document.createElement('div');
  taskArea.className = 'cell-tasks';
  renderTasksInArea(taskArea, dateStr);
  cell.appendChild(taskArea);

  // Events
  if (!isOtherMonth) {
    cell.addEventListener('click', () => openModal(dateStr));
  }
  cell.addEventListener('dragover',  onDragOver);
  cell.addEventListener('dragleave', onDragLeave);
  cell.addEventListener('drop',      e => onDrop(e, dateStr));

  return cell;
}

function renderTasksInArea(taskArea, dateStr) {
  const tasks = getFilteredTasks(dateStr);
  const MAX = 3;
  taskArea.textContent = '';

  tasks.slice(0, MAX).forEach(task => {
    taskArea.appendChild(buildTaskChip(task, dateStr));
  });

  if (tasks.length > MAX) {
    const more = document.createElement('div');
    more.className = 'cell-more';
    more.textContent = `+${tasks.length - MAX} lagi`;
    taskArea.appendChild(more);
  }
}

function buildTaskChip(task, dateStr) {
  const chip = document.createElement('div');
  chip.className = `task-chip task-chip--${task.cat}${task.done ? ' is-done' : ''}`;
  chip.draggable = !task.done;
  chip.dataset.taskId = task.id;
  chip.dataset.date   = dateStr;
  chip.title = task.text;

  // Priority dot
  const prioDot = document.createElement('span');
  prioDot.className = `chip-prio chip-prio--${task.priority}`;
  chip.appendChild(prioDot);

  // Text
  const txt = document.createElement('span');
  txt.className = 'task-chip__text';
  txt.textContent = task.text;
  chip.appendChild(txt);

  // Reminder icon
  if (task.reminder) {
    const remIcon = document.createElement('span');
    remIcon.className = 'chip-reminder';
    remIcon.textContent = '🔔';
    chip.appendChild(remIcon);
  }

  // Delete button
  const del = document.createElement('button');
  del.className = 'task-chip__del';
  del.title = 'Hapus';
  del.innerHTML = '<svg width="7" height="7" viewBox="0 0 7 7" fill="none"><line x1="1" y1="1" x2="6" y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="6" y1="1" x2="1" y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  del.addEventListener('click', e => { e.stopPropagation(); deleteTask(dateStr, task.id); });
  chip.appendChild(del);

  // Subtask progress bar
  if (task.subtasks.length > 0) {
    const doneCount = task.subtasks.filter(s => s.done).length;
    const pct = (doneCount / task.subtasks.length) * 100;
    const bar = document.createElement('div');
    bar.className = 'chip-subtask-bar';
    const fill = document.createElement('div');
    fill.className = 'chip-subtask-fill';
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    chip.appendChild(bar);
  }

  // Click → buka detail panel
  chip.addEventListener('click', e => {
    e.stopPropagation();
    openDetailPanel(dateStr, task.id);
  });

  // Drag events
  chip.addEventListener('dragstart', e => onDragStart(e, task.id, dateStr));
  chip.addEventListener('dragend',   onDragEnd);

  return chip;
}

/** Perbarui hanya sel tertentu tanpa re-render seluruh grid */
function refreshCell(dateStr) {
  const cell = DOM.calendarGrid.querySelector(`.cal-cell[data-date="${dateStr}"]`);
  if (cell) {
    const area = cell.querySelector('.cell-tasks');
    if (area) renderTasksInArea(area, dateStr);
  }
}

// ============================================================
// WEEKLY VIEW
// ============================================================

function renderWeekly() {
  const wStart = getWeekStart(state.weekOffset);
  const todayKey = getTodayKey();
  const headerFrag = document.createDocumentFragment();
  const gridFrag   = document.createDocumentFragment();

  for (let i = 0; i < 7; i++) {
    const d = new Date(wStart.getTime() + i * 86400000);
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const isToday   = key === todayKey;
    const holiday   = state.holidays[key] || '';
    const weekend   = isWeekend(key);

    // Header
    const hCell = document.createElement('div');
    let hCls = 'weekly-header-cell';
    if (isToday) hCls += ' is-today';
    if (holiday) hCls += ' is-holiday';
    else if (weekend) hCls += ' is-weekend-day';
    hCell.className = hCls;

    const hDay = document.createElement('div');
    hDay.className = 'weekly-h-day';
    hDay.textContent = DAYS_SHORT[d.getDay()];

    const hNum = document.createElement('div');
    hNum.className = 'weekly-h-num';
    hNum.textContent = d.getDate();

    hCell.appendChild(hDay);
    hCell.appendChild(hNum);

    if (holiday) {
      const hl = document.createElement('div');
      hl.className = 'weekly-h-holiday';
      hl.textContent = holiday;
      hCell.appendChild(hl);
    }

    headerFrag.appendChild(hCell);

    // Grid column
    const col = document.createElement('div');
    let colCls = 'weekly-col';
    if (isToday) colCls += ' is-today';
    if (holiday) colCls += ' is-holiday';
    else if (weekend) colCls += ' is-weekend-day';
    col.className = colCls;

    const colTasks = document.createElement('div');
    colTasks.className = 'weekly-col-tasks';

    const tasks = getFilteredTasks(key);
    tasks.forEach(task => {
      colTasks.appendChild(buildWeeklyTaskCard(task, key));
    });

    col.appendChild(colTasks);

    // Add button
    const addBtn = document.createElement('button');
    addBtn.className = 'weekly-add-btn';
    addBtn.textContent = '+ Tambah';
    addBtn.addEventListener('click', () => openModal(key));
    col.appendChild(addBtn);

    // Drag targets
    col.addEventListener('dragover',  onDragOver);
    col.addEventListener('dragleave', onDragLeave);
    col.addEventListener('drop',      e => onDrop(e, key));

    gridFrag.appendChild(col);
  }

  DOM.weeklyDayHeaders.textContent = '';
  DOM.weeklyGrid.textContent = '';
  DOM.weeklyDayHeaders.appendChild(headerFrag);
  DOM.weeklyGrid.appendChild(gridFrag);
  updateStats();
}

function buildWeeklyTaskCard(task, dateStr) {
  const card = document.createElement('div');
  card.className = `weekly-task-card weekly-task-card--${task.cat}${task.done ? ' is-done' : ''}`;
  card.draggable = !task.done;

  const title = document.createElement('div');
  title.className = 'wtc-title';
  title.textContent = task.text;
  card.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'wtc-meta';

  const prioBadge = document.createElement('span');
  prioBadge.className = `wtc-prio wtc-prio--${task.priority}`;
  prioBadge.textContent = PRIO_LABEL[task.priority];
  meta.appendChild(prioBadge);

  if (task.subtasks.length > 0) {
    const doneCount = task.subtasks.filter(s => s.done).length;
    const sub = document.createElement('span');
    sub.className = 'wtc-sub';
    sub.textContent = `✓ ${doneCount}/${task.subtasks.length}`;
    meta.appendChild(sub);
  }

  if (task.reminder) {
    const rem = document.createElement('span');
    rem.className = 'wtc-reminder';
    rem.textContent = `🔔 ${formatReminderDisplay(task.reminder)}`;
    meta.appendChild(rem);
  }

  card.appendChild(meta);

  card.addEventListener('click', () => openDetailPanel(dateStr, task.id));
  card.addEventListener('dragstart', e => onDragStart(e, task.id, dateStr));
  card.addEventListener('dragend',   onDragEnd);

  return card;
}

// ============================================================
// AGENDA VIEW
// ============================================================

function renderAgenda() {
  const todayKey = getTodayKey();
  const today = new Date(todayKey + 'T00:00:00');

  // Kumpulkan 90 hari ke depan
  const agendaItems = [];
  for (let i = -7; i < 90; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const key = dateKey(d.getFullYear(), d.getMonth(), d.getDate());
    const tasks = getFilteredTasks(key);
    if (tasks.length > 0) {
      agendaItems.push({ dateStr: key, tasks, date: d });
    }
  }

  DOM.agendaList.textContent = '';

  if (agendaItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'agenda-empty';
    empty.innerHTML = '<div class="agenda-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="1.5" opacity="0.35"/><path d="M3 9H21" stroke="currentColor" stroke-width="1.5" opacity="0.35"/><path d="M8 2V6M16 2V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.35"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.35"/></svg></div><div>Tidak ada task mendatang</div><div style="font-size:11px;color:var(--text-muted)">Klik tanggal di kalender atau gunakan quick input untuk menambah task</div>';
    DOM.agendaList.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();

  agendaItems.forEach(({ dateStr, tasks, date }) => {
    const isToday = dateStr === todayKey;
    const holiday = state.holidays[dateStr] || '';

    // Date group header
    const group = document.createElement('div');
    group.className = 'agenda-date-group';

    const header = document.createElement('div');
    header.className = 'agenda-date-header';

    const dStr = document.createElement('div');
    dStr.className = `agenda-date-str${isToday ? ' is-today' : ''}`;
    dStr.textContent = `${isToday ? '📍 Hari Ini — ' : ''}${DAYS_FULL[date.getDay()]}, ${date.getDate()} ${MONTHS_ID[date.getMonth()]} ${date.getFullYear()}`;
    header.appendChild(dStr);

    if (holiday) {
      const hl = document.createElement('div');
      hl.className = 'agenda-holiday-lbl';
      hl.textContent = `🎌 ${holiday}`;
      header.appendChild(hl);
    }

    const line = document.createElement('div');
    line.className = 'agenda-date-line';
    header.appendChild(line);

    group.appendChild(header);

    // Tasks
    tasks.forEach(task => {
      group.appendChild(buildAgendaItem(task, dateStr));
    });

    frag.appendChild(group);
  });

  DOM.agendaList.appendChild(frag);
  updateStats();
}

function buildAgendaItem(task, dateStr) {
  const item = document.createElement('div');
  item.className = `agenda-task-item${task.done ? ' is-done' : ''}`;

  // Done button
  const doneBtn = document.createElement('button');
  doneBtn.className = 'agenda-done-btn';
  doneBtn.title = task.done ? 'Tandai belum selesai' : 'Tandai selesai';
  doneBtn.innerHTML = task.done ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';
  doneBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleTaskDone(dateStr, task.id);
  });
  item.appendChild(doneBtn);

  // Category bar
  const catBar = document.createElement('div');
  catBar.className = `agenda-cat-bar agenda-cat-bar--${task.cat}`;
  item.appendChild(catBar);

  // Body
  const body = document.createElement('div');
  body.className = 'agenda-task-body';

  const title = document.createElement('div');
  title.className = 'agenda-task-title';
  title.textContent = task.text;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'agenda-task-meta';

  const catBadge = document.createElement('span');
  catBadge.className = `agenda-badge agenda-badge--${task.cat}`;
  catBadge.textContent = CAT_LABEL[task.cat];
  meta.appendChild(catBadge);

  const prioBadge = document.createElement('span');
  prioBadge.className = `agenda-badge agenda-badge--${task.priority}`;
  prioBadge.textContent = PRIO_LABEL[task.priority];
  meta.appendChild(prioBadge);

  if (task.subtasks.length > 0) {
    const doneCount = task.subtasks.filter(s => s.done).length;
    const sub = document.createElement('span');
    sub.className = 'agenda-subtask-info';
    sub.textContent = `📋 ${doneCount}/${task.subtasks.length} subtask`;
    meta.appendChild(sub);
  }

  if (task.reminder) {
    const rem = document.createElement('span');
    rem.className = 'agenda-reminder';
    rem.textContent = `🔔 ${formatReminderDisplay(task.reminder)}`;
    meta.appendChild(rem);
  }

  body.appendChild(meta);
  item.appendChild(body);

  item.addEventListener('click', () => openDetailPanel(dateStr, task.id));

  return item;
}

// ============================================================
// TASK CRUD
// ============================================================

function addTask(dateStr, text, cat, priority, reminder, reminderRepeat, silent = false) {
  if (!text.trim()) return;
  const task = migrateTask({ id: genId(), text: text.trim(), cat, priority, reminder, reminderRepeat });
  if (!state.tasks[dateStr]) state.tasks[dateStr] = [];
  state.tasks[dateStr].push(task);
  saveTasks();
  if (state.view === 'monthly') refreshCell(dateStr);
  else renderCurrentView();
  updateStats();
  if (!silent) showToast(`Task ditambahkan — ${formatDisplayDate(dateStr)}`);
}

function deleteTask(dateStr, taskId) {
  if (!state.tasks[dateStr]) return;
  state.tasks[dateStr] = state.tasks[dateStr].filter(t => t.id !== taskId);
  if (state.tasks[dateStr].length === 0) delete state.tasks[dateStr];
  saveTasks();

  // Tutup detail panel jika task yang dihapus sedang dibuka
  if (state.detailTask?.taskId === taskId) closeDetailPanel();

  if (state.view === 'monthly') refreshCell(dateStr);
  else renderCurrentView();
  updateStats();
  showToast('Task dihapus');
}

function updateTask(dateStr, taskId, changes) {
  const list = state.tasks[dateStr];
  if (!list) return;
  const idx = list.findIndex(t => t.id === taskId);
  if (idx === -1) return;
  Object.assign(list[idx], changes);
  saveTasks();
  if (state.view === 'monthly') refreshCell(dateStr);
  else renderCurrentView();
  updateStats();
}

function toggleTaskDone(dateStr, taskId) {
  const list = state.tasks[dateStr];
  if (!list) return;
  const task = list.find(t => t.id === taskId);
  if (!task) return;
  task.done = !task.done;
  saveTasks();
  if (state.view === 'monthly') refreshCell(dateStr);
  else renderCurrentView();
  updateStats();
  showToast(task.done ? 'Task selesai' : 'Task dibuka kembali');
  // Perbarui detail panel jika terbuka
  if (state.detailTask?.taskId === taskId) openDetailPanel(dateStr, taskId);
}

function moveTask(taskId, fromDate, toDate) {
  if (fromDate === toDate || !state.tasks[fromDate]) return;
  const idx = state.tasks[fromDate].findIndex(t => t.id === taskId);
  if (idx === -1) return;
  const [task] = state.tasks[fromDate].splice(idx, 1);
  if (state.tasks[fromDate].length === 0) delete state.tasks[fromDate];
  if (!state.tasks[toDate]) state.tasks[toDate] = [];
  state.tasks[toDate].push(task);
  saveTasks();
  if (state.view === 'monthly') {
    refreshCell(fromDate);
    refreshCell(toDate);
  } else {
    renderCurrentView();
  }
  updateStats();
  showToast(`Task dipindah ke ${formatDisplayDate(toDate)}`);
}

// ============================================================
// STATS
// ============================================================

function updateStats() {
  const { year, month } = state;
  const prefix = `${year}-${String(month + 1).padStart(2,'0')}-`;
  let total = 0, done = 0, high = 0, pending = 0;

  for (const [key, tasks] of Object.entries(state.tasks)) {
    if (!key.startsWith(prefix)) continue;
    tasks.forEach(t => {
      total++;
      if (t.done) done++;
      if (t.priority === 'high' && !t.done) high++;
      if (!t.done) pending++;
    });
  }

  DOM.statTotal.textContent   = total;
  DOM.statDone.textContent    = done;
  DOM.statHigh.textContent    = high;
  DOM.statPending.textContent = pending;
}

// ============================================================
// DRAG & DROP
// ============================================================

function onDragStart(e, taskId, fromDate) {
  state.dragData = { taskId, fromDate };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', taskId);
  requestAnimationFrame(() => e.currentTarget.classList.add('is-dragging'));
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('is-dragging');
  document.querySelectorAll('.cal-cell--drag-over, .weekly-col.drag-over').forEach(el => {
    el.classList.remove('cal-cell--drag-over');
    el.classList.remove('drag-over');
  });
  state.dragData = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const el = e.currentTarget;
  if (!el.classList.contains('cal-cell--drag-over')) {
    el.classList.add('cal-cell--drag-over');
  }
}

function onDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('cal-cell--drag-over');
  }
}

function onDrop(e, toDate) {
  e.preventDefault();
  e.currentTarget.classList.remove('cal-cell--drag-over');
  if (!state.dragData) return;
  const { taskId, fromDate } = state.dragData;
  state.dragData = null;
  moveTask(taskId, fromDate, toDate);
}

// ============================================================
// QUICK INPUT PARSER
// ============================================================

/**
 * Terjemahkan alias tanggal natural language → YYYY-MM-DD
 * Mendukung bahasa Indonesia & Inggris
 */
function resolveQuickDate(token) {
  const now = new Date();
  const toKey = (d) => dateKey(d.getFullYear(), d.getMonth(), d.getDate());

  // Jika sudah format YYYY-MM-DD, langsung pakai
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;

  switch (token.toLowerCase()) {
    // ---- Hari ini ----
    case 'today':
    case 'hari-ini':
    case 'hariini':
    case 'ini':
      return toKey(now);

    // ---- Besok ----
    case 'tomorrow':
    case 'besok':
      return toKey(new Date(now.getTime() + 86400000));

    // ---- Lusa ----
    case 'lusa':
    case 'dayafter':
      return toKey(new Date(now.getTime() + 2 * 86400000));

    // ---- Minggu depan ----
    case 'nextweek':
    case 'next-week':
    case 'minggu-depan':
    case 'minggu':
      return toKey(new Date(now.getTime() + 7 * 86400000));

    // ---- Bulan depan ----
    case 'nextmonth':
    case 'next-month':
    case 'bulan-depan':
    case 'bulan':
      return toKey(new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()));

    // ---- Sabtu terdekat ----
    case 'weekend':
    case 'sabtu': {
      const daysToSat = ((6 - now.getDay()) + 7) % 7 || 7;
      return toKey(new Date(now.getTime() + daysToSat * 86400000));
    }

    // ---- Senin terdekat ----
    case 'monday':
    case 'senin': {
      const daysToMon = ((1 - now.getDay()) + 7) % 7 || 7;
      return toKey(new Date(now.getTime() + daysToMon * 86400000));
    }

    // ---- Jumat terdekat ----
    case 'friday':
    case 'jumat': {
      const daysToFri = ((5 - now.getDay()) + 7) % 7 || 7;
      return toKey(new Date(now.getTime() + daysToFri * 86400000));
    }

    // Fallback: tidak dikenali → hari ini
    default:
      return toKey(now);
  }
}

/**
 * Format quick input: "Teks task #kategori !prioritas @tanggal"
 * @tanggal bisa berupa:
 *   YYYY-MM-DD     → tanggal spesifik, misal @2026-04-20
 *   @today         → hari ini
 *   @besok         → besok
 *   @lusa          → lusa
 *   @minggu-depan  → 7 hari ke depan
 *   @bulan-depan   → bulan depan, tanggal sama
 *   @weekend/@sabtu → Sabtu terdekat
 *   @senin/@monday  → Senin terdekat
 *   @jumat/@friday  → Jumat terdekat
 */
function parseQuickInput(raw) {
  let text = raw;
  let cat = 'work', priority = 'medium', dateStr = getTodayKey();

  // Ekstrak @token (mendukung YYYY-MM-DD dan alias kata)
  const dateMatch = text.match(/@([\w-]+)/);
  if (dateMatch) {
    dateStr = resolveQuickDate(dateMatch[1]);
    text = text.replace(dateMatch[0], '');
  }

  // Ekstrak #kategori
  const catMatch = text.match(/#(work|personal|urgent)/i);
  if (catMatch) { cat = catMatch[1].toLowerCase(); text = text.replace(catMatch[0], ''); }

  // Ekstrak !prioritas
  const prioMatch = text.match(/!(high|medium|low)/i);
  if (prioMatch) { priority = prioMatch[1].toLowerCase(); text = text.replace(prioMatch[0], ''); }

  text = text.trim().replace(/\s+/g, ' ');

  return { text, cat, priority, dateStr };
}


// ============================================================
// MODAL (Tambah / Edit Task)
// ============================================================

function openModal(dateStr, task = null) {
  state.selectedDate = dateStr;
  state.editingTask  = task ? { dateStr, taskId: task.id } : null;

  DOM.modalTitle.textContent = task ? 'Edit Task' : 'Tambah Task';
  DOM.modalDateDisplay.textContent = formatDisplayDate(dateStr);
  DOM.taskInput.value = task ? task.text : '';

  // Set kategori
  const catVal = task ? task.cat : 'work';
  document.querySelectorAll('input[name="taskCat"]').forEach(r => { r.checked = r.value === catVal; });

  // Set prioritas
  const prioVal = task ? task.priority : 'medium';
  document.querySelectorAll('input[name="taskPriority"]').forEach(r => { r.checked = r.value === prioVal; });

  // Set reminder
  DOM.reminderInput.value = task?.reminder || '';
  DOM.reminderRepeat.value = task?.reminderRepeat || 'none';

  DOM.modalOverlay.hidden = false;
  requestAnimationFrame(() => setTimeout(() => DOM.taskInput.focus(), 50));
}

function closeModal() {
  DOM.modalOverlay.hidden = true;
  state.selectedDate = null;
  state.editingTask  = null;
}

function saveTaskFromModal() {
  const text = DOM.taskInput.value.trim();
  if (!text) {
    DOM.taskInput.style.borderColor = '#E84C4C';
    setTimeout(() => { DOM.taskInput.style.borderColor = ''; }, 1200);
    DOM.taskInput.focus();
    return;
  }

  const cat      = document.querySelector('input[name="taskCat"]:checked')?.value || 'work';
  const priority = document.querySelector('input[name="taskPriority"]:checked')?.value || 'medium';
  const reminder = DOM.reminderInput.value || null;
  const repeat   = DOM.reminderRepeat.value || 'none';

  if (state.editingTask) {
    // Mode edit
    updateTask(state.editingTask.dateStr, state.editingTask.taskId, { text, cat, priority, reminder, reminderRepeat: repeat });
    showToast('Task diperbarui');
    // Refresh detail panel jika terbuka
    if (state.detailTask?.taskId === state.editingTask.taskId) {
      openDetailPanel(state.editingTask.dateStr, state.editingTask.taskId);
    }
  } else {
    // Mode tambah
    addTask(state.selectedDate, text, cat, priority, reminder, repeat);
  }

  closeModal();
}

// ============================================================
// DETAIL PANEL
// ============================================================

function openDetailPanel(dateStr, taskId) {
  const list = state.tasks[dateStr];
  if (!list) return;
  const task = list.find(t => t.id === taskId);
  if (!task) return;

  state.detailTask = { dateStr, taskId };
  DOM.detailPanel.hidden = false;
  renderDetailPanel(task, dateStr);
}

function closeDetailPanel() {
  state.detailTask = null;
  DOM.detailPanel.hidden = true;
  DOM.detailBody.textContent = '';
}

function renderDetailPanel(task, dateStr) {
  const body = DOM.detailBody;
  body.textContent = '';

  // ---- Done Toggle ----
  const doneToggle = document.createElement('button');
  doneToggle.className = `detail-done-toggle${task.done ? ' is-done' : ''}`;
  doneToggle.innerHTML = `
    <span class="detail-done-check">
      ${task.done ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4 7L8 3" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
    </span>
    <span>${task.done ? 'Selesai — klik untuk buka kembali' : 'Tandai sebagai selesai'}</span>
  `;
  doneToggle.addEventListener('click', () => toggleTaskDone(dateStr, task.id));
  body.appendChild(doneToggle);

  // ---- Date info ----
  const dateInfo = document.createElement('div');
  dateInfo.style.cssText = 'font-size:11px;color:var(--text-muted);padding:2px 0';
  dateInfo.textContent = '📅 ' + formatDisplayDate(dateStr);
  body.appendChild(dateInfo);

  // ---- Task Text ----
  const txtSection = document.createElement('div');
  txtSection.className = 'detail-section';
  const txtLabel = document.createElement('div');
  txtLabel.className = 'detail-label';
  txtLabel.textContent = 'Deskripsi Task';
  const txtInput = document.createElement('textarea');
  txtInput.className = 'detail-input';
  txtInput.rows = 2;
  txtInput.value = task.text;
  txtInput.style.resize = 'none';
  txtSection.appendChild(txtLabel);
  txtSection.appendChild(txtInput);
  body.appendChild(txtSection);

  // ---- Category ----
  const catSection = document.createElement('div');
  catSection.className = 'detail-section';
  const catLabel = document.createElement('div');
  catLabel.className = 'detail-label';
  catLabel.textContent = 'Kategori';
  const catPicker = document.createElement('div');
  catPicker.className = 'detail-cat-picker';
  ['work', 'personal', 'urgent'].forEach(c => {
    const lbl = document.createElement('label');
    lbl.className = 'detail-cat-option';
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = `dCat_${task.id}`; inp.value = c;
    inp.checked = task.cat === c;
    const chip = document.createElement('span');
    chip.className = `cat-chip cat-chip--${c}`;
    chip.innerHTML = `<span class="cat-dot"></span>${CAT_LABEL[c]}`;
    lbl.appendChild(inp);
    lbl.appendChild(chip);
    catPicker.appendChild(lbl);
  });
  catSection.appendChild(catLabel);
  catSection.appendChild(catPicker);
  body.appendChild(catSection);

  // ---- Priority ----
  const prioSection = document.createElement('div');
  prioSection.className = 'detail-section';
  const prioLabel = document.createElement('div');
  prioLabel.className = 'detail-label';
  prioLabel.textContent = 'Prioritas';
  const prioPicker = document.createElement('div');
  prioPicker.className = 'detail-prio-picker';
  ['high', 'medium', 'low'].forEach(p => {
    const lbl = document.createElement('label');
    lbl.className = 'detail-prio-option';
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = `dPrio_${task.id}`; inp.value = p;
    inp.checked = task.priority === p;
    const chip = document.createElement('span');
    chip.className = `prio-chip prio-chip--${p}`;
    chip.textContent = (p === 'high' ? '🔴' : p === 'medium' ? '🟡' : '🟢') + ' ' + PRIO_LABEL[p];
    lbl.appendChild(inp);
    lbl.appendChild(chip);
    prioPicker.appendChild(lbl);
  });
  prioSection.appendChild(prioLabel);
  prioSection.appendChild(prioPicker);
  body.appendChild(prioSection);

  // ---- Subtasks ----
  const subSection = document.createElement('div');
  subSection.className = 'detail-section';
  const subLabel = document.createElement('div');
  subLabel.className = 'detail-label';
  subLabel.textContent = `Subtask (${task.subtasks.filter(s=>s.done).length}/${task.subtasks.length})`;
  subSection.appendChild(subLabel);

  const subList = document.createElement('div');
  subList.className = 'subtask-list';
  task.subtasks.forEach(sub => {
    subList.appendChild(buildSubtaskItem(sub, task, dateStr, subLabel));
  });
  subSection.appendChild(subList);

  // Add subtask input
  const addRow = document.createElement('div');
  addRow.className = 'subtask-add-row';
  const subInput = document.createElement('input');
  subInput.className = 'subtask-add-input';
  subInput.type = 'text';
  subInput.placeholder = 'Tambah subtask...';
  subInput.maxLength = 100;
  const subAddBtn = document.createElement('button');
  subAddBtn.className = 'subtask-add-btn';
  subAddBtn.textContent = 'Tambah';

  const addSubtask = () => {
    const txt = subInput.value.trim();
    if (!txt) return;
    task.subtasks.push({ id: genId(), text: txt, done: false });
    saveTasks();
    subInput.value = '';
    // Re-render detail panel
    openDetailPanel(dateStr, task.id);
    if (state.view === 'monthly') refreshCell(dateStr);
    else renderCurrentView();
  };

  subAddBtn.addEventListener('click', addSubtask);
  subInput.addEventListener('keydown', e => { if (e.key === 'Enter') addSubtask(); });
  addRow.appendChild(subInput);
  addRow.appendChild(subAddBtn);
  subSection.appendChild(addRow);
  body.appendChild(subSection);

  // ---- Reminder ----
  const remSection = document.createElement('div');
  remSection.className = 'detail-section';
  const remLabel = document.createElement('div');
  remLabel.className = 'detail-label';
  remLabel.textContent = 'Pengingat';
  const remInput = document.createElement('input');
  remInput.className = 'detail-input form-input--datetime';
  remInput.type = 'datetime-local';
  remInput.value = task.reminder || '';

  const repLabel = document.createElement('div');
  repLabel.className = 'detail-label';
  repLabel.style.marginTop = '6px';
  repLabel.textContent = 'Pengulangan';
  const repSelect = document.createElement('select');
  repSelect.className = 'form-select';
  repSelect.style.marginTop = '4px';
  Object.entries(REPEAT_LABEL).forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (task.reminderRepeat === v) opt.selected = true;
    repSelect.appendChild(opt);
  });

  remSection.appendChild(remLabel);
  remSection.appendChild(remInput);
  remSection.appendChild(repLabel);
  remSection.appendChild(repSelect);
  body.appendChild(remSection);

  // ---- Actions ----
  const actions = document.createElement('div');
  actions.className = 'detail-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-detail-save';
  saveBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-1px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" stroke="currentColor" stroke-width="2"/><polyline points="17 21 17 13 7 13 7 21" stroke="currentColor" stroke-width="2"/><polyline points="7 3 7 8 15 8" stroke="currentColor" stroke-width="2"/></svg>Simpan Perubahan';
  saveBtn.addEventListener('click', () => {
    const newText  = txtInput.value.trim();
    const newCat   = catPicker.querySelector('input:checked')?.value || task.cat;
    const newPrio  = prioPicker.querySelector('input:checked')?.value || task.priority;
    const newRem   = remInput.value || null;
    const newRep   = repSelect.value || 'none';
    if (!newText) { txtInput.style.borderColor = '#E84C4C'; return; }
    updateTask(dateStr, task.id, { text: newText, cat: newCat, priority: newPrio, reminder: newRem, reminderRepeat: newRep });
    showToast('Perubahan disimpan');
  });

  const delBtn = document.createElement('button');
  delBtn.className = 'btn-detail-delete';
  delBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="margin-right:5px;vertical-align:-1px"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2"/></svg>Hapus Task';
  delBtn.addEventListener('click', () => {
    openConfirmDialog({
      title: 'Hapus Task?',
      message: `"${task.text}" akan dihapus permanen dan tidak bisa dikembalikan.`,
      confirmLabel: 'Hapus',
      onConfirm: () => deleteTask(dateStr, task.id),
    });
  });

  actions.appendChild(saveBtn);
  actions.appendChild(delBtn);
  body.appendChild(actions);
}

function buildSubtaskItem(sub, parentTask, dateStr, labelEl) {
  const item = document.createElement('div');
  item.className = 'subtask-item';

  const check = document.createElement('button');
  check.className = `subtask-check${sub.done ? ' is-done' : ''}`;
  check.title = sub.done ? 'Buka kembali' : 'Selesaikan';
  check.innerHTML = sub.done
    ? '<svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5L3.5 6.5L7.5 2.5" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    : '';
  check.addEventListener('click', () => {
    sub.done = !sub.done;
    saveTasks();
    openDetailPanel(dateStr, parentTask.id);
    if (state.view === 'monthly') refreshCell(dateStr);
    else renderCurrentView();
  });

  const txt = document.createElement('span');
  txt.className = `subtask-text${sub.done ? ' is-done' : ''}`;
  txt.textContent = sub.text;

  const del = document.createElement('button');
  del.className = 'subtask-del';
  del.title = 'Hapus subtask';
  del.innerHTML = '<svg width="8" height="8" viewBox="0 0 8 8" fill="none"><line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  del.addEventListener('click', () => {
    parentTask.subtasks = parentTask.subtasks.filter(s => s.id !== sub.id);
    saveTasks();
    openDetailPanel(dateStr, parentTask.id);
    if (state.view === 'monthly') refreshCell(dateStr);
    else renderCurrentView();
  });

  item.appendChild(check);
  item.appendChild(txt);
  item.appendChild(del);
  return item;
}

// ============================================================
// NAVIGATION
// ============================================================

function prevPeriod() {
  if (state.view === 'weekly') {
    state.weekOffset--;
    updateSidebarHeader();
    renderWeekly();
  } else {
    if (state.month === 0) { state.month = 11; state.year--; }
    else state.month--;
    ensureHolidaysLoaded();
    renderCurrentView();
    updateSidebarHeader();
  }
}

function nextPeriod() {
  if (state.view === 'weekly') {
    state.weekOffset++;
    updateSidebarHeader();
    renderWeekly();
  } else {
    if (state.month === 11) { state.month = 0; state.year++; }
    else state.month++;
    ensureHolidaysLoaded();
    renderCurrentView();
    updateSidebarHeader();
  }
}

function goToToday() {
  const now = new Date();
  state.year = now.getFullYear();
  state.month = now.getMonth();
  state.weekOffset = 0;
  ensureHolidaysLoaded();
  renderCurrentView();
  updateSidebarHeader();
}

async function ensureHolidaysLoaded() {
  const yr = state.year;
  const alreadyLoaded = Object.keys(state.holidays).some(k => k.startsWith(yr + '-'));
  if (!alreadyLoaded) await loadHolidays(yr);
  else updateHolidayInfoSidebar();
}

// ============================================================
// TOAST
// ============================================================

let _toastTimer = null;
function showToast(msg) {
  DOM.toast.textContent = msg;
  DOM.toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 2400);
}

// ============================================================
// CONFIRM DIALOG (ganti browser confirm() bawaan)
// ============================================================

let _confirmCallback = null;

function openConfirmDialog({ title, message, confirmLabel = 'Konfirmasi', isDanger = true, onConfirm }) {
  $('confirmTitle').textContent = title;
  $('confirmMsg').textContent   = message;
  const okBtn = $('btnConfirmOk');
  okBtn.textContent = confirmLabel;
  okBtn.className   = isDanger ? 'btn btn--danger' : 'btn btn--primary';
  _confirmCallback  = onConfirm;
  $('confirmOverlay').hidden = false;
}

function closeConfirmDialog() {
  $('confirmOverlay').hidden = true;
  _confirmCallback = null;
}

// ============================================================
// SETTINGS MODAL
// ============================================================

function openSettings() {
  $('settingsOverlay').hidden = false;
}

function closeSettings() {
  $('settingsOverlay').hidden = true;
}

// ---- EXPORT ----
function exportTasks() {
  try {
    const payload = {
      _meta: {
        app:       'Tododo',
        version:   '1.0.1',
        exported:  new Date().toISOString(),
        totalDates: Object.keys(state.tasks).length,
        totalTasks: Object.values(state.tasks).reduce((s, arr) => s + arr.length, 0),
      },
      tasks: state.tasks,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `tododo-backup-${getTodayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📤 Data berhasil diekspor');
    closeSettings();
  } catch (err) {
    showToast('❌ Gagal mengekspor data');
    console.error('[CTM] Export error:', err);
  }
}

// ---- IMPORT ----
function importTasks(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);

      // Support both formats: raw { date: [tasks] } atau { _meta, tasks: {...} }
      const rawTasks = parsed.tasks || parsed;

      if (typeof rawTasks !== 'object' || Array.isArray(rawTasks)) {
        showToast('❌ Format file tidak valid'); return;
      }

      let imported = 0, skipped = 0;

      for (const [date, tasks] of Object.entries(rawTasks)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!Array.isArray(tasks)) continue;

        if (!state.tasks[date]) state.tasks[date] = [];
        const existingIds = new Set(state.tasks[date].map(t => t.id));

        tasks.forEach(t => {
          if (existingIds.has(t.id)) { skipped++; return; }
          state.tasks[date].push(migrateTask(t));
          imported++;
        });
      }

      saveTasks();
      renderCurrentView();
      updateStats();
      showToast(`📥 Diimpor ${imported} task${skipped > 0 ? ` (${skipped} duplikat dilewati)` : ''}`);
      closeSettings();
    } catch {
      showToast('❌ File tidak dapat dibaca atau format salah');
    }
  };
  reader.readAsText(file);
}

// ============================================================
// EVENT BINDING
// ============================================================

// ============================================================
// NOTEPAD / STICKY NOTES
// ============================================================

const STORAGE_LAYOUT_KEY = STORAGE_LAYOUT;

function loadLayoutPref() {
  try {
    state.scatteredLayout = localStorage.getItem(STORAGE_LAYOUT_KEY) === 'scattered';
  } catch { state.scatteredLayout = false; }
}

function saveLayoutPref() {
  try { localStorage.setItem(STORAGE_LAYOUT_KEY, state.scatteredLayout ? 'scattered' : 'grid'); } catch {}
}

function toggleLayout() {
  state.scatteredLayout = !state.scatteredLayout;
  saveLayoutPref();
  applyLayoutUI();
  renderNotepad();
}

function applyLayoutUI() {
  if (!DOM.btnLayoutToggle) return;
  DOM.btnLayoutToggle.classList.toggle('is-scattered', state.scatteredLayout);
  if (DOM.layoutLabel) {
    DOM.layoutLabel.textContent = state.scatteredLayout ? 'Berantakan' : 'Rapih';
  }
  if (DOM.boardGrid) {
    DOM.boardGrid.classList.toggle('is-scattered', state.scatteredLayout);
  }
}

function renderNotepad() {
  if (!DOM.boardGrid) return;
  DOM.boardGrid.innerHTML = '';
  applyLayoutUI();
  state.stickies.forEach((sticky, idx) => {
    DOM.boardGrid.appendChild(buildStickyCard(sticky, idx));
  });
}

function buildStickyCard(sticky, idx) {
  const card = document.createElement('div');
  card.className = 'sticky-note';
  card.dataset.id = sticky.id;
  if (sticky.color) card.dataset.color = sticky.color;

  // Position for scattered mode
  if (state.scatteredLayout) {
    const x = sticky.x != null ? sticky.x : 20 + (idx % 4) * 220;
    const y = sticky.y != null ? sticky.y : 20 + Math.floor(idx / 4) * 210;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }

  const header = document.createElement('div');
  header.className = 'sticky-header';

  // --- Format controls (B/I/U) ---
  const formatControls = document.createElement('div');
  formatControls.className = 'sticky-controls';

  const boldBtn = document.createElement('button');
  boldBtn.className = 'sticky-btn format-btn';
  boldBtn.title = 'Bold';
  boldBtn.textContent = 'B';

  const italicBtn = document.createElement('button');
  italicBtn.className = 'sticky-btn format-btn';
  italicBtn.title = 'Italic';
  italicBtn.innerHTML = '<i>I</i>';

  const underlineBtn = document.createElement('button');
  underlineBtn.className = 'sticky-btn format-btn';
  underlineBtn.title = 'Underline';
  underlineBtn.innerHTML = '<u>U</u>';

  formatControls.appendChild(boldBtn);
  formatControls.appendChild(italicBtn);
  formatControls.appendChild(underlineBtn);

  // --- Right controls (color, pin, delete) ---
  const controls = document.createElement('div');
  controls.className = 'sticky-controls';

  const colorBtn = document.createElement('button');
  colorBtn.className = 'sticky-btn';
  colorBtn.title = 'Ubah Warna';
  colorBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/></svg>';
  colorBtn.onclick = () => {
    const colors = ['yellow', 'pink', 'blue', 'green'];
    let idx2 = colors.indexOf(sticky.color || 'yellow');
    idx2 = (idx2 + 1) % colors.length;
    sticky.color = colors[idx2];
    card.dataset.color = sticky.color;
    saveStickies();
  };

  const pinBtn = document.createElement('button');
  pinBtn.className = 'sticky-btn';
  pinBtn.title = 'Pin to Tab (Pop out)';
  pinBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 14M8 6L12 2L16 6M6 22L12 14L18 22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  pinBtn.onclick = () => {
    if (window.electronAPI && window.electronAPI.createSticky) {
      window.electronAPI.createSticky({ id: sticky.id, text: sticky.text || '', color: sticky.color || 'yellow' });
    }
  };

  const delBtn = document.createElement('button');
  delBtn.className = 'sticky-btn';
  delBtn.innerHTML = '<svg width="8" height="8" viewBox="0 0 10 10" fill="none"><line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  delBtn.title = 'Hapus';
  delBtn.onclick = () => {
    openConfirmDialog({
      title: 'Hapus Sticky Note?',
      message: 'Catatan ini akan dihapus permanen dan tidak bisa dikembalikan.',
      confirmLabel: 'Hapus',
      onConfirm: () => {
        state.stickies = state.stickies.filter(s => s.id !== sticky.id);
        saveStickies();
        renderNotepad();
        showToast('Sticky note dihapus');
      },
    });
  };

  controls.appendChild(colorBtn);
  controls.appendChild(pinBtn);
  controls.appendChild(delBtn);
  header.appendChild(formatControls);
  header.appendChild(controls);

  // --- Editor (contenteditable) ---
  const editor = document.createElement('div');
  editor.className = 'sticky-content';
  editor.contentEditable = 'true';
  editor.innerHTML = sticky.text || '';
  editor.dataset.placeholder = 'Ketik catatan...';

  let typingTimer;
  editor.addEventListener('input', () => {
    clearTimeout(typingTimer);
    sticky.text = editor.innerHTML;
    typingTimer = setTimeout(saveStickies, 500);
  });

  // --- B/I/U active state tracking ---
  const updateFormatState = () => {
    try {
      boldBtn.classList.toggle('active', document.queryCommandState('bold'));
      italicBtn.classList.toggle('active', document.queryCommandState('italic'));
      underlineBtn.classList.toggle('active', document.queryCommandState('underline'));
    } catch {}
  };

  boldBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.execCommand('bold', false, null);
    updateFormatState();
  });
  italicBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.execCommand('italic', false, null);
    updateFormatState();
  });
  underlineBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    document.execCommand('underline', false, null);
    updateFormatState();
  });

  editor.addEventListener('keyup', updateFormatState);
  editor.addEventListener('click', updateFormatState);
  editor.addEventListener('focus', updateFormatState);

  // --- Image paste handler ---
  editor.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => {
          editor.focus();
          document.execCommand('insertImage', false, ev.target.result);
          sticky.text = editor.innerHTML;
          saveStickies();
        };
        reader.readAsDataURL(file);
        return;
      }
    }
  });

  // --- Image drag & drop handler (prevent gallery, insert into note) ---
  editor.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  editor.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach(file => {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            editor.focus();
            document.execCommand('insertImage', false, ev.target.result);
            sticky.text = editor.innerHTML;
            saveStickies();
          };
          reader.readAsDataURL(file);
        }
      });
    }
  });

  // --- Drag to reposition (scattered mode) ---
  if (state.scatteredLayout) {
    let isDragging = false, startX = 0, startY = 0, origX = 0, origY = 0;

    header.style.cursor = 'grab';
    header.addEventListener('mousedown', (e) => {
      // Jangan drag jika klik tombol
      if (e.target.closest('.sticky-btn')) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseInt(card.style.left) || 0;
      origY = parseInt(card.style.top) || 0;
      card.classList.add('is-dragging-note');
      header.style.cursor = 'grabbing';
      e.preventDefault();
    });

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      card.style.left = (origX + dx) + 'px';
      card.style.top = (origY + dy) + 'px';
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      card.classList.remove('is-dragging-note');
      header.style.cursor = 'grab';
      sticky.x = parseInt(card.style.left) || 0;
      sticky.y = parseInt(card.style.top) || 0;
      saveStickies();
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  card.appendChild(header);
  card.appendChild(editor);
  return card;
}

// ============================================================
// BIND EVENTS
// ============================================================

function bindEvents() {
  // Navigation
  $('btnPrevPeriod').addEventListener('click', prevPeriod);
  $('btnNextPeriod').addEventListener('click', nextPeriod);
  $('btnToday').addEventListener('click', goToToday);

  // View switcher
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Quick input — support batch (paste multi-baris atau pisahkan dengan ;)
  const quickInput = $('quickInput');

  function submitQuickInput() {
    const raw = quickInput.value.trim();
    if (!raw) { quickInput.focus(); return; }

    // Batch mode: split by semicolon
    const lines = raw.split(';').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      let count = 0;
      lines.forEach(line => {
        const { text, cat, priority, dateStr } = parseQuickInput(line);
        if (text) { addTask(dateStr, text, cat, priority, null, 'none', true); count++; }
      });
      quickInput.value = '';
      if (count > 0) showToast(`${count} task berhasil ditambahkan`);
      else showToast('Tidak ada task valid');
    } else {
      const { text, cat, priority, dateStr } = parseQuickInput(raw);
      if (!text) { showToast('Teks task tidak boleh kosong'); quickInput.focus(); return; }
      addTask(dateStr, text, cat, priority, null, 'none');
      quickInput.value = '';
    }
  }

  $('btnQuickAdd').addEventListener('click', submitQuickInput);
  quickInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitQuickInput();
  });

  // Intercept paste untuk mendeteksi multi-line dari clipboard
  quickInput.addEventListener('paste', (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (pasted.includes('\n')) {
      e.preventDefault();
      const lines = pasted.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length > 1) {
        let count = 0;
        lines.forEach(line => {
          const { text, cat, priority, dateStr } = parseQuickInput(line);
          if (text) { addTask(dateStr, text, cat, priority, null, 'none', true); count++; }
        });
        quickInput.value = '';
        showToast(count > 0 ? `${count} task berhasil ditambahkan` : 'Tidak ada task valid dalam teks yang di-paste');
      } else {
        // Satu baris saja, pasang ke input
        quickInput.value = lines[0] || '';
      }
    }
  });

  // Tombol ? bantuan quick input
  const btnHelp    = $('btnQuickHelp');
  const helpTooltip = $('quickHelpTooltip');
  btnHelp.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !helpTooltip.hidden;
    helpTooltip.hidden = isOpen;
    btnHelp.classList.toggle('is-open', !isOpen);
  });
  // Tutup tooltip saat klik di luar
  document.addEventListener('click', (e) => {
    if (!btnHelp.contains(e.target) && !helpTooltip.contains(e.target)) {
      helpTooltip.hidden = true;
      btnHelp.classList.remove('is-open');
    }
  });


  // Modal
  $('btnModalClose').addEventListener('click', closeModal);
  $('btnCancelModal').addEventListener('click', closeModal);
  $('btnSaveTask').addEventListener('click', saveTaskFromModal);
  DOM.modalOverlay.addEventListener('click', e => { if (e.target === DOM.modalOverlay) closeModal(); });
  DOM.taskInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveTaskFromModal();
    if (e.key === 'Escape') closeModal();
  });

  // Detail panel
  $('btnDetailClose').addEventListener('click', closeDetailPanel);

  // Filter kategori
  document.querySelectorAll('.filter-check').forEach(chk => {
    chk.addEventListener('change', () => {
      state.filters[chk.dataset.cat] = chk.checked;
      renderCurrentView();
    });
  });

  // Filter prioritas
  document.querySelectorAll('.filter-check-p').forEach(chk => {
    chk.addEventListener('change', () => {
      state.prioFilters[chk.dataset.priority] = chk.checked;
      renderCurrentView();
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      $('quickInput').focus();
    }
    if (e.ctrlKey && e.key === ',') {
      e.preventDefault();
      $('settingsOverlay').hidden ? openSettings() : closeSettings();
    }
    if (e.key === 'Escape') {
      if (!$('confirmOverlay').hidden) closeConfirmDialog();
      else if (!$('settingsOverlay').hidden) closeSettings();
      else if (!DOM.modalOverlay.hidden) closeModal();
      else if (!DOM.detailPanel.hidden) closeDetailPanel();
    }
    if (DOM.modalOverlay.hidden && DOM.detailPanel.hidden && $('settingsOverlay').hidden) {
      if (e.key === 'ArrowLeft')  prevPeriod();
      if (e.key === 'ArrowRight') nextPeriod();
    }
  });

  // ---- Confirm dialog ----
  $('btnConfirmCancel').addEventListener('click', closeConfirmDialog);
  $('btnConfirmOk').addEventListener('click', () => {
    if (typeof _confirmCallback === 'function') _confirmCallback();
    closeConfirmDialog();
  });
  $('confirmOverlay').addEventListener('click', e => {
    if (e.target === $('confirmOverlay')) closeConfirmDialog();
  });

  // ---- Settings modal ----
  $('btnSettings').addEventListener('click', openSettings);
  $('btnSettingsClose').addEventListener('click', closeSettings);
  $('settingsOverlay').addEventListener('click', e => {
    if (e.target === $('settingsOverlay')) closeSettings();
  });

  if (DOM.btnOpenNotepad) {
    DOM.btnOpenNotepad.addEventListener('click', () => switchView('notepad'));
  }
  if (DOM.btnAddSticky) {
    DOM.btnAddSticky.addEventListener('click', () => {
      const newSticky = { id: genId(), text: '', color: 'yellow' };
      if (state.scatteredLayout) {
        // Place new sticky at a somewhat random but visible position
        const count = state.stickies.length;
        newSticky.x = 20 + (count % 4) * 220 + Math.floor(Math.random() * 30);
        newSticky.y = 20 + Math.floor(count / 4) * 210 + Math.floor(Math.random() * 30);
      }
      state.stickies.push(newSticky);
      saveStickies();
      renderNotepad();
    });
  }
  if (DOM.btnLayoutToggle) {
    DOM.btnLayoutToggle.addEventListener('click', toggleLayout);
  }

  // Prevent file drag&drop from opening as gallery on main window
  document.addEventListener('dragover', (e) => {
    // Allow internal task drag&drop to work, but prevent file drops from navigating
    if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
    }
  });
  document.addEventListener('drop', (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
    }
  });

  // Export
  $('btnExportData').addEventListener('click', exportTasks);

  // Import
  const importBtn   = $('btnImportData');
  const importInput = $('importFileInput');
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importTasks(file);
    importInput.value = ''; // reset agar file yang sama bisa dipilih lagi
  });

  // Link kredensial di settings — buka di browser default
  document.querySelectorAll('.scl-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const url = link.href;
      if (window.electronAPI && window.electronAPI.openExternal) {
        window.electronAPI.openExternal(url);
      } else {
        window.open(url, '_blank');
      }
    });
  });


  // Window controls (Electron)
  if (window.electronAPI) {
    DOM.btnMinimize.addEventListener('click', () => window.electronAPI.minimize());
    DOM.btnClose.addEventListener('click',    () => window.electronAPI.close());
    DOM.btnPin.addEventListener('click',      () => window.electronAPI.togglePin());

    window.electronAPI.onPinStatusChanged(isPinned => {
      DOM.btnPin.classList.toggle('is-pinned', isPinned);
      DOM.btnPin.title = isPinned ? 'Lepas pin' : 'Pin (Selalu di Atas)';
      showToast(isPinned ? 'Window di-pin di atas' : 'Pin dilepas');
    });

    if (window.electronAPI.onStickyUpdate) {
      window.electronAPI.onStickyUpdate((data) => {
        const idx = state.stickies.findIndex(s => s.id === data.id);
        if (idx !== -1) {
          state.stickies[idx].text = data.text;
          state.stickies[idx].color = data.color;
          saveStickies();
          // Update visual di viewNotepad jika sedang aktif
          if (state.view === 'notepad') {
            const card = DOM.boardGrid.querySelector(`.sticky-note[data-id="${data.id}"]`);
            if (card) {
              card.dataset.color = data.color;
              const txtBox = card.querySelector('.sticky-content');
              if (txtBox && txtBox.innerHTML !== data.text) txtBox.innerHTML = data.text;
            }
          }
        }
      });
    }
  }
}

// ============================================================
// INIT
// ============================================================

async function init() {
  loadTasks();
  loadStickies();
  loadLayoutPref();
  bindEvents();
  updateSidebarHeader();

  // Muat data libur (async, tidak block render)
  loadHolidays(state.year).then(() => renderCurrentView());
  // Juga muat tahun berikutnya untuk navigasi mulus
  loadHolidays(state.year + 1);

  renderCurrentView();
  startReminderPolling();

  // Minta izin notifikasi
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Salam hari ini
  const now = new Date();
  showToast(`📅 ${DAYS_FULL[now.getDay()]}, ${now.getDate()} ${MONTHS_ID[now.getMonth()]} ${now.getFullYear()}`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
