import './style.css';
import * as store from './store.js';
import * as google from './google.js';
import * as ai from './ai.js';
import { scriptSource } from './script-template.js';
import { today, addDays, humanDate, weekdayShort, dayNum, addMinutes, diffMinutes } from './time.js';

// ---------- Утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = {
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5"/></svg>',
  tick: '<svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2c2.8.3 5 2.6 5 5.8"/></svg>',
};

const state = { sel: today(), tab: 'day', syncing: false, syncError: '' };

function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

const sortKey = (i) => i.date + (i.start ? '1' + i.start : '0') + i.title;
const byDate = (a, b) => sortKey(a).localeCompare(sortKey(b));

// ---------- Отрисовка ----------
function render() {
  const app = $('#app');
  const t = today();
  const items = store.all();
  const counts = {};
  for (const i of items) {
    counts[i.date] ??= { m: 0, t: 0 };
    if (i.kind === 'task') { if (!i.done) counts[i.date].t++; } else counts[i.date].m++;
  }
  const days = Array.from({ length: 35 }, (_, k) => addDays(t, k - 3));
  const s = store.getSettings();
  const needSetup = !google.isConnected();
  const pending = store.dirty().length;
  let sub = google.isConnected()
    ? (state.syncError ? 'Ошибка синхронизации' : s.lastSync ? `Синхронизировано в ${new Date(s.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Omsk' })}` : 'Google Календарь подключён')
    : 'Только на этом устройстве';
  if (pending) sub += ` · не отправлено: ${pending}`;

  app.innerHTML = `
  <div class="app">
    <div class="top">
      <div class="bar">
        <h1>${esc(humanDate(state.sel))}</h1>
        ${google.isConnected() ? `<button class="icon-btn ${state.syncing ? 'spin' : ''}" data-act="sync" aria-label="Синхронизировать">${ico.sync}</button>` : ''}
        <button class="icon-btn" data-act="settings" aria-label="Настройки">${ico.gear}</button>
      </div>
      <div class="sub">${esc(sub)}</div>
      <div class="strip" id="strip">
        ${days.map((d) => `
          <button class="day ${d === t ? 'today' : ''} ${d === state.sel ? 'sel' : ''}" data-day="${d}">
            <div class="wd">${esc(weekdayShort(d))}</div><div class="n">${dayNum(d)}</div>
            <div class="dots">${counts[d]?.m ? '<i></i>' : ''}${counts[d]?.t ? '<i class="t"></i>' : ''}</div>
          </button>`).join('')}
      </div>
      <div class="tabs">
        <button class="${state.tab === 'day' ? 'on' : ''}" data-tab="day">День</button>
        <button class="${state.tab === 'tasks' ? 'on' : ''}" data-tab="tasks">Все задачи</button>
        <button class="${state.tab === 'week' ? 'on' : ''}" data-tab="week">7 дней</button>
      </div>
    </div>
    <main>
      ${needSetup ? `<div class="banner"><div><b>Осталось подключить</b>${'Google Календарь'}</div><button class="btn small primary" data-act="settings">Настроить</button></div>` : ''}
      ${state.syncError ? `<div class="err">${esc(state.syncError)}</div>` : ''}
      ${state.tab === 'day' ? renderDay(items, t) : state.tab === 'tasks' ? renderTasks(items, t) : renderWeek(items)}
    </main>
    <div class="dock">
      <button class="plus" data-act="new" aria-label="Добавить">${ico.plus}</button>
      <button class="mic" data-act="voice" aria-label="Голосовая команда">${ico.mic}</button>
      <span style="width:52px"></span>
    </div>
  </div>`;
  const selBtn = $('.day.sel');
  if (selBtn && !render.scrolled) { selBtn.scrollIntoView({ inline: 'center', block: 'nearest' }); render.scrolled = true; }
}

