// Текст скрипта Google Apps Script, который пользователь вставляет на script.google.com.
export function scriptSource(secret) {
  return `// Планировщик: доступ к вашему Google Календарю (версия 2: с поддержкой Gemini).
// Вставьте этот код целиком в новый проект на script.google.com.
const SECRET = '${secret}';

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.secret !== SECRET) return out({ status: 403, data: { error: { message: 'Неверный ключ доступа' } } });
    if (req.ai) return gemini(req.ai);
    const path = req.path || '';
    if (!/^(\\/[A-Za-z0-9_@.%-]+)?$/.test(path)) return out({ status: 400, data: { error: { message: 'Недопустимый запрос' } } });
    let url = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(req.calendarId || 'primary') + '/events' + path;
    const q = req.query || {};
    const qs = Object.keys(q).filter(function (k) { return q[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    if (qs) url += '?' + qs;
    const opts = {
      method: String(req.method || 'GET').toLowerCase(),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    };
    if (req.body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(req.body); }
    const res = UrlFetchApp.fetch(url, opts);
    const text = res.getContentText();
    return out({ status: res.getResponseCode(), data: text ? JSON.parse(text) : null });
  } catch (err) {
    return out({ status: 500, data: { error: { message: String(err) } } });
  }
}

// Голосовые команды: запрос к Gemini идёт с серверов Google, поэтому работает из любой страны.
function gemini(ai) {
  if (!/^[a-z0-9.-]+$/.test(ai.model || '')) return out({ status: 400, data: { error: { message: 'Недопустимая модель' } } });
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + ai.model + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': ai.key },
    payload: JSON.stringify(ai.body), muteHttpExceptions: true,
  });
  const text = res.getContentText();
  return out({ status: res.getResponseCode(), data: text ? JSON.parse(text) : null, gemini: true });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Эта функция нужна, чтобы Google запросил доступ к календарю. Запустите её один раз кнопкой «Выполнить».
function authorize() {
  CalendarApp.getDefaultCalendar();
  UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
  });
}
`;
}
