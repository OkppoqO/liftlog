(() => {
'use strict';

/* ========== 動作資料 ========== */
const PARTS = window.LIFTLOG_PARTS;
const EQUIPS = window.LIFTLOG_EQUIPS;
const LEGACY = window.LIFTLOG_LEGACY;
const BUILTIN = window.LIFTLOG_EXERCISES.map(([name, part, equip, en, img, level]) => ({ name, part, equip, en, img, level, custom: false }));
const BUILTIN_NAMES = new Set(BUILTIN.map(e => e.name));
const LEVEL_LABEL = ['', '初階', '中階', '進階'];
const STORAGE_KEY = 'liftlog_v1';
const RPE_OPTIONS = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const fixName = n => LEGACY[n] || String(n);

let state = defaultState();
function defaultState() {
  return {
    sets: [], customExercises: [], plans: [],
    settings: { restDefault: 90, autoStartTimer: true, keepAwake: false, lastExportAt: null, activePlanId: null }
  };
}

/* ========== 工具函式 ========== */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = n => String(n).padStart(2, '0');
const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());
const parseISO = iso => new Date(iso + 'T00:00:00');
const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const fmt = (n, d = 1) => round(n, d).toLocaleString('zh-TW', { maximumFractionDigits: d });
const shortDate = iso => { const [, m, d] = iso.split('-'); return `${+m}/${+d}`; };
const weekday = iso => '日一二三四五六'[parseISO(iso).getDay()];
const fmtTime = sec => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
const mondayOf = iso => { const d = parseISO(iso); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return toISO(d); };

/* ========== 動作目錄 ========== */
let cache = null;
function invalidate() { cache = null; }
function catalog() {
  if (cache && cache.catalog) return cache.catalog;
  const list = [...BUILTIN, ...state.customExercises.map(c => ({ ...c, en: '', img: null, level: 0, custom: true }))];
  const names = new Set(list.map(e => e.name));
  state.sets.forEach(s => {
    if (!names.has(s.exercise)) { names.add(s.exercise); list.push({ name: s.exercise, part: '其他', equip: '器械', en: '', img: null, level: 0, custom: true, orphan: true }); }
  });
  const map = new Map(list.map(e => [e.name, e]));
  cache = cache || {};
  cache.catalog = { list, map };
  return cache.catalog;
}
const exInfo = name => catalog().map.get(name) || { name, part: '其他', equip: '器械', img: null, custom: true };
const isBW = name => exInfo(name).equip === '自重';
const allParts = () => { const l = catalog().list; return [...PARTS, '其他'].filter(p => l.some(e => e.part === p)); };

/* 圖片：兩張示範圖交替，看起來像動態示範 */
function thumbHTML(name, { anim = false, cls = '' } = {}) {
  const e = exInfo(name);
  if (!e.img) return `<span class="thumb none ${cls}">${esc([...name][0] || '?')}</span>`;
  const src = k => `img/ex/${encodeURIComponent(e.img)}-${k}.jpg`;
  return `<span class="thumb ${anim ? 'anim' : ''} ${cls}"><img src="${src(0)}" alt="" loading="lazy">${anim ? `<img src="${src(1)}" alt="" loading="lazy">` : ''}</span>`;
}

/* 1RM 與 PR 分數：自重動作以「負重優先、再比次數」 */
const e1rm = s => s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30);
const score = s => isBW(s.exercise) ? s.weight * 1000 + s.reps : e1rm(s);
function setText(s, short = false) {
  if (isBW(s.exercise)) {
    const w = s.weight > 0 ? (short ? `+${fmt(s.weight)}` : `自重+${fmt(s.weight)}kg`) : '自重';
    return `${w} × ${s.reps}`;
  }
  return short ? `${fmt(s.weight)}×${s.reps}` : `${fmt(s.weight)}kg × ${s.reps}`;
}

/* ========== 索引（每次存檔後重算） ========== */
function idx() {
  if (cache && cache.idx) return cache.idx;
  const chrono = state.sets.map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.date.localeCompare(b.s.date) || a.i - b.i).map(x => x.s);
  const last = new Map(), best = new Map(), prIds = new Set(), byDate = new Map(), lastDate = new Map();
  chrono.forEach(s => {
    last.set(s.exercise, s);
    lastDate.set(s.exercise, s.date);
    const v = score(s), b = best.get(s.exercise);
    if (b !== undefined && v > b.v + 1e-9) prIds.add(s.id);
    if (b === undefined || v > b.v) best.set(s.exercise, { v, s });
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  });
  cache = cache || {};
  cache.idx = { chrono, last, best, prIds, byDate, lastDate };
  return cache.idx;
}
/* 同一天、同一動作合併成一組（依第一次出現的順序） */
function groupDay(date) {
  const sets = idx().byDate.get(date) || [];
  const groups = new Map();
  sets.forEach(s => { if (!groups.has(s.exercise)) groups.set(s.exercise, []); groups.get(s.exercise).push(s); });
  return [...groups.entries()].map(([exercise, list]) => ({ exercise, sets: list }));
}

/* ========== 儲存：IndexedDB ========== */
function validSet(s) {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.exercise &&
    isFinite(+s.weight) && +s.weight >= 0 && isFinite(+s.reps) && +s.reps >= 1;
}
function normalize(d) {
  const out = defaultState();
  if (!d || typeof d !== 'object') return out;
  if (Array.isArray(d.sets)) {
    const ids = new Set();
    out.sets = d.sets.filter(validSet).map((s, i) => {
      let id = String(s.id || uid());
      if (ids.has(id)) id = uid() + i;
      ids.add(id);
      const rpe = +s.rpe;
      return {
        id, date: s.date, exercise: fixName(s.exercise),
        weight: +s.weight, reps: Math.round(+s.reps), note: s.note ? String(s.note) : '',
        rpe: s.rpe != null && rpe >= 1 && rpe <= 10 ? rpe : null,
        createdAt: +s.createdAt || i + 1
      };
    });
  }
  if (Array.isArray(d.customExercises)) {
    const seen = new Set(BUILTIN_NAMES);
    d.customExercises.forEach(c => {
      const name = c && c.name ? fixName(String(c.name).trim()) : '';
      if (name && !seen.has(name)) {
        seen.add(name);
        out.customExercises.push({
          name, part: [...PARTS, '其他'].includes(c.part) ? c.part : '其他',
          equip: EQUIPS.includes(c.equip) ? c.equip : '器械'
        });
      }
    });
  }
  if (Array.isArray(d.plans)) {
    out.plans = d.plans.filter(p => p && p.name && Array.isArray(p.items)).map(p => ({
      id: String(p.id || uid()), name: String(p.name).slice(0, 20),
      items: p.items.filter(it => it && it.exercise).map(it => ({ exercise: fixName(it.exercise), sets: Math.min(20, Math.max(1, Math.round(+it.sets) || 3)) }))
    }));
  }
  if (d.settings) {
    const r = +d.settings.restDefault;
    if (r >= 5 && r <= 600) out.settings.restDefault = r;
    ['autoStartTimer', 'keepAwake'].forEach(k => { if (typeof d.settings[k] === 'boolean') out.settings[k] = d.settings[k]; });
    if (d.settings.lastExportAt && !isNaN(Date.parse(d.settings.lastExportAt))) out.settings.lastExportAt = d.settings.lastExportAt;
    if (d.settings.activePlanId && out.plans.some(p => p.id === d.settings.activePlanId)) out.settings.activePlanId = d.settings.activePlanId;
  }
  return out;
}

