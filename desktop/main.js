/*
 * Mansur AI для Windows — ГЛАВНЫЙ процесс Electron (Node.js).
 * Electron = Chromium (окно) + Node.js (доступ к файлам и командам ПК). Главный процесс управляет окном,
 * хранит настройки и токен, обращается к серверу и запускает агентов; окно (renderer) общается с ним
 * только через безопасный мост preload.js (IPC), само к файлам и токену доступа не имеет.
 */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, screen } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { runTask, planTeamTask } = require('./agent');
const { stopAll } = require('./tools');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  // Для настоящего сервера build-app.bat записывает адрес сайта в package.json ("mansurServer").
  server: require('./package.json').mansurServer || 'http://localhost:8000',
  token: null,
  user: null,
  autonomy: 'ask', // ask — спрашивать перед опасными командами; full — спрашивать только перед удалением
  fullAccess: false,
  acceptSiteTasks: true,
  projectsDir: path.join(app.getPath('documents'), 'Mansur AI Projects'),
  zoom: 1, // масштаб интерфейса
  bounds: null, // последнее положение и размер окна
};

let settings = { ...DEFAULTS, ...readJson(SETTINGS_FILE) };
let win = null;
const running = new Map(); // номер агента -> { задача, агент, остановлена ли }
const localTasks = new Set(); // задачи, созданные в самом приложении (выполняются, даже если задачи с сайта выключены)
const leads = new Map(); // id задачи -> командная задача, главный агент которой ждёт команду
let team = { owned: 1, max: 5, agents: [] }; // из GET /api/agents
let pollTimer = null;

// Прочитать JSON-файл настроек (если файла нет — пустой объект).
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }
// Сохранить настройки в %AppData%/Mansur AI/settings.json.
function saveSettings() { fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); }
const send = (channel, data) => win?.webContents.send(channel, data);