function renderDay(items, t) {
  let html = '';
  if (state.sel === t) {
    const late = items.filter((i) => i.kind === 'task' && !i.done && i.date < t).sort(byDate);
    if (late.length) html += `<div class="group-h late">Просрочено</div>` + late.map((i) => itemHtml(i, true)).join('');
  }
  const list = items.filter((i) => i.date === state.sel).sort(byDate);
  if (list.length) html += (html ? `<div class="group-h">${esc(humanDate(state.sel))}</div>` : '') + list.map((i) => itemHtml(i)).join('');
  if (!html) html = `<div class="empty"><b>Свободный день</b>Нажмите на микрофон и скажите, например: «Встреча с поставщиком рыбы завтра в 11»</div>`;
  return html;
}

function renderTasks(items, t) {
  const open = items.filter((i) => i.kind === 'task' && !i.done).sort(byDate);
  const late = open.filter((i) => i.date < t), now = open.filter((i) => i.date === t), later = open.filter((i) => i.date > t);
  const done = items.filter((i) => i.kind === 'task' && i.done && i.date >= addDays(t, -7)).sort(byDate).reverse();
  const g = (title, arr, cls = '', showDate = true) => arr.length ? `<div class="group-h ${cls}">${title}</div>` + arr.map((i) => itemHtml(i, showDate)).join('') : '';
  const html = g('Просрочено', late, 'late') + g('Сегодня', now, '', false) + g('Дальше', later) + g('Выполнено за неделю', done);
  return html || `<div class="empty"><b>Задач нет</b>Скажите: «Задача: проверить остатки лосося до пятницы»</div>`;
}

function renderWeek(items) {
  let html = '';
  for (let k = 0; k < 7; k++) {
    const d = addDays(state.sel, k);
    const list = items.filter((i) => i.date === d).sort(byDate);
    html += `<div class="group-h">${esc(humanDate(d))}</div>` + (list.length ? list.map((i) => itemHtml(i)).join('') : `<div class="sub" style="padding:0 2px 6px">Ничего не запланировано</div>`);
  }
  return html;
}

function itemHtml(i, showDate = false) {
  const lead = i.kind === 'task'
    ? `<button class="check ${i.done ? 'on' : ''}" data-toggle="${i.id}" aria-label="${i.done ? 'Вернуть в работу' : 'Выполнено'}">${ico.tick}</button>`
    : `<span class="kind-ico">${ico.people}</span>`;
  const time = i.start ? `${i.start}${i.end ? `<small>${i.end}</small>` : ''}` : `<small>${i.kind === 'task' ? 'весь день' : 'весь день'}</small>`;
  const links = (i.links || []).map((l) => `<a class="chip link" href="${esc(l.url)}" target="_blank" rel="noopener" data-stop>🔗 ${esc(l.title || shortUrl(l.url))}</a>`).join('');
  return `
    <div class="item ${i.kind} ${i.done ? 'done' : ''}" data-open="${i.id}">
      ${lead}
      <div class="body">
        <div class="title">${esc(i.title)}</div>
        <div class="meta">
          ${showDate ? `<span class="chip">${esc(humanDate(i.date))}</span>` : ''}
          ${i.assignee ? `<span class="chip who">👤 ${esc(i.assignee)}</span>` : ''}
          ${i.location ? `<span class="chip">📍 ${esc(i.location)}</span>` : ''}
          ${links}
          ${i.dirty ? '<span class="chip pending">не отправлено</span>' : ''}
        </div>
      </div>
      <div class="time">${time}</div>
    </div>`;
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    if (x.hostname.includes('docs.google.com')) return 'Google Док';
    if (x.hostname.includes('drive.google.com')) return 'Google Диск';
    return x.hostname.replace(/^www\./, '');
  } catch { return u; }
}

// ---------- Модальные окна ----------
function openSheet(html, onMount) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog"><div class="grab"></div>${html}</div>`;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeSheet(); });
  document.body.appendChild(wrap);
  onMount?.(wrap.firstElementChild);
  return wrap.firstElementChild;
}
function closeSheet() {
  voice.stop();
  document.querySelectorAll('.sheet-wrap').forEach((w) => w.remove());
}