const DB_NAME = 'liftlog', DB_VERSION = 1;
let db = null, storageOK = true;
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('sets')) {
        const st = d.createObjectStore('sets', { keyPath: 'id' });
        st.createIndex('date', 'date');
        st.createIndex('exercise', 'exercise');
      }
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = tx.onabort = () => rej(tx.error); });
async function idbReadAll() {
  const tx = db.transaction(['sets', 'meta'], 'readonly');
  const meta = tx.objectStore('meta');
  const [sets, customExercises, plans, settings] = await Promise.all([
    reqP(tx.objectStore('sets').getAll()), reqP(meta.get('customExercises')), reqP(meta.get('plans')), reqP(meta.get('settings'))
  ]);
  sets.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return { sets, customExercises: customExercises || [], plans: plans || [], settings: settings || {} };
}
let persisted = new Map();
let saveChain = Promise.resolve();
async function idbSave() {
  const tx = db.transaction(['sets', 'meta'], 'readwrite');
  const st = tx.objectStore('sets');
  const next = new Map();
  state.sets.forEach(s => {
    const j = JSON.stringify(s);
    next.set(s.id, j);
    if (persisted.get(s.id) !== j) st.put(s);
  });
  persisted.forEach((_, id) => { if (!next.has(id)) st.delete(id); });
  const meta = tx.objectStore('meta');
  meta.put(state.customExercises, 'customExercises');
  meta.put(state.plans, 'plans');
  meta.put(state.settings, 'settings');
  await txDone(tx);
  persisted = next;
}
async function load() {
  try {
    db = await idbOpen();
    const data = await idbReadAll();
    let legacy = null;
    try { legacy = localStorage.getItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
    if (!data.sets.length && !data.customExercises.length && legacy) {
      state = normalize(JSON.parse(legacy));
      persisted = new Map();
      await idbSave();
      try { localStorage.setItem(STORAGE_KEY + '_migrated', legacy); localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 忽略 */ }
    } else {
      state = normalize(data);
      persisted = new Map(data.sets.map(s => [s.id, JSON.stringify(s)]));
      /* 舊名稱改名後要寫回資料庫 */
      if (state.sets.some(s => persisted.get(s.id) !== JSON.stringify(s))) save();
    }
  } catch (e) {
    db = null;
    try {
      localStorage.setItem('__liftlog_test', '1'); localStorage.removeItem('__liftlog_test');
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = normalize(JSON.parse(raw));
    } catch (err) { storageOK = false; }
  }
  invalidate();
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* 忽略 */ }
}
function save() {
  invalidate();
  if (!storageOK) return;
  if (db) { saveChain = saveChain.then(idbSave).catch(() => toast('⚠️ 無法寫入資料庫，請先匯出備份')); return; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { toast('⚠️ 無法儲存，請先匯出備份'); }
}

/* ========== 共用 UI ========== */
let toastTimer;
function toast(msg, gold = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('gold', gold);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
function askConfirm(msg, { ok = '確定', danger = false } = {}) {
  return new Promise(resolve => {
    const ov = $('#confirmOverlay'), yes = $('#confirmYes'), no = $('#confirmNo');
    $('#confirmMsg').textContent = msg;
    yes.textContent = ok;
    yes.className = 'btn ' + (danger ? 'danger' : 'primary');
    const done = v => { ov.classList.remove('open'); yes.onclick = no.onclick = ov.onclick = null; resolve(v); };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    ov.onclick = e => { if (e.target === ov) done(false); };
    ov.classList.add('open');
  });
}
function bindEnter(formSel, fn) {
  const form = $(formSel);
  form.addEventListener('submit', e => { e.preventDefault(); fn(); });
  form.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); fn(); } });
}
const openOverlay = id => $(id).classList.add('open');
const closeOverlay = el => (typeof el === 'string' ? $(el) : el).classList.remove('open');
$$('.overlay:not(#confirmOverlay)').forEach(ov => {
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-close]')) closeOverlay(ov); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#confirmOverlay').classList.contains('open')) { $('#confirmNo').click(); return; }
  const open = $$('.overlay.open');
  if (open.length) closeOverlay(open[open.length - 1]);
});
const rpeOpts = '<option value="">—</option>' + RPE_OPTIONS.map(v => `<option value="${v}">${v}${v === 10 ? '（力竭）' : v === 8 ? '（還剩 2 下）' : ''}</option>`).join('');
$('#fRpe').innerHTML = rpeOpts;
$('#eRpe').innerHTML = rpeOpts;

/* 加減按鈕：重量的跳距依器材（啞鈴 1kg，其他 2.5kg） */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const input = document.getElementById(b.dataset.step);
  if (!input) return;
  const dir = +b.dataset.dir;
  let step = 1;
  if (input.id === 'fWeight') step = exInfo(curEx).equip === '啞鈴' ? 1 : 2.5;
  const min = input.min !== '' ? +input.min : 0;
  const max = input.max ? +input.max : Infinity;
  const cur = input.value === '' ? min : +input.value;
  input.value = Math.min(max, Math.max(min, round(cur + dir * step, 2)));
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

/* ========== 分頁 ========== */
let currentTab = 'train';
function showTab(tab) {
  currentTab = tab;
  $$('#nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + tab));
  renderTab();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) showTab(b.dataset.tab); });
function renderTab() {
  if (currentTab === 'train') renderTrain();
  else if (currentTab === 'cal') renderCalendar();
  else if (currentTab === 'plans') renderPlans();
  else if (currentTab === 'progress') renderProgress();
}

/* ========== 訓練頁 ========== */
let curDate = todayISO();
let curEx = '';
let flashIds = [];

function activePlan() { return state.plans.find(p => p.id === state.settings.activePlanId) || null; }
function doneCount(ex, date = curDate) { return (idx().byDate.get(date) || []).filter(s => s.exercise === ex).length; }

/* 選動作時，自動帶入「這個動作」上次的重量與次數 */
function selectExercise(name, { prefill = true } = {}) {
  curEx = name;
  if (prefill) {
    const last = idx().last.get(name);
    if (last) {
      $('#fWeight').value = last.weight;
      $('#fReps').value = last.reps;
      $('#fRpe').value = last.rpe == null ? '' : String(last.rpe);
    } else {
      $('#fWeight').value = isBW(name) ? 0 : '';
      const item = activePlan() && activePlan().items.find(it => it.exercise === name);
      $('#fReps').value = isBW(name) ? 12 : 10;
      if (item && item.reps) $('#fReps').value = item.reps;
      $('#fRpe').value = '';
    }
    $('#fCount').value = 1;
    $('#formError').textContent = '';
  }
  renderTrain();
}

function renderDateBar() {
  const t = todayISO();
  $('#fDate').value = curDate;
  $('#dateLabel').innerHTML = `${curDate === t ? '今天' : curDate === addDays(t, -1) ? '昨天' : shortDate(curDate)}<small>${shortDate(curDate)}（${weekday(curDate)}）</small>`;
  $('#dateNext').disabled = curDate >= t;
  $('#dateNext').style.opacity = curDate >= t ? .3 : 1;
}

function renderPlanBar() {
  const ap = activePlan();
  $('#planBar').innerHTML = `<button type="button" class="chip ${ap ? '' : 'active'}" data-plan="">自由訓練</button>` +
    state.plans.map(p => `<button type="button" class="chip ${ap && ap.id === p.id ? 'active' : ''}" data-plan="${esc(p.id)}">${esc(p.name)}</button>`).join('') +
    `<button type="button" class="chip add" data-plan-new>＋ 建立菜單</button>`;
  const card = $('#planCard');
  if (!ap) { card.hidden = true; return; }
  card.hidden = false;
  let doneSets = 0, totalSets = 0;
  $('#planTitle').textContent = `今日菜單：${ap.name}`;
  $('#planList').innerHTML = ap.items.length ? ap.items.map(it => {
    const n = doneCount(it.exercise);
    doneSets += Math.min(n, it.sets); totalSets += it.sets;
    const last = idx().last.get(it.exercise);
    return `<button type="button" class="plan-ex ${it.exercise === curEx ? 'cur' : ''} ${n >= it.sets ? 'done' : ''}" data-ex="${esc(it.exercise)}">
      ${thumbHTML(it.exercise)}
      <span class="info"><span class="nm">${esc(it.exercise)}</span><span class="sub">${last ? '上次 ' + setText(last) : '還沒做過'}</span></span>
      <span class="prog">${n}/${it.sets}</span></button>`;
  }).join('') : '<div class="empty-block">這個菜單還沒有動作，到「菜單」分頁加入吧</div>';
  $('#planProg').textContent = totalSets ? `${doneSets}/${totalSets} 組` : '';
}

