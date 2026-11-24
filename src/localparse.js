// Разбор типовых голосовых команд без Claude: бесплатно и офлайн, но только по шаблонам.
import * as store from './store.js';
import { today, addDays, partsOf, addMinutes } from './time.js';

const WEEKDAYS = [
  ['понедельник', 1], ['вторник', 2], ['сред', 3], ['четверг', 4], ['пятниц', 5], ['суббот', 6], ['воскресень', 0],
];
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MEETING_WORDS = /(встреч|созвон|совещан|планёрк|планерк|переговор|собеседован|собрани|звонок|обед с|ужин с|видеозвон)/;
const TASK_WORDS = /(задач|надо|нужно|напомни|не забыть|проверить|сделать|подготовить|отправить|согласовать|заказать)/;

const pad = (n) => String(n).padStart(2, '0');
const weekdayOf = (date) => new Date(date + 'T12:00:00Z').getUTCDay();

// Каждый парсер находит фрагмент, возвращает значение и вырезает фрагмент из текста.
function take(state, re, fn) {
  const m = state.text.match(re);
  if (!m) return null;
  const v = fn(m);
  if (v == null) return null;
  state.text = (state.text.slice(0, m.index) + ' ' + state.text.slice(m.index + m[0].length)).replace(/\s+/g, ' ');
  return v;
}

function parseDate(state) {
  const t = today();
  return (
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:на |до )?послезавтра(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => addDays(t, 2)) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:на |до )?завтра(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => addDays(t, 1)) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:на |до )?сегодня(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => t) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))через (неделю|месяц|день|два дня|(?:\d+|одну|две|три) (?:дн\S*|недел\S*))/, (m) => {
      const w = m[1].split(' ')[0]; m[2] = m[1].split(' ')[1];
      if (w === 'неделю') return addDays(t, 7);
      if (w === 'месяц') return addDays(t, 30);
      if (w === 'день') return addDays(t, 1);
      if (w === 'два дня') return addDays(t, 2);
      const n = { одну: 1, две: 2, три: 3 }[w] ?? Number(w);
      return addDays(t, /недел/.test(m[2] || '') ? n * 7 : n);
    }) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:на |в )?следующ\S* недел\S*/, () => { let d = addDays(t, 1); while (weekdayOf(d) !== 1) d = addDays(d, 1); return d; }) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, (m) => makeDate(Number(m[1]), Number(m[2]))) ||
    take(state, new RegExp(`(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:на |до |к )?(\\d{1,2})(?:-?го|-е)?\\s+(${MONTHS.join('|')})[а-я]*`), (m) => makeDate(Number(m[1]), MONTHS.indexOf(m[2]) + 1)) ||
    take(state, new RegExp(`(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:в |во |на |до |к |в эт\\S* |в следующ\\S* )?(${WEEKDAYS.map((w) => w[0]).join('|')})[а-я]*`), (m) => {
      const wd = WEEKDAYS.find((w) => w[0] === m[1])[1];
      let d = addDays(t, 1);
      while (weekdayOf(d) !== wd) d = addDays(d, 1);
      return d;
    })
  );
}

function makeDate(day, month) {
  if (!day || !month || day > 31 || month > 12) return null;
  const t = today();
  let y = Number(t.slice(0, 4));
  let d = `${y}-${pad(month)}-${pad(day)}`;
  if (d < addDays(t, -60)) d = `${y + 1}-${pad(month)}-${pad(day)}`;
  return d;
}

function hour12(h, part) {
  if (part && /(вечер|дня|ночи)/.test(part) && h < 12) return h + 12;
  if (part && /утра/.test(part) && h === 12) return 0;
  if (!part && h >= 1 && h <= 7) return h + 12; // «в 3» в рабочем контексте — это 15:00
  return h;
}

