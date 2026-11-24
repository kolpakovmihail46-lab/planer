// Двусторонняя синхронизация с Google Календарём прямо из браузера (без сервера).
import * as store from './store.js';
import { partsOf, toRFC, addMinutes, addDays, today, TZ } from './time.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TKEY = 'planner.gtoken.v1';
const DONE = '✓ ';
const SEP = '\n\n—\n';

let token = (() => { try { return JSON.parse(localStorage.getItem(TKEY)); } catch { return null; } })();
let tokenClient = null;
let gisPromise = null;

const saveToken = (t) => { token = t; try { t ? localStorage.setItem(TKEY, JSON.stringify(t)) : localStorage.removeItem(TKEY); } catch {} };

// Два способа подключения: через Google Apps Script (без Google Cloud) или через OAuth Client ID.
const viaScript = () => store.getSettings().googleMode !== 'oauth';
export const isConfigured = () => viaScript() ? !!store.getSettings().scriptUrl : !!store.getSettings().googleClientId;
export const isConnected = () => !!store.getSettings().googleConnected && (viaScript() ? !!store.getSettings().scriptUrl : !!token);
export const tokenValid = () => viaScript() || (!!token && token.exp > Date.now());

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = res;
    s.onerror = () => { gisPromise = null; rej(new Error('Не удалось загрузить вход Google. Проверьте интернет.')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

async function requestToken(prompt) {
  await loadGis();
  const clientId = store.getSettings().googleClientId;
  if (!clientId) throw new Error('Не указан Google Client ID в настройках.');
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error('Google: ' + (r.error_description || r.error)));
        saveToken({ access: r.access_token, exp: Date.now() + (Number(r.expires_in) - 60) * 1000 });
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Окно входа закрыто.' : 'Не удалось войти в Google.')),
    });
    tokenClient.requestAccessToken({ prompt });
  });
}

export async function connect() {
  if (viaScript()) {
    if (!store.getSettings().scriptUrl) throw new Error('Вставьте адрес веб-приложения Apps Script.');
    await scriptCall('', { query: { maxResults: '1' } });
  } else await requestToken('consent');
  store.setSettings({ googleConnected: true });
}

export function disconnect() {
  if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token.access, () => {});
  saveToken(null);
  store.setSettings({ googleConnected: false });
  store.wipeRemoteCache();
}

async function ensureToken() {
  if (token && token.exp > Date.now()) return token.access;
  await requestToken('');
  return token.access;
}

// Запрос через развернутый скрипт: простой POST без preflight, скрипт сам ходит в Calendar API.
async function scriptCall(path, { method = 'GET', body, query } = {}) {
  const s = store.getSettings();
  let res;
  try {
    res = await fetch(s.scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: s.scriptSecret, calendarId: s.calendarId || 'primary', method, path, query, body }),
    });
  } catch {
    throw new Error('Не удалось связаться со скриптом Google. Проверьте адрес и что доступ открыт для «Все» (Anyone).');
  }
  let out;
  try { out = await res.json(); } catch { throw new Error('Скрипт Google ответил не так, как ожидалось. Проверьте, что развернута последняя версия.'); }
  if (method === 'DELETE' && (out.status === 404 || out.status === 410)) return null;
  if (out.status >= 400) throw new Error(`Google Календарь: ${out.data?.error?.message || 'ошибка ' + out.status}`);
  return out.data;
}