function renderCurrent() {
  const e = exInfo(curEx);
  const th = $('#curThumb');
  th.className = 'thumb big ' + (e.img ? 'anim' : 'none');
  th.innerHTML = e.img
    ? [0, 1].map(k => `<img src="img/ex/${encodeURIComponent(e.img)}-${k}.jpg" alt="">`).join('')
    : esc([...curEx][0] || '?');
  $('#curName').textContent = curEx;
  $('#curTags').innerHTML = `<span class="tag">${esc(e.part)}</span><span class="tag eq">${esc(e.equip)}</span>${e.level ? `<span class="tag">${LEVEL_LABEL[e.level]}</span>` : ''}`;
  const bw = isBW(curEx);
  $('#weightLabel').textContent = bw ? '額外負重 kg（0＝自重）' : '重量 (kg)';
  $('#fWeight').placeholder = bw ? '0' : '重量';
  const last = idx().last.get(curEx), best = idx().best.get(curEx);
  $('#lastHint').innerHTML = last
    ? `上次：<b>${setText(last)}</b>（${shortDate(last.date)}）・最佳 <b>${setText(best.s)}</b>`
    : '這個動作還沒有紀錄，第一次做先從輕重量開始 💪';
  const today = (idx().byDate.get(curDate) || []).filter(s => s.exercise === curEx);
  const item = activePlan() && activePlan().items.find(it => it.exercise === curEx);
  $('#btnLog').textContent = `＋ 記錄第 ${today.length + 1} 組${item ? `（目標 ${item.sets} 組）` : ''}`;
  $('#curSets').innerHTML = today.length ? `<div class="set-chips">${today.map((s, i) => setChip(s, i)).join('')}</div>` : '';
}
function setChip(s, i) {
  const pr = idx().prIds.has(s.id);
  return `<button type="button" class="set-chip ${pr ? 'pr' : ''} ${flashIds.includes(s.id) ? 'flash' : ''}" data-edit="${esc(s.id)}"><i>${i + 1}</i>${setText(s, true)}${s.rpe != null ? `<i style="margin:0 0 0 4px">@${s.rpe}</i>` : ''}${pr ? ' 🏆' : ''}</button>`;
}
function groupsHTML(date, { showThumb = true } = {}) {
  const groups = groupDay(date);
  if (!groups.length) return '';
  return groups.map(g => {
    const notes = g.sets.filter(s => s.note).map(s => s.note);
    return `<div class="ex-group">
      ${showThumb ? `<button type="button" class="thumb-btn" data-info="${esc(g.exercise)}" style="background:none;border:none;padding:0">${thumbHTML(g.exercise)}</button>` : ''}
      <div class="body">
        <div class="nm" data-select="${esc(g.exercise)}"><span>${esc(g.exercise)}</span><small>${g.sets.length} 組</small></div>
        <div class="set-chips">${g.sets.map((s, i) => setChip(s, i)).join('')}</div>
        ${notes.length ? `<div class="note-line">📝 ${notes.map(esc).join('・')}</div>` : ''}
      </div></div>`;
  }).join('');
}
function daySummary(date) {
  const sets = idx().byDate.get(date) || [];
  if (!sets.length) return '';
  const vol = sets.reduce((a, s) => a + s.weight * s.reps, 0);
  return `${groupDay(date).length} 個動作・${sets.length} 組${vol ? `・${fmt(vol, 0)} kg` : ''}`;
}
function renderTrain() {
  renderDateBar();
  renderPlanBar();
  renderCurrent();
  $('#daySum').textContent = daySummary(curDate);
  $('#dayGroups').innerHTML = groupsHTML(curDate) || '<div class="empty-block">這天還沒有紀錄。選好動作、輸入重量次數，按「記錄」就好。</div>';
  flashIds = [];
}

