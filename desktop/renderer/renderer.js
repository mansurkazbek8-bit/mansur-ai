/*
 * Mansur AI для Windows — интерфейс окна (renderer-процесс).
 * Все запросы к серверу идут через главный процесс (window.mansur из preload.js): у окна нет доступа
 * к токену и файлам. Разделы: Агент, Команда, Чат, Задачи, Оформление, Настройки.
 */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const M = window.mansur;
  const state = { settings: null, user: null, models: [], usage: [], chat: null, chats: [], modelId: null, mode: 'login', team: null, running: [], leads: [], logFilter: null };
  const tenge = n => Number(n).toLocaleString('ru-RU') + ' ₸';
  const agentImg = a => `img/agents/${a.slug}.png`;

  // 3D scenes (three.js) are loaded on demand; without WebGL the pictures stay.
  let agents3d = null, teamStage = null, teamStageKey = '';
  // Показать 3D-модель агента на canvas.
  async function mount3d(canvas, opts) {
    try {
      agents3d ||= await import('./js/agents3d.js');
      if (!canvas.isConnected) return null;
      const stage = agents3d.createStage(canvas, opts);
      canvas.closest('.stage-wrap')?.classList.add('ready');
      return stage;
    } catch (e) {
      console.warn('3D недоступно:', e.message);
      return null;
    }
  }
  const workingMap = () => {
    const map = {};
    state.running.forEach(r => { const a = state.team?.agents.find(x => x.slot === r.slot); if (a) map[a.slug] = true; });
    return map;
  };

  // ---------------------------------------------------------------- window (macOS-like animations) — кнопки окна и анимации
  const root = document.getElementById('window-root');
  const play = name => {
    root.classList.remove('anim-open', 'anim-close', 'anim-minimize', 'anim-restore', 'anim-maximize');
    void root.offsetWidth;
    root.classList.add('anim-' + name);
  };
  root.addEventListener('animationend', e => { if (e.target === root && !root.classList.contains('anim-minimize') && !root.classList.contains('anim-close')) root.className = ''; });
  M.on('win:anim', play);
  document.getElementById('tl-close').onclick = () => M.window.close();
  document.getElementById('tl-min').onclick = () => M.window.minimize();
  document.getElementById('tl-max').onclick = () => M.window.maximize();
  document.getElementById('titlebar').addEventListener('dblclick', e => { if (!e.target.closest('.lights, .tb-right')) M.window.maximize(); });

  // Resize by dragging any edge or corner (the main process follows the cursor).
  document.querySelectorAll('#resize-handles .rh').forEach(h => {
    h.addEventListener('pointerdown', e => { h.setPointerCapture(e.pointerId); M.window.resizeStart(h.dataset.edge); });
    const end = () => M.window.resizeEnd();
    h.addEventListener('pointerup', end);
    h.addEventListener('lostpointercapture', end);
  });
  M.on('win:state', s => {
    document.documentElement.classList.toggle('maximized', s.maximized);
    // Windows shows a "restore" icon (two squares) while the window is maximized.
    document.getElementById('max-icon').innerHTML = s.maximized
      ? '<rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V0.5h7v7h-2"/>'
      : '<rect x="0.5" y="0.5" width="9" height="9"/>';
    document.getElementById('tl-max').title = s.maximized ? 'Свернуть в окно' : 'Развернуть';
  });
  M.on('win:zoom', z => {
    const el = document.getElementById('set-zoom');
    if (el) { el.value = Math.round(z * 100); document.getElementById('set-zoom-val').textContent = Math.round(z * 100) + '%'; }
  });
  document.getElementById('set-zoom').addEventListener('input', e => M.window.zoom(e.target.value / 100));

  // ---------------------------------------------------------------- design (shared with the website) — оформление (общее с сайтом)
  const cache = {
    get: k => { try { return JSON.parse(localStorage.getItem('mansur_' + k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem('mansur_' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  // Применить оформление пользователя (то же, что на сайте).
  function applyDesign(user) {
    const bg = user ? { url: user.background_url, type: user.background_type } : (cache.get('background') || {});
    const appearance = user ? user.appearance : cache.get('appearance');
    if (user) { cache.set('appearance', appearance); cache.set('background', bg); }
    MansurTheme.apply(appearance, bg);
  }
  applyDesign(null);

  // Короткое всплывающее уведомление.
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  }
  // Запрос к API сервера (в окне — через главный процесс; в главном процессе — сам HTTP-запрос с токеном).
  async function api(method, url, body) {
    const r = await M.api(method, url, body);
    if (!r.ok) { const e = new Error((r.errors && Object.values(r.errors).flat()[0]) || r.error); e.status = r.status; throw e; }
    return r.data;
  }
  const md = text => {
    const box = document.createElement('div');
    box.className = 'md';
    box.innerHTML = DOMPurify.sanitize(marked.parse(text || '', { breaks: true, gfm: true }));
    box.querySelectorAll('pre code').forEach(c => { try { hljs.highlightElement(c); } catch { /* ignore */ } });
    box.querySelectorAll('a').forEach(a => a.addEventListener('click', e => { e.preventDefault(); M.open(a.href); }));
    return box;
  };

  // ---------------------------------------------------------------- login — вход
  const SOCIAL_ICON = {
    google: '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
    github: '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
    apple: '<svg viewBox="0 0 384 512" width="16" height="18" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>',
  };
  const cleanErr = err => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  // Google / GitHub / Apple buttons — only the ones the site admin has set up.
  // Показать кнопки «Войти через Google/GitHub», если они настроены на сервере.
  async function loadSocialButtons() {
    const providers = await M.socialProviders($('#login-form [name=server]').value.trim());
    $('#social-login').classList.toggle('hidden', !providers.length);
    const box = $('#social-login .social-btns');
    box.innerHTML = providers.map(p => `<button type="button" class="btn btn-block social-btn social-${p.name}" data-social="${p.name}">${SOCIAL_ICON[p.name] || ''}<span>${esc(p.title)}</span></button>`).join('');
    box.querySelectorAll('[data-social]').forEach(b => b.onclick = async () => {
      $('#login-err').textContent = '';
      $('#social-wait').classList.remove('hidden');
      box.querySelectorAll('button').forEach(x => (x.disabled = true));
      try {
        await M.socialLogin({ server: $('#login-form [name=server]').value.trim(), provider: b.dataset.social });
        state.settings = await M.settings();
        showApp();
      } catch (err) {
        const msg = cleanErr(err);
        if (msg !== 'Вход отменён') $('#login-err').textContent = msg;
      } finally {
        $('#social-wait').classList.add('hidden');
        box.querySelectorAll('button').forEach(x => (x.disabled = false));
      }
    });
  }
  $('#social-cancel').onclick = e => { e.preventDefault(); M.socialCancel(); };
  $('#login-form [name=server]').addEventListener('change', loadSocialButtons);
  // Password reset happens on the site: the letter's link opens there anyway.
  $('#login-forgot').onclick = e => {
    e.preventDefault();
    const base = ($('#login-form [name=server]').value.trim() || state.settings.server).replace(/\/+$/, '');
    const email = $('#login-form [name=email]').value.trim();
    M.open(`${base}/#/forgot${email ? '?email=' + encodeURIComponent(email) : ''}`);
  };

  // Экран входа: адрес сервера, email и пароль, вход через соцсети, «Забыли пароль?».
  function showLogin() {
    $('#app-screen').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-form [name=server]').value = state.settings.server;
    loadSocialButtons();
  }
  $$('.seg button').forEach(b => b.onclick = () => {
    state.mode = b.dataset.mode;
    $$('.seg button').forEach(x => x.classList.toggle('active', x === b));
    $('.reg-only').classList.toggle('hidden', state.mode !== 'register');
    $('.login-only').classList.toggle('hidden', state.mode === 'register');
    $('#login-btn').textContent = state.mode === 'register' ? 'Создать аккаунт' : 'Войти';
  });
  $('#login-form').onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    $('#login-btn').disabled = true;
    $('#login-err').textContent = '';
    try {
      await M.login({ ...f, register: state.mode === 'register' });
      state.settings = await M.settings();
      showApp();
    } catch (err) {
      $('#login-err').textContent = cleanErr(err);
    } finally { $('#login-btn').disabled = false; }
  };

  // ---------------------------------------------------------------- navigation — навигация по разделам
  // Загрузить профиль пользователя с сервера.
  async function loadMe() {
    try {
      const me = await api('GET', '/me');
      state.user = me.user;
      applyDesign(state.user);
      fillAccount();
    } catch { /* offline */ }
  }
  // Показать имя и данные аккаунта в окне.
  function fillAccount() {
    const u = state.user || state.settings.user;
    if (!u) return;
    const ini = (u.name || '?').trim().slice(0, 1).toUpperCase();
    $('#account-btn').textContent = ini;
    $('#am-avatar').textContent = ini;
    $('#am-name').textContent = u.name;
    $('#am-email').textContent = u.email;
    $('#am-role').textContent = u.role === 'admin' ? 'Администратор' : 'Пользователь';
    $('#am-admin').classList.toggle('hidden', u.role !== 'admin');
    $('#tb-user').textContent = u.name + (u.role === 'admin' ? ' · админ' : '');
  }
  const siteUrl = path => state.settings.server.replace(/\/+$/, '') + path;
  $('#account-btn').onclick = e => { e.stopPropagation(); $('#account-menu').classList.toggle('hidden'); };
  document.addEventListener('click', e => { if (!e.target.closest('#account-menu')) $('#account-menu').classList.add('hidden'); });
  $('#am-admin').onclick = () => M.open(siteUrl('/#/admin'));
  $('#am-site').onclick = () => M.open(siteUrl('/'));
  $('#am-design').onclick = () => { $('#account-menu').classList.add('hidden'); $('.rail-btn[data-view=design]').click(); };
  $('#am-logout').onclick = async () => { await M.logout(); state.user = null; state.settings = await M.settings(); cache.set('appearance', null); cache.set('background', null); MansurTheme.apply(null, {}); showLogin(); };

  // Раздел «Оформление» в приложении.
  function renderDesign() {
    const u = state.user;
    if (!u) return;
    MansurTheme.renderEditor($('#design-box'), {
      appearance: u.appearance,
      background: { url: u.background_url, type: u.background_type },
      notify: toast,
      save: async appearance => { state.user = (await api('PUT', '/me/appearance', appearance)).data; applyDesign(state.user); },
      upload: async file => {
        const r = await M.uploadBackground({ name: file.name, type: file.type, bytes: await file.arrayBuffer() });
        if (!r.ok) throw new Error(r.error);
        state.user = r.data;
        return { url: state.user.background_url, type: state.user.background_type };
      },
      removeBackground: async () => { await api('DELETE', '/me/background'); state.user.background_url = null; state.user.background_type = null; },
    });
  }

  // Основной экран после входа: левое меню-рельс с 3D-иконками и разделы.
  function showApp() {
    $('#login-screen').classList.add('hidden');
    $('#app-screen').classList.remove('hidden');
    fillAccount();
    loadMe();
    loadModels();
    fillSettings();
    renderChat();
    M.teamState();
    M.team();
  }
  $$('.rail-btn').forEach(b => b.onclick = () => {
    $$('.rail-btn').forEach(x => x.classList.toggle('active', x === b));
    document.body.dataset.view = b.dataset.view;
    $$('.view').forEach(v => v.classList.add('hidden'));
    const view = $('#view-' + b.dataset.view);
    view.classList.remove('hidden', 'mt-enter-soft');
    void view.offsetWidth;
    view.classList.add('mt-enter-soft');
    if (b.dataset.view === 'design') renderDesign();
    if (b.dataset.view === 'chat') loadChats();
    if (b.dataset.view === 'tasks') loadTasks();
    if (b.dataset.view === 'team') { renderTeamView(); M.team(); }
  });

  // ---------------------------------------------------------------- agent — журнал агента
  const logBox = $('#agent-log');
  let logStarted = false;
  // Добавить строку в журнал агента на экране (мысль, инструмент, результат, ошибка).
  function addLog(e) {
    if (!logStarted) { logBox.innerHTML = ''; logStarted = true; }
    const line = document.createElement('div');
    const a = e.slot && state.team?.agents.find(x => x.slot === e.slot);
    if (e.slot) line.dataset.slot = e.slot;
    line.classList.toggle('hidden', !!state.logFilter && e.slot !== state.logFilter);
    line.innerHTML = `<span class="t">${new Date(e.at).toLocaleTimeString('ru-RU')}</span>${a ? `<span class="who" style="color:${a.color}">${esc(a.name)}</span>` : ''}<span class="lg-${esc(e.type)}"></span>`;
    line.lastChild.textContent = e.text;
    logBox.append(line);
    logBox.scrollTop = logBox.scrollHeight;
  }
  // ---------------------------------------------------------------- agent team — команда агентов
  const busyTask = slot => state.running.find(r => r.slot === slot)?.task;

  // Полоса агентов: 5 агентов, кто свободен, кто занят.
  function renderTeamBar() {
    const t = state.team;
    if (!t?.agents?.length) return;
    const working = state.running.length;
    const pill = $('#agent-pill');
    pill.textContent = working ? `● Работают ${working} из ${t.owned}` : `Готовы: ${t.owned} ${t.owned === 1 ? 'агент' : t.owned < 5 ? 'агента' : 'агентов'}`;
    pill.classList.toggle('run', !!working);
    $('#agent-stop').classList.toggle('hidden', !working);
    $('#team-bar').innerHTML = t.agents.map(a => {
      const task = busyTask(a.slot);
      if (a.owned) {
        return `<div class="tb-agent ${task ? 'working' : ''} ${state.logFilter === a.slot ? 'focus' : ''}" style="--ac:${a.color}" data-filter="${a.slot}" title="${task ? 'Показать журнал агента' : 'Свободен'}">
          <img src="${agentImg(a)}" alt="">
          <div class="tb-info"><b>${esc(a.name)}</b><span>${task ? '⚙ ' + esc(task.title) : '● свободен'}</span></div>
          ${task ? `<button class="tb-stop" data-stop="${a.slot}" title="Остановить ${esc(a.name)}">■</button>` : ''}
        </div>`;
      }
      return a.next
        ? `<button class="tb-agent locked next" style="--ac:${a.color}" data-buy="${a.slot}"><img src="${agentImg(a)}" alt=""><div class="tb-info"><b>＋ ${esc(a.name)}</b><span>${tenge(a.price)}</span></div></button>`
        : `<div class="tb-agent locked" style="--ac:${a.color}" title="${esc(a.name)} откроется после предыдущего агента"><img src="${agentImg(a)}" alt=""><div class="tb-info"><b>🔒 ${esc(a.name)}</b><span>${tenge(a.price)}</span></div></div>`;
    }).join('');
    $$('[data-filter]').forEach(el => el.onclick = e => {
      if (e.target.closest('[data-stop]')) return;
      const slot = +el.dataset.filter;
      state.logFilter = state.logFilter === slot ? null : slot;
      $$('#agent-log > div').forEach(l => l.classList.toggle('hidden', !!state.logFilter && +l.dataset.slot !== state.logFilter));
      renderTeamBar();
    });
    $$('[data-stop]').forEach(b => b.onclick = () => M.stopAgent(+b.dataset.stop));
    $$('#team-bar [data-buy]').forEach(b => b.onclick = () => buyModal(t.agents.find(a => a.slot === +b.dataset.buy)));
    if (state.leads.length) {
      $('#team-bar').insertAdjacentHTML('beforeend', state.leads.map(l => `<div class="tb-lead" title="${esc(l.parts.join(' · '))}">👥 ${esc(l.agent.name)} ждёт команду: «${esc(l.task.title)}» · частей: ${l.parts.length}</div>`).join(''));
    }
    const canTogether = t.owned >= 2;
    $('#together').classList.toggle('off', !canTogether);
    $('#agent-together').disabled = !canTogether;
    if (!canTogether) $('#agent-together').checked = false;
    $('#together-team').innerHTML = t.agents.filter(a => a.owned).map(a => `<img src="${agentImg(a)}" alt="">`).join('');
    renderDock();
    teamStage?.setWorking(workingMap());
    if (!$('#view-team').classList.contains('hidden')) renderTeamView();
  }

  // Owned agents are always visible in the corner of the window.
  // Плашка агентов внизу окна.
  function renderDock() {
    const dock = $('#agent-dock');
    const owned = (state.team?.agents || []).filter(a => a.owned);
    dock.classList.toggle('hidden', !owned.length || $('#app-screen').classList.contains('hidden'));
    const collapsed = localStorage.getItem('dock_hidden') === '1';
    dock.classList.toggle('collapsed', collapsed);
    dock.innerHTML = `<button class="dock-toggle" title="${collapsed ? 'Показать команду' : 'Свернуть'}">${collapsed ? '<img class="dock-ico" src="img/icons/team.png" alt="">' : '›'}</button>` + owned.map((a, i) => {
      const task = busyTask(a.slot);
      return `<button class="dock-agent ${task ? 'working' : ''}" style="--ac:${a.color};--i:${i}" data-dock="${a.slot}" title="${esc(a.name)}${task ? ' — ' + esc(task.title) : ' — свободен'}">
        ${task ? `<span class="dock-bubble">⚙ ${esc(task.title)}</span>` : ''}<img src="${agentImg(a)}" alt=""><span class="dock-name">${esc(a.name)}</span></button>`;
    }).join('');
    $('.dock-toggle', dock).onclick = () => { localStorage.setItem('dock_hidden', collapsed ? '0' : '1'); renderDock(); };
    $$('[data-dock]', dock).forEach(b => b.onclick = () => $('.rail-btn[data-view=team]').click());
  }

  // Раздел «Команда»: все агенты и покупка новых.
  function renderTeamView() {
    const t = state.team;
    if (!t?.agents?.length) { $('#team-cards').innerHTML = '<p class="muted">Нет связи с сервером.</p>'; return; }
    const key = t.agents.filter(a => a.owned).map(a => a.slug).join();
    if (key !== teamStageKey) {
      teamStage?.dispose();
      teamStageKey = key;
      // a fresh canvas: a WebGL context can't be reused after dispose
      const old = $('#team-stage');
      const canvas = old.cloneNode();
      old.replaceWith(canvas);
      mount3d(canvas, {
        agents: t.agents.filter(a => a.owned).map(a => ({ slug: a.slug, working: !!busyTask(a.slot) })),
        onPick: slug => $(`#team-cards .agent-card[data-slot="${t.agents.find(a => a.slug === slug).slot}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        paused: () => !$('#buy-modal').classList.contains('hidden') || $('#view-team').classList.contains('hidden'),
      }).then(s => (teamStage = s));
    }
    $('#team-dots').innerHTML = `<span class="muted small">${t.owned} из ${t.max}</span>` + t.agents.map(a => `<i class="${a.owned ? 'on' : ''}" style="--ac:${a.color}"></i>`).join('');
    $('#team-cards').innerHTML = t.agents.map(a => {
      const task = busyTask(a.slot);
      const prev = t.agents.find(x => x.slot === a.slot - 1);
      return `
        <div class="agent-card ${a.owned ? 'owned' : 'locked'} ${a.next ? 'next' : ''} ${task ? 'working' : ''}" style="--ac:${a.color}" data-slot="${a.slot}">
          <span class="agent-num">#${a.slot}</span>
          <div class="agent-art"><img src="${agentImg(a)}" alt="">${a.owned ? '' : '<span class="agent-lock">🔒</span>'}</div>
          <h3>${esc(a.name)}</h3><div class="agent-sub">${esc(a.title)}</div>
          <p>${esc(a.description)}</p>
          ${a.owned
            ? (task ? `<div class="agent-status busy">⚙ ${esc(task.title)}</div>` : '<div class="agent-status free">● Свободен</div>') + (a.price ? '' : '<div class="agent-price">Бесплатно</div>')
            : a.next ? `<button class="btn btn-primary agent-buy" data-buy="${a.slot}">Добавить за ${tenge(a.price)}</button>`
            : `<div class="agent-price">${tenge(a.price)}</div><div class="muted small">После агента ${esc(prev?.name || '')}</div>`}
        </div>`;
    }).join('');
    $$('#team-cards [data-buy]').forEach(b => b.onclick = () => buyModal(t.agents.find(a => a.slot === +b.dataset.buy)));
  }

  // Окно покупки агента.
  function buyModal(a) {
    const t = state.team;
    const box = $('#buy-box');
    box.style.setProperty('--ac', a.color);
    box.innerHTML = `
      <div class="stage-wrap buy-stage" style="background-image:url(${agentImg(a)})"><canvas id="buy-stage"></canvas></div>
      <h2 style="margin:6px 0 2px">${esc(a.name)} <span class="agent-sub">· ${esc(a.title)}</span></h2>
      <p class="muted">${esc(a.description)}</p>
      <div class="buy-lines">
        <div><span>Агентов сейчас</span><b>${t.owned}</b></div>
        <div><span>После покупки</span><b>${t.owned + 1} — одновременно ${t.owned + 1} задачи</b></div>
        <div class="total"><span>К оплате (разово)</span><b>${tenge(a.price)}</b></div>
      </div>
      ${t.payment_mode === 'demo' ? '<p class="small muted">🧪 Демо-режим оплаты: деньги не списываются, агент добавляется сразу.</p>' : ''}
      <div class="row end"><button class="btn" id="buy-no">Отмена</button><button class="btn btn-primary" id="buy-yes">Оплатить ${tenge(a.price)}</button></div>`;
    $('#buy-modal').classList.remove('hidden');
    let buyStage = null;
    mount3d($('#buy-stage'), { agents: [{ slug: a.slug }], spin: true }).then(s => (buyStage = s));
    const closeBuy = () => { $('#buy-modal').classList.add('hidden'); buyStage?.dispose(); };
    $('#buy-no').onclick = closeBuy;
    $('#buy-yes').onclick = async e => {
      e.target.disabled = true;
      try {
        const r = await api('POST', '/agents/buy');
        closeBuy();
        toast('🎉 ' + r.message, 'ok');
        await M.team();
        $(`#team-cards .agent-card[data-slot="${a.slot}"]`)?.classList.add('just-joined');
      } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    };
  }
  $('#agent-run').onclick = async () => {
    const prompt = $('#agent-prompt').value.trim();
    if (prompt.length < 3) { toast('Опишите задачу', 'err'); return; }
    $('#agent-result').classList.add('hidden');
    logStarted = false;
    const together = $('#agent-together').checked;
    const r = await M.runAgent({ prompt, workspace: $('#agent-ws').value.trim(), mode: together ? 'team' : 'solo' });
    if (!r.ok) { toast(r.error, 'err'); return; }
    $('#agent-prompt').value = '';
    toast(r.queued ? 'Все агенты заняты — задача в очереди и начнётся, как только кто-то освободится'
      : together ? `${r.agent.name} руководит командой: делит задачу на части` : `${r.agent.name} взял задачу`, r.queued ? '' : 'ok');
  };
  $('#agent-stop').onclick = () => M.stopAgent();
  $('#agent-ws-pick').onclick = async () => { const d = await M.pickFolder(); if (d) $('#agent-ws').value = d; };
  $('#log-clear').onclick = () => { logBox.innerHTML = ''; logStarted = true; };
  $$('[data-ex]').forEach(b => b.onclick = () => { $('#agent-prompt').value = b.dataset.ex; $('#agent-prompt').focus(); });

  M.on('agent:event', addLog);
  M.on('agent:state', s => { state.team = s.team; state.running = s.running; state.leads = s.leads || []; renderTeamBar(); });
  M.on('agent:done', d => {
    const box = $('#agent-result');
    const who = d.agent ? `${d.agent.name}: ` : '';
    if (d.status === 'completed') {
      box.innerHTML = `<div class="result-who" style="color:${d.agent?.color || 'inherit'}">${d.agent ? `<img src="${agentImg(d.agent)}" alt="">` : ''}${esc(who)}«${esc(d.task.title)}» — готово</div>`;
      box.append(md(d.result));
      if (d.workspace) {
        const b = document.createElement('button');
        b.className = 'btn btn-sm';
        b.textContent = '📁 Открыть папку проекта';
        b.onclick = () => M.open(d.workspace);
        box.append(b);
      }
      box.classList.remove('hidden');
      toast(who + 'задача выполнена', 'ok');
    } else if (d.status === 'failed') {
      toast(who + 'задача не выполнена: ' + d.result, 'err');
    }
  });
  M.on('agent:confirm', ({ id, text }) => {
    $('#modal-text').textContent = text;
    $('#modal').classList.remove('hidden');
    const answer = ok => { $('#modal').classList.add('hidden'); M.answerConfirm(id, ok); };
    $('#modal-yes').onclick = () => answer(true);
    $('#modal-no').onclick = () => answer(false);
  });
  M.on('auth:expired', () => { toast('Сеанс завершён — войдите снова', 'err'); M.settings().then(s => { state.settings = s; showLogin(); }); });

  // ---------------------------------------------------------------- chat (synced with the website) — чат (общий с сайтом)
  // Загрузить список нейросетей для чата.
  async function loadModels() {
    try {
      state.models = (await api('GET', '/models')).data;
      state.usage = (await api('GET', '/usage')).data;
      state.modelId = state.modelId || state.models[0]?.id;
      const groups = {};
      state.models.forEach(m => (groups[m.provider_title || m.provider] ||= []).push(m));
      $('#chat-model').innerHTML = Object.entries(groups).map(([title, list]) =>
        `<optgroup label="${esc(title)}">${list.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
      $('#chat-model').value = state.modelId;
      updateLimit();
    } catch (e) { toast(e.message, 'err'); }
  }
  // Обновить «Осталось сегодня».
  function updateLimit() {
    const u = state.usage.find(x => x.ai_model_id === +state.modelId);
    $('#chat-limit').textContent = u ? `осталось сегодня: ${u.remaining}` : '';
  }
  // Загрузить список чатов (те же, что на сайте).
  async function loadChats() {
    const q = $('#chat-q').value.trim();
    try {
      state.chats = (await api('GET', '/chats' + (q ? '?q=' + encodeURIComponent(q) : ''))).data;
      $('#chat-list').innerHTML = state.chats.map(c => `<div class="chat-item ${state.chat?.id === c.id ? 'active' : ''}" data-id="${c.id}" title="${esc(c.title)}">${esc(c.title)}</div>`).join('') || '<p class="muted small">Чатов нет</p>';
      $$('.chat-item').forEach(el => el.onclick = () => openChat(+el.dataset.id));
    } catch (e) { toast(e.message, 'err'); }
  }
  let qTimer;
  $('#chat-q').oninput = () => { clearTimeout(qTimer); qTimer = setTimeout(loadChats, 300); };
  // Открыть чат с сообщениями.
  async function openChat(id) {
    try {
      state.chat = (await api('GET', '/chats/' + id)).data;
      if (state.chat.ai_model_id) { state.modelId = state.chat.ai_model_id; $('#chat-model').value = state.modelId; updateLimit(); }
      renderChat();
      loadChats();
    } catch (e) { toast(e.message, 'err'); }
  }
  // Нарисовать сообщения чата.
  function renderChat() {
    $('#chat-title').textContent = state.chat?.title || 'Новый чат';
    const box = $('#chat-msgs');
    box.innerHTML = '';
    (state.chat?.messages || []).forEach(m => {
      const el = document.createElement('div');
      el.className = 'msg ' + m.role;
      if (m.role === 'user') el.textContent = m.content;
      else {
        el.innerHTML = `<div class="who">${esc(m.model_name || 'Mansur AI')}</div>`;
        if (m.image_url) el.insertAdjacentHTML('beforeend', `<img src="${esc(m.image_url)}" alt="">`);
        else el.append(md(m.content));
      }
      box.append(el);
    });
    if (!state.chat?.messages?.length) box.innerHTML = '<p class="muted" style="text-align:center;margin-top:20vh">Начните разговор — чат появится и на сайте.</p>';
    box.scrollTop = box.scrollHeight;
  }
  $('#chat-new').onclick = () => { state.chat = null; renderChat(); loadChats(); };
  $('#chat-model').onchange = async e => {
    state.modelId = +e.target.value;
    updateLimit();
    if (state.chat) await api('PATCH', '/chats/' + state.chat.id, { ai_model_id: state.modelId }).catch(err => toast(err.message, 'err'));
  };
  // Отправить сообщение в чат (тот же POST /api/chats/{id}/messages, что и на сайте).
  async function sendChat() {
    const input = $('#chat-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    $('#chat-send').disabled = true;
    try {
      if (!state.chat) state.chat = { ...(await api('POST', '/chats', { ai_model_id: +state.modelId })).data, messages: [] };
      state.chat.messages.push({ role: 'user', content });
      renderChat();
      $('#chat-msgs').insertAdjacentHTML('beforeend', '<div class="msg assistant muted" id="typing">печатает…</div>');
      const r = await api('POST', `/chats/${state.chat.id}/messages`, { content, ai_model_id: +state.modelId });
      state.chat.messages.pop();
      state.chat.messages.push(r.user_message, r.assistant_message);
      state.chat.title = r.chat.title;
      const u = state.usage.find(x => x.ai_model_id === +state.modelId);
      if (u) u.remaining = r.remaining;
      updateLimit();
      renderChat();
      loadChats();
    } catch (e) {
      $('#typing')?.remove();
      toast(e.message, 'err');
    } finally { $('#chat-send').disabled = false; }
  }
  $('#chat-send').onclick = sendChat;
  $('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });

  // ---------------------------------------------------------------- tasks — задачи
  const STATUS = { queued: 'В очереди', running: 'Выполняется', completed: 'Готово', failed: 'Ошибка', cancelled: 'Отменена' };
  // Загрузить и показать задачи агента.
  async function loadTasks() {
    try {
      const tasks = (await api('GET', '/agent-tasks')).data;
      $('#tasks-list').innerHTML = tasks.map(t => `
        <div class="task">
          <div class="grow"><b>${esc(t.title)}</b><span class="muted small">${new Date(t.created_at).toLocaleString('ru-RU')} · шагов: ${t.log_count}${t.workspace ? ' · ' + esc(t.workspace) : ''}</span></div>
          <span class="status st-${t.status}">${STATUS[t.status]}</span>
          ${t.status === 'queued' ? `<button class="btn btn-sm" data-run="${t.id}">▶ Выполнить</button>` : ''}
          ${['queued', 'running'].includes(t.status) ? `<button class="btn btn-sm btn-danger" data-cancel="${t.id}">Отменить</button>` : ''}
        </div>`).join('') || '<p class="muted">Задач пока нет.</p>';
      $$('[data-run]').forEach(b => b.onclick = () => {
        const t = tasks.find(x => x.id === +b.dataset.run);
        logStarted = false;
        M.runExisting(t);
        $('.rail-btn[data-view=agent]').click();
      });
      $$('[data-cancel]').forEach(b => b.onclick = async () => {
        await api('POST', `/agent-tasks/${b.dataset.cancel}/cancel`).catch(e => toast(e.message, 'err'));
        loadTasks();
      });
    } catch (e) { toast(e.message, 'err'); }
  }
  $('#tasks-refresh').onclick = loadTasks;

  // ---------------------------------------------------------------- settings — настройки
  // Заполнить раздел «Настройки»: папка проектов, режим подтверждений, полный доступ.
  function fillSettings() {
    const s = state.settings;
    $('#set-user').textContent = s.user ? `${s.user.name} · ${s.user.email}` : '';
    $('#set-server').value = s.server;
    $('#set-dir').value = s.projectsDir;
    $('#set-autonomy').value = s.autonomy;
    $('#set-full').checked = s.fullAccess;
    $('#set-site').checked = s.acceptSiteTasks;
    $('#set-version').textContent = 'Версия ' + s.version;
    $('#set-zoom').value = Math.round((s.zoom || 1) * 100);
    $('#set-zoom-val').textContent = Math.round((s.zoom || 1) * 100) + '%';
  }
  $('#set-dir-pick').onclick = async () => { const d = await M.pickFolder(); if (d) $('#set-dir').value = d; };
  $('#set-save').onclick = async () => {
    await M.saveSettings({
      server: $('#set-server').value.trim(), projectsDir: $('#set-dir').value.trim(),
      autonomy: $('#set-autonomy').value, fullAccess: $('#set-full').checked, acceptSiteTasks: $('#set-site').checked,
    });
    state.settings = await M.settings();
    toast('Настройки сохранены', 'ok');
  };
  $('#set-logout').onclick = () => $('#am-logout').click();

  // ---------------------------------------------------------------- boot — запуск окна
  M.settings().then(s => { state.settings = s; s.token ? showApp() : showLogin(); });
})();
