// Разбор голосовой/текстовой команды в набор действий с помощью Claude.
import Anthropic from '@anthropic-ai/sdk';
import * as store from './store.js';
import { partsOf, addDays, weekdayLong, TZ } from './time.js';
import { parseLocal } from './localparse.js';

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
        required: ['op', 'target_id', 'kind', 'title', 'date', 'start', 'end', 'assignee', 'notes', 'add_links'],
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
«Поручи/назначь Ивану» = assignee "Иван" (в именительном падеже). Ссылки добавляй в add_links только если в команде есть адрес; иначе пустой массив.
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

export const isConfigured = () => !!store.getSettings().anthropicKey;

export async function parseCommand(text) {
  const apiKey = store.getSettings().anthropicKey;
  // Без ключа — встроенный разбор по шаблонам.
  if (!apiKey) return { ...parseLocal(text), local: true };
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
  const parsed = JSON.parse(textBlock.text);
  // Отбрасываем действия, которые ссылаются на несуществующие записи.
  parsed.actions = (parsed.actions || []).filter((a) => a.op === 'create' ? a.title && a.date : store.get(a.target_id));
  return parsed;
}