$('#datePrev').addEventListener('click', () => { curDate = addDays(curDate, -1); renderTrain(); });
$('#dateNext').addEventListener('click', () => { if (curDate < todayISO()) { curDate = addDays(curDate, 1); renderTrain(); } });
$('#fDate').addEventListener('change', e => { if (e.target.value) { curDate = e.target.value > todayISO() ? todayISO() : e.target.value; renderTrain(); } });
$('#planBar').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  if (b.hasAttribute('data-plan-new')) { openPlanEditor(null); return; }
  state.settings.activePlanId = b.dataset.plan || null;
  save();
  const ap = activePlan();
  if (ap && ap.items.length) {
    const next = ap.items.find(it => doneCount(it.exercise) < it.sets) || ap.items[0];
    selectExercise(next.exercise);
  } else renderTrain();
});
$('#planList').addEventListener('click', e => { const b = e.target.closest('[data-ex]'); if (b) { selectExercise(b.dataset.ex); $('#curCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
$('#btnPick').addEventListener('click', () => openPicker({ mode: 'single', onPick: name => { selectExercise(name); } }));
document.addEventListener('click', e => {
  if (e.target.closest('#curThumb')) openDetail(curEx);
});

function logSet() {
  const wRaw = $('#fWeight').value.trim();
  const rRaw = $('#fReps').value.trim();
  const cRaw = $('#fCount').value.trim();
  const bw = isBW(curEx);
  let err = '';
  if (!curEx) err = '請先選擇動作';
  else if (wRaw === '' && !bw) err = '請輸入重量（自重動作可以留空）';
  else if (wRaw !== '' && (!isFinite(+wRaw) || +wRaw < 0)) err = '重量需為 0 以上的數字';
  else if (+wRaw > 1000) err = '重量超過 1000kg，請確認是否輸入錯誤';
  else if (rRaw === '' || !Number.isInteger(+rRaw) || +rRaw < 1) err = '次數需為 1 以上的整數';
  else if (+rRaw > 200) err = '次數超過 200，請確認是否輸入錯誤';
  const count = cRaw === '' ? 1 : +cRaw;
  if (!err && (!Number.isInteger(count) || count < 1 || count > 10)) err = '組數需為 1～10 的整數';
  $('#formError').textContent = err;
  if (err) { toast('⚠️ ' + err); return; }
  const rpe = $('#fRpe').value;
  const base = { date: curDate, exercise: curEx, weight: wRaw === '' ? 0 : round(+wRaw, 2), reps: +rRaw, note: $('#fNote').value.trim(), rpe: rpe === '' ? null : +rpe };
  const prev = idx().best.get(curEx);
  const now = Date.now();
  const added = Array.from({ length: count }, (_, i) => ({ id: uid() + i, ...base, createdAt: now + i }));
  state.sets.push(...added);
  save();
  flashIds = added.map(s => s.id);
  $('#fNote').value = '';
  $('#fCount').value = 1;
  const s = added[0];
  if (prev && score(s) > prev.v + 1e-9) toast(`🏆 新 PR！${s.exercise} ${setText(s)}`, true);
  else toast(`✅ ${s.exercise} ${setText(s)}${count > 1 ? ` × ${count} 組` : ''}`);

  /* 菜單模式：這個動作做完目標組數，自動換下一個 */
  const ap = activePlan();
  const item = ap && ap.items.find(it => it.exercise === curEx);
  if (item && doneCount(curEx) >= item.sets) {
    const next = ap.items.find(it => doneCount(it.exercise) < it.sets);
    if (next) { setTimeout(() => toast(`👉 下一個：${next.exercise}`), 1500); selectExercise(next.exercise); }
    else { setTimeout(() => toast('🎉 今日菜單全部完成！', true), 1500); renderTrain(); }
  } else renderTrain();
  if (state.settings.autoStartTimer && curDate === todayISO()) startTimer(state.settings.restDefault);
}
bindEnter('#logForm', logSet);
$('#btnLog').addEventListener('click', logSet);

/* 點組數晶片＝編輯；點動作名稱＝切換到該動作 */
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-edit]');
  if (chip) { openEdit(chip.dataset.edit); return; }
  const sel = e.target.closest('[data-select]');
  if (sel) {
    if (currentTab !== 'train') showTab('train');
    selectExercise(sel.dataset.select);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const info = e.target.closest('[data-info]');
  if (info && !info.closest('#pickerOverlay')) openDetail(info.dataset.info);
});

/* ========== 編輯單組 ========== */
let editingId = null;
function exerciseOptions(selected) {
  const list = catalog().list;
  let html = '';
  allParts().forEach(p => {
    [...EQUIPS].forEach(eq => {
      const items = list.filter(e => e.part === p && e.equip === eq);
      if (items.length) html += `<optgroup label="${p}・${eq}">` + items.map(e => `<option value="${esc(e.name)}"${e.name === selected ? ' selected' : ''}>${esc(e.name)}</option>`).join('') + '</optgroup>';
    });
  });
  return html;
}
function openEdit(id) {
  const s = state.sets.find(x => x.id === id);
  if (!s) return;
  editingId = id;
  $('#eExercise').innerHTML = exerciseOptions(s.exercise);
  $('#eDate').value = s.date;
  $('#eWeight').value = s.weight;
  $('#eReps').value = s.reps;
  $('#eNote').value = s.note || '';
  $('#eRpe').value = s.rpe == null ? '' : String(s.rpe);
  $('#eWeightLabel').textContent = isBW(s.exercise) ? '額外負重 kg' : '重量 (kg)';
  $('#editError').textContent = '';
  openOverlay('#editOverlay');
}
$('#eExercise').addEventListener('change', e => { $('#eWeightLabel').textContent = isBW(e.target.value) ? '額外負重 kg' : '重量 (kg)'; });
function saveEdit() {
  const i = state.sets.findIndex(x => x.id === editingId);
  if (i < 0) return;
  const date = $('#eDate').value, w = $('#eWeight').value.trim(), r = $('#eReps').value.trim(), ex = $('#eExercise').value;
  let err = '';
  if (!date) err = '請選擇日期';
  else if (w !== '' && (!isFinite(+w) || +w < 0 || +w > 1000)) err = '重量需為 0～1000';
  else if (w === '' && !isBW(ex)) err = '請輸入重量';
  else if (!Number.isInteger(+r) || +r < 1 || +r > 200) err = '次數需為 1～200 的整數';
  $('#editError').textContent = err;
  if (err) return;
  const rpe = $('#eRpe').value;
  state.sets[i] = { ...state.sets[i], date, exercise: ex, weight: w === '' ? 0 : round(+w, 2), reps: +r, note: $('#eNote').value.trim(), rpe: rpe === '' ? null : +rpe };
  flashIds = [editingId];
  save();
  closeOverlay('#editOverlay');
  renderTab();
  toast('✏️ 已更新');
}
bindEnter('#editForm', saveEdit);
$('#btnEditSave').addEventListener('click', saveEdit);
$('#btnEditDel').addEventListener('click', async () => {
  const s = state.sets.find(x => x.id === editingId);
  if (!s) return;
  if (!await askConfirm(`刪除這組？\n${s.exercise} ${setText(s)}（${shortDate(s.date)}）`, { ok: '刪除', danger: true })) return;
  state.sets = state.sets.filter(x => x.id !== s.id);
  save();
  closeOverlay('#editOverlay');
  renderTab();
  toast('🗑 已刪除');
});

/* ========== 動作庫（部位 → 器材 → 動作） ========== */
const picker = { mode: 'single', part: '胸', equip: '', q: '', selected: [], onPick: null };
function openPicker({ mode = 'single', onPick, title } = {}) {
  picker.mode = mode;
  picker.onPick = onPick;
  picker.selected = [];
  picker.q = '';
  $('#pkSearch').value = '';
  const p = exInfo(curEx).part;
  picker.part = mode === 'single' && idx().lastDate.size ? '最近' : (PARTS.includes(p) ? p : '胸');
  picker.equip = '';
  $('#pkTitle').textContent = title || (mode === 'multi' ? '加入動作到菜單' : '選擇動作');
  $('#pkFoot').hidden = mode !== 'multi';
  renderPicker();
  openOverlay('#pickerOverlay');
  $('#pkList').scrollTop = 0;
}
function pickerItems() {
  const list = catalog().list;
  const q = picker.q.trim().toLowerCase();
  if (q) return list.filter(e => e.name.toLowerCase().includes(q) || (e.en && e.en.toLowerCase().includes(q)));
  if (picker.part === '最近') {
    const ld = idx().lastDate;
    return list.filter(e => ld.has(e.name) && (!picker.equip || e.equip === picker.equip))
      .sort((a, b) => ld.get(b.name).localeCompare(ld.get(a.name))).slice(0, 40);
  }
  return list.filter(e => e.part === picker.part && (!picker.equip || e.equip === picker.equip));
}
function renderPicker() {
  const parts = [...(idx().lastDate.size ? ['最近'] : []), ...allParts()];
  $('#pkParts').innerHTML = parts.map(p => `<button type="button" class="${p === picker.part && !picker.q ? 'active' : ''}" data-part="${p}">${p}</button>`).join('');
  const base = picker.part === '最近' ? catalog().list.filter(e => idx().lastDate.has(e.name)) : catalog().list.filter(e => e.part === picker.part);
  const eqs = EQUIPS.filter(eq => base.some(e => e.equip === eq));
  $('#pkEquips').innerHTML = picker.q ? '' : `<button type="button" class="chip ${picker.equip ? '' : 'active'}" data-equip="">全部</button>` +
    eqs.map(eq => `<button type="button" class="chip ${picker.equip === eq ? 'active' : ''}" data-equip="${eq}">${eq} ${base.filter(e => e.equip === eq).length}</button>`).join('');
  const items = pickerItems();
  const row = e => {
    const last = idx().last.get(e.name);
    const sel = picker.selected.includes(e.name) || (picker.mode === 'single' && e.name === curEx);
    return `<div class="pk-row ${sel ? 'sel' : ''}">
      <button type="button" class="main" data-pick="${esc(e.name)}">${thumbHTML(e.name)}
        <span class="info"><span class="nm">${esc(e.name)}</span>
        <span class="sub">${picker.q || picker.part === '最近' ? `${e.part}・${e.equip}・` : ''}${last ? `<b>上次 ${setText(last)}</b>` : (e.en ? esc(e.en) : '自訂動作')}</span></span>
      </button>
      ${picker.mode === 'multi' ? `<span class="check" data-pick="${esc(e.name)}">${sel ? '✓' : ''}</span>` : ''}
      <button type="button" class="icon-btn" data-pinfo="${esc(e.name)}" aria-label="查看 ${esc(e.name)} 示範">ⓘ</button>
    </div>`;
  };
  let html = '';
  if (!items.length) html = `<div class="empty-block">${picker.q ? '找不到這個動作，可以在下方新增自訂動作' : '這個分類沒有動作'}</div>`;
  else if (picker.q || picker.equip || picker.part === '最近') html = items.map(row).join('');
  else EQUIPS.forEach(eq => {
    const g = items.filter(e => e.equip === eq);
    if (g.length) html += `<div class="pk-sec">${eq}（${g.length}）</div>` + g.map(row).join('');
  });
  const defPart = PARTS.includes(picker.part) ? picker.part : '胸';
  html += `<details class="pk-custom" ${picker.q && !items.length ? 'open' : ''}><summary>＋ 找不到？新增自訂動作</summary>
    <form class="add-ex" id="addExForm" novalidate>
      <input type="text" id="newExName" maxlength="24" placeholder="動作名稱" value="${esc(picker.q)}">
      <select id="newExPart">${[...PARTS, '其他'].map(p => `<option${p === defPart ? ' selected' : ''}>${p}</option>`).join('')}</select>
      <select id="newExEquip">${EQUIPS.map(q => `<option${q === (picker.equip || '器械') ? ' selected' : ''}>${q}</option>`).join('')}</select>
      <button type="button" class="btn primary" id="btnAddEx">新增動作</button>
    </form></details>`;
  $('#pkList').innerHTML = html;
  $('#pkDone').textContent = picker.selected.length ? `加入 ${picker.selected.length} 個動作` : '請勾選動作';
  $('#pkDone').disabled = !picker.selected.length;
}
$('#pkSearch').addEventListener('input', e => { picker.q = e.target.value; renderPicker(); });
$('#pkParts').addEventListener('click', e => {
  const b = e.target.closest('[data-part]');
  if (!b) return;
  picker.part = b.dataset.part; picker.equip = ''; picker.q = ''; $('#pkSearch').value = '';
  renderPicker(); $('#pkList').scrollTop = 0;
});
$('#pkEquips').addEventListener('click', e => {
  const b = e.target.closest('[data-equip]');
  if (!b) return;
  picker.equip = b.dataset.equip; renderPicker(); $('#pkList').scrollTop = 0;
});
$('#pkList').addEventListener('click', e => {
  const info = e.target.closest('[data-pinfo]');
  if (info) { openDetail(info.dataset.pinfo, { fromPicker: true }); return; }
  if (e.target.closest('#btnAddEx')) { addCustomExercise(); return; }
  const p = e.target.closest('[data-pick]');
  if (!p) return;
  choosePicked(p.dataset.pick);
});
function choosePicked(name) {
  if (picker.mode === 'multi') {
    const i = picker.selected.indexOf(name);
    if (i >= 0) picker.selected.splice(i, 1); else picker.selected.push(name);
    renderPicker();
  } else {
    closeOverlay('#pickerOverlay');
    if (picker.onPick) picker.onPick(name);
  }
}
$('#pkDone').addEventListener('click', () => {
  if (!picker.selected.length) return;
  closeOverlay('#pickerOverlay');
  if (picker.onPick) picker.onPick([...picker.selected]);
});
$('#pkList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'newExName') { e.preventDefault(); addCustomExercise(); } });
function addCustomExercise() {
  const name = $('#newExName').value.trim();
  if (!name) { toast('請輸入動作名稱'); return; }
  if (catalog().map.has(name) && !catalog().map.get(name).orphan) { toast('這個動作已經存在'); picker.q = name; $('#pkSearch').value = name; renderPicker(); return; }
  const part = $('#newExPart').value, equip = $('#newExEquip').value;
  state.customExercises.push({ name, part, equip });
  save();
  toast(`已新增：${name}（${part}・${equip}）`);
  if (picker.mode === 'multi') { picker.selected.push(name); picker.q = ''; $('#pkSearch').value = ''; picker.part = part; picker.equip = ''; renderPicker(); }
  else choosePicked(name);
}

/* ========== 動作說明（示範圖 + YouTube 影片） ========== */
function openDetail(name, { fromPicker = false } = {}) {
  const e = exInfo(name);
  const last = idx().last.get(name), best = idx().best.get(name);
  const n = state.sets.filter(s => s.exercise === name).length;
  const q = encodeURIComponent(e.en ? `${e.en} exercise proper form` : `${name} 動作教學`);
  $('#dtName').textContent = name;
  $('#dtBody').innerHTML = `
    ${e.img ? `<div class="detail-anim">${thumbHTML(name, { anim: true, cls: 'lg' })}</div>
      <div class="detail-imgs"><img src="img/ex/${encodeURIComponent(e.img)}-0.jpg" alt="起始姿勢"><img src="img/ex/${encodeURIComponent(e.img)}-1.jpg" alt="結束姿勢"></div>`
      : '<div class="empty-block">自訂動作沒有示範圖</div>'}
    <dl class="kv">
      <dt>部位</dt><dd>${esc(e.part)}</dd><dt>器材</dt><dd>${esc(e.equip)}</dd>
      ${e.level ? `<dt>難度</dt><dd>${LEVEL_LABEL[e.level]}</dd>` : ''}
      ${e.en ? `<dt>英文</dt><dd>${esc(e.en)}</dd>` : ''}
      <dt>紀錄</dt><dd>${n ? `${n} 組・上次 ${setText(last)}・最佳 ${setText(best.s)}` : '還沒有紀錄'}</dd>
    </dl>
    <div class="btn-grid">
      <a class="btn ghost" style="text-align:center;text-decoration:none" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">▶ 看教學影片</a>
      <button type="button" class="btn primary" id="dtUse">${fromPicker && picker.mode === 'multi' ? (picker.selected.includes(name) ? '取消勾選' : '勾選這個') : '練這個動作'}</button>
    </div>`;
  $('#dtUse').onclick = () => {
    closeOverlay('#detailOverlay');
    if (fromPicker) choosePicked(name);
    else { if (currentTab !== 'train') showTab('train'); selectExercise(name); }
  };
  openOverlay('#detailOverlay');
}

/* ========== 日曆 ========== */
let calMonth = todayISO().slice(0, 7);   // YYYY-MM
let calSel = todayISO();
function renderCalendar() {
  const [y, m] = calMonth.split('-').map(Number);
  $('#calTitle').textContent = `${y} 年 ${m} 月`;
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysIn = new Date(y, m, 0).getDate();
  const t = todayISO();
  const byDate = idx().byDate;
  let html = '', trainDays = 0, sets = 0;
  for (let i = 0; i < offset; i++) html += '<span class="cal-day out"></span>';
  for (let d = 1; d <= daysIn; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const list = byDate.get(iso) || [];
    if (list.length) { trainDays++; sets += list.length; }
    const parts = [...new Set(list.map(s => exInfo(s.exercise).part))];
    const cls = ['cal-day', list.length ? 'on' : '', iso === t ? 'today' : '', iso === calSel ? 'sel' : '', iso > t ? 'future' : ''].join(' ');
    html += `<button type="button" class="${cls}" data-day="${iso}"><span class="d">${d}</span>${parts.length ? `<span class="p">${parts.slice(0, 2).join('')}${parts.length > 2 ? '…' : ''}</span>` : ''}</button>`;
  }
  $('#calGrid').innerHTML = html;
  $('#calSum').innerHTML = `<span><b>${trainDays}</b>天</span><span><b>${sets}</b>組</span>`;
  $('#calNext').style.opacity = calMonth >= t.slice(0, 7) ? .3 : 1;
  $('#calDayTitle').textContent = `${shortDate(calSel)}（${weekday(calSel)}）${daySummary(calSel) ? '' : ''}`;
  $('#calDayList').innerHTML = (daySummary(calSel) ? `<p class="hint">${daySummary(calSel)}</p>` : '') +
    (groupsHTML(calSel) || '<div class="empty-block">這天沒有訓練紀錄</div>');
  $('#calDayGo').hidden = calSel > t;
}
function shiftMonth(n) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  const next = toISO(d).slice(0, 7);
  if (next > todayISO().slice(0, 7)) return;
  calMonth = next;
  renderCalendar();
}
$('#calPrev').addEventListener('click', () => shiftMonth(-1));
$('#calNext').addEventListener('click', () => shiftMonth(1));
$('#calGrid').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) { calSel = b.dataset.day; renderCalendar(); } });
$('#calDayGo').addEventListener('click', () => { curDate = calSel; showTab('train'); });

