// Локальное хранилище: кэш событий Google Календаря + изменения, которые ещё не отправлены.
const KEY = 'planner.items.v1';
const SKEY = 'planner.settings.v1';

function read(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* память недоступна */ }
}

let items = read(KEY, []);
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
function commit() { write(KEY, items); listeners.forEach((fn) => fn()); }

export const uid = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const all = () => items.filter((i) => !i.deleted);
export const get = (id) => items.find((i) => i.id === id);
export const dirty = () => items.filter((i) => i.dirty);

export function upsert(data) {
  const now = Date.now();
  const existing = data.id && get(data.id);
  if (existing) Object.assign(existing, data, { updated: now, dirty: true });
  else items.push({ links: [], done: false, assignee: '', notes: '', ...data, id: data.id || uid(), gid: data.gid || null, updated: now, dirty: true });
  commit();
  return data.id || items[items.length - 1].id;
}

export function remove(id) {
  const it = get(id);
  if (!it) return;
  if (it.gid) Object.assign(it, { deleted: true, dirty: true });
  else items = items.filter((i) => i.id !== id);
  commit();
}

// Помечаем запись как отправленную в Google.
// Удалить всю повторяющуюся серию: убираем экземпляры и ставим «надгробие» для основного события в Google.
export function removeSeries(recurringId) {
  items = items.filter((i) => i.recurringId !== recurringId);
  items.push({ id: uid(), gid: recurringId, deleted: true, dirty: true, title: '', date: '0000-00-00' });
  commit();
}

export function markSynced(id, patch = {}) {
  const it = get(id);
  if (!it) return;
  if (it.deleted) items = items.filter((i) => i.id !== id);
  else Object.assign(it, patch, { dirty: false });
}

// Подменяем всё, что пришло из Google в окне дат, кроме несохранённых локальных правок.
export function replaceRemote(from, to, remote) {
  const byGid = new Map(items.filter((i) => i.gid).map((i) => [i.gid, i]));
  const keep = items.filter((i) => !i.gid || i.dirty || i.date < from || i.date > to);
  const keepGids = new Set(keep.filter((i) => i.gid).map((i) => i.gid));
  for (const r of remote) {
    if (keepGids.has(r.gid)) continue;
    const old = byGid.get(r.gid);
    keep.push({ ...r, id: old ? old.id : uid(), dirty: false, updated: Date.now() });
  }
  items = keep;
  commit();
}

export function save() { commit(); }

export function wipeRemoteCache() {
  items = items.filter((i) => !i.gid);
  commit();
}

let settings = read(SKEY, {});
export const getSettings = () => ({ calendarId: 'primary', ...settings });
export function setSettings(patch) { settings = { ...settings, ...patch }; write(SKEY, settings); }