async function api(path, opts = {}, retried = false) {
  if (viaScript()) return scriptCall(path, opts);
  const { method = 'GET', body, query } = opts;
  const access = await ensureToken();
  const cal = encodeURIComponent(store.getSettings().calendarId || 'primary');
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => v != null && url.searchParams.set(k, v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) { saveToken(null); return api(path, { method, body, query }, true); }
  if (method === 'DELETE' && (res.status === 404 || res.status === 410)) return null;
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    throw new Error(`Google Календарь: ${msg}`);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Преобразование запись <-> событие ----------

function toEvent(it) {
  const links = (it.links || []).filter((l) => l.url);
  let description = it.notes || '';
  const extra = links.filter((l) => !description.includes(l.url));
  if (extra.length) description += SEP + 'Ссылки:\n' + extra.map((l) => `${l.title ? l.title + ': ' : ''}${l.url}`).join('\n');
  if (it.assignee) description += (extra.length ? '\n' : SEP) + `Ответственный: ${it.assignee}`;
  const ev = {
    summary: (it.kind === 'task' && it.done ? DONE : '') + it.title,
    description,
    extendedProperties: { private: {
      plKind: it.kind,
      plDone: it.done ? '1' : '0',
      plAssignee: it.assignee || '',
      plNotes: (it.notes || '').slice(0, 1000),
      plLinks: JSON.stringify(links).slice(0, 1024),
    } },
  };
  if (it.start) {
    const end = it.end || addMinutes(it.date, it.start, it.kind === 'task' ? 30 : 60).time;
    const endDate = end > it.start ? it.date : addDays(it.date, 1);
    ev.start = { dateTime: toRFC(it.date, it.start), timeZone: TZ, date: null };
    ev.end = { dateTime: toRFC(endDate, end), timeZone: TZ, date: null };
  } else {
    ev.start = { date: it.date, dateTime: null, timeZone: null };
    ev.end = { date: addDays(it.date, 1), dateTime: null, timeZone: null };
  }
  if (it.kind === 'task') ev.transparency = 'transparent';
  return ev;
}

const stripHtml = (s) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

function fromEvent(ev) {
  const p = ev.extendedProperties?.private || {};
  let date, start = null, end = null;
  if (ev.start?.dateTime) {
    const s = partsOf(new Date(ev.start.dateTime));
    date = s.date; start = s.time;
    if (ev.end?.dateTime) end = partsOf(new Date(ev.end.dateTime)).time;
  } else {
    date = ev.start?.date;
  }
  let title = ev.summary || '(без названия)';
  if (title.startsWith(DONE)) title = title.slice(DONE.length);
  let links = [];
  try { links = JSON.parse(p.plLinks || '[]'); } catch {}
  if (ev.hangoutLink && !links.some((l) => l.url === ev.hangoutLink)) links.push({ title: 'Видеовстреча', url: ev.hangoutLink });
  const desc = stripHtml(ev.description || '');
  const notes = p.plNotes != null ? p.plNotes : desc.split(SEP)[0];
  if (!p.plKind) {
    for (const m of desc.matchAll(/https?:\/\/[^\s<>"]+/g)) if (!links.some((l) => l.url === m[0])) links.push({ title: '', url: m[0] });
  }
  return {
    gid: ev.id,
    kind: p.plKind === 'task' ? 'task' : 'meeting',
    title, date, start, end,
    done: p.plDone === '1',
    assignee: p.plAssignee || '',
    notes: p.plKind ? notes : desc,
    links,
    htmlLink: ev.htmlLink,
    location: ev.location || '',
  };
}

// ---------- Синхронизация ----------

let syncing = null;
export function sync() {
  if (!isConfigured() || !isConnected()) return Promise.resolve(false);
  syncing ??= doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  // 1. Отправляем локальные изменения.
  for (const it of store.dirty()) {
    if (it.deleted) {
      await api(`/${encodeURIComponent(it.gid)}`, { method: 'DELETE' });
      store.markSynced(it.id);
    } else if (!it.gid) {
      const ev = await api('', { method: 'POST', body: toEvent(it) });
      store.markSynced(it.id, { gid: ev.id, htmlLink: ev.htmlLink });
    } else {
      const ev = await api(`/${encodeURIComponent(it.gid)}`, { method: 'PATCH', body: toEvent(it) });
      store.markSynced(it.id, { htmlLink: ev.htmlLink });
    }
  }
  store.save();
  // 2. Забираем свежие события за окно: 30 дней назад — 120 вперёд.
  const from = addDays(today(), -30), to = addDays(today(), 120);
  const remote = [];
  let pageToken;
  do {
    const r = await api('', { query: {
      timeMin: toRFC(from, '00:00'), timeMax: toRFC(addDays(to, 1), '00:00'),
      singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', pageToken,
    } });
    for (const ev of r.items || []) if (ev.status !== 'cancelled') remote.push(fromEvent(ev));
    pageToken = r.nextPageToken;
  } while (pageToken);
  store.replaceRemote(from, to, remote);
  store.setSettings({ lastSync: Date.now() });
  return true;
}