/* ========== 菜單 ========== */
function renderPlans() {
  const box = $('#planCards');
  if (!state.plans.length) {
    box.innerHTML = `<div class="card"><div class="empty-block">還沒有菜單。<br>把常做的動作排成菜單，訓練時選「今天練什麼」就會自動列出動作。</div>
      <button type="button" class="btn ghost block" id="btnSamplePlans">✨ 建立範例菜單（推／拉／腿）</button></div>`;
    return;
  }
  const ap = activePlan();
  box.innerHTML = state.plans.map(p => {
    const total = p.items.reduce((a, it) => a + it.sets, 0);
    const parts = [...new Set(p.items.map(it => exInfo(it.exercise).part))];
    return `<div class="card plan-card ${ap && ap.id === p.id ? 'active' : ''}">
      <div class="pc-head"><div><div class="pc-name">${esc(p.name)}</div><div class="pc-meta">${p.items.length} 個動作・${total} 組・${parts.join(' ') || '—'}</div></div>
      <button type="button" class="btn ghost sm" data-plan-edit="${esc(p.id)}">編輯</button></div>
      <div class="pc-list">${p.items.map(it => `<span class="tag">${esc(it.exercise)} × ${it.sets}</span>`).join('') || '<span class="pc-meta">尚未加入動作</span>'}</div>
      <button type="button" class="btn primary block" data-plan-start="${esc(p.id)}">${ap && ap.id === p.id ? '繼續訓練' : '▶ 今天練這個'}</button>
    </div>`;
  }).join('');
}
$('#planCards').addEventListener('click', e => {
  const ed = e.target.closest('[data-plan-edit]');
  if (ed) { openPlanEditor(ed.dataset.planEdit); return; }
  const st = e.target.closest('[data-plan-start]');
  if (st) {
    state.settings.activePlanId = st.dataset.planStart;
    save();
    curDate = todayISO();
    const ap = activePlan();
    showTab('train');
    if (ap.items.length) selectExercise((ap.items.find(it => doneCount(it.exercise) < it.sets) || ap.items[0]).exercise);
    return;
  }
  if (e.target.closest('#btnSamplePlans')) {
    state.plans.push(
      { id: uid() + 'a', name: '推日（胸肩三頭）', items: [['槓鈴臥推', 4], ['上斜啞鈴臥推', 3], ['蝴蝶機夾胸', 3], ['啞鈴肩推', 3], ['啞鈴側平舉', 3], ['三頭繩索下壓', 3]].map(([exercise, sets]) => ({ exercise, sets })) },
      { id: uid() + 'b', name: '拉日（背二頭）', items: [['硬舉', 3], ['引體向上', 3], ['寬握滑輪下拉', 3], ['坐姿繩索划船', 3], ['臉拉', 3], ['啞鈴二頭彎舉', 3]].map(([exercise, sets]) => ({ exercise, sets })) },
      { id: uid() + 'c', name: '腿日（腿核心）', items: [['槓鈴深蹲', 4], ['羅馬尼亞硬舉', 3], ['腿推', 3], ['俯臥腿後勾', 3], ['站姿提踵機', 3], ['懸吊抬腿', 3]].map(([exercise, sets]) => ({ exercise, sets })) }
    );
    save(); renderPlans(); toast('已建立 3 個範例菜單，可以隨時編輯');
  }
});
$('#btnNewPlan').addEventListener('click', () => openPlanEditor(null));

