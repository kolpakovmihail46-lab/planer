// Разбор голосовой/текстовой команды в набор действий с помощью Claude.
import Anthropic from '@anthropic-ai/sdk';
import * as store from './store.js';
import { partsOf, addDays, weekdayLong, TZ } from './time.js';
import { parseLocal } from './localparse.js';
import { scriptGemini, scriptReady } from './google.js';

const MODEL = 'claude-opus-5-5';

const nullable = (type) => ({ type: [type, 'null'] });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'clarification'],
  properties: {
    clarification: { ...nullable('string'), description: 'Вопрос пользователю, если команду нельзя однозначно понять; иначе null.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'target_id', 'kind', 'title', 'date', 'start', 'end', 'assignee', 'notes', 'repeat', 'add_links'],
        properties: {
          op: { type: 'string', enum: ['create', 'update', 'complete', 'reopen', 'delete'] },
          target_id: nullable('string'),
          kind: { type: ['string', 'null'], enum: ['meeting', 'task', null] },
          title: nullable('string'),
          date: { ...nullable('string'), description: 'YYYY-MM-DD' },
          start: { ...nullable('string'), description: 'HH:MM, 24h' },
          end: { ...nullable('string'), description: 'HH:MM, 24h' },
          assignee: nullable('string'),
          notes: nullable('string'),
          repeat: { type: ['string', 'null'], enum: ['daily', 'weekly', 'weekdays', null], description: 'Только для create: повторение' },
          add_links: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['title', 'url'],
              properties: { title: { type: 'string' }, url: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

function buildSystem() {
  const now = partsOf();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(now.date, i);
    return `${d} — ${weekdayLong(d)}`;
  }).join('\n');
  const from = addDays(now.date, -14), to = addDays(now.date, 60);
  const items = store.all()
    .filter((i) => (i.date >= from && i.date <= to) || (i.kind === 'task' && !i.done && i.date < now.date))
    .sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')))
    .slice(0, 250)
    .map((i) => ({ id: i.id, kind: i.kind, title: i.title, date: i.date, start: i.start, end: i.end, done: i.kind === 'task' ? i.done : undefined, assignee: i.assignee || undefined }));

  return `Ты разбираешь голосовые команды для личного планировщика руководителя (COO сети суши-баров). Команда приходит после распознавания речи, поэтому в ней могут быть ошибки распознавания, лишние слова и неточная пунктуация; восстанавливай смысл.

В планировщике два типа записей:
- meeting — встреча (обычно с временем начала; если длительность не названа, end = null, приложение поставит 1 час);
- task — обязательная задача (может быть на весь день без времени: start = null, end = null). Если не сказано иное, задачи создаются на сегодня.

Операции:
- create — создать запись (kind, title, date обязательны; target_id = null);
- update — изменить существующую: перенести (date/start/end), переименовать, назначить ответственного (assignee), добавить заметку или ссылки. Заполняй только меняющиеся поля, остальные null. Для переноса встречи на другое время без указания длительности оставь end = null — приложение сохранит прежнюю длительность;
- complete — отметить задачу выполненной; reopen — вернуть в работу;
- delete — удалить.
Для update/complete/reopen/delete укажи target_id из списка ниже. Выбирай запись по смыслу названия и дате; если подходят несколько и выбрать нельзя, верни пустой actions и задай вопрос в clarification.
«Поручи/назначь Ивану» = assignee "Иван" (в именительном падеже). «Каждый день/ежедневно» = repeat daily, «по будням» = weekdays, «каждую неделю/еженедельно/по понедельникам» = weekly (date — ближайший такой день). Иначе repeat = null. Ссылки добавляй в add_links только если в команде есть адрес; иначе пустой массив.
Название (title) формулируй коротко, с заглавной буквы, без даты и времени.
Если команда вообще не про планировщик, верни пустой actions и короткое пояснение в clarification.
Одна команда может содержать несколько действий.

Часовой пояс: ${TZ}. Сейчас ${now.date}, ${weekdayLong(now.date)}, ${now.time}.
Ближайшие дни:
${days}
«Утром» без времени = 09:00, «в обед» = 13:00, «вечером» = 18:00. «Через час» считай от текущего времени.

Текущие записи (JSON):
${JSON.stringify(items)}`;
}

export const isConfigured = () => !!(store.getSettings().anthropicKey || store.getSettings().geminiKey);
export const engine = () => (store.getSettings().anthropicKey ? 'claude' : store.getSettings().geminiKey ? 'gemini' : 'local');

const cleanup = (parsed) => {
  const keys = ['target_id', 'kind', 'title', 'date', 'start', 'end', 'assignee', 'notes', 'repeat'];
  parsed.actions = (parsed.actions || []).map((a) => {
    const o = { ...a, add_links: (a.add_links || []).filter((l) => l && l.url).map((l) => ({ title: l.title || '', url: l.url })) };
    for (const k of keys) if (o[k] === undefined || o[k] === '') o[k] = null;
    return o;
  });
  parsed.clarification = parsed.clarification || null;
  // Отбрасываем действия, которые ссылаются на несуществующие записи.
  parsed.actions = parsed.actions.filter((a) => a.op === 'create' ? a.title && a.date : store.get(a.target_id));
  return parsed;
};

export async function parseCommand(text) {
  const e = engine();
  if (e === 'local') return { ...parseLocal(text), local: true };
  if (e === 'gemini') {
    try { return cleanup(await geminiParse(text)); }
    catch (err) {
      // Если Gemini недоступен, не оставляем без результата: разбираем шаблонами и показываем причину.
      return { ...parseLocal(text), local: true, warning: err.message };
    }
  }
  return cleanup(await claudeParse(text));
}

// ——— Google Gemini (бесплатный ключ из aistudio.google.com) ———
const S = (extra = {}) => ({ type: 'STRING', nullable: true, ...extra });
const GSCHEMA = {
  type: 'OBJECT',
  required: ['actions', 'clarification'],
  properties: {
    clarification: S({ description: 'Вопрос пользователю, если команду нельзя однозначно понять; иначе null.' }),
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['op', 'target_id', 'kind', 'title', 'date', 'start', 'end', 'assignee', 'notes', 'repeat', 'add_links'],
        properties: {
          op: { type: 'STRING', enum: ['create', 'update', 'complete', 'reopen', 'delete'] },
          target_id: S(), kind: S({ enum: ['meeting', 'task'] }), title: S(),
          date: S({ description: 'YYYY-MM-DD' }), start: S({ description: 'HH:MM, 24h' }), end: S({ description: 'HH:MM, 24h' }),
          assignee: S(), notes: S(), repeat: S({ enum: ['daily', 'weekly', 'weekdays'], description: 'Только для create' }),
          add_links: { type: 'ARRAY', items: { type: 'OBJECT', required: ['title', 'url'], properties: { title: { type: 'STRING' }, url: { type: 'STRING' } } } },
        },
      },
    },
  },
};
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash'];

