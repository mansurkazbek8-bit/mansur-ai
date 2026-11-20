/*
 * Цикл ИИ-агента: модель планирует, вызывает инструменты на этом компьютере (файлы, PowerShell, браузер),
 * видит результаты и исправляет ошибки, пока задача не будет выполнена.
 * Сама модель работает на СЕРВЕРЕ (POST /api/agent/step) — ключи нейросетей на ПК не хранятся.
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { definitions, createExecutor } = require('./tools');
const { inspectSite } = require('./site-inspector');

const MAX_STEPS = 70;          // защита от бесконечного цикла: не больше 70 шагов на задачу
const CONTEXT_CHARS = 60000;   // примерный предел размера разговора, после которого старые выводы сокращаются

// Стандарт качества сайтов: что сдал бы профессиональный дизайнер-разработчик (вставляется в инструкцию модели).
const WEBSITE_STANDARD = `СТАНДАРТ КАЧЕСТВА САЙТА (обязателен, если задача — сайт или страница):
Структура — файлы index.html, css/style.css, js/main.js, images/. Разделы <section> с id:
  1) шапка <header> с логотипом и <nav> (якорные ссылки), на телефоне — кнопка-бургер;
  2) главный экран (hero) на всю высоту: крупный заголовок, подзаголовок, 1–2 кнопки, фоновая картинка с затемнением;
  3) 4–6 смысловых разделов по теме. Пример для кофейни: «О нас», «Меню» (категории: кофе, чай, десерты; у каждой позиции название, короткое описание и цена в ₸), «Почему мы» (карточки с иконками-эмодзи), «Галерея», «Отзывы» (3 отзыва с именами), «Контакты» (адрес, телефон, часы работы, форма бронирования);
  4) подвал <footer> с контактами и соцсетями.
Дизайн:
  - палитра в :root { --bg, --text, --accent, --accent-2, --muted, --card } под тему (для кофейни — кофейные, кремовые, тёплые тона);
  - 2 шрифта Google Fonts (выразительный для заголовков, читаемый для текста), заголовки 48–72px на главном экране;
  - ВСЁ содержимое (и главный экран тоже) — внутри .container { max-width: 1200px; margin: 0 auto; padding: 0 24px }: текст никогда не прилипает к краю окна; между разделами отступы 90–120px, сетки CSS Grid/Flex, карточки со скруглением 16–24px и мягкими тенями;
  - кнопки с градиентом или акцентным цветом, hover-эффекты (подъём, тень), transition 0.3s;
  - плавная прокрутка, появление блоков при прокрутке (IntersectionObserver в main.js), активный пункт меню;
  - адаптив: @media (max-width: 900px) и (max-width: 600px), на телефоне всё в одну колонку.
Контент — настоящий, живой текст на русском. НИКОГДА: «Lorem ipsum», «Название 1», «Текст здесь», placeholder-картинки, ссылки на example.com.
Картинки — 4–5 штук через generate_image, ВСЕ ОДНИМ ШАГОМ в самом начале: images/hero.jpg (1600×900) и тематические 800×600 (например, напитки, интерьер, десерты). Они рисуются в фоне — не жди их, сразу пиши HTML/CSS/JS со ссылками на эти пути. Промпты — подробные, на английском, в одном стиле (например: "professional food photography, warm natural light, shallow depth of field"). Никогда не используй внешние API нейросетей, ключи, node-fetch и сервисы-заглушки.
Объём — style.css обычно 300–500 строк, на странице 1500+ символов текста.
Проверка — inspect_site (исправляй, пока не пройдёт), затем запусти сервер, check_url и open_in_browser.`;

const GENERAL_STANDARD = `СТАНДАРТ КАЧЕСТВА (для любой задачи):
- Делай результат, который не стыдно показать заказчику: полный, продуманный и красивый, а не минимальный пример.
- Программы и игры — с понятным интерфейсом, обработкой ошибок, комментариями; игры — со счётом, рестартом и инструкцией; перед сдачей запусти и проверь.
- Документы Word — через create_docx, со структурой: заголовки, разделы, таблицы, выводы.
- Пиши полный рабочий код без заглушек и «здесь будет код». Не создавай пробных и служебных файлов (test.css, .keep, «console.log('test')»).
- Чтобы изменить часть готового файла — replace_in_file; никогда не перезаписывай большой файл короткой заглушкой.
- Большие файлы пиши ЧАСТЯМИ по 100–150 строк: первая часть — write_file, остальные — append_file. Один огромный вызов на 500 строк не успеет сгенерироваться.`;

// Системная инструкция агента: рабочая папка, правила безопасности, стандарты качества сайта и кода.
function systemPrompt(workspace, agent) {
  const port = 5500 + (agent.slot - 1) * 10;
  return `Ты — ${agent.name}, агент №${agent.slot} команды Mansur AI: автономный ИИ-агент уровня senior-разработчика и дизайнера на компьютере пользователя с Windows ${os.release()}.
Другие агенты команды могут работать одновременно с тобой, поэтому для локальных серверов используй только порты ${port}–${port + 9}.
Ты выполняешь задачу сам, шаг за шагом, с помощью инструментов. Рабочая папка: ${workspace}

Порядок работы:
1. Кратко составь план (что за проект, какие файлы, какие разделы/функции, какой стиль).
2. Сразу поставь в очередь все нужные картинки (generate_image рисует в фоне), затем без ожидания пиши файлы через write_file — относительные пути внутри рабочей папки.
3. Проверь результат (inspect_site для сайтов, запуск для программ), исправь найденное (replace_in_file / write_file) и проверь снова.
4. Запусти и открой результат пользователю.

Инструменты:
- Команды — run_powershell. Серверы и долгие процессы — только start_process (например: python -m http.server ${port} или npx --yes serve -l ${port}).
- Картинки — только generate_image. Документы Word (.docx) — только create_docx, никогда через write_file.
- Не удаляй и не меняй файлы вне рабочей папки без явной просьбы.

${GENERAL_STANDARD}

${WEBSITE_STANDARD}

Когда задача полностью выполнена, ответь без вызова инструментов подробным итогом по-русски: что сделано (по пунктам), где лежат файлы (полные пути), как открыть или запустить. Ответ «Готово» без подробностей не подходит.`;
}

// Before handing in, the agent reviews its own work once, like a strict client.
const REVIEW = `Прежде чем сдавать, проверь работу как строгий заказчик:
1. Если это сайт — вызови inspect_site и исправь ВСЕ найденные проблемы; убедись, что выполнен стандарт качества сайта (разделы, дизайн, адаптив, 4–6 картинок, живой текст).
2. Прочитай главные файлы (read_file) и найди слабые места: пустые или скучные блоки, несогласованные классы, ошибки в коде, недоделанные функции. Улучши их.
3. Убедись, что результат запущен и открыт пользователю.
Если всё действительно отлично — напиши подробный итог без вызова инструментов. Если нет — сначала исправь.`;

const isWebsiteTask = text => /сайт|лендинг|страниц|веб|web|site|html|портфолио|магазин/i.test(text);
const QUALITY_ROUNDS = 5;

/** Let background pictures finish (up to 4 minutes) before the work is checked. */
// Дождаться фоновой генерации картинок (до 4 минут) перед проверкой результата.
async function waitForImages(execute, log) {
  if (!execute.waitImages) return { failed: [], unfinished: [] };
  const first = await execute.waitImages(0);
  if (first.pending) log('info', `⏳ Жду картинки, которые рисуются в фоне (${first.pending})…`);
  const res = first.pending ? await execute.waitImages(240000) : first;
  if (res.failed.length) log('error', `Не удалось создать картинки: ${res.failed.join('; ')}`);
  return res;
}