let peDraft = null;
function openPlanEditor(id) {
  const p = id ? state.plans.find(x => x.id === id) : null;
  peDraft = p ? { id: p.id, name: p.name, items: p.items.map(it => ({ ...it })) } : { id: null, name: '', items: [] };
  $('#peTitle').textContent = p ? '編輯菜單' : '新增菜單';
  $('#peName').value = peDraft.name;
  $('#peDelete').hidden = !p;
  $('#peError').textContent = '';
  renderPlanItems();
  openOverlay('#planOverlay');
}
function renderPlanItems() {
  $('#peItems').innerHTML = peDraft.items.length ? peDraft.items.map((it, i) => `
    <div class="pe-row">
      ${thumbHTML(it.exercise)}
      <div class="nm">${esc(it.exercise)}<small>${esc(exInfo(it.exercise).part)}・${esc(exInfo(it.exercise).equip)}</small></div>
      <div class="stepper sm"><button type="button" data-pe-sets="${i}" data-d="-1">−</button><input type="number" value="${it.sets}" data-pe-input="${i}" inputmode="numeric" min="1" max="20" aria-label="組數"><button type="button" data-pe-sets="${i}" data-d="1">+</button></div>
      <button type="button" class="icon-btn" data-pe-move="${i}" data-d="-1" aria-label="上移" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>↑</button>
      <button type="button" class="icon-btn" data-pe-move="${i}" data-d="1" aria-label="下移" ${i === peDraft.items.length - 1 ? 'disabled style="opacity:.25"' : ''}>↓</button>
      <button type="button" class="icon-btn" data-pe-del="${i}" aria-label="移除">✕</button>
    </div>`).join('') : '<div class="empty-block">還沒有動作，按下方按鈕從動作庫加入</div>';
}
$('#peItems').addEventListener('click', e => {
  const s = e.target.closest('[data-pe-sets]'), m = e.target.closest('[data-pe-move]'), d = e.target.closest('[data-pe-del]');
  if (s) { const it = peDraft.items[+s.dataset.peSets]; it.sets = Math.min(20, Math.max(1, it.sets + +s.dataset.d)); }
  else if (m) { const i = +m.dataset.peMove, j = i + +m.dataset.d; if (j < 0 || j >= peDraft.items.length) return; [peDraft.items[i], peDraft.items[j]] = [peDraft.items[j], peDraft.items[i]]; }
  else if (d) peDraft.items.splice(+d.dataset.peDel, 1);
  else return;
  renderPlanItems();
});
$('#peItems').addEventListener('change', e => {
  const inp = e.target.closest('[data-pe-input]');
  if (inp) { peDraft.items[+inp.dataset.peInput].sets = Math.min(20, Math.max(1, Math.round(+inp.value) || 3)); renderPlanItems(); }
});
$('#peAdd').addEventListener('click', () => {
  peDraft.name = $('#peName').value;
  openPicker({
    mode: 'multi', title: '加入動作到菜單',
    onPick: names => {
      names.forEach(n => { if (!peDraft.items.some(it => it.exercise === n)) peDraft.items.push({ exercise: n, sets: 3 }); });
      renderPlanItems();
    }
  });
});
$('#peSave').addEventListener('click', () => {
  const name = $('#peName').value.trim();
  if (!name) { $('#peError').textContent = '請輸入菜單名稱'; return; }
  if (!peDraft.items.length) { $('#peError').textContent = '請至少加入一個動作'; return; }
  const plan = { id: peDraft.id || uid(), name, items: peDraft.items };
  const i = state.plans.findIndex(p => p.id === plan.id);
  if (i >= 0) state.plans[i] = plan; else state.plans.push(plan);
  save();
  closeOverlay('#planOverlay');
  renderTab();
  toast(`📋 已儲存菜單：${name}`);
});
$('#peDelete').addEventListener('click', async () => {
  if (!peDraft.id) return;
  if (!await askConfirm(`刪除菜單「${$('#peName').value || '未命名'}」？\n（訓練紀錄不會被刪除）`, { ok: '刪除', danger: true })) return;
  state.plans = state.plans.filter(p => p.id !== peDraft.id);
  if (state.settings.activePlanId === peDraft.id) state.settings.activePlanId = null;
  save();
  closeOverlay('#planOverlay');
  renderTab();
});

/* ========== 進度 ========== */
let chart = null;
let metric = 'max';
const METRICS = {
  weight: [['max', '最大重量'], ['e1rm', '估算 1RM'], ['volume', '訓練量']],
  bw: [['reps', '最多次數'], ['total', '總次數'], ['max', '最大負重']]
};
function renderProgress() {
  const sets = state.sets;
  const t = todayISO();
  const monday = mondayOf(t);
  const days = idx().byDate.size;
  const weekSets = sets.filter(s => s.date >= monday && s.date <= t);
  const d30 = addDays(t, -29);
  const days30 = [...idx().byDate.keys()].filter(d => d >= d30 && d <= t).length;
  const trainedWeeks = new Set([...idx().byDate.keys()].map(mondayOf));
  let streak = 0, w = trainedWeeks.has(monday) ? 0 : 1;
  while (trainedWeeks.has(addDays(monday, -7 * w))) { streak++; w++; }
  const weekDays = new Set(weekSets.map(s => s.date)).size;
  $('#statGrid').innerHTML = `
    <div class="stat"><div class="label">本週訓練</div><div class="val">${weekDays}<small>天</small></div></div>
    <div class="stat"><div class="label">本週組數</div><div class="val">${weekSets.length}<small>組</small></div></div>
    <div class="stat"><div class="label">連續訓練</div><div class="val">${streak}<small>週</small></div></div>
    <div class="stat"><div class="label">近 30 天</div><div class="val">${days30}<small>天</small></div></div>
    <div class="stat"><div class="label">累計天數</div><div class="val">${days}<small>天</small></div></div>
    <div class="stat"><div class="label">累計組數</div><div class="val">${sets.length}<small>組</small></div></div>`;

  const byPart = {};
  weekSets.forEach(s => { const p = exInfo(s.exercise).part; byPart[p] = (byPart[p] || 0) + 1; });
  const maxPart = Math.max(20, ...Object.values(byPart));
  $('#partBars').innerHTML = weekSets.length
    ? `<div class="part-bars">${[...PARTS, '其他'].filter(p => p !== '其他' || byPart[p]).map(p => {
        const n = byPart[p] || 0;
        return `<div class="part-bar"><span>${p}</span><div class="track"><div class="fill" style="width:${n / maxPart * 100}%"></div></div><span class="n">${n}<small> 組</small></span></div>`;
      }).join('')}</div>`
    : '<div class="empty-block">這週還沒有訓練紀錄</div>';

  renderChart();
  renderPR();
}
function renderChart() {
  const sel = $('#pExercise');
  const used = [...idx().lastDate.keys()];
  const wrap = $('#chartWrap'), summary = $('#progressSummary');
  if (!used.length) {
    sel.innerHTML = '<option value="">（尚無紀錄）</option>';
    $('#metricSeg').innerHTML = '';
    wrap.classList.add('is-empty');
    $('#chartEmpty').textContent = '尚無紀錄，先到「訓練」分頁記錄幾組吧！';
    summary.innerHTML = '';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }
  const prev = sel.value;
  let html = '';
  allParts().forEach(p => {
    const items = used.filter(n => exInfo(n).part === p).sort((a, b) => idx().lastDate.get(b).localeCompare(idx().lastDate.get(a)));
    if (items.length) html += `<optgroup label="${p}">${items.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>`;
  });
  sel.innerHTML = html;
  if (used.includes(prev)) sel.value = prev;
  else { const top = used.sort((a, b) => idx().lastDate.get(b).localeCompare(idx().lastDate.get(a)))[0]; sel.value = curEx && used.includes(curEx) ? curEx : top; }
  const ex = sel.value, bw = isBW(ex);
  const ms = bw ? METRICS.bw : METRICS.weight;
  if (!ms.some(m => m[0] === metric)) metric = ms[0][0];
  $('#metricSeg').innerHTML = ms.map(([k, l]) => `<button type="button" data-metric="${k}" class="${k === metric ? 'active' : ''}">${l}</button>`).join('');
  const unit = (metric === 'reps' || metric === 'total') ? '下' : 'kg';
  const label = ms.find(m => m[0] === metric)[1];
  const byDate = {};
  state.sets.filter(s => s.exercise === ex).forEach(s => {
    const d = byDate[s.date] || (byDate[s.date] = { e1rm: 0, max: 0, volume: 0, reps: 0, total: 0 });
    d.e1rm = Math.max(d.e1rm, e1rm(s));
    d.max = Math.max(d.max, s.weight);
    d.volume += s.weight * s.reps;
    d.reps = Math.max(d.reps, s.reps);
    d.total += s.reps;
  });
  const dates = Object.keys(byDate).sort();
  const values = dates.map(d => round(byDate[d][metric], 1));
  if (typeof Chart === 'undefined') {
    wrap.classList.add('is-empty');
    $('#chartEmpty').textContent = '圖表元件載入失敗';
  } else {
    wrap.classList.remove('is-empty');
    const ctx = $('#progressChart').getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 240);
    grad.addColorStop(0, 'rgba(182,255,59,.35)');
    grad.addColorStop(1, 'rgba(182,255,59,0)');
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels: dates.map(shortDate), datasets: [{ label, data: values, borderColor: '#b6ff3b', backgroundColor: grad, fill: true, tension: .3, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: '#0d0f12', pointBorderColor: '#b6ff3b', pointBorderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => dates[it[0].dataIndex], label: it => `${label}：${fmt(it.parsed.y)} ${unit}` } } },
        scales: {
          x: { ticks: { color: '#8a93a2' }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { ticks: { color: '#8a93a2', callback: v => v + unit }, grid: { color: 'rgba(255,255,255,.05)' } }
        }
      }
    });
  }
  const first = values[0], last = values[values.length - 1];
  const diff = last - first, pct = first > 0 ? diff / first * 100 : 0;
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
  summary.innerHTML = `
    <div class="stat"><div class="label">最新</div><div class="val">${fmt(last)}<small>${unit}</small></div></div>
    <div class="stat"><div class="label">最佳</div><div class="val">${fmt(Math.max(...values))}<small>${unit}</small></div></div>
    <div class="stat"><div class="label">${dates.length} 次・變化</div><div class="val ${cls}">${diff >= 0 ? '+' : ''}${fmt(pct)}<small>%</small></div></div>`;
}
$('#pExercise').addEventListener('change', renderChart);
$('#metricSeg').addEventListener('click', e => { const b = e.target.closest('[data-metric]'); if (b) { metric = b.dataset.metric; renderChart(); } });
function renderPR() {
  const rows = [...idx().best.entries()].sort((a, b) => {
    const pa = PARTS.indexOf(exInfo(a[0]).part), pb = PARTS.indexOf(exInfo(b[0]).part);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || b[1].v - a[1].v;
  });
  $('#prTable').innerHTML = rows.length ? `<table><thead><tr><th>動作</th><th>最佳一組</th><th>日期</th></tr></thead><tbody>${rows.map(([ex, b]) => `<tr>
    <td data-select="${esc(ex)}">${esc(ex)}<br><span class="sm" style="color:var(--muted);font-size:11px">${esc(exInfo(ex).part)}・${esc(exInfo(ex).equip)}</span></td>
    <td class="num">${setText(b.s)}${!isBW(ex) && b.s.reps > 1 ? `<br><span class="sm">1RM≈${fmt(e1rm(b.s))}kg</span>` : ''}</td>
    <td><span class="sm">${shortDate(b.s.date)}</span></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty-block">還沒有 PR，開始記錄吧！</div>';
}