// --- Редактор записи ---
function openEditor(id, preset = {}) {
  const it = id ? store.get(id) : null;
  const d = { kind: 'task', title: '', date: state.sel, start: '', end: '', assignee: '', notes: '', links: [], done: false, ...(it || {}), ...preset };
  let kind = d.kind;
  const linkRow = (l = { title: '', url: '' }) => `<div class="link-row"><input class="input t" placeholder="Название" value="${esc(l.title)}"><input class="input u" type="url" inputmode="url" placeholder="https://…" value="${esc(l.url)}"><button class="x" type="button" data-rm aria-label="Убрать">✕</button></div>`;
  const sheet = openSheet(`
    <h2>${it ? 'Редактировать' : 'Новая запись'}</h2>
    <div class="seg"><button data-k="task" class="${kind === 'task' ? 'on' : ''}">Задача</button><button data-k="meeting" class="${kind === 'meeting' ? 'on' : ''}">Встреча</button></div>
    <label class="field"><span>Название</span><input class="input" id="f-title" value="${esc(d.title)}" placeholder="Что нужно сделать?"></label>
    <div class="row">
      <label class="field"><span>Дата</span><input class="input" type="date" id="f-date" value="${esc(d.date)}"></label>
      <label class="field"><span>Начало</span><input class="input" type="time" id="f-start" value="${esc(d.start || '')}"></label>
      <label class="field"><span>Конец</span><input class="input" type="time" id="f-end" value="${esc(d.end || '')}"></label>
    </div>
    <p class="hint" id="f-hint">Без времени — на весь день.</p>
    <label class="field"><span>Ответственный</span><input class="input" id="f-who" value="${esc(d.assignee)}" placeholder="Например: Иван, шеф ТЦ «Галерея»"></label>
    <label class="field"><span>Заметки</span><textarea class="input" id="f-notes" rows="3">${esc(d.notes)}</textarea></label>
    <div class="field"><span>Ссылки на документы</span><div id="f-links">${(d.links.length ? d.links : []).map(linkRow).join('')}</div>
      <button class="btn small" type="button" id="f-addlink">+ Добавить ссылку</button></div>
    ${it?.kind === 'task' || !it ? `<label class="check-line" id="f-done-line" ${kind !== 'task' ? 'hidden' : ''}><input type="checkbox" id="f-done" ${d.done ? 'checked' : ''}> Выполнено</label>` : ''}
    ${it?.htmlLink ? `<p class="hint"><a href="${esc(it.htmlLink)}" target="_blank" rel="noopener">Открыть в Google Календаре</a></p>` : ''}
    <div class="actions">
      ${it ? '<button class="btn danger" id="f-del">Удалить</button>' : ''}
      <span class="grow"></span>
      <button class="btn" id="f-cancel">Отмена</button>
      <button class="btn primary" id="f-save">Сохранить</button>
    </div>`);

  sheet.querySelectorAll('[data-k]').forEach((b) => b.onclick = () => {
    kind = b.dataset.k;
    sheet.querySelectorAll('[data-k]').forEach((x) => x.classList.toggle('on', x === b));
    const dl = $('#f-done-line', sheet); if (dl) dl.hidden = kind !== 'task';
  });
  $('#f-addlink', sheet).onclick = () => { $('#f-links', sheet).insertAdjacentHTML('beforeend', linkRow()); $('#f-links .link-row:last-child .u', sheet).focus(); };
  $('#f-links', sheet).onclick = (e) => { if (e.target.closest('[data-rm]')) e.target.closest('.link-row').remove(); };
  $('#f-cancel', sheet).onclick = closeSheet;
  if (it) $('#f-del', sheet).onclick = () => { if (confirmDelete(sheet)) { store.remove(it.id); closeSheet(); toast('Удалено'); syncSoon(); } };
  if (!it) setTimeout(() => $('#f-title', sheet).focus(), 50);
  $('#f-save', sheet).onclick = () => {
    const title = $('#f-title', sheet).value.trim();
    if (!title) { $('#f-title', sheet).focus(); return; }
    const links = [...sheet.querySelectorAll('.link-row')].map((r) => ({ title: $('.t', r).value.trim(), url: normalizeUrl($('.u', r).value.trim()) })).filter((l) => l.url);
    const start = $('#f-start', sheet).value || null;
    let end = start ? ($('#f-end', sheet).value || null) : null;
    store.upsert({
      id: it?.id, kind, title, date: $('#f-date', sheet).value || today(), start, end,
      assignee: $('#f-who', sheet).value.trim(), notes: $('#f-notes', sheet).value.trim(), links,
      done: kind === 'task' ? !!$('#f-done', sheet)?.checked : false,
    });
    state.sel = $('#f-date', sheet).value || state.sel;
    closeSheet();
    toast('Сохранено');
    syncSoon();
  };
}