/** Main HTML page of the project, if there is one. */
// Найти главный HTML-файл проекта, если он есть.
function findSite(workspace) {
  for (const f of ['index.html', 'site/index.html', 'public/index.html']) {
    if (fs.existsSync(path.join(workspace, f))) return f;
  }
  try { return fs.readdirSync(workspace).find(f => /\.html?$/i.test(f)) || null; } catch { return null; }
}

/** Short report written by the app when the model's own summary is too thin. */
// Короткий отчёт, если модель сама написала слишком скупой итог.
function autoSummary(workspace, task) {
  const files = [];
  const walk = (dir, rel = '') => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.name === 'node_modules' || d.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      d.isDirectory() ? walk(path.join(dir, d.name), r) : files.push(r);
    }
  };
  try { walk(workspace); } catch { /* empty folder */ }
  const site = findSite(workspace);
  return `**Задача выполнена:** ${task.title || task.prompt.slice(0, 80)}\n\n**Папка проекта:** \`${workspace}\`\n\n**Файлы (${files.length}):**\n${files.slice(0, 40).map(f => `- ${f}`).join('\n')}`
    + (site ? `\n\n**Как открыть:** двойной щелчок по \`${path.join(workspace, site)}\` или кнопка «Открыть папку проекта».` : '');
}