/* ========== 休息計時器（鎖定畫面顯示 + 大聲提示音） ==========
 * iOS 網頁無法在鎖定畫面放自訂小工具，所以用「播放音檔」的方式：
 * 產生一段「靜音（休息秒數）＋ 響亮鈴聲」的音檔來播放，
 * 鎖定畫面會像音樂一樣顯示倒數進度，時間到時鈴聲在背景也會響。 */
const RING_C = 2 * Math.PI * 54;
const timer = { total: 90, remaining: 90, endAt: 0, running: false, iv: null };
$('#ringFg').style.strokeDasharray = RING_C;
const SR = 8000;
let alarmPCM = null, audioURL = null, usingAudio = false;
const audio = new Audio();
audio.setAttribute('playsinline', '');
audio.preload = 'auto';

function makeAlarm() {
  const out = [];
  const tone = (f, dur) => {
    const n = Math.round(SR * dur);
    for (let i = 0; i < n; i++) {
      const t = i / SR, env = Math.min(1, i / 60, (n - i) / 60);
      /* 方波＋泛音：聽起來比純正弦波大聲、清楚 */
      out.push((Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.65 + Math.sin(4 * Math.PI * f * t) * 0.35) * env);
    }
  };
  const gap = dur => { for (let i = 0; i < Math.round(SR * dur); i++) out.push(0); };
  for (let r = 0; r < 3; r++) { tone(1046, 0.16); gap(0.06); tone(1046, 0.16); gap(0.06); tone(1568, 0.4); gap(0.3); }
  return out;
}
function buildWav(silenceSec) {
  alarmPCM = alarmPCM || makeAlarm();
  const ns = Math.max(0, Math.round(silenceSec * SR));
  const total = ns + alarmPCM.length;
  const buf = new ArrayBuffer(44 + total);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + total, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, total, true);
  const data = new Uint8Array(buf, 44);
  data.fill(128, 0, ns);
  for (let i = 0; i < alarmPCM.length; i++) data[ns + i] = Math.max(0, Math.min(255, Math.round(128 + alarmPCM[i] * 127)));
  if (audioURL) URL.revokeObjectURL(audioURL);
  audioURL = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return audioURL;
}
function playAudioFor(sec) {
  try {
    audio.src = buildWav(sec);
    const p = audio.play();
    usingAudio = true;
    if (p && p.catch) p.catch(() => { usingAudio = false; });
  } catch (e) { usingAudio = false; }
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: `休息 ${fmtTime(Math.round(timer.total))}`,
        artist: curEx ? `下一組：${curEx}` : 'LiftLog',
        album: 'LiftLog 休息計時',
        artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch (e) { /* 忽略 */ }
  }
}
if ('mediaSession' in navigator) {
  try {
    navigator.mediaSession.setActionHandler('play', () => startTimer());
    navigator.mediaSession.setActionHandler('pause', () => pauseTimer());
  } catch (e) { /* 忽略 */ }
}
/* 備用：無法播放音檔時改用 Web Audio */
let audioCtx = null;
function ensureAudioCtx() {
  try {
    if (!audioCtx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audioCtx = new AC(); }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* 忽略 */ }
}
function fallbackBeep() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const comp = audioCtx.createDynamicsCompressor();
  comp.connect(audioCtx.destination);
  for (let r = 0; r < 3; r++) [0, 0.22, 0.44].forEach((dt, i) => {
    const t = t0 + r * 1.1 + dt;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square';
    o.frequency.value = i === 2 ? 1568 : 1046;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (i === 2 ? 0.4 : 0.16));
    o.connect(g).connect(comp);
    o.start(t); o.stop(t + 0.42);
  });
}
function stopAudio() {
  try { audio.pause(); } catch (e) { /* 忽略 */ }
  if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'paused'; } catch (e) { /* 忽略 */ }
}
function setTimer(sec) {
  clearInterval(timer.iv);
  stopAudio();
  timer.total = sec; timer.remaining = sec; timer.running = false;
  renderTimer();
}
function startTimer(sec) {
  ensureAudioCtx();
  if (sec) { timer.total = sec; timer.remaining = sec; }
  if (timer.remaining <= 0) timer.remaining = timer.total;
  timer.endAt = Date.now() + timer.remaining * 1000;
  timer.running = true;
  playAudioFor(timer.remaining);
  clearInterval(timer.iv);
  timer.iv = setInterval(tick, 250);
  $('#timerFab').classList.remove('done');
  renderTimer();
}
function pauseTimer() {
  if (!timer.running) return;
  timer.remaining = Math.max(0, (timer.endAt - Date.now()) / 1000);
  timer.running = false;
  clearInterval(timer.iv);
  stopAudio();
  renderTimer();
}
function tick() {
  timer.remaining = Math.max(0, (timer.endAt - Date.now()) / 1000);
  if (timer.remaining <= 0) {
    timer.running = false;
    clearInterval(timer.iv);
    if (!usingAudio || audio.paused) fallbackBeep();
    if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
    toast('⏰ 休息結束，下一組！');
    const fab = $('#timerFab');
    fab.classList.remove('done'); void fab.offsetWidth; fab.classList.add('done');
  }
  renderTimer();
}
function renderTimer() {
  const sec = Math.ceil(timer.remaining);
  $('#timerDisplay').textContent = fmtTime(sec);
  $('#ringFg').style.strokeDashoffset = RING_C * (1 - (timer.total ? timer.remaining / timer.total : 0));
  const paused = !timer.running && timer.remaining > 0 && timer.remaining < timer.total;
  $('#btnStartPause').textContent = timer.running ? '暫停' : paused ? '繼續' : '開始';
  $('#timerLabel').textContent = timer.running ? '休息中…' : timer.remaining <= 0 ? '時間到！' : paused ? '已暫停' : '準備開始';
  $('#fabTime').textContent = (timer.running || paused) ? fmtTime(sec) : '';
  $$('#presets .preset').forEach(c => c.classList.toggle('active', +c.dataset.sec === state.settings.restDefault));
  $('#autoStart').checked = state.settings.autoStartTimer;
  $('#keepAwake').checked = state.settings.keepAwake;
}
$('#timerFab').addEventListener('click', () => { ensureAudioCtx(); openOverlay('#timerOverlay'); });
$('#presets').addEventListener('click', e => {
  const c = e.target.closest('.preset');
  if (!c) return;
  state.settings.restDefault = +c.dataset.sec; save();
  setTimer(+c.dataset.sec);
});
function setCustomSec() {
  const v = +$('#customSec').value;
  if (!Number.isInteger(v) || v < 5 || v > 600) { toast('請輸入 5～600 之間的整數秒數'); return; }
  state.settings.restDefault = v; save();
  setTimer(v);
  $('#customSec').value = '';
  toast(`休息時間設為 ${fmtTime(v)}`);
}
bindEnter('#customTimeForm', setCustomSec);
$('#btnCustomSec').addEventListener('click', setCustomSec);
$('#btnStartPause').addEventListener('click', () => timer.running ? pauseTimer() : startTimer());
$('#btnReset').addEventListener('click', () => setTimer(timer.total));
$('#btnPlus').addEventListener('click', () => {
  timer.total += 15;
  if (timer.running) { timer.endAt += 15000; timer.remaining = (timer.endAt - Date.now()) / 1000; playAudioFor(timer.remaining); }
  else timer.remaining += 15;
  renderTimer();
});
$('#btnTestSound').addEventListener('click', () => {
  if (timer.running) { toast('計時中，結束後再試聽'); return; }
  try { audio.src = buildWav(0); audio.play().catch(() => { ensureAudioCtx(); fallbackBeep(); }); } catch (e) { ensureAudioCtx(); fallbackBeep(); }
});
$('#autoStart').addEventListener('change', e => { state.settings.autoStartTimer = e.target.checked; save(); });