// Двойное нажатие вместо системного confirm(): первое нажатие просит подтверждения.
function confirmDelete(sheet) {
  const b = $('#f-del', sheet);
  if (b.dataset.armed) return true;
  b.dataset.armed = '1';
  b.textContent = 'Точно удалить?';
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Удалить'; } }, 3000);
  return false;
}

const normalizeUrl = (u) => !u ? '' : /^[a-z]+:\/\//i.test(u) ? u : 'https://' + u;

// --- Настройки ---
function openSettings() {
  if (!store.getSettings().scriptSecret) {
    const rnd = crypto.getRandomValues(new Uint8Array(18));
    store.setSettings({ scriptSecret: Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('') });
  }
  const s = store.getSettings();
  let mode = s.googleMode === 'oauth' ? 'oauth' : 'script';
  const origin = location.origin;
  const steps = `
    <ol class="steps">
      <li>Нажмите «Скопировать скрипт».</li>
      <li>Откройте <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> под своим Google-аккаунтом. Откроется новый проект: удалите всё в редакторе и вставьте скопированное.</li>
      <li>Слева у «Сервисы» нажмите <b>＋</b> → <b>Google Calendar API</b> → «Добавить».</li>
      <li>Нажмите 💾 «Сохранить», затем выберите функцию <b>authorize</b> и нажмите «Выполнить». Google попросит доступ: «Проверить разрешения» → ваш аккаунт → «Дополнительно» → «Перейти к проекту» → «Разрешить».</li>
      <li>«Развертывание» → «Новое развертывание» → ⚙ тип «Веб-приложение». Запуск от имени: <b>Я</b>. Доступ: <b>Все</b>. «Развернуть».</li>
      <li>Скопируйте «URL веб-приложения» (заканчивается на <b>/exec</b>) и вставьте ниже.</li>
    </ol>`;
  const sheet = openSheet(`
    <h2>Настройки</h2>
    <div class="group-h" style="margin-top:0">Google Календарь</div>
    ${google.isConnected() ? `<p class="hint" style="margin:0 0 10px">✅ Подключён${mode === 'script' ? ' через Apps Script' : ''}.</p>` : ''}
    <div class="seg" id="s-mode"><button data-m="script" class="${mode === 'script' ? 'on' : ''}">Через Apps Script</button><button data-m="oauth" class="${mode === 'oauth' ? 'on' : ''}">OAuth Client ID</button></div>
    <div id="s-script" ${mode !== 'script' ? 'hidden' : ''}>
      <p class="hint">Без Google Cloud и без карты. Делается один раз, лучше с компьютера.</p>
      ${steps}
      <div class="actions" style="margin:0 0 12px"><button class="btn small" id="s-copy">📋 Скопировать скрипт</button></div>
      <label class="field"><span>Ключ доступа (уже вписан в скрипт)</span><input class="input" id="s-secret" value="${esc(s.scriptSecret)}" autocomplete="off"></label>
      <p class="hint">Если настраиваете скрипт на компьютере, а пользуетесь с телефона, введите на телефоне тот же ключ и тот же URL.</p>
      <label class="field"><span>URL веб-приложения</span><input class="input" id="s-url" value="${esc(s.scriptUrl || '')}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" inputmode="url"></label>
    </div>
    <div id="s-oauth" ${mode !== 'oauth' ? 'hidden' : ''}>
      <label class="field"><span>OAuth Client ID</span><input class="input" id="s-gid" value="${esc(s.googleClientId || '')}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off"></label>
      <p class="hint">В Google Cloud добавьте адрес <b>${esc(origin)}</b> в «Authorized JavaScript origins».</p>
    </div>
    <label class="field"><span>Календарь</span><input class="input" id="s-cal" value="${esc(s.calendarId || 'primary')}" autocomplete="off"></label>
    <p class="hint">primary — основной календарь. Можно указать ID другого календаря.</p>
    <div class="actions" style="margin-top:0;margin-bottom:8px">
      ${google.isConnected() ? '<button class="btn" id="s-gout">Отключить Google</button>' : ''}
      <button class="btn primary" id="s-gin">${google.isConnected() ? 'Переподключить' : 'Подключить Google'}</button>
    </div>
    <div id="s-err"></div>
    <div class="group-h">Голосовые команды (Claude)</div>
    <label class="field"><span>Ключ Anthropic API</span><input class="input" type="password" id="s-key" value="${esc(s.anthropicKey || '')}" placeholder="sk-ant-…" autocomplete="off"></label>
    <p class="hint">Необязательно. Без ключа команды разбираются по шаблонам (бесплатно); с ключом Claude понимает свободную речь. Ключ хранится только в этом браузере.</p>
    <div class="group-h">Другое устройство</div>
    <p class="hint">Ссылка перенесёт все настройки на телефон. Отправьте её себе (например, в «Избранное» Telegram) и откройте на телефоне в Chrome. В ссылке ваши ключи, никому её не пересылайте.</p>
    <div class="actions" style="margin-top:0"><button class="btn small" id="s-link">🔗 Скопировать ссылку для телефона</button></div>
    <div id="s-linkout"></div>
    <p class="hint" style="margin-top:12px">Версия: ${__BUILD__}</p>
    <div class="actions"><span class="grow"></span><button class="btn" id="s-close">Закрыть</button><button class="btn primary" id="s-save">Сохранить</button></div>`);

  sheet.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
    mode = b.dataset.m;
    sheet.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b));
    $('#s-script', sheet).hidden = mode !== 'script';
    $('#s-oauth', sheet).hidden = mode !== 'oauth';
  });
  $('#s-copy', sheet).onclick = async () => {
    const secret = $('#s-secret', sheet).value.trim();
    if (!secret) { $('#s-secret', sheet).focus(); return; }
    store.setSettings({ scriptSecret: secret });
    const code = scriptSource(secret);
    try { await navigator.clipboard.writeText(code); toast('Скрипт скопирован'); }
    catch {
      $('#s-err', sheet).innerHTML = `<p class="hint">Не удалось скопировать автоматически. Выделите текст ниже и скопируйте вручную.</p><textarea class="input" rows="8" readonly>${esc(code)}</textarea>`;
    }
  };
  const saveFields = () => {
    const prev = store.getSettings();
    const next = {
      googleMode: mode,
      googleClientId: $('#s-gid', sheet).value.trim(),
      scriptUrl: $('#s-url', sheet).value.trim(),
      scriptSecret: $('#s-secret', sheet).value.trim() || prev.scriptSecret,
      calendarId: $('#s-cal', sheet).value.trim() || 'primary',
      anthropicKey: $('#s-key', sheet).value.trim(),
    };
    store.setSettings(next);
    if (prev.calendarId !== next.calendarId || (prev.googleMode || 'script') !== mode) store.wipeRemoteCache();
  };
  $('#s-close', sheet).onclick = closeSheet;
  $('#s-save', sheet).onclick = () => { saveFields(); closeSheet(); render(); runSync(); };
  $('#s-gin', sheet).onclick = async (e) => {
    saveFields();
    e.target.disabled = true;
    $('#s-err', sheet).innerHTML = '<p class="hint">Проверяю подключение…</p>';
    try { await google.connect(); closeSheet(); toast('Google Календарь подключён'); runSync(); }
    catch (err) { $('#s-err', sheet).innerHTML = `<div class="err">${esc(err.message)}</div>`; e.target.disabled = false; }
  };
  $('#s-link', sheet).onclick = async () => {
    saveFields();
    const link = makeSetupLink();
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
    catch { $('#s-linkout', sheet).innerHTML = `<textarea class="input" rows="3" readonly>${esc(link)}</textarea>`; }
  };
  $('#s-gout', sheet)?.addEventListener('click', () => { google.disconnect(); closeSheet(); render(); toast('Google отключён'); });
}

