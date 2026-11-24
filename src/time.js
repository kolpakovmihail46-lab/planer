// Всё время считаем в часовом поясе Омска, независимо от настроек телефона.
export const TZ = 'Asia/Omsk';
export const OFFSET = '+06:00';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

export function partsOf(d = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const h = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${h}:${p.minute}` };
}

export const today = () => partsOf().date;

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const toRFC = (date, time) => `${date}T${time}:00${OFFSET}`;

export function addMinutes(date, time, mins) {
  return partsOf(new Date(new Date(toRFC(date, time)).getTime() + mins * 60000));
}

export function diffMinutes(date, a, b) {
  return (new Date(toRFC(date, b)) - new Date(toRFC(date, a))) / 60000;
}

const wdShort = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', timeZone: 'UTC' });
const wdLong = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const asUTC = (date) => new Date(date + 'T12:00:00Z');

export const weekdayShort = (date) => wdShort.format(asUTC(date));
export const weekdayLong = (date) => wdLong.format(asUTC(date));
export const dayNum = (date) => Number(date.slice(8, 10));

export function humanDate(date) {
  const t = today();
  if (date === t) return 'Сегодня';
  if (date === addDays(t, 1)) return 'Завтра';
  if (date === addDays(t, -1)) return 'Вчера';
  return `${weekdayShort(date)}, ${dayMonth.format(asUTC(date))}`;
}