/** Shorten old tool outputs so the conversation fits the model context. */
// Сократить старые выводы инструментов, чтобы разговор поместился в контекст модели.
function compact(messages) {
  let size = JSON.stringify(messages).length;
  for (let i = 2; i < messages.length - 6 && size > CONTEXT_CHARS; i++) {
    const m = messages[i];
    if (m.role === 'tool' && m.content.length > 400) {
      size -= m.content.length - 400;
      m.content = m.content.slice(0, 400) + '\n…[сокращено]';
    }
    // Whole files written long ago: keep the call, drop the body (it is on disk, read_file shows it).
    for (const call of m.tool_calls || []) {
      const raw = call.function?.arguments || '';
      if (raw.length < 1500) continue;
      try {
        const args = JSON.parse(raw);
        for (const k of ['content', 'markdown']) if (typeof args[k] === 'string' && args[k].length > 300) args[k] = args[k].slice(0, 300) + '…[файл записан на диск, см. read_file]';
        const next = JSON.stringify(args);
        size -= raw.length - next.length;
        call.function.arguments = next;
      } catch { /* not JSON — leave it */ }
    }
  }
  return messages;
}

const short = (s, n = 300) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ask the model for the next step; a busy free provider (502) is waited out a few times. */
// Спросить у сервера следующий шаг (POST /api/agent/step); если нейросеть занята (502) — подождать и повторить.
async function stepWithRetry(deps, messages, log, tools = definitions) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deps.api('POST', '/agent/step', { messages: compact(messages), tools });
    } catch (e) {
      const offline = !e.status && /fetch failed|ECONNREFUSED|ECONNRESET|network/i.test(e.message + (e.cause?.code || ''));
      if (!offline && e.status !== 502 && !/перегружена|не ответила/i.test(e.message)) throw e;
      if (attempt >= (offline ? 7 : 4) || deps.isStopped()) throw e;
      log('info', offline
        ? `⏳ Нет связи с сервером Mansur AI, жду 20 секунд (попытка ${attempt} из 6)…`
        : `⏳ Нейросеть занята, жду 20 секунд (попытка ${attempt} из 3)…`);
      await sleep(20000);
    }
  }
}

/**
 * Run one agent task.
 * @param {object} task server task {id, prompt, workspace}
 * @param {object} deps { api, downloadTo, confirm, onEvent, settings, isStopped, agent: {slot, name} }
 */