// --- Перенос настроек на другое устройство через ссылку (данные в #фрагменте, на сервер не уходят) ---
const SETUP_KEYS = { googleMode: 'm', scriptUrl: 'u', scriptSecret: 's', calendarId: 'c', googleClientId: 'g', anthropicKey: 'k' };
function makeSetupLink() {
  const st = store.getSettings();
  const data = {};
  for (const [k, short] of Object.entries(SETUP_KEYS)) if (st[k]) data[short] = st[k];
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#setup=${b64}`;
}
function importSetupFromHash() {
  const m = location.hash.match(/^#setup=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const json = decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
    const data = JSON.parse(json);
    const patch = {};
    for (const [k, short] of Object.entries(SETUP_KEYS)) if (data[short]) patch[k] = data[short];
    if ((patch.googleMode || 'script') === 'script' && patch.scriptUrl) patch.googleConnected = true;
    store.wipeRemoteCache();
    store.setSettings(patch);
    toast(patch.googleConnected ? 'Настройки перенесены, загружаю календарь…' : 'Настройки перенесены');
    return true;
  } catch {
    toast('Ссылка с настройками повреждена');
    return false;
  }
}

// ---------- Голос ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = {
  rec: null,
  start(onText, onEnd) {
    if (!SR) return false;
    this.stop();
    const rec = new SR();
    rec.lang = 'ru-RU';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const r = e.results[k];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      onText((finalText + ' ' + interim).trim());
    };
    rec.onerror = (e) => { this.lastError = e.error; };
    rec.onend = () => { this.rec = null; onEnd(finalText.trim(), this.lastError); this.lastError = null; };
    this.rec = rec;
    rec.start();
    return true;
  },
  stop() { try { this.rec?.stop(); } catch {} },
};

