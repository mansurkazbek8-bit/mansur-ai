/*
 * Инструменты, которые ИИ-агент может использовать на компьютере пользователя.
 * definitions — описания для нейросети (формат OpenAI function calling): модель выбирает инструмент и параметры,
 * а createExecutor реально выполняет его. Опасные действия требуют подтверждения пользователя.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { shell } = require('electron');
const { markdownToDocx } = require('./docx-writer');
const { inspectSite } = require('./site-inspector');

// Нетекстовые форматы: запись их через write_file даст испорченный файл (для Word есть create_docx).
const BINARY = /\.(docx?|xlsx?|pptx?|pdf|png|jpe?g|gif|webp|bmp|ico|zip|rar|7z|exe|dll|mp3|mp4)$/i;

const MAX_OUTPUT = 8000;
const MAX_IMAGES = 5; // на задачу: бесплатный генератор рисует одну картинку в 45 с
const clip = (s, n = MAX_OUTPUT) => (s.length > n ? s.slice(0, n) + `\n…[обрезано, всего ${s.length} символов]` : s);

// Команды, которые удаляют или меняют систему, выполняются только после согласия пользователя.
const DANGEROUS = /\b(Remove-Item|rm|rmdir|rd|del|erase|Format-\w+|Clear-Disk|Stop-Computer|Restart-Computer|shutdown|diskpart|bcdedit|reg\s+(add|delete)|Set-ExecutionPolicy|Remove-\w+|Uninstall-\w+|takeown|icacls|cipher)\b|\|\s*(iex|Invoke-Expression)\b/i;

const background = new Map(); // "задача:имя" -> фоновый процесс (у параллельных агентов имена не пересекаются)

// Список из 14 инструментов агента.
const definitions = [
  fn('list_dir', 'Показать содержимое папки (файлы и подпапки).', { path: str('Путь к папке, по умолчанию рабочая папка') }, []),
  fn('read_file', 'Прочитать текстовый файл.', { path: str('Путь к файлу') }, ['path']),
  fn('write_file', 'Создать или полностью перезаписать ТЕКСТОВЫЙ файл (код, .html, .css, .js, .py, .txt, .md, .json, .csv). Папки создаются автоматически. Файлы Word, Excel, PDF и картинки так создавать нельзя.', { path: str('Путь к файлу'), content: str('Полное содержимое файла') }, ['path', 'content']),
  fn('append_file', 'Дописать текст в конец файла. Большие файлы (больше ~150 строк) пиши частями: первая часть — write_file, следующие — append_file.', { path: str('Путь к файлу'), content: str('Текст, который нужно добавить в конец') }, ['path', 'content']),
  fn('replace_in_file', 'Заменить фрагмент текста в файле (для исправления ошибок).', { path: str('Путь к файлу'), find: str('Точный текст, который нужно найти'), replace: str('Новый текст') }, ['path', 'find', 'replace']),
  fn('delete_path', 'Удалить файл или папку (требует подтверждения пользователя).', { path: str('Путь') }, ['path']),
  fn('run_powershell', 'Выполнить команду PowerShell и дождаться результата. Не используйте для серверов и долгих процессов — для них есть start_process.', { command: str('Команда PowerShell'), timeout_sec: { type: 'integer', description: 'Таймаут в секундах, по умолчанию 120' } }, ['command']),
  fn('start_process', 'Запустить долгий фоновый процесс (например, веб-сервер). Возвращает первые строки вывода.', { name: str('Короткое имя процесса, например site'), command: str('Команда PowerShell') }, ['name', 'command']),
  fn('stop_process', 'Остановить фоновый процесс, запущенный через start_process.', { name: str('Имя процесса') }, ['name']),
  fn('inspect_site', 'Проверить качество сайта как строгий заказчик: битые ссылки и картинки, заглушки, адаптивность, количество разделов, объём стилей и текста. Вызывай после создания сайта и после исправлений, пока проверка не будет пройдена.', { path: str('HTML-файл сайта, по умолчанию index.html') }, []),
  fn('check_url', 'Открыть URL по HTTP и вернуть код ответа и начало страницы — чтобы проверить, что сайт работает.', { url: str('Адрес, например http://localhost:5500') }, ['url']),
  fn('open_in_browser', 'Открыть адрес или файл у пользователя в браузере/программе по умолчанию.', { target: str('URL или путь к файлу') }, ['target']),
  fn('create_docx', 'Создать настоящий документ Word (.docx) из текста в формате Markdown: # заголовки, абзацы, списки «- пункт», **жирный** текст и таблицы вида | A | B |, где первая строка — шапка. Используй для любых документов и таблиц Word.', { path: str('Путь к файлу .docx, например report.docx'), markdown: str('Содержимое документа в Markdown'), landscape: { type: 'boolean', description: 'Альбомная ориентация (для широких таблиц)' } }, ['path', 'markdown']),
  fn('generate_image', 'Создать изображение нейросетью по описанию и сохранить в файл (.jpg). Работает в фоне: картинка появится через 1–3 минуты, а ты сразу продолжай писать код. Не больше 5 картинок на задачу.', { prompt: str('Описание изображения (лучше на английском)'), path: str('Куда сохранить, например images/hero.jpg'), width: { type: 'integer' }, height: { type: 'integer' } }, ['prompt', 'path']),
];

// Описание инструмента для нейросети в формате OpenAI function calling (имя, описание, параметры).
function fn(name, description, properties, required) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
// Короткая запись строкового параметра инструмента.
function str(description) { return { type: 'string', description }; }

/**
 * @param {object} ctx { workspace, fullAccess, confirm(text) => Promise<bool>, api(method, path, body), downloadTo(url, file) }
 */