// ГЛАВНЫЙ ЦИКЛ АГЕНТА: модель планирует → вызывает инструмент на ПК → видит результат → исправляет ошибки, пока задача не готова (не больше 70 шагов).
async function runTask(task, deps) {
  const workspace = task.workspace || path.join(deps.settings.projectsDir, `task-${task.id}`);
  fs.mkdirSync(workspace, { recursive: true });

  const pending = [];
  let flushing = Promise.resolve();
  const log = (type, text) => {
    deps.onEvent({ type, text, at: new Date().toISOString(), taskId: task.id });
    pending.push({ type, text: short(text, 19000) });
    flushing = flushing.then(async () => {
      if (!pending.length) return;
      const entries = pending.splice(0, pending.length);
      await deps.api('POST', `/agent/tasks/${task.id}/logs`, { entries }).catch(() => {});
    });
  };

  const execute = createExecutor({
    workspace,
    fullAccess: deps.settings.fullAccess,
    confirm: text => (deps.settings.autonomy === 'full' && !/удалить/i.test(text) ? Promise.resolve(true) : deps.confirm(text)),
    api: deps.api,
    downloadTo: deps.downloadTo,
    scope: task.id,
  });

  const messages = [
    { role: 'system', content: systemPrompt(workspace, deps.agent) },
    { role: 'user', content: task.prompt + (isWebsiteTask(task.prompt) ? '\n\n(Это сайт: строго следуй стандарту качества сайта.)' : '') },
  ];

  log('info', `▶ ${deps.agent.name} берёт задачу. Рабочая папка: ${workspace}`);

  let askedSummary = false;
  let reviewed = false;
  let wroteFiles = false;
  let qualityRounds = 0;
  let launched = false;
  const websiteTask = isWebsiteTask(task.prompt);
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (deps.isStopped()) { log('info', '■ Остановлено пользователем'); return { status: 'cancelled' }; }
      const status = await deps.api('GET', `/agent/tasks/${task.id}/status`).catch(() => null);
      if (status?.status === 'cancelled') { log('info', '■ Задача отменена на сайте'); return { status: 'cancelled' }; }

      const res = await stepWithRetry(deps, messages, log);
      const msg = res.message || {};
      // The model ran out of output length while writing a big file: the tool call was lost.
      if (res.finish_reason === 'length' && !(msg.tool_calls || []).length) {
        log('info', '✂ Ответ нейросети оборвался — пишу файл частями.');
        messages.push({ role: 'assistant', content: String(msg.content || '').slice(0, 500) });
        messages.push({ role: 'user', content: 'Твой ответ оборвался: файл слишком большой для одного ответа. Пиши его ЧАСТЯМИ по 100–150 строк: первая часть — write_file, следующие — append_file. Продолжай.' });
        continue;
      }
      // Open models sometimes leak format tokens into the name: "write_file<|channel|>commentary", "functions.write_file".
      const toolCalls = (msg.tool_calls || []).map(c => ({
        ...c,
        function: { ...c.function, name: String(c.function?.name || '').split('<|')[0].replace(/^functions\./, '').trim() },
      }));
      messages.push({ role: 'assistant', content: msg.content ?? '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });

      if (msg.content && toolCalls.length) log('thought', msg.content);

      if (!toolCalls.length) {
        // Pictures queued in the background must be ready before anything is checked or handed in.
        const images = await waitForImages(execute, log);
        // Quality gate: a website is not handed in while the inspector still finds problems.
        if (websiteTask && qualityRounds < QUALITY_ROUNDS && step < MAX_STEPS - 4) {
          const site = findSite(workspace);
          const report = site ? inspectSite(workspace, site) : 'Ошибка: в рабочей папке нет HTML-страницы сайта.';
          if (!report.startsWith('Проверка пройдена')) {
            qualityRounds++;
            log('info', `🔍 Контроль качества (круг ${qualityRounds}): есть что исправить.`);
            const failedNote = images.failed.length
              ? `\n\nЭти картинки генератор не смог создать: ${images.failed.join('; ')}. Не создавай их заново — убери ссылки на них или замени блок красивым CSS-градиентом.`
              : '';
            messages.push({ role: 'user', content: `Сдавать рано — автоматическая проверка сайта:\n${report}${failedNote}\n\nИсправь всё по списку (большие файлы — частями через write_file и append_file), затем снова вызови inspect_site.` });
            continue;
          }
          if (!launched) {
            qualityRounds++;
            messages.push({ role: 'user', content: 'Проверка пройдена. Теперь запусти сайт через start_process, проверь check_url и открой через open_in_browser, затем напиши подробный итог.' });
            continue;
          }
        }
        // One self-review round before the result is handed in (websites already passed the inspector).
        if (!websiteTask && !reviewed && wroteFiles && step < MAX_STEPS - 12) {
          reviewed = true;
          log('info', '🔍 Проверяю работу перед сдачей…');
          messages.push({ role: 'user', content: REVIEW });
          continue;
        }
        // Weak free models sometimes finish with just "Готово." — ask once for a real summary.
        if (!askedSummary && step > 1 && (msg.content || '').trim().length < 60) {
          askedSummary = true;
          messages.push({ role: 'user', content: 'Напиши подробный итог по-русски: что сделано по пунктам, полные пути к файлам и как их открыть. Инструменты больше не вызывай.' });
          continue;
        }
        const own = String(msg.content || '').trim();
        const result = own.length >= 60 ? own : autoSummary(workspace, task);
        log('result', result);
        await flushing;
        await deps.api('POST', `/agent/tasks/${task.id}/complete`, { result });
        return { status: 'completed', result, workspace };
      }

      for (const call of toolCalls) {
        let args = {};
        let broken = false;
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { broken = true; }
        // Long file bodies sometimes arrive as broken JSON: say so plainly instead of running with no arguments.
        if (broken || (['write_file', 'append_file'].includes(call.function.name) && !args.path)) {
          const hint = `Ошибка: аргументы вызова ${call.function.name} повреждены (обрыв длинного ответа). Повтори, но пиши файл частями по 100–150 строк: write_file, затем append_file.`;
          log('error', hint);
          messages.push({ role: 'tool', tool_call_id: call.id, content: hint });
          continue;
        }
        const preview = Object.entries(args).map(([k, v]) => `${k}=${short(String(v), k === 'content' ? 60 : 160)}`).join(', ');
        log('tool', `⚙ ${call.function.name}(${preview})`);
        if (deps.isStopped()) break;
        const output = await execute(call.function.name, args);
        if (['write_file', 'append_file', 'replace_in_file', 'create_docx', 'generate_image'].includes(call.function.name)) wroteFiles = true;
        if (call.function.name === 'start_process' || (call.function.name === 'open_in_browser' && /\.html?$/i.test(String(args.target || '')))) launched = true;
        log(output.startsWith('Ошибка') ? 'error' : 'info', short(output, 600));
        messages.push({ role: 'tool', tool_call_id: call.id, content: String(output) });
      }
    }
    throw new Error(`Достигнут предел ${MAX_STEPS} шагов. Уточните задачу или разбейте её на части.`);
  } catch (e) {
    log('error', '✖ ' + e.message);
    await flushing;
    await deps.api('POST', `/agent/tasks/${task.id}/fail`, { result: e.message }).catch(() => {});
    return { status: 'failed', result: e.message, workspace };
  }
}