function parseTime(state) {
  const t = (h, m = 0) => (h >= 0 && h < 24 && m >= 0 && m < 60 ? `${pad(h)}:${pad(m)}` : null);
  const range = take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))с (\d{1,2})(?:[:. ](\d{2}))?\s*(?:час\S*)?\s*до (\d{1,2})(?:[:. ](\d{2}))?\s*(?:час\S*)?\s*(утра|дня|вечера)?/, (m) => {
    const a = t(hour12(Number(m[1]), m[5]), Number(m[2] || 0)), b = t(hour12(Number(m[3]), m[5]), Number(m[4] || 0));
    return a && b ? { start: a, end: b } : null;
  });
  if (range) return range;
  const now = partsOf();
  const start =
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))через (\d+|час|полчаса|пол часа)\s*(минут\S*|час\S*)?/, (m) => {
      const mins = m[1] === 'час' ? 60 : /пол/.test(m[1]) ? 30 : /час/.test(m[2] || '') ? Number(m[1]) * 60 : Number(m[1]);
      const r = addMinutes(now.date, now.time, mins);
      state.dateFromTime = r.date;
      return r.time;
    }) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:в |на |к )?(\d{1,2})[:.](\d{2})(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, (m) => t(Number(m[1]), Number(m[2]))) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:в |на |к )(\d{1,2})(?: (\d{2}))?\s*(?:час\S*)?\s*(утра|дня|вечера|ночи)?(?=\s|$)/, (m) => t(hour12(Number(m[1]), m[3]), Number(m[2] || 0))) ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:в |на |к )час дня(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => '13:00') ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:в )?полдень(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => '12:00') ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))утром(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => '09:00') ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:в )?обед(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?! с)/, () => '13:00') ||
    take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))вечером(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, () => '18:00');
  if (!start) return null;
  const dur = take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))на (\d+|час|полчаса|пол часа|полтора часа)\s*(минут\S*|час\S*)?/, (m) => {
    if (m[1] === 'час') return 60;
    if (/пол/.test(m[1])) return /полтора/.test(m[1]) ? 90 : 30;
    return /час/.test(m[2] || '') ? Number(m[1]) * 60 : /минут/.test(m[2] || '') ? Number(m[1]) : null;
  });
  return { start, end: dur ? addMinutes(today(), start, dur).time : null };
}