// Создать исполнитель инструментов для одной задачи: все пути ограничены рабочей папкой (если не дан полный доступ).
function createExecutor(ctx) {
  const resolve = p => {
    const full = path.resolve(ctx.workspace, p || '.');
    const rel = path.relative(ctx.workspace, full);
    if (!ctx.fullAccess && (rel.startsWith('..') || path.isAbsolute(rel))) {
      throw new Error(`Доступ разрешён только внутри рабочей папки ${ctx.workspace}. Включите «Полный доступ» в настройках, чтобы работать с другими папками.`);
    }
    return full;
  };

  // A mistyped absolute path ("...\\ask-33\\index.html") would throw away a file the model spent
  // minutes writing: when that folder doesn't exist, the file goes into the workspace instead.
  const writable = p => {
    try { return { file: resolve(p), note: '' }; } catch (e) {
      if (!path.isAbsolute(p || '') || fs.existsSync(path.dirname(p))) throw e;
      const name = path.basename(p);
      return { file: path.join(ctx.workspace, name), note: `\n⚠ Путь «${p}» вне рабочей папки — файл сохранён в рабочую папку как ${name}. Дальше используй относительные пути.` };
    }
  };

  const handlers = {
    async list_dir({ path: p }) {
      const dir = resolve(p);
      const items = await fsp.readdir(dir, { withFileTypes: true });
      if (!items.length) return `Папка ${dir} пуста`;
      const lines = await Promise.all(items.slice(0, 300).map(async d => {
        if (d.isDirectory()) return `[папка] ${d.name}`;
        const st = await fsp.stat(path.join(dir, d.name)).catch(() => null);
        return `${d.name} (${st ? st.size : '?'} байт)`;
      }));
      return `${dir}:\n` + lines.join('\n');
    },

    async read_file({ path: p }) {
      const file = resolve(p);
      return clip(await fsp.readFile(file, 'utf8'), 20000);
    },

    async write_file({ path: p, content }) {
      if (BINARY.test(p || '')) {
        return `Ошибка: ${path.extname(p)} — не текстовый формат, write_file создаст испорченный файл. Для Word используй create_docx, для картинок — generate_image.`;
      }
      const { file, note } = writable(p);
      // Weak models sometimes "rewrite" a big file as one comment ("/* full CSS as above */"), wiping the work.
      const before = await fsp.stat(file).then(s => s.size, () => 0);
      const size = Buffer.byteLength(content ?? '');
      if (before > 1500 && size < before * 0.25 && (size < 300 || /as above|placeholder|см\. выше|как выше|full .{0,20}content|\.\.\.\s*\*\//i.test(content))) {
        return `Отказано: ${path.basename(file)} уже содержит ${before} байт, а новая версия — ${size} байт заглушки. Работа была бы потеряна. Чтобы исправить часть файла, используй replace_in_file; чтобы дописать — append_file.`;
      }
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, content ?? '', 'utf8');
      return `Файл сохранён: ${file} (${size} байт)${note}`;
    },

    async append_file({ path: p, content }) {
      if (BINARY.test(p || '')) return `Ошибка: ${path.extname(p)} — не текстовый формат.`;
      const { file, note } = writable(p);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      // Appending to a finished HTML page would land after </html>: put it before </body> instead.
      const current = /\.html?$/i.test(file) ? await fsp.readFile(file, 'utf8').catch(() => '') : '';
      const body = current.lastIndexOf('</body>');
      if (body !== -1 && !/<\/body>/i.test(content ?? '')) {
        await fsp.writeFile(file, current.slice(0, body) + (content ?? '') + '\n' + current.slice(body), 'utf8');
      } else {
        await fsp.appendFile(file, content ?? '', 'utf8');
      }
      const st = await fsp.stat(file);
      return `Дописано в ${file}${body !== -1 ? ' (перед </body>)' : ''}: +${Buffer.byteLength(content ?? '')} байт, всего ${st.size} байт${note}`;
    },

    async create_docx({ path: p, markdown, landscape }) {
      const file = resolve(/\.docx$/i.test(p) ? p : p.replace(/\.[^.\\/]*$/, '') + '.docx');
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const { buffer, tables, paragraphs } = await markdownToDocx(markdown || '', { landscape: !!landscape });
      await fsp.writeFile(file, buffer);
      return `Документ Word сохранён: ${file} (абзацев: ${paragraphs}, таблиц: ${tables}). Его можно открыть через open_in_browser.`;
    },

    async replace_in_file({ path: p, find, replace }) {
      const file = resolve(p);
      const text = await fsp.readFile(file, 'utf8');
      const count = text.split(find).length - 1;
      if (!count) return 'Фрагмент не найден — прочитайте файл через read_file и повторите с точным текстом.';
      await fsp.writeFile(file, text.split(find).join(replace), 'utf8');
      return `Заменено вхождений: ${count} в ${file}`;
    },

    async delete_path({ path: p }) {
      const target = resolve(p);
      if (!(await ctx.confirm(`Агент хочет удалить:\n${target}`))) return 'Пользователь запретил удаление.';
      await fsp.rm(target, { recursive: true, force: true });
      return `Удалено: ${target}`;
    },

    async run_powershell({ command, timeout_sec }) {
      if (DANGEROUS.test(command) && !(await ctx.confirm(`Агент хочет выполнить команду:\n${command}`))) {
        return 'Пользователь запретил выполнение этой команды. Предложи другой способ.';
      }
      return runPs(command, ctx.workspace, Math.min(Math.max(timeout_sec || 120, 5), 900));
    },

    async start_process({ name, command }) {
      if (DANGEROUS.test(command) && !(await ctx.confirm(`Агент хочет запустить:\n${command}`))) {
        return 'Пользователь запретил запуск.';
      }
      const key = `${ctx.scope}:${name}`;
      if (background.has(key)) killTree(background.get(key));
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: ctx.workspace, windowsHide: true });
      background.set(key, child);
      let out = '';
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { out += d; });
      await new Promise(r => setTimeout(r, 5000));
      const alive = child.exitCode === null;
      return `${alive ? `Процесс «${name}» запущен в фоне (PID ${child.pid}).` : `Процесс завершился с кодом ${child.exitCode}.`}\nВывод:\n${clip(out || '(пока пусто)', 3000)}`;
    },

    async stop_process({ name }) {
      const child = background.get(`${ctx.scope}:${name}`);
      if (!child) return `Процесс «${name}» не найден`;
      killTree(child);
      background.delete(`${ctx.scope}:${name}`);
      return `Процесс «${name}» остановлен`;
    },

    async inspect_site({ path: p }) {
      const file = resolve(p || 'index.html');
      const pending = new Set([...images.jobs.values()].filter(j => !j.done).map(j => j.file));
      return inspectSite(path.dirname(file), path.basename(file), { pending });
    },

    async check_url({ url }) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const text = await res.text();
        return `HTTP ${res.status}\n${clip(text, 2500)}`;
      } catch (e) {
        return `Не удалось открыть ${url}: ${e.cause?.code || e.message}`;
      }
    },

    async open_in_browser({ target }) {
      const isUrl = /^https?:\/\//i.test(target);
      const what = isUrl ? target : resolve(target);
      if (!shell) {
        spawn('cmd.exe', ['/c', 'start', '""', what], { windowsHide: true, detached: true }).unref();
      } else if (isUrl) {
        await shell.openExternal(what);
      } else {
        const err = await shell.openPath(what);
        if (err) return 'Ошибка: ' + err;
      }
      return `Открыто: ${target}`;
    },

    // Pictures are drawn in the background (the free generator allows one every 45 s),
    // so the agent writes the code meanwhile instead of waiting minutes for each image.
    async generate_image({ prompt, path: p, width, height }) {
      const file = resolve(/\.(jpe?g|png)$/i.test(p || '') ? p : (p || 'images/image') + '.jpg');
      if (images.jobs.has(file)) return `Картинка ${path.relative(ctx.workspace, file)} уже в очереди.`;
      if (images.jobs.size >= MAX_IMAGES) return `Ошибка: не больше ${MAX_IMAGES} картинок на задачу. Используй уже созданные или оформи блок градиентом.`;
      const draw = async () => {
        const res = await ctx.api('POST', '/agent/image', { prompt, width: width || 1024, height: height || 1024 });
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await ctx.downloadTo(res.url, file);
      };
      const job = { file, done: false, error: null };
      images.jobs.set(file, job);
      images.queue = images.queue.then(async () => {
        try { await draw(); } catch (e) {
          // One more try after a pause: the free generator often answers 503 for a moment.
          await new Promise(r => setTimeout(r, 15000));
          try { await draw(); } catch (e2) { job.error = e2.message || e.message; }
        }
        job.done = true;
      });
      return `⏳ Картинка поставлена в очередь и появится в ${path.relative(ctx.workspace, file)} через 1–3 минуты. Не жди её — сразу пиши код и ссылайся на этот путь.`;
    },
  };

  const images = { queue: Promise.resolve(), jobs: new Map() };

  // Выполнить одну задачу: start → цикл агента (agent.js) → complete/fail; журнал отправляется на сервер.
  async function execute(name, args) {
    const handler = handlers[name];
    if (!handler) return `Неизвестный инструмент ${name}`;
    try {
      return await handler(args || {});
    } catch (e) {
      return `Ошибка: ${e.message}`;
    }
  }

  /** Wait for queued pictures (up to timeoutMs) and report the ones that failed. */
  execute.waitImages = async timeoutMs => {
    const pending = [...images.jobs.values()].filter(j => !j.done).length;
    if (pending) await Promise.race([images.queue, new Promise(r => setTimeout(r, timeoutMs))]);
    const rel = j => path.relative(ctx.workspace, j.file);
    return {
      pending,
      failed: [...images.jobs.values()].filter(j => j.error).map(j => `${rel(j)} (${j.error})`),
      unfinished: [...images.jobs.values()].filter(j => !j.done).map(rel),
    };
  };
  return execute;
}

// Выполнить команду PowerShell с таймаутом и вернуть вывод.
function runPs(command, cwd, timeoutSec) {
  return new Promise(resolve => {
    // UTF-8 output so Russian text is readable for the model.
    const wrapped = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ${command}`;
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', wrapped], { cwd, windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { killTree(child); err += `\n[прервано по таймауту ${timeoutSec} с]`; }, timeoutSec * 1000);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { err += e.message; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve(clip(`Код выхода: ${code}\n${out ? 'Вывод:\n' + out : ''}${err ? '\nОшибки:\n' + err : ''}`.trim()));
    });
  });
}

// Остановить процесс вместе со всеми дочерними (taskkill /T).
function killTree(child) {
  try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* already gone */ }
}

// Остановить все фоновые процессы задачи (серверы сайтов) — при отмене или выходе.
function stopAll(scope = null) {
  for (const [key, child] of background) {
    if (scope !== null && !key.startsWith(scope + ':')) continue;
    killTree(child);
    background.delete(key);
  }
}

module.exports = { definitions, createExecutor, stopAll, ensureDir: dir => fs.mkdirSync(dir, { recursive: true }) };