/**
 * Lead agent of a "together" task: split it into parts that the team does at the same time.
 * @returns {Promise<Array<{title: string, prompt: string}>|null>} null when the task is too small to split
 */
// Главный агент режима «Вместе» делит задачу на части для команды (или null, если делить нечего).
async function planTeamTask(task, deps, count) {
  const messages = [
    { role: 'system', content: `Ты — ${deps.agent.name}, руководитель команды из ${count} ИИ-агентов на компьютере с Windows. Раздели задачу пользователя на части, которые агенты выполнят одновременно в одной папке проекта.
У агентов есть инструменты: write_file, read_file, run_powershell, generate_image (создаёт картинку нейросетью и сохраняет файл), create_docx. Внешние API, ключи и интернет-сервисы не нужны и запрещены.
Правила деления:
- Дели только на НЕЗАВИСИМЫЕ части, которые не ломают друг друга. Хорошо: разные страницы сайта; картинки отдельно от кода; разные модули программы; разные главы документа.
- Плохо: HTML отдельно от CSS одной страницы — классы не совпадут. Одну страницу целиком (HTML+CSS+JS) делает один агент.
- Пример для одностраничного сайта: часть 1 — «Картинки»: generate_image для images/hero.jpg (1600×900) и 4–5 тематических images/*.jpg (800×600) с точными именами файлов и подробными английскими промптами в одном стиле; часть 2 — «Сайт»: index.html, css/style.css, js/main.js по стандарту качества, с подключением этих картинок по тем же именам.
- Частей от 2 до ${count}, больше не нужно, если задачу честно не разделить.
- Каждая часть работает только со СВОИМИ файлами; в задании перечисли файлы части и всё, что связывает её с другими (имена файлов, разделов, классов, функций).
- Каждая часть должна быть сделана на профессиональном уровне: красиво, полно, с живым содержимым, без заглушек.
- Серверы в частях не запускать: общий запуск и проверку руководитель сделает в конце.
Ответь ТОЛЬКО JSON без пояснений и без markdown: {"parts":[{"title":"коротко, 2–5 слов","prompt":"подробное задание части"}]}` },
    { role: 'user', content: task.prompt },
  ];
  const res = await stepWithRetry(deps, messages, deps.log, []);
  const text = String(res.message?.content || '');
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const parts = (json.parts || [])
      .filter(p => p && String(p.title || '').trim() && String(p.prompt || '').trim().length > 5)
      .slice(0, count)
      .map(p => ({ title: String(p.title).trim().slice(0, 140), prompt: String(p.prompt).trim().slice(0, 6000) }));
    return parts.length >= 2 ? parts : null;
  } catch {
    return null;
  }
}

module.exports = { runTask, planTeamTask };