function openVoice() {
  const sheet = openSheet(`
    <h2>Голосовая команда</h2>
    <div class="listen">
      <button class="pulse" id="v-mic" aria-label="Говорить">${ico.mic}</button>
      <div class="status" id="v-status"></div>
    </div>
    <label class="field"><span>Команда</span><textarea class="input" id="v-text" rows="2" placeholder="«Перенеси встречу с Олегом на четверг в 15:00»"></textarea></label>
    <div class="actions" style="margin-top:0"><span class="grow"></span><button class="btn" id="v-cancel">Закрыть</button><button class="btn primary" id="v-go">Разобрать</button></div>
    <div id="v-result"></div>`);
  const status = $('#v-status', sheet), text = $('#v-text', sheet), mic = $('#v-mic', sheet);
  const listen = () => {
    const ok = voice.start(
      (t) => { text.value = t; },
      (final, err) => {
        mic.classList.remove('live');
        if (err && err !== 'no-speech' && err !== 'aborted') { status.textContent = err === 'not-allowed' ? 'Нет доступа к микрофону. Разрешите его в настройках браузера.' : 'Не получилось распознать, попробуйте ещё раз.'; return; }
        if (final) { text.value = final; analyze(); } else status.textContent = 'Нажмите на микрофон и говорите';
      });
    if (ok) { mic.classList.add('live'); status.textContent = 'Слушаю…'; $('#v-result', sheet).innerHTML = ''; }
    else { status.textContent = 'Распознавание речи недоступно в этом браузере — введите команду текстом.'; text.focus(); }
  };
  const analyze = async () => {
    const cmd = text.value.trim();
    if (!cmd) return;
    voice.stop();
    status.textContent = 'Разбираю команду…';
    $('#v-go', sheet).disabled = true;
    try {
      const res = await ai.parseCommand(cmd);
      status.textContent = '';
      showProposal(sheet, res);
    } catch (e) {
      status.textContent = '';
      $('#v-result', sheet).innerHTML = `<div class="err">${esc(e.message)}</div>`;
    } finally { $('#v-go', sheet).disabled = false; }
  };
  mic.onclick = () => (voice.rec ? voice.stop() : listen());
  $('#v-go', sheet).onclick = analyze;
  $('#v-cancel', sheet).onclick = closeSheet;
  text.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analyze(); } });
  listen();
}