async function geminiParse(text) {
  const key = store.getSettings().geminiKey;
  const body = {
    systemInstruction: { parts: [{ text: buildSystem() }] },
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: GSCHEMA, temperature: 0.1 },
  };
  let lastErr;
  for (const model of GEMINI_MODELS) {
    let status, data;
    if (scriptReady()) {
      try { ({ status, data } = await scriptGemini({ model, key, body })); }
      catch (e) {
        if (e.message !== 'OLD_SCRIPT') throw e;
        // Старая версия скрипта — пробуем напрямую.
        ({ status, data } = await geminiDirect(model, key, body, true));
      }
    } else ({ status, data } = await geminiDirect(model, key, body, false));
    if (status === 404) { lastErr = new Error('Модель Gemini недоступна'); continue; }
    if (status >= 400) throw new Error(geminiError(status, data));
    const cand = data?.candidates?.[0];
    const out = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    if (!out) throw new Error(cand?.finishReason === 'SAFETY' ? 'Gemini отказался обрабатывать команду.' : 'Пустой ответ Gemini.');
    return JSON.parse(out);
  }
  throw lastErr;
}

async function geminiDirect(model, key, body, oldScript) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body),
    });
  } catch { throw new Error('Нет связи с Gemini.' + (oldScript ? ' Обновите скрипт Google (Настройки → «Скопировать скрипт»), тогда запросы пойдут через него.' : '')); }
  const data = await res.json().catch(() => null);
  if (res.status === 400 && /location/i.test(data?.error?.message || '') && oldScript)
    throw new Error('Gemini не работает напрямую из России. Обновите скрипт Google: Настройки → «Скопировать скрипт», вставьте его вместо старого и сделайте новое развертывание.');
  return { status: res.status, data };
}

function geminiError(status, data) {
  const msg = data?.error?.message || '';
  if (/API key not valid|API_KEY_INVALID/i.test(msg)) return 'Ключ Gemini не подходит. Проверьте его в настройках.';
  if (/location/i.test(msg)) return 'Gemini недоступен из вашей страны. Подключите календарь через скрипт Google — тогда запросы пойдут через него.';
  if (status === 429) return 'Бесплатный лимит Gemini на минуту исчерпан, попробуйте чуть позже.';
  return 'Gemini: ' + (msg || 'ошибка ' + status);
}

// ——— Claude ———
async function claudeParse(text) {
  const apiKey = store.getSettings().anthropicKey;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: buildSystem(),
      messages: [{ role: 'user', content: text }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Ключ Anthropic API не подходит. Проверьте его в настройках.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Слишком много запросов к Claude, попробуйте через минуту.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Нет связи с Claude. Проверьте интернет.');
    if (e instanceof Anthropic.APIError) throw new Error('Claude: ' + (e.error?.error?.message || e.message));
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude отказался обрабатывать эту команду.');
  if (response.stop_reason === 'max_tokens') throw new Error('Ответ Claude оборвался, попробуйте короче.');
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Пустой ответ Claude.');
  return JSON.parse(textBlock.text);
}