// ---------------------------------------------------------------- server API — обращение к серверу Mansur AI
// Запрос к API сервера (в окне — через главный процесс; в главном процессе — сам HTTP-запрос с токеном).
async function api(method, url, body) {
  const res = await fetch(settings.server.replace(/\/+$/, '') + '/api' + url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(settings.token ? { Authorization: 'Bearer ' + settings.token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(url === '/agent/step' ? 600000 : 240000), // a step may write a whole file
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) { settings.token = null; settings.user = null; saveSettings(); send('auth:expired'); }
    const err = new Error(data?.message || `Ошибка сервера ${res.status}`);
    err.status = res.status;
    err.errors = data?.errors;
    throw err;
  }
  return data;
}

// Скачать файл с сервера на диск (картинки, которые сгенерировал сервер для сайта агента).
async function downloadTo(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Не удалось скачать файл: HTTP ' + res.status);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// ---------------------------------------------------------------- confirmations — подтверждение опасных действий пользователем
let confirmSeq = 0;
const confirmWaiters = new Map();
// Спросить пользователя в окне «Разрешить?» — агент ждёт ответа (для опасных команд).
function confirm(text) {
  return new Promise(resolve => {
    const id = ++confirmSeq;
    confirmWaiters.set(id, resolve);
    send('agent:confirm', { id, text });
    win?.flashFrame(true);
  });
}
ipcMain.handle('agent:confirm-answer', (_e, { id, ok }) => {
  confirmWaiters.get(id)?.(ok);
  confirmWaiters.delete(id);
  win?.flashFrame(false);
});

// ---------------------------------------------------------------- agent team — команда агентов
// Every owned agent runs its own task, so several tasks are done at the same time.
// Обновить данные команды агентов с сервера (GET /api/agents).
async function refreshTeam() {
  if (!settings.token) return team;
  await recoverStaleTasks();
  try { team = await api('GET', '/agents'); } catch { /* offline — keep the last known team */ }
  sendTeamState();
  return team;
}
// Имя и цвет агента по номеру слота.
function agentInfo(slot) { return team.agents.find(a => a.slot === slot) || { slot, name: `Агент №${slot}`, color: '#7c5cff' }; }
// Номер свободного агента или null, если все заняты.
function freeSlot() {
  for (let slot = 1; slot <= team.owned; slot++) if (!running.has(slot)) return slot;
  return null;
}
// Сообщить окну, какие агенты чем заняты (для плашки агентов).
function sendTeamState() {
  send('agent:state', {
    team,
    running: [...running].map(([slot, job]) => ({ slot, task: job.task, agent: job.agent, lead: job.task.mode === 'team' })),
    leads: [...leads.values()].map(job => ({ task: job.task, agent: job.agent, parts: job.parts || [] })),
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A crash or a closed app can leave tasks "running" on the server and keep agents busy: fail them on start.
let recovered = false;
// После перезапуска приложения: задачи, оставшиеся «в работе», помечаются ошибкой на сервере.
async function recoverStaleTasks() {
  if (recovered || !settings.token) return;
  recovered = true;
  try {
    const res = await api('GET', '/agent-tasks?status=running');
    for (const t of res.data) {
      await api('POST', `/agent/tasks/${t.id}/fail`, { result: 'Приложение было закрыто во время выполнения. Запустите задачу заново.' }).catch(() => {});
    }
  } catch { recovered = false; }
}
const event = (type, text, extra = {}) => send('agent:event', { type, text, at: new Date().toISOString(), ...extra });

// ---------------------------------------------------------------- agent runner — запуск задач агента
// Выполнить одну задачу: start → цикл агента (agent.js) → complete/fail; журнал отправляется на сервер.
async function execute(task, wanted = null) {
  const slot = wanted ?? freeSlot();
  if (!slot) {
    event('info', `⏳ Все агенты заняты — задача «${task.title}» подождёт в очереди`, { taskId: task.id });
    return { status: 'queued' };
  }
  const job = { task, slot, agent: agentInfo(slot), stopped: false };
  running.set(slot, job);
  sendTeamState();
  try {
    await api('POST', `/agent/tasks/${task.id}/start`, { slot });
  } catch (e) {
    // The server decides how many agents may work: if this one is busy or not bought, the task stays queued.
    running.delete(slot);
    event(e.status === 409 || e.status === 403 ? 'info' : 'error', (e.status === 409 ? '⏳ ' : '✖ ') + e.message, { taskId: task.id, slot });
    refreshTeam();
    return { status: 'queued' };
  }
  try {
    const result = task.mode === 'team' ? await runTeamTask(task, job) : await runTask(task, deps(job));
    // A stopped task must not stay "running" on the server, or its agent would look busy forever.
    if (result.status === 'cancelled') await api('POST', `/agent-tasks/${task.id}/cancel`).catch(() => {});
    send('agent:done', { task, slot: job.slot, agent: job.agent, ...result });
    return result;
  } catch (e) {
    event('error', '✖ ' + e.message, { taskId: task.id, slot: job.slot });
    await api('POST', `/agent/tasks/${task.id}/fail`, { result: e.message }).catch(() => {});
    send('agent:done', { task, slot: job.slot, agent: job.agent, status: 'failed', result: e.message });
    return { status: 'failed', result: e.message };
  } finally {
    if (running.get(job.slot) === job) running.delete(job.slot);
    leads.delete(task.id);
    sendTeamState();
    setTimeout(pollTasks, 300); // a free agent takes the next queued task
  }
}

// Набор функций, которые агент получает от главного процесса: API, скачивание, подтверждение, события.
function deps(job) {
  return {
    api, downloadTo, confirm, settings,
    agent: job.agent,
    isStopped: () => job.stopped,
    onEvent: e => send('agent:event', { ...e, slot: job.slot }),
  };
}

/**
 * "Together" mode: the lead splits the task, hands its agent to the team while the parts are done
 * in parallel in one folder, then takes an agent back to check and join everything.
 */
// Режим «Вместе»: главный агент делит задачу на части, агенты делают их параллельно в одной папке, затем главный проверяет и собирает результат.
async function runTeamTask(task, job) {
  const workspace = task.workspace || path.join(settings.projectsDir, `task-${task.id}`);
  fs.mkdirSync(workspace, { recursive: true });
  const log = (type, text) => {
    event(type, text, { taskId: task.id, slot: job.slot });
    api('POST', `/agent/tasks/${task.id}/logs`, { entries: [{ type, text }] }).catch(() => {});
  };

  log('info', `👥 ${job.agent.name} руководит командой из ${team.owned} агентов и делит задачу на части…`);
  const parts = await planTeamTask(task, { ...deps(job), log }, team.owned);
  if (!parts) {
    log('info', 'Задача небольшая — выполню её сам.');
    return runTask({ ...task, workspace }, deps(job));
  }

  for (const [i, part] of parts.entries()) {
    const others = parts.filter((_, j) => j !== i).map(p => `«${p.title}»`).join(', ');
    const prompt = `Это часть ${i + 1} из ${parts.length} общей задачи команды агентов.
Общая цель: ${task.prompt}

Твоя часть — «${part.title}»:
${part.prompt}

Одновременно с тобой другие агенты делают: ${others}. Не меняй их файлы и не запускай серверы — общую проверку сделает руководитель.`;
    const sub = (await api('POST', '/agent-tasks', { parent_id: task.id, title: part.title, prompt, workspace })).data;
    localTasks.add(sub.id);
    log('info', `📌 Часть ${i + 1}: ${part.title}`);
  }

  // The lead's agent joins the team for the parts.
  await api('POST', `/agent/tasks/${task.id}/slot`, { slot: null });
  running.delete(job.slot);
  job.parts = parts.map(p => p.title);
  leads.set(task.id, job);
  sendTeamState();
  pollTasks();

  let subtasks = [];
  for (;;) {
    await sleep(4000);
    if (job.stopped) return { status: 'cancelled' };
    const t = (await api('GET', `/agent-tasks/${task.id}`)).data;
    if (t.status === 'cancelled') return { status: 'cancelled' };
    subtasks = t.subtasks || [];
    if (subtasks.length && subtasks.every(s => !['queued', 'running'].includes(s.status))) break;
  }

  // Take an agent back for the final check.
  for (;;) {
    if (job.stopped) return { status: 'cancelled' };
    const slot = freeSlot();
    if (slot) {
      try {
        await api('POST', `/agent/tasks/${task.id}/slot`, { slot });
        job.slot = slot;
        job.agent = agentInfo(slot);
        running.set(slot, job);
        leads.delete(task.id);
        sendTeamState();
        break;
      } catch { /* taken by someone else — wait */ }
    }
    await sleep(3000);
  }

  const report = subtasks.map((s, i) => `${i + 1}. «${s.title}» (${agentInfo(s.agent_slot || 1).name}) — ${s.status === 'completed' ? 'готово' : 'НЕ выполнено'}: ${String(s.result || '').slice(0, 1200)}`).join('\n\n');
  log('info', `🔎 Все части готовы. ${job.agent.name} проверяет проект целиком.`);
  return runTask({ ...task, workspace, prompt: `Ты — руководитель команды агентов. Общая задача пользователя: ${task.prompt}

Команда выполнила части в папке ${workspace}:
${report}

Теперь проверь проект целиком: посмотри файлы (list_dir, read_file), исправь несостыковки между частями (имена файлов, ссылки, классы), доделай невыполненные части, запусти и проверь результат. В конце напиши подробный итог для пользователя: что сделала команда, где файлы, как открыть.` }, deps(job));
}

// Queued tasks (from the site or waiting for a free agent) are handed to free agents.
let polling = false;
// Каждые несколько секунд спрашивать сервер о новых задачах с сайта и запускать их на свободных агентах.
async function pollTasks() {
  if (!settings.token || polling || !freeSlot()) return;
  polling = true;
  try {
    const res = await api('GET', '/agent/tasks?status=queued');
    for (const task of res.data) {
      const fromSite = !localTasks.has(task.id);
      if (fromSite && !settings.acceptSiteTasks) continue;
      const slot = freeSlot();
      if (!slot) break;
      if (fromSite) event('info', `📥 Получена задача с сайта: «${task.title}»`, { taskId: task.id, slot });
      execute(task, slot);
    }
  } catch { /* offline — try later */ } finally { polling = false; }
}

// ---------------------------------------------------------------- IPC — обработчики запросов из окна (межпроцессное взаимодействие)
ipcMain.handle('settings:get', () => ({ ...settings, token: settings.token ? '***' : null, version: app.getVersion() }));
ipcMain.handle('settings:set', (_e, patch) => {
  const allowed = ['server', 'autonomy', 'fullAccess', 'acceptSiteTasks', 'projectsDir'];
  for (const k of allowed) if (k in patch) settings[k] = patch[k];
  saveSettings();
  return true;
});
ipcMain.handle('auth:login', async (_e, { server, email, password, register, name }) => {
  settings.server = server || settings.server;
  settings.token = null;
  const res = await api('POST', register ? '/register' : '/login', { email, password, name, client: 'desktop' });
  settings.token = res.token;
  settings.user = res.user;
  saveSettings();
  refreshTeam();
  return res.user;
});
// Sign-in through Google / GitHub / Apple: the system browser does the sign-in, then the server
// redirects to a one-shot listener on 127.0.0.1 with a code that is exchanged for a token.
let oauthListener = null;
ipcMain.handle('auth:providers', async (_e, server) => {
  const base = (server || settings.server).replace(/\/+$/, '');
  try {
    const res = await fetch(base + '/api/oauth/providers', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    return res.ok ? (await res.json()).data : [];
  } catch { return []; }
});
ipcMain.handle('auth:oauth', async (_e, { server, provider }) => {
  settings.server = server || settings.server;
  oauthListener?.close();
  const page = text => `<!doctype html><meta charset="utf-8"><title>Mansur AI</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh;background:#0f1117;color:#e8eaf2"><div style="text-align:center"><h2>Mansur AI</h2><p>${text}</p></div>`;
  const result = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams;
      if (!q.has('code') && !q.has('error')) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(q.has('code') ? 'Вход выполнен. Вернитесь в приложение — эту вкладку можно закрыть.' : 'Не удалось войти: ' + q.get('error').replace(/[<>&]/g, '')));
      srv.close();
      q.has('code') ? resolve(q.get('code')) : reject(new Error(q.get('error')));
    });
    srv.on('close', () => { if (oauthListener === srv) oauthListener = null; reject(new Error('Вход отменён')); });
    srv.listen(0, '127.0.0.1', () => {
      oauthListener = srv;
      const base = settings.server.replace(/\/+$/, '');
      shell.openExternal(`${base}/auth/${encodeURIComponent(provider)}?client=desktop&port=${srv.address().port}`);
    });
    setTimeout(() => srv.close(), 5 * 60 * 1000);
  });
  settings.token = null;
  const res = await api('POST', '/oauth/exchange', { code: result });
  settings.token = res.token;
  settings.user = res.user;
  saveSettings();
  refreshTeam();
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  return res.user;
});
ipcMain.handle('auth:oauth-cancel', () => { oauthListener?.close(); return true; });
ipcMain.handle('auth:logout', async () => {
  await api('POST', '/logout').catch(() => {});
  settings.token = null; settings.user = null; saveSettings();
  return true;
});
ipcMain.handle('api', async (_e, { method, url, body }) => {
  try { return { ok: true, data: await api(method, url, body) }; } catch (e) { return { ok: false, error: e.message, errors: e.errors, status: e.status }; }
});
ipcMain.handle('agent:run', async (_e, { prompt, workspace, mode }) => {
  try {
    const task = (await api('POST', '/agent-tasks', { prompt, workspace: workspace || null, mode: mode || 'solo' })).data;
    localTasks.add(task.id);
    const slot = freeSlot();
    execute(task, slot);
    return { ok: true, task, queued: !slot, agent: slot ? agentInfo(slot) : null };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('agent:run-existing', async (_e, task) => { localTasks.add(task.id); execute(task); return true; });
// Stop one agent (slot) or the whole team.
ipcMain.handle('agent:stop', (_e, slot = null) => {
  for (const [s, job] of running) {
    if (slot !== null && s !== slot) continue;
    job.stopped = true;
    stopAll(job.task.id);
  }
  if (slot === null) leads.forEach(job => (job.stopped = true));
  return true;
});
ipcMain.handle('agents:team', () => refreshTeam());
ipcMain.handle('agents:state', () => { sendTeamState(); return true; });
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.projectsDir });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('shell:open', (_e, target) => (/^https?:/i.test(target) ? shell.openExternal(target) : shell.openPath(target)));

// ---------------------------------------------------------------- appearance (shared with the website) — оформление (общее с сайтом)
ipcMain.handle('me:background', async (_e, { name, type, bytes }) => {
  try {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type }), name);
    const res = await fetch(settings.server.replace(/\/+$/, '') + '/api/me/background', {
      method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + settings.token }, body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: Object.values(data.errors || {}).flat()[0] || data.message || 'Не удалось загрузить файл' };
    return { ok: true, data: data.data };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---------------------------------------------------------------- window with macOS-like animations — окно с плавными анимациями
let animating = false;
// Плавно изменить прозрачность окна (анимация открытия/сворачивания).
function fade(to, ms) {
  return new Promise(resolve => {
    if (!win) return resolve();
    const from = win.getOpacity(), steps = Math.max(1, Math.round(ms / 16));
    let i = 0;
    const t = setInterval(() => {
      i++;
      const k = i / steps, eased = 1 - (1 - k) ** 3;
      if (win && !win.isDestroyed()) win.setOpacity(from + (to - from) * eased);
      if (i >= steps) { clearInterval(t); resolve(); }
    }, 16);
  });
}
ipcMain.handle('win:minimize', async () => {
  if (animating || !win) return;
  animating = true;
  send('win:anim', 'minimize');
  await fade(0, 300);
  win.minimize();
  animating = false;
});
ipcMain.handle('win:maximize', () => {
  if (!win) return;
  send('win:anim', 'maximize');
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.handle('win:close', async () => {
  if (animating || !win) return;
  animating = true;
  send('win:anim', 'close');
  await fade(0, 230);
  win.close();
});

// The window has no system frame, so resizing is done with our own edge handles.
const MIN_W = 900, MIN_H = 600;
let resizing = null;
ipcMain.handle('win:resize-start', (_e, edge) => {
  if (!win || win.isMaximized()) return;
  const start = { cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() };
  clearInterval(resizing);
  resizing = setInterval(() => {
    const c = screen.getCursorScreenPoint();
    const dx = c.x - start.cursor.x, dy = c.y - start.cursor.y;
    let { x, y, width, height } = start.bounds;
    if (edge.includes('e')) width = Math.max(MIN_W, width + dx);
    if (edge.includes('s')) height = Math.max(MIN_H, height + dy);
    if (edge.includes('w')) { const w = Math.max(MIN_W, width - dx); x += width - w; width = w; }
    if (edge.includes('n')) { const h = Math.max(MIN_H, height - dy); y += height - h; height = h; }
    win.setBounds({ x, y, width, height });
  }, 16);
});
ipcMain.handle('win:resize-end', () => { clearInterval(resizing); resizing = null; rememberBounds(); });

// Interface scale: Ctrl + / Ctrl - / Ctrl 0 or the slider in settings.
// Масштаб интерфейса окна.
function setZoom(z) {
  settings.zoom = Math.min(1.6, Math.max(0.7, Math.round(z * 100) / 100));
  win?.webContents.setZoomFactor(settings.zoom);
  saveSettings();
  send('win:zoom', settings.zoom);
  return settings.zoom;
}
ipcMain.handle('win:zoom', (_e, z) => setZoom(z));

// Запомнить положение и размер окна до следующего запуска.
function rememberBounds() {
  if (win && !win.isMaximized() && !win.isMinimized()) { settings.bounds = win.getBounds(); saveSettings(); }
}

// Создать окно приложения (без системной рамки, со своими кнопками) и загрузить renderer/index.html.
function createWindow() {
  const b = settings.bounds;
  const onScreen = b && screen.getAllDisplays().some(d => b.x < d.workArea.x + d.workArea.width && b.x + b.width > d.workArea.x && b.y < d.workArea.y + d.workArea.height && b.y + b.height > d.workArea.y);
  win = new BrowserWindow({
    width: onScreen ? b.width : 1280, height: onScreen ? b.height : 820,
    ...(onScreen ? { x: b.x, y: b.y } : {}),
    minWidth: MIN_W, minHeight: MIN_H,
    resizable: true,
    thickFrame: true,
    frame: false,
    show: false,
    backgroundColor: '#0b0d14',
    title: 'Mansur AI',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });

  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(settings.zoom || 1));
  win.webContents.on('before-input-event', (e, input) => {
    if (!input.control || input.type !== 'keyDown') return;
    if (input.key === '=' || input.key === '+') { setZoom(settings.zoom + 0.1); e.preventDefault(); }
    if (input.key === '-') { setZoom(settings.zoom - 0.1); e.preventDefault(); }
    if (input.key === '0') { setZoom(1); e.preventDefault(); }
  });
  let boundsTimer;
  const saveSoon = () => { clearTimeout(boundsTimer); boundsTimer = setTimeout(rememberBounds, 500); };
  win.on('resize', saveSoon);
  win.on('move', saveSoon);
  win.on('close', rememberBounds);

  win.once('ready-to-show', () => {
    win.setOpacity(0);
    win.show();
    send('win:anim', 'open');
    fade(1, 260);
  });
  win.on('restore', () => { send('win:anim', 'restore'); fade(1, 300); });
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    fs.mkdirSync(settings.projectsDir, { recursive: true });
    createWindow();
    refreshTeam();
    pollTimer = setInterval(pollTasks, 6000);
    setInterval(refreshTeam, 30000);
  });
  app.on('window-all-closed', () => { clearInterval(pollTimer); stopAll(); app.quit(); });
}