const OPS = { create: 'Создать', update: 'Изменить', complete: 'Выполнено', reopen: 'Вернуть в работу', delete: 'Удалить' };
const KIND = { task: 'задачу', meeting: 'встречу' };

function describe(a) {
  const target = a.target_id ? store.get(a.target_id) : null;
  const det = [];
  const when = (date, start, end) => [date && humanDate(date), start && (end ? `${start}–${end}` : start)].filter(Boolean).join(', ');
  if (a.op === 'create') {
    det.push(when(a.date, a.start, a.end) || '');
    if (!a.start) det.push(a.kind === 'task' ? 'на весь день' : 'без времени');
  } else if (a.op === 'update') {
    if (a.date || a.start || a.end) det.push(`Было: ${when(target.date, target.start, target.end) || '—'} → станет: ${when(a.date || target.date, a.start || target.start, a.end)}`);
    if (a.title && a.title !== target.title) det.push(`Новое название: «${a.title}»`);
  }
  if (a.assignee) det.push(`Ответственный: ${a.assignee}`);
  if (a.notes) det.push(`Заметка: ${a.notes}`);
  if (a.add_links?.length) det.push(`Ссылки: ${a.add_links.map((l) => l.title || shortUrl(l.url)).join(', ')}`);
  const what = a.op === 'create' ? `${KIND[a.kind] || 'задачу'}: «${a.title}»` : `«${target.title}»`;
  return `<div class="act ${a.op === 'delete' ? 'del' : ''}"><div class="op">${OPS[a.op]} ${a.op === 'create' ? '' : ''}</div><div class="what">${esc(what.charAt(0).toUpperCase() + what.slice(1))}</div><div class="det">${det.filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join('')}</div></div>`;
}

function showProposal(sheet, res) {
  const box = $('#v-result', sheet);
  if (!res.actions.length) {
    box.innerHTML = `<div class="q">${esc(res.clarification || 'Не понял команду. Попробуйте сформулировать иначе.')}</div>`;
    return;
  }
  const single = res.actions.length === 1 && ['create', 'update'].includes(res.actions[0].op);
  if (res.local) box.dataset.local = '1';
  box.innerHTML = `
    <div class="group-h">Проверьте перед сохранением</div>
    ${res.actions.map(describe).join('')}
    ${res.clarification ? `<div class="q">${esc(res.clarification)}</div>` : ''}
    ${res.local ? '<p class="hint">Разобрано по шаблонам, без Claude. Если что-то не так, нажмите «Поправить».</p>' : ''}
    <div class="actions">
      ${single ? '<button class="btn" id="p-edit">Поправить</button>' : ''}
      <span class="grow"></span>
      <button class="btn" id="p-no">Отмена</button>
      <button class="btn primary" id="p-yes">Подтвердить</button>
    </div>`;
  $('#p-no', box).onclick = () => { box.innerHTML = ''; };
  $('#p-yes', box).onclick = () => {
    const firstDate = applyActions(res.actions);
    if (firstDate) state.sel = firstDate;
    closeSheet();
    toast(res.actions.length > 1 ? `Сохранено действий: ${res.actions.length}` : 'Сохранено');
    syncSoon();
  };
  $('#p-edit', box)?.addEventListener('click', () => {
    const a = res.actions[0];
    if (a.op === 'create') openEditor(null, pickDefined({ kind: a.kind || 'task', title: a.title, date: a.date, start: a.start, end: a.end, assignee: a.assignee, notes: a.notes, links: a.add_links }));
    else { const t = store.get(a.target_id); openEditor(t.id, updatedFields(t, a)); }
  });
}