let wakeLock = null;
async function applyWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    if (state.settings.keepAwake && document.visibilityState === 'visible') {
      if (!wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    } else if (wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { wakeLock = null; }
}
if ('wakeLock' in navigator) $('#wakeRow').hidden = false;
$('#keepAwake').addEventListener('change', e => { state.settings.keepAwake = e.target.checked; save(); applyWakeLock(); });
document.addEventListener('pointerdown', () => { if (state.settings.keepAwake && !wakeLock) applyWakeLock(); }, { passive: true });
let openedOn = todayISO();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (timer.running) tick();
  applyWakeLock();
  const t = todayISO();
  if (t !== openedOn) { if (curDate === openedOn) curDate = t; openedOn = t; renderTab(); }
});

/* ========== 設定與資料 ========== */
$('#btnSettings').addEventListener('click', () => { renderSettings(); openOverlay('#settingsOverlay'); });
function renderSettings() {
  $('#builtinCount').textContent = BUILTIN.length;
  $('#customList').innerHTML = state.customExercises.length
    ? state.customExercises.map((c, i) => `<span class="ctag">${esc(c.name)} <em>${c.part}・${c.equip}</em><button type="button" data-rm="${i}" aria-label="刪除 ${esc(c.name)}">✕</button></span>`).join('')
    : '<span class="muted-note" style="margin:0">尚未新增。在「換動作」清單最下方可以新增。</span>';
  $('#storageInfo').textContent = !storageOK ? '⚠️ 目前無法保存資料，請務必匯出備份。'
    : db ? `資料存在這支手機的資料庫（${state.sets.length} 組紀錄、${state.plans.length} 個菜單、${state.customExercises.length} 個自訂動作），離線也能用；刪除 App 或清除 Safari 網站資料會一起清掉。`
    : '資料存在瀏覽器 localStorage，換手機前請先匯出備份。';
  const el = $('#backupInfo');
  const last = state.settings.lastExportAt;
  if (!state.sets.length) { el.textContent = ''; return; }
  const daysAgo = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  const stale = daysAgo === null || daysAgo >= 14;
  el.className = 'muted-note ' + (stale ? 'backup-warn' : 'backup-ok');
  el.textContent = daysAgo === null ? '💾 還沒備份過，建議匯出一份存到「檔案」App 或 iCloud 雲碟。'
    : `💾 上次備份：${daysAgo === 0 ? '今天' : `${daysAgo} 天前`}${stale ? '，建議再備份一次' : ''}`;
}
$('#customList').addEventListener('click', async e => {
  const b = e.target.closest('[data-rm]');
  if (!b) return;
  const c = state.customExercises[+b.dataset.rm];
  if (!c) return;
  const n = state.sets.filter(s => s.exercise === c.name).length;
  if (!await askConfirm(n ? `刪除「${c.name}」？\n已有的 ${n} 組紀錄會保留。` : `刪除自訂動作「${c.name}」？`, { ok: '刪除', danger: true })) return;
  state.customExercises.splice(+b.dataset.rm, 1);
  state.plans.forEach(p => { p.items = p.items.filter(it => it.exercise !== c.name || n); });
  save(); renderSettings(); renderTab();
});
$('#btnExport').addEventListener('click', async () => {
  if (!state.sets.length && !state.customExercises.length && !state.plans.length) { toast('目前沒有資料可以匯出'); return; }
  const payload = { app: 'LiftLog', version: 3, exportedAt: new Date().toISOString(), ...state };
  const name = `liftlog-${todayISO()}.json`;
  const json = JSON.stringify(payload, null, 2);
  const done = () => { state.settings.lastExportAt = payload.exportedAt; save(); renderSettings(); toast(`⬇ 已匯出 ${state.sets.length} 組紀錄`); };
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && 'ontouchend' in document) {
      await navigator.share({ files: [file], title: 'LiftLog 備份' });
      done(); return;
    }
  } catch (err) { if (err && err.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  done();
});
$('#btnImport').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (err) { toast('❌ 檔案不是有效的 JSON'); return; }
    if (!data || !Array.isArray(data.sets)) { toast('❌ 找不到紀錄資料，請確認是 LiftLog 匯出的檔案'); return; }
    const next = normalize(data);
    const skipped = data.sets.length - next.sets.length;
    if (!await askConfirm(`將匯入 ${next.sets.length} 組紀錄${skipped ? `（${skipped} 筆格式錯誤會略過）` : ''}並取代目前的訓練紀錄。\n自訂動作與菜單會合併保留。`, { ok: '匯入' })) return;
    /* 自訂動作、菜單：合併而不是覆蓋 */
    const names = new Set(next.customExercises.map(c => c.name));
    state.customExercises.forEach(c => { if (!names.has(c.name)) next.customExercises.push(c); });
    const pids = new Set(next.plans.map(p => p.id));
    state.plans.forEach(p => { if (!pids.has(p.id)) next.plans.push(p); });
    next.settings.lastExportAt = data.exportedAt && !isNaN(Date.parse(data.exportedAt)) ? data.exportedAt : state.settings.lastExportAt;
    state = next;
    save(); setTimer(state.settings.restDefault); renderSettings(); renderTab();
    toast(`⬆ 已匯入 ${next.sets.length} 組紀錄`);
  };
  reader.readAsText(file);
});
$('#btnClear').addEventListener('click', async () => {
  if (!state.sets.length) { toast('目前沒有訓練紀錄'); return; }
  if (!await askConfirm('確定清除全部「訓練紀錄」？\n自訂動作與菜單會保留。建議先匯出備份。', { ok: '清除', danger: true })) return;
  if (!await askConfirm('再次確認：清除後無法復原！', { ok: '永久清除', danger: true })) return;
  state.sets = [];
  save(); renderSettings(); renderTab();
  toast('已清除訓練紀錄');
});

/* 範例資料：過去 6 週、每 3 天一次，A/B 課表交替並漸進加重 */
function sampleSets() {
  const out = [], now = new Date();
  let seq = 0, a = 0, b = 0;
  const mk = (date, exercise, weight, reps) => out.push({ id: uid() + seq, date, exercise, weight, reps, note: '', rpe: null, createdAt: Date.now() + seq++ });
  for (let i = 0; i < 14; i++) {
    const date = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - i) * 3));
    if (i % 2 === 0) {
      [5, 5, 5].forEach(r => mk(date, '槓鈴深蹲', 80 + a * 2.5, r));
      [5, 5, a % 2 ? 4 : 5].forEach(r => mk(date, '槓鈴臥推', 60 + Math.floor(a / 2) * 2.5, r));
      [12, 12, 10].forEach(r => mk(date, '啞鈴飛鳥', 8 + Math.floor(a / 3) * 2, r));
      [10 + a, 9 + a].forEach(r => mk(date, '懸吊抬腿', 0, r));
      a++;
    } else {
      [5, 5].forEach(r => mk(date, '硬舉', 100 + b * 5, r));
      [6 + Math.floor(b / 2), 5 + Math.floor(b / 2), 5].forEach(r => mk(date, '引體向上', 0, r));
      [8, 8, 8].forEach(r => mk(date, '槓鈴划船', 50 + b * 2.5, r));
      [10, 10, 8].forEach(r => mk(date, '啞鈴肩推', 14 + Math.floor(b / 2) * 2, r));
      b++;
    }
  }
  return out;
}
$('#btnSample').addEventListener('click', async () => {
  if (state.sets.length && !await askConfirm('載入範例資料會取代目前的訓練紀錄，確定？', { ok: '載入' })) return;
  state.sets = sampleSets();
  save(); closeOverlay('#settingsOverlay'); renderSettings();
  selectExercise('槓鈴臥推');
  toast(`✨ 已載入 ${state.sets.length} 組範例紀錄`);
});

/* ========== 安裝提示、離線、初始化 ========== */
function setupInstallTip() {
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('liftlog_install_dismissed') === '1'; } catch (e) { /* 忽略 */ }
  if (isIOS && !standalone && !dismissed) $('#installTip').hidden = false;
  $('#installClose').addEventListener('click', () => {
    $('#installTip').hidden = true;
    try { localStorage.setItem('liftlog_install_dismissed', '1'); } catch (e) { /* 忽略 */ }
  });
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* 忽略 */ }));
}

(async () => {
  await load();
  const ap = activePlan();
  const lastAny = idx().chrono[idx().chrono.length - 1];
  const start = (ap && ap.items.length && (ap.items.find(it => doneCount(it.exercise) < it.sets) || ap.items[0]).exercise) ||
    (lastAny && lastAny.exercise) || '槓鈴臥推';
  selectExercise(start);
  if (!storageOK) $('#storageWarn').hidden = false;
  setTimer(state.settings.restDefault);
  setupInstallTip();
  applyWakeLock();
})();
})();