function toNominative(w) {
  let n = w;
  if (/ье$/.test(n)) n = n.replace(/ье$/, 'ья');
  else if (/е$/.test(n)) n = n.replace(/е$/, 'а');
  else if (/ю$/.test(n)) n = n.replace(/ю$/, 'й');
  else if (/у$/.test(n)) n = n.replace(/у$/, '');
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function parseAssignee(state) {
  return take(state, /(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(?:поручи(?:ть)?|назначь|назначить|передай|ответственн\S*)\s+([а-яё]{3,})(?:\s+([а-яё]{3,}(?:у|ю|е)))?(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))/, (m) => {
    const words = [m[1], m[2]].filter((w) => w && !TASK_WORDS.test(w) && !/^(задач|встреч|ему|ей|мне)/.test(w));
    return words.length ? words.map(toNominative).join(' ') : null;
  });
}

function parseLinks(state) {
  const links = [];
  let m;
  while ((m = state.text.match(/(?:ссылк\S*\s*:?\s*)?((?:https?:\/\/|www\.)\S+|(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*)/i))) {
    const url = /^https?:/i.test(m[1]) ? m[1] : 'https://' + m[1];
    links.push({ title: '', url: url.replace(/[.,;)]+$/, '') });
    state.text = state.text.replace(m[0], ' ');
  }
  return links;
}

const STOP = new Set(['задача', 'задачу', 'задачи', 'встреча', 'встречу', 'встречи', 'про', 'с', 'со', 'по', 'на', 'в', 'во', 'и', 'к', 'о', 'об', 'для', 'мне', 'это', 'эту', 'этот', 'запись']);
const stem = (w) => w.replace(/ё/g, 'е').slice(0, Math.max(4, Math.ceil(w.length * 0.7)));
const words = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

function findTarget(phrase, filter = () => true) {
  const q = words(phrase).map(stem);
  if (!q.length) return { item: null, options: [] };
  const t = today();
  const scored = store.all().filter(filter).map((it) => {
    const tw = words(it.title).map(stem);
    let score = 0;
    for (const w of q) if (tw.some((x) => x.startsWith(w) || w.startsWith(x))) score++;
    if (it.date >= t) score += 0.1; // предпочитаем будущие
    return { it, score };
  }).filter((x) => x.score >= 1).sort((a, b) => b.score - a.score || Math.abs(new Date(a.it.date) - new Date(t)) - Math.abs(new Date(b.it.date) - new Date(t)));
  if (!scored.length) return { item: null, options: [] };
  if (scored.length > 1 && Math.floor(scored[0].score) === Math.floor(scored[1].score) && scored[0].it.title !== scored[1].it.title)
    return { item: null, options: scored.slice(0, 4).map((x) => x.it) };
  return { item: scored[0].it, options: [] };
}

function cleanTitle(s) {
  let t = s
    .replace(/(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9]))(создай|создать|добавь|добавить|запланируй|запланировать|поставь|поставить|новая|новую|новое|напомни|напомнить|мне|пожалуйста|запиши|записать|задача|задачу|встреча|встречу|ссылка|ссылку)(?:(?<![а-яёa-z0-9])(?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])(?![а-яёa-z0-9])):?/g, ' ')
    .replace(/^[\s,.:—-]+|[\s,.:—-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

const empty = () => ({ op: 'create', target_id: null, kind: null, title: null, date: null, start: null, end: null, assignee: null, notes: null, add_links: [] });
const ask = (q) => ({ actions: [], clarification: q });
const optionsText = (opts) => 'Подходит несколько записей: ' + opts.map((o) => `«${o.title}»`).join(', ') + '. Уточните название.';

export function parseLocal(input) {
  const raw = input.trim().replace(/[«»"]/g, '');
  const low = raw.toLowerCase().replace(/планерк/g, 'планёрк').replace(/[,;!?]+/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  let m;

  // Выполнено / вернуть в работу / удалить
  if ((m = low.match(/^(?:отметь\S*|пометь\S*|выполнен\S*|выполнил\S*|сделан\S*|сделал\S*|готов\S*|закрой\S*|закрыть)\s*(?:как выполнен\S*|выполнен\S*)?\s*:?\s*(?:задач\S*)?\s*(.*)$/))) {
    const { item, options } = findTarget(m[1].replace(/выполнен\S*/g, ''), (i) => i.kind === 'task');
    if (!item) return ask(options.length ? optionsText(options) : 'Не нашёл такую задачу. Назовите её точнее.');
    if (item.done) return ask(`Задача «${item.title}» уже выполнена.`);
    return { actions: [{ ...empty(), op: 'complete', target_id: item.id }], clarification: null };
  }
  if ((m = low.match(/^(?:верни\S*|вернуть|открой\S* снова|снова открой\S*)\s*(?:в работу)?\s*:?\s*(.*)$/))) {
    const { item, options } = findTarget(m[1].replace(/в работу/g, ''), (i) => i.kind === 'task');
    if (!item) return ask(options.length ? optionsText(options) : 'Не нашёл такую задачу.');
    return { actions: [{ ...empty(), op: 'reopen', target_id: item.id }], clarification: null };
  }
  if ((m = low.match(/^(?:удали\S*|отмени\S*|убери\S*)\s+(.*)$/))) {
    const s = { text: m[1] };
    const date = parseDate(s);
    const { item, options } = findTarget(s.text, (i) => !date || i.date === date);
    if (!item) return ask(options.length ? optionsText(options) : 'Не нашёл, что удалить. Назовите запись точнее.');
    return { actions: [{ ...empty(), op: 'delete', target_id: item.id }], clarification: null };
  }

  // Перенос / изменение / добавление ссылки к существующей записи
  if ((m = low.match(/^(?:перенеси\S*|перенести|передвинь\S*|сдвинь\S*|подвинь\S*|измени\S*|поменяй\S*)\s+(.*)$/))) {
    const body = m[1];
    const split = body.search(/\s(?:на|в|во|к)\s+(?:\d|сегодня|завтра|послезавтра|понедельник|вторник|сред|четверг|пятниц|суббот|воскресень|следующ|утро|вечер|обед|полдень)/);
    const targetPhrase = split > 0 ? body.slice(0, split) : body;
    const whenPhrase = split > 0 ? body.slice(split) : '';
    const s = { text: whenPhrase };
    const date = parseDate(s), time = parseTime(s);
    const ts = { text: targetPhrase };
    const oldDate = parseDate(ts); parseTime(ts);
    const { item, options } = findTarget(ts.text, (i) => !oldDate || i.date === oldDate);
    if (!item) return ask(options.length ? optionsText(options) : 'Не нашёл, что перенести. Назовите запись точнее.');
    if (!date && !time && !s.dateFromTime) return ask(`Куда перенести «${item.title}»? Скажите день и время.`);
    return { actions: [{ ...empty(), op: 'update', target_id: item.id, date: date || s.dateFromTime || null, start: time?.start || null, end: time?.end || null }], clarification: null };
  }
  if ((m = low.match(/^(?:к|ко)\s+(.+?)\s+(?:добавь|прикрепи|приложи)\s+(.*)$/)) || (m = low.match(/^(?:добавь|прикрепи|приложи)\s+(?:ссылк\S*|документ\S*)\s+(?:к|ко)\s+(.+?)\s*:?\s+((?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]).*)$/))) {
    const s = { text: raw.slice(raw.toLowerCase().indexOf(m[2].slice(0, 6))) };
    const links = parseLinks(s);
    const { item, options } = findTarget(m[1]);
    if (!item) return ask(options.length ? optionsText(options) : 'Не нашёл запись, к которой добавить.');
    if (!links.length) return ask('Не расслышал адрес ссылки. Удобнее добавить её вручную в карточке.');
    return { actions: [{ ...empty(), op: 'update', target_id: item.id, add_links: links }], clarification: null };
  }

  // Иначе — создание новой записи
  const s = { text: low };
  const links = parseLinks(s);
  const assignee = parseAssignee(s);
  const date = parseDate(s);
  const time = parseTime(s);
  const kind = MEETING_WORDS.test(low) ? 'meeting' : TASK_WORDS.test(low) ? 'task' : time ? 'meeting' : 'task';
  // Возвращаем исходный регистр для названия (имена собственные).
  let title = restoreCase(cleanTitle(s.text), raw);
  if (kind === 'meeting' && /^(С|Со) /.test(title)) title = 'Встреча ' + title.charAt(0).toLowerCase() + title.slice(1);
  if (!title) return ask('Не понял, что записать. Скажите, например: «Встреча с поставщиком завтра в 11».');
  return {
    actions: [{ ...empty(), op: 'create', kind, title, date: date || s.dateFromTime || today(), start: time?.start || null, end: time?.end || null, assignee, add_links: links }],
    clarification: null,
  };
}

function restoreCase(title, raw) {
  const rawWords = raw.split(/\s+/);
  return title.split(' ').map((w, i) => {
    const orig = rawWords.find((r) => r.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яёa-z0-9-]/gi, '') === w.toLowerCase().replace(/[^а-яёa-z0-9-]/gi, ''));
    if (orig && i > 0 && /^[А-ЯЁA-Z]/.test(orig)) return w.charAt(0).toUpperCase() + w.slice(1);
    return w;
  }).join(' ');
}