const pickDefined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null));

function updatedFields(t, a) {
  const p = pickDefined({ title: a.title, date: a.date, assignee: a.assignee, kind: a.kind });
  if (a.start) {
    p.start = a.start;
    // Сохраняем длительность, если конец не назван.
    p.end = a.end || (t.start && t.end ? addMinutes(a.date || t.date, a.start, diffMinutes(t.date, t.start, t.end)).time : null);
  } else if (a.end) p.end = a.end;
  if (a.notes) p.notes = t.notes ? `${t.notes}\n${a.notes}` : a.notes;
  if (a.add_links?.length) p.links = [...(t.links || []), ...a.add_links.map((l) => ({ title: l.title, url: normalizeUrl(l.url) }))];
  return p;
}

function applyActions(actions) {
  let firstDate = null;
  for (const a of actions) {
    if (a.op === 'create') {
      store.upsert(pickDefined({ kind: a.kind || 'task', title: a.title, date: a.date, start: a.start, end: a.start ? a.end : null, assignee: a.assignee || '', notes: a.notes || '', links: (a.add_links || []).map((l) => ({ title: l.title, url: normalizeUrl(l.url) })) }));
      firstDate ??= a.date;
      continue;
    }
    const t = store.get(a.target_id);
    if (!t) continue;
    if (a.op === 'update') { const p = updatedFields(t, a); store.upsert({ id: t.id, ...p }); firstDate ??= p.date || t.date; }
    else if (a.op === 'complete') store.upsert({ id: t.id, done: true });
    else if (a.op === 'reopen') store.upsert({ id: t.id, done: false });
    else if (a.op === 'delete') store.remove(t.id);
  }
  return firstDate;
}

// ---------- Синхронизация ----------
async function runSync(auto = false) {
  if (!google.isConnected()) { render(); return; }
  // Без нажатия пользователя браузер не даст открыть окно входа Google, поэтому авто-синхронизация ждёт кнопку.
  if (auto === true && !google.tokenValid()) { render(); return; }
  state.syncing = true; render();
  try { await google.sync(); state.syncError = ''; }
  catch (e) { state.syncError = e.message + ' Изменения сохранены на устройстве и отправятся позже.'; }
  state.syncing = false; render();
}
let syncTimer;
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 300); }

// ---------- События ----------
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-stop]')) return;
  const el = e.target.closest('[data-act],[data-day],[data-tab],[data-toggle],[data-open]');
  if (!el || el.closest('.sheet')) return;
  if (el.dataset.day) { state.sel = el.dataset.day; if (state.tab === 'tasks') state.tab = 'day'; render(); return; }
  if (el.dataset.tab) { state.tab = el.dataset.tab; render(); return; }
  if (el.dataset.toggle) { const it = store.get(el.dataset.toggle); store.upsert({ id: it.id, done: !it.done }); syncSoon(); return; }
  if (el.dataset.open) { openEditor(el.dataset.open); return; }
  const act = el.dataset.act;
  if (act === 'settings') openSettings();
  else if (act === 'new') openEditor(null);
  else if (act === 'voice') openVoice();
  else if (act === 'sync') runSync(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

store.onChange(render);
window.addEventListener('online', () => runSync(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { render(); if (google.isConnected()) runSync(true); } });

importSetupFromHash();
render();
if (google.isConnected()) runSync(true);
if (new URLSearchParams(location.search).get('voice')) openVoice();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
  // Когда вышла новая версия, перезагружаемся один раз, чтобы сразу её показать.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); } });
}
