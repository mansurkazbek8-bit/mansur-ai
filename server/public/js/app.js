/*
 * Mansur AI — сайт в виде одностраничного приложения (SPA) на чистом JavaScript без фреймворков.
 * Вся работа идёт через REST API сервера (/api): страница не перезагружается, JavaScript сам
 * перерисовывает нужные части. Адрес страницы хранится после знака # (#/chat, #/tasks, #/admin).
 * Токен входа хранится в localStorage и отправляется в заголовке Authorization.
 * Весь код обёрнут в (() => { … })() — так переменные не попадают в глобальную область.
 */
(() => {
  'use strict';

  // ---------------------------------------------------------------- state — состояние приложения и вспомогательные функции
  // Обёртка над localStorage (хранилище браузера): ключи с префиксом mansur_, значения в JSON.
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem('mansur_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('mansur_' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem('mansur_' + k); } catch { /* storage unavailable */ } },
  };

  // Состояние приложения: кто вошёл, список моделей и чатов, открытый чат и т.д.
  const state = {
    token: store.get('token'),
    user: null,
    models: [],
    usage: [],
    chats: [],
    chat: null,
    modelId: store.get('model'),
    filters: { q: '', model: '' },
    sending: false,
    appInfo: null,
    taskTimer: null,
    social: [], // sign-in providers configured by the admin (Google / GitHub / Apple)
    team: null, // agent roster: which of the 5 agents the user owns and what they are doing
  };
  const tenge = n => Number(n).toLocaleString('ru-RU') + ' ₸';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  // esc — экранирование HTML: любой текст пользователя или нейросети вставляется только через неё (защита от XSS).
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtDate = d => d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const initials = n => (n || '?').trim().slice(0, 1).toUpperCase();

  // ---------------------------------------------------------------- theme — оформление (тема, цвета, фон)
  // Применить оформление пользователя; копия в localStorage убирает «мигание» при загрузке страницы.
  function applyDesign(user) {
    const appearance = user ? user.appearance : store.get('appearance');
    const bg = user ? { url: user.background_url, type: user.background_type } : store.get('background', {});
    if (user) { store.set('appearance', user.appearance); store.set('background', bg); }
    MansurTheme.apply(appearance || { theme: store.get('theme', 'dark') }, bg);
  }
  applyDesign(null);

  // ---------------------------------------------------------------- api — обращение к REST API сервера
  // Единая функция запроса к API: fetch + JSON + токен в заголовке Authorization: Bearer. Ошибку превращает в исключение с текстом с сервера; при 401 — выход.
  async function api(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && state.token) { logoutLocal(); }
      const err = new Error(data?.message || `Ошибка ${res.status}`);
      err.status = res.status;
      err.errors = data?.errors || {};
      throw err;
    }
    return data;
  }

  // ---------------------------------------------------------------- ui helpers — всплывающие уведомления, окна, Markdown
  // Короткое всплывающее уведомление в углу экрана (ok — зелёное, err — красное).
  function toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 5000);
  }

  // Открыть модальное окно с переданным HTML; закрывается по крестику, фону или Esc.
  function modal(html, { wide = false, onClose } = {}) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="overlay"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
    const overlay = $('.overlay', root);
    const close = () => { root.innerHTML = ''; onClose?.(); };
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
    $$('[data-close]', root).forEach(b => b.addEventListener('click', close));
    const first = $('input, textarea', root);
    first?.focus();
    return { el: $('.modal', root), close };
  }

  // Окно подтверждения «Вы уверены?»; возвращает Promise<true/false>.
  function confirmBox(text, okText = 'Удалить') {
    return new Promise(resolve => {
      const m = modal(`<h2>Подтверждение</h2><p>${esc(text)}</p>
        <div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="cf-ok">${esc(okText)}</button></div>`,
      { onClose: () => resolve(false) });
      $('#cf-ok').onclick = () => { $('#modal-root').innerHTML = ''; resolve(true); };
      return m;
    });
  }

  // Окно ввода строки (например, новое имя чата); возвращает Promise<строка|null>.
  function promptBox(title, value = '') {
    return new Promise(resolve => {
      modal(`<h2>${esc(title)}</h2><input class="input" id="pb-val" value="${esc(value)}" maxlength="150">
        <div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="pb-ok">Сохранить</button></div>`,
      { onClose: () => resolve(null) });
      const done = () => { const v = $('#pb-val').value.trim(); $('#modal-root').innerHTML = ''; resolve(v || null); };
      $('#pb-ok').onclick = done;
      $('#pb-val').addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
    });
  }

  // Ответ нейросети (Markdown) → безопасный HTML: сначала экранируем всё, потом размечаем код, жирный, списки (защита от XSS).
  function renderMarkdown(text) {
    const html = DOMPurify.sanitize(marked.parse(text || '', { breaks: true, gfm: true }));
    const box = document.createElement('div');
    box.className = 'md';
    box.innerHTML = html;
    $$('pre code', box).forEach(code => {
      try { hljs.highlightElement(code); } catch { /* unknown language */ }
      const btn = document.createElement('button');
      btn.className = 'copy-code';
      btn.textContent = 'Копировать';
      btn.onclick = () => navigator.clipboard.writeText(code.innerText).then(() => { btn.textContent = 'Скопировано'; setTimeout(() => (btn.textContent = 'Копировать'), 1500); });
      code.parentElement.append(btn);
    });
    $$('a', box).forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
    return box;
  }

  // ---------------------------------------------------------------- auth — вход и регистрация
  const SOCIAL_ICON = {
    google: '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>',
    github: '<svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
    apple: '<svg viewBox="0 0 384 512" width="16" height="18" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>',
  };
  const socialTitle = p => (p === 'github' ? 'GitHub' : p[0].toUpperCase() + p.slice(1));
  const socialButtons = (prefix, providers) => providers.length ? `
    <div class="social-sep"><span>${prefix}</span></div>
    <div class="social-btns">${providers.map(p => `<a class="btn social-btn social-${p.name}" href="/auth/${p.name}?client=web">${SOCIAL_ICON[p.name] || ''}<span>${esc(p.title)}</span></a>`).join('')}</div>` : '';

  // ---------------------------------------------------------------- forgotten password — «Забыли пароль?»
  // Окно «Забыли пароль?»: email → POST /api/forgot-password → письмо со ссылкой.
  function forgotModal(email = '') {
    modal(`
      <h2>Восстановление пароля</h2>
      <p class="muted" style="margin-top:0">Укажите email аккаунта — мы пришлём письмо со ссылкой для нового пароля.</p>
      <form id="forgot-form">
        <label class="field"><span>Email</span><input class="input" type="email" name="email" required value="${esc(email)}"></label>
        <div class="error-text" id="forgot-err"></div>
        <button class="btn btn-primary btn-lg" style="width:100%" type="submit">Отправить письмо</button>
      </form>
      <p class="muted small" style="text-align:center;margin:14px 0 0"><a href="#" id="forgot-back">← Вернуться ко входу</a></p>`);
    $('#forgot-back').onclick = e => { e.preventDefault(); authModal('login'); };
    $('#forgot-form').onsubmit = async e => {
      e.preventDefault();
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true;
      $('#forgot-err').textContent = '';
      try {
        const res = await api('POST', '/forgot-password', { email: $('[name=email]', e.target).value.trim() });
        $('#forgot-form').outerHTML = `<div class="card" style="text-align:center"><div style="font-size:40px">📬</div><p style="margin:8px 0 0">${esc(res.message)}</p></div>`;
      } catch (err) {
        $('#forgot-err').textContent = Object.values(err.errors).flat()[0] || err.message;
        btn.disabled = false;
      }
    };
  }

  // The letter's link opens /#/reset?token=…&email=…
  // Окно «Новый пароль» по ссылке из письма: POST /api/reset-password → сразу вход.
  function resetModal(token, email) {
    modal(`
      <h2>Новый пароль</h2>
      <p class="muted" style="margin-top:0">Для аккаунта <b>${esc(email)}</b></p>
      <form id="reset-form">
        <label class="field"><span>Новый пароль (не короче 8 символов)</span><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password"></label>
        <label class="field"><span>Повторите пароль</span><input class="input" type="password" name="password_confirmation" required minlength="8" autocomplete="new-password"></label>
        <div class="error-text" id="reset-err"></div>
        <button class="btn btn-primary btn-lg" style="width:100%" type="submit">Сохранить и войти</button>
      </form>`);
    $('#reset-form').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (f.password !== f.password_confirmation) { $('#reset-err').textContent = 'Пароли не совпадают'; return; }
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true;
      try {
        const res = await api('POST', '/reset-password', { ...f, token, email });
        state.token = res.token;
        store.set('token', res.token);
        $('#modal-root').innerHTML = '';
        await loadMe();
        toast('Пароль изменён. На других устройствах нужно войти заново.', 'ok');
        location.hash = '#/chat';
      } catch (err) {
        $('#reset-err').textContent = Object.values(err.errors).flat()[0] || err.message;
        btn.disabled = false;
      }
    };
  }

  // The installer has no paid code-signing certificate yet, so Windows SmartScreen warns on first run.
  // Explain right away what to press, while the download goes on.
  document.addEventListener('click', e => {
    if (!e.target.closest('a[href*="/downloads/"]')) return;
    setTimeout(() => modal(`
      <div style="text-align:center"><img src="/img/icons/download.png" alt="" style="width:72px;height:72px"></div>
      <h2 style="text-align:center;margin-top:6px">Установщик скачивается</h2>
      <p class="muted" style="margin-top:0">Откройте файл <b>MansurAI-Setup.exe</b> из загрузок. Если Windows покажет синее окно <b>«Система Windows защитила ваш компьютер»</b> — это нормально для новых программ без платной цифровой подписи:</p>
      <ol class="install-steps">
        <li>нажмите ссылку <b>«Подробнее»</b>;</li>
        <li>появится кнопка <b>«Выполнить в любом случае»</b> — нажмите её;</li>
        <li>установка займёт около минуты, ярлык Mansur AI появится на рабочем столе.</li>
      </ol>
      <p class="muted small">Приложение не содержит вирусов: это тот же Mansur AI, что и сайт. Предупреждение исчезнет, когда у установщика появится цифровая подпись.</p>
      <button class="btn btn-primary btn-lg" style="width:100%" data-close>Понятно</button>`), 400);
  });

  // Open site tab says "I'm here" once a minute so the admin sees who is online.
  setInterval(() => {
    if (state.token && document.visibilityState === 'visible') api('POST', '/ping').catch(() => {});
  }, 60000);

  // Result of the Google / GitHub / Apple redirect: /?oauth_code=… or /?oauth_error=…
  // Завершение входа через Google/GitHub: одноразовый код из адреса → POST /api/oauth/exchange → токен.
  async function finishSocialLogin() {
    const params = new URLSearchParams(location.search);
    const code = params.get('oauth_code'), error = params.get('oauth_error');
    if (!code && !error) return;
    history.replaceState(null, '', location.pathname + '#/');
    if (error) { toast(error, 'err'); return; }
    try {
      const res = await api('POST', '/oauth/exchange', { code });
      state.token = res.token;
      store.set('token', res.token);
      toast(`Добро пожаловать, ${res.user.name}!`, 'ok');
      // No hashchange here: boot() loads the profile first and then renders the chat itself.
      history.replaceState(null, '', location.pathname + '#/chat');
    } catch (err) { toast(err.message, 'err'); }
  }

  // Выйти на этом устройстве: забыть токен и данные пользователя.
  function logoutLocal() {
    state.token = null; state.user = null; state.chat = null; state.chats = [];
    store.del('token');
    store.del('appearance');
    store.del('background');
    MansurTheme.apply(null, {});
    location.hash = '#/';
    render();
  }

  // Загрузить профиль и лимиты (GET /api/me); если токен недействителен — пользователь станет гостем.
  async function loadMe() {
    if (!state.token) return;
    try {
      const me = await api('GET', '/me');
      state.user = me.user;
      applyDesign(state.user);
      state.usage = me.usage;
      await loadTeam();
    } catch { /* handled in api() */ }
  }

  // Окно входа / регистрации (POST /api/login или /api/register), кнопки «Войти через Google/GitHub».
  function authModal(mode = 'login') {
    const isLogin = mode === 'login';
    modal(`
      <h2>${isLogin ? 'Вход в Mansur AI' : 'Регистрация'}</h2>
      <form id="auth-form">
        ${isLogin ? '' : '<label class="field"><span>Имя</span><input class="input" name="name" required maxlength="100"></label>'}
        <label class="field"><span>Email</span><input class="input" type="email" name="email" required></label>
        <label class="field"><span>Пароль ${isLogin ? '' : '(не короче 8 символов)'}</span><input class="input" type="password" name="password" required minlength="${isLogin ? 1 : 8}"></label>
        ${isLogin ? '<p class="small" style="margin:-6px 0 10px;text-align:right"><a href="#" id="auth-forgot">Забыли пароль?</a></p>' : ''}
        <div class="error-text" id="auth-err"></div>
        <button class="btn btn-primary btn-lg" style="width:100%" type="submit">${isLogin ? 'Войти' : 'Создать аккаунт бесплатно'}</button>
      </form>
      ${socialButtons(isLogin ? 'или войдите через' : 'или зарегистрируйтесь через', state.social)}
      <p class="muted small" style="text-align:center;margin:14px 0 0">
        ${isLogin ? 'Нет аккаунта? <a href="#" id="auth-switch">Зарегистрироваться</a>' : 'Уже есть аккаунт? <a href="#" id="auth-switch">Войти</a>'}
      </p>`);
    $('#auth-switch').onclick = e => { e.preventDefault(); authModal(isLogin ? 'register' : 'login'); };
    $('#auth-forgot')?.addEventListener('click', e => { e.preventDefault(); forgotModal($('[name=email]', $('#auth-form')).value.trim()); });
    $('#auth-form').onsubmit = async e => {
      e.preventDefault();
      const btn = $('button[type=submit]', e.target);
      btn.disabled = true;
      $('#auth-err').textContent = '';
      try {
        const data = Object.fromEntries(new FormData(e.target));
        const res = await api('POST', isLogin ? '/login' : '/register', { ...data, client: 'web' });
        state.token = res.token;
        store.set('token', res.token);
        $('#modal-root').innerHTML = '';
        await loadMe();
        toast(isLogin ? `С возвращением, ${res.user.name}!` : 'Аккаунт создан. Добро пожаловать!', 'ok');
        location.hash = '#/chat';
      } catch (err) {
        $('#auth-err').textContent = Object.values(err.errors).flat()[0] || err.message;
      } finally { btn.disabled = false; }
    };
  }

  // Окно профиля: смена имени и пароля (PATCH /api/me), выход на всех устройствах.
  function profileModal() {
    const u = state.user;
    modal(`
      <h2>Профиль</h2>
      <div class="user-chip" style="padding:0 0 14px"><div class="avatar">${esc(initials(u.name))}</div><div><b>${esc(u.name)}</b><div class="muted small">${esc(u.email)}${u.role === 'admin' ? ' · администратор' : ''}</div></div></div>
      <form id="pf-form">
        <label class="field"><span>Имя</span><input class="input" name="name" value="${esc(u.name)}" maxlength="100"></label>
        ${u.social?.length ? `<p class="muted small" style="margin:0 0 12px">Вход через: ${u.social.map(p => `<span class="social-chip">${SOCIAL_ICON[p] || ''} ${socialTitle(p)}</span>`).join(' ')}</p>` : ''}
        ${u.has_password === false
          ? '<label class="field"><span>Задать пароль (чтобы входить и по email)</span><input class="input" type="password" name="password" minlength="8"></label>'
          : `<label class="field"><span>Текущий пароль (для смены пароля)</span><input class="input" type="password" name="current_password"></label>
        <label class="field"><span>Новый пароль</span><input class="input" type="password" name="password" minlength="8"></label>`}
        <div class="error-text" id="pf-err"></div>
        <div class="modal-actions" style="justify-content:space-between">
          <button type="button" class="btn btn-ghost btn-danger" id="pf-all">Выйти на всех устройствах</button>
          <button class="btn btn-primary" type="submit">Сохранить</button>
        </div>
      </form>`);
    $('#pf-form').onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v));
      try {
        const res = await api('PATCH', '/me', data);
        state.user = res.data;
        $('#modal-root').innerHTML = '';
        toast('Профиль сохранён', 'ok');
        render();
      } catch (err) { $('#pf-err').textContent = Object.values(err.errors).flat()[0] || err.message; }
    };
    $('#pf-all').onclick = async () => {
      if (!(await confirmBox('Завершить все сеансы, включая Windows-приложение?', 'Выйти везде'))) return;
      await api('POST', '/logout-all').catch(() => {});
      logoutLocal();
    };
  }

  // ---------------------------------------------------------------- landing — главная страница для гостей
  const ICON = { text: '💬', image: '🎨', coder: '👨‍💻' };
  // 3D icons (the same set as in the Windows app); emoji stay only inside <select>, which cannot show pictures.
  const ico = (name, cls = 'ico3d') => `<img class="${cls}" src="/img/icons/${name}.png" alt="">`;
  const modelEmoji = m => m.slug?.includes('coder') ? ICON.coder : (ICON[m.type] || '🤖');
  const modelIcon = m => ico(m.slug?.includes('coder') ? 'code' : m.type === 'image' ? 'image' : m.type === 'agent' ? 'agent' : 'chat');

  // Кнопка «Скачать для Windows» (неактивна, если установщика нет на сервере).
  function downloadButton(cls = 'btn-lg') {
    const a = state.appInfo;
    if (a?.available) {
      return `<a class="btn btn-primary ${cls}" href="${esc(a.download_url)}" download>${ico('download', 'btn-ico')} Скачать для Windows <span class="small" style="opacity:.8">v${esc(a.version)} · ${a.size_mb} МБ</span></a>`;
    }
    return `<button class="btn ${cls}" disabled>${ico('download', 'btn-ico')} Приложение для Windows — скоро</button>`;
  }

  // Главная страница для гостя: возможности, команда агентов, нейросети, скачивание приложения.
  function renderLanding() {
    const logged = !!state.user;
    $('#app').innerHTML = `
      <nav class="nav">
        <a class="logo" href="#/"><img src="/favicon.svg" alt="">Mansur AI</a>
        <div class="nav-links">
          <a class="btn btn-ghost" href="#models">Нейросети</a>
          <a class="btn btn-ghost" href="#features">Возможности</a>
          <a class="btn btn-ghost" href="#team">Агенты</a>
          <a class="btn btn-ghost" href="#download">Приложение</a>
        </div>
        <div class="spacer"></div>
        ${logged ? `<span class="muted small">Вы вошли как <b>${esc(state.user.name)}</b></span>
            ${state.user.role === 'admin' ? `<a class="btn" href="#/admin">${ico('settings', 'btn-ico')} Админ-панель</a>` : ''}
            <button class="btn btn-ghost" id="nav-logout">Выйти</button>
            <a class="btn btn-primary" href="#/chat">Открыть чат</a>`
          : `<button class="btn" id="login">Войти</button><button class="btn btn-primary" id="signup">Начать бесплатно</button>`}
      </nav>

      <header class="hero">
        <span class="badge-pill">✨ Бесплатно · без подписки · на русском</span>
        <h1>Все нейросети<br><span class="grad-text">в одном месте</span></h1>
        <p class="lead">Общайтесь с разными нейросетями, создавайте изображения и пишите код — бесплатно. А ИИ-агент для Windows сам выполнит задачу на вашем компьютере: создаст сайт, запустит и исправит ошибки.</p>
        <div class="cta">
          <button class="btn btn-primary btn-lg" id="hero-start">Начать общение →</button>
          ${downloadButton()}
        </div>
      </header>

      <section class="section" id="models">
        <h2>Нейросети</h2>
        <p class="muted">Переключайтесь между моделями прямо в чате — история сохраняется.</p>
        <div class="grid" id="model-grid">${state.models.map(m => `
          <div class="card model-card" data-model="${m.id}">
            <div class="ico">${modelIcon(m)}</div>
            <h3>${esc(m.name)}</h3>
            <p>${esc(m.description || '')}</p>
            <div style="margin-top:12px"><span class="tag">${esc(m.provider_title || m.provider)}</span> <span class="tag">${m.type === 'image' ? 'Изображения' : 'Текст и код'}</span> <span class="tag">${m.daily_limit}/день бесплатно</span></div>
          </div>`).join('') || '<p class="muted">Загрузка…</p>'}
        </div>
      </section>

      <section class="section" id="features">
        <h2>Возможности</h2>
        <p class="muted">Сайт и приложение работают с одним аккаунтом — чаты и задачи синхронизируются.</p>
        <div class="grid">
          ${[
            ['swap', 'Переключение моделей', 'Начните с одной нейросети и продолжите с другой в том же чате.'],
            ['image', 'Генерация изображений', 'Опишите картинку словами — и скачайте результат.'],
            ['code', 'Код с подсветкой', 'Ответы в Markdown, подсветка синтаксиса, копирование в один клик.'],
            ['mic', 'Голосовой ввод', 'Надиктуйте вопрос вместо набора текста.'],
            ['search', 'Поиск по чатам', 'Ищите по названию и тексту сообщений, фильтруйте по модели.'],
            ['export', 'Экспорт чата', 'Сохраните переписку в файл Markdown.'],
            ['agent', 'ИИ-агент для Windows', 'Создаёт файлы и сайты, запускает PowerShell, сам исправляет ошибки.'],
            ['tasks', 'Задачи с сайта на ПК', 'Поставьте задачу на сайте — приложение выполнит её на компьютере.'],
            ['shield', 'Безопасно для всех', 'Фильтр мата и контента 18+ — для текста и картинок.'],
          ].map(([i, t, d]) => `<div class="card feature"><div class="ico">${ico(i)}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
        </div>
      </section>

      <section class="section" id="team">
        <h2>Команда ИИ-агентов</h2>
        <p class="muted">Первый агент — бесплатно. Добавьте ещё, и они будут выполнять разные задачи одновременно или вместе возьмутся за одну большую.</p>
        <div class="stage-wrap landing-stage"><canvas id="landing-stage"></canvas><div class="stage-hint">Наведите курсор — агенты смотрят на вас 👀</div></div>
        <div class="team-grid">${(state.team?.agents || []).map(a => `
          <div class="agent-card showcase" style="--ac:${a.color}">
            <div class="agent-art"><img src="${a.image}" alt="${esc(a.name)}"></div>
            <h3>${esc(a.name)}</h3><div class="agent-sub">${esc(a.title)}</div>
            <div class="agent-price">${a.price ? tenge(a.price) : 'Бесплатно'}</div>
          </div>`).join('')}
        </div>
        <div class="cta" style="margin-top:22px;justify-content:center;display:flex"><button class="btn btn-primary btn-lg" id="team-start">Собрать команду →</button></div>
      </section>

      <section class="section" id="download">
        <div class="download">
          <div style="position:relative">
            <span class="badge-pill">🪟 Windows 10 / 11</span>
            <h2 style="margin-top:14px">Mansur AI для Windows</h2>
            <p class="muted">ИИ-агент, который работает прямо на вашем компьютере:</p>
            <ul>
              <li>создаёт и редактирует файлы и папки;</li>
              <li>пишет код и целые сайты;</li>
              <li>запускает команды PowerShell и локальный сервер;</li>
              <li>создаёт изображения и сохраняет их в проект;</li>
              <li>сам находит и исправляет ошибки, пока задача не будет готова.</li>
            </ul>
            <div class="row" style="margin-top:18px">${downloadButton()}</div>
            <p class="muted small" style="margin-top:10px">Опасные команды (удаление файлов и т. п.) агент выполняет только после вашего подтверждения.</p>
          </div>
          <div class="terminal">
            <div class="t-dim"># Задача: «Сделай сайт-портфолио и запусти его»</div>
            <div><span class="t-cmd">✎ write_file</span> portfolio/index.html</div>
            <div><span class="t-cmd">✎ write_file</span> portfolio/style.css</div>
            <div><span class="t-cmd">✎ generate_image</span> portfolio/hero.jpg</div>
            <div><span class="t-cmd">▶ start_process</span> python -m http.server 5500</div>
            <div><span class="t-cmd">⌕ check_url</span> http://localhost:5500 → 200</div>
            <div class="t-ok">✔ Готово: сайт запущен на http://localhost:5500</div>
          </div>
        </div>
      </section>

      <footer class="footer">© ${new Date().getFullYear()} Mansur AI · Бесплатные нейросети для всех · <a href="/docs" target="_blank">API для разработчиков</a> · <a href="/privacy" target="_blank">Конфиденциальность</a></footer>`;

    $('#login')?.addEventListener('click', () => authModal('login'));
    $('#nav-logout')?.addEventListener('click', async () => { await api('POST', '/logout').catch(() => {}); logoutLocal(); });
    $('#signup')?.addEventListener('click', () => authModal('register'));
    $('#hero-start').onclick = () => (state.user ? (location.hash = '#/chat') : authModal('register'));
    $('#team-start').onclick = () => (state.user ? (location.hash = '#/agents') : authModal('register'));
    if (state.team) mount3d($('#landing-stage'), { agents: state.team.agents.map(a => ({ slug: a.slug })) });
    renderDock();
    $$('.model-card').forEach(c => c.onclick = () => {
      state.modelId = +c.dataset.model; store.set('model', state.modelId);
      state.user ? (location.hash = '#/chat') : authModal('register');
    });
  }

  // ---------------------------------------------------------------- app layout — каркас приложения: боковое меню и список чатов
  // Каркас приложения после входа: левое меню (новый чат, поиск, фильтр, разделы) и основная область.
  function renderLayout(page) {
    const u = state.user;
    $('#app').innerHTML = `
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-head">
            <div class="row" style="justify-content:space-between">
              <a class="logo" href="#/"><img src="/favicon.svg" alt="">Mansur AI</a>
              <button class="btn btn-ghost icon-btn mobile-only" id="side-close">✕</button>
            </div>
            <button class="btn btn-primary" id="new-chat">＋ Новый чат</button>
            <input class="input" id="chat-q" placeholder="🔎 Поиск по чатам" value="${esc(state.filters.q)}">
            <select class="select" id="chat-filter">
              <option value="">Все нейросети</option>
              ${state.models.map(m => `<option value="${m.id}" ${+state.filters.model === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select>
          </div>
          <div class="chat-list" id="chat-list"></div>
          <div class="sidebar-foot">
            <a class="side-link" href="#/agents"><span class="mini-team">${(state.team?.agents || []).filter(a => a.owned).map(a => `<i style="--ac:${a.color}" title="${esc(a.name)}"><img src="${a.image}" alt=""></i>`).join('')}</span>Команда агентов <span class="side-count">${state.team ? state.team.owned + '/' + state.team.max : ''}</span></a>
            <a class="side-link" href="#/tasks">${ico('tasks', 'side-ico')} Задачи агенту</a>
            <a class="side-link" href="#/design">${ico('style', 'side-ico')} Оформление</a>
            ${u.role === 'admin' ? `<a class="side-link" href="#/admin">${ico('settings', 'side-ico')} Админ-панель</a>` : ''}
            <a class="side-link" href="#/" >${ico('download', 'side-ico')} Скачать приложение</a>
            <div class="row" style="justify-content:space-between">
              <button class="side-link" id="profile" style="flex:1"><div class="avatar">${esc(initials(u.name))}</div><span style="overflow:hidden;text-overflow:ellipsis">${esc(u.name)}</span></button>
              <button class="btn btn-ghost icon-btn" id="logout" title="Выйти">⏻</button>
            </div>
          </div>
        </aside>
        <main class="main" id="main"></main>
      </div>`;

    $('#profile').onclick = profileModal;
    $('#logout').onclick = async () => { await api('POST', '/logout').catch(() => {}); logoutLocal(); };
    $('#new-chat').onclick = () => {
      closeSidebar();
      if (location.hash === '#/chat') openNewChat();
      else location.hash = '#/chat';
    };
    $('#side-close').onclick = closeSidebar;
    renderDock();
    $('#chat-q').oninput = debounce(e => { state.filters.q = e.target.value.trim(); loadChats(); }, 300);
    $('#chat-filter').onchange = e => { state.filters.model = e.target.value; loadChats(); };
    loadChats();
  }
  const closeSidebar = () => $('#sidebar')?.classList.remove('open');
  const menuButton = '<button class="btn btn-ghost icon-btn mobile-only" id="side-open">☰</button>';
  const bindMenu = () => { const b = $('#side-open'); if (b) b.onclick = () => $('#sidebar').classList.add('open'); };

  // Загрузить список чатов с учётом поиска и фильтра (GET /api/chats?q=&ai_model_id=).
  async function loadChats() {
    const p = new URLSearchParams();
    if (state.filters.q) p.set('q', state.filters.q);
    if (state.filters.model) p.set('ai_model_id', state.filters.model);
    try {
      const res = await api('GET', '/chats?' + p);
      state.chats = res.data;
      renderChatList();
    } catch (e) { toast(e.message, 'err'); }
  }

  // Нарисовать список чатов в меню, сгруппированный по датам (Сегодня, Вчера…).
  function renderChatList() {
    const list = $('#chat-list');
    if (!list) return;
    if (!state.chats.length) {
      list.innerHTML = `<p class="muted small" style="padding:10px">${state.filters.q || state.filters.model ? 'Ничего не найдено' : 'Чатов пока нет — начните новый'}</p>`;
      return;
    }
    const today = new Date().toDateString();
    const groups = { 'Сегодня': [], 'Ранее': [] };
    state.chats.forEach(c => groups[new Date(c.updated_at).toDateString() === today ? 'Сегодня' : 'Ранее'].push(c));
    list.innerHTML = Object.entries(groups).filter(([, a]) => a.length).map(([g, arr]) => `
      <div class="group-label">${g}</div>
      ${arr.map(c => `
        <div class="chat-item ${state.chat?.id === c.id ? 'active' : ''}" data-id="${c.id}" title="${esc(c.title)}">
          <span>${c.model ? modelIcon(c.model) : ico('chat')}</span>
          <span class="t">${esc(c.title)}</span>
          <span class="acts"><button data-rename="${c.id}" title="Переименовать">✎</button><button data-delete="${c.id}" title="Удалить">🗑</button></span>
        </div>`).join('')}`).join('');

    $$('.chat-item', list).forEach(el => el.onclick = e => {
      if (e.target.closest('[data-rename],[data-delete]')) return;
      closeSidebar();
      location.hash = '#/chat/' + el.dataset.id;
    });
    $$('[data-rename]', list).forEach(b => b.onclick = async () => {
      const chat = state.chats.find(c => c.id === +b.dataset.rename);
      const title = await promptBox('Переименовать чат', chat.title);
      if (!title) return;
      await api('PATCH', `/chats/${chat.id}`, { title }).catch(e => toast(e.message, 'err'));
      if (state.chat?.id === chat.id) { state.chat.title = title; $('#chat-title') && ($('#chat-title').textContent = title); }
      loadChats();
    });
    $$('[data-delete]', list).forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Удалить чат вместе с сообщениями?'))) return;
      const id = +b.dataset.delete;
      await api('DELETE', `/chats/${id}`).catch(e => toast(e.message, 'err'));
      if (state.chat?.id === id) location.hash = '#/chat';
      loadChats();
    });
  }

  // ---------------------------------------------------------------- chat page — страница чата (ключевой сценарий 1 на стороне клиента)
  const TEMPLATES = {
    text: [
      ['Объясни просто', 'Объясни простыми словами, как работает нейросеть'],
      ['Составь план', 'Составь план подготовки к экзамену по программированию на 2 недели'],
      ['Напиши текст', 'Напиши короткое поздравление с днём рождения для друга'],
      ['Переведи', 'Переведи на английский: «Я хочу создать свою ИИ-платформу»'],
    ],
    coder: [
      ['Сайт-визитка', 'Напиши HTML и CSS для красивого сайта-визитки в одном файле'],
      ['Найди ошибку', 'Найди ошибку в коде на PHP: echo "Привет" . $name'],
      ['Laravel API', 'Покажи, как сделать CRUD-контроллер в Laravel для модели Product'],
      ['Объясни код', 'Объясни, что делает этот код: [1,2,3].map(x => x * 2)'],
    ],
    image: [
      ['Космос', 'Кот-астронавт в открытом космосе, цифровая живопись'],
      ['Город будущего', 'Футуристический город ночью, неоновые огни, дождь'],
      ['Логотип', 'Минималистичный логотип для ИИ-компании, фиолетовый градиент'],
      ['Пейзаж', 'Горное озеро на рассвете, реалистичное фото'],
    ],
  };

  // <option>s grouped by provider, like model pickers on other AI aggregators.
  // Варианты выпадающего списка нейросетей (в <select> нельзя картинки, поэтому эмодзи).
  function modelOptions(selectedId) {
    const groups = {};
    state.models.forEach(m => (groups[m.provider_title || m.provider] ||= []).push(m));
    return Object.entries(groups).map(([title, list]) => `<optgroup label="${esc(title)}">${list.map(m =>
      `<option value="${m.id}" ${m.id === selectedId ? 'selected' : ''}>${modelEmoji(m)} ${esc(m.name)}</option>`).join('')}</optgroup>`).join('');
  }

  const currentModel = () => state.models.find(m => m.id === state.modelId) || state.models[0];
  const remainingFor = id => state.usage.find(u => u.ai_model_id === id)?.remaining;

  // Страница чата: заголовок, выбор нейросети, остаток лимита, сообщения и поле ввода.
  function renderChatPage() {
    const model = currentModel();
    if (model) state.modelId = model.id;
    $('#main').innerHTML = `
      <div class="topbar">
        ${menuButton}
        <div class="title" id="chat-title">${esc(state.chat?.title || 'Новый чат')}</div>
        <span class="limit-chip" id="limit-chip"></span>
        <select class="select model-select" id="model-select" title="Нейросеть">
          ${modelOptions(state.modelId)}
        </select>
        <button class="btn btn-ghost icon-btn" id="export" title="Экспорт в Markdown" ${state.chat ? '' : 'disabled'}>⤓</button>
      </div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <div class="composer-box">
          <textarea id="input" rows="1" placeholder="Спросите что-нибудь…" maxlength="8000"></textarea>
          <button class="btn btn-ghost icon-btn mic" id="mic" title="Голосовой ввод">🎙</button>
          <button class="btn btn-primary icon-btn" id="send" title="Отправить">➤</button>
        </div>
        <div class="hint">Enter — отправить, Shift+Enter — новая строка. Нейросети могут ошибаться. Мат и контент 18+ запрещены.</div>
      </div>`;
    bindMenu();
    renderMessages();
    updateLimitChip();

    const input = $('#input');
    const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 220) + 'px'; };
    input.addEventListener('input', autosize);
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    $('#send').onclick = () => send();
    $('#model-select').onchange = async e => {
      state.modelId = +e.target.value;
      store.set('model', state.modelId);
      updateLimitChip();
      if (!state.chat?.messages?.length) renderMessages();
      if (state.chat) {
        await api('PATCH', `/chats/${state.chat.id}`, { ai_model_id: state.modelId }).catch(err => toast(err.message, 'err'));
        toast(`Нейросеть переключена на «${currentModel().name}». История сохранена.`);
      }
      input.placeholder = currentModel()?.type === 'image' ? 'Опишите изображение…' : 'Спросите что-нибудь…';
    };
    $('#export').onclick = exportChat;
    setupVoice();
    input.placeholder = currentModel()?.type === 'image' ? 'Опишите изображение…' : 'Спросите что-нибудь…';
    input.focus();
  }

  // Обновить плашку «Осталось сегодня: N из M».
  function updateLimitChip() {
    const chip = $('#limit-chip');
    const m = currentModel();
    if (!chip || !m) return;
    const r = remainingFor(m.id);
    chip.innerHTML = `Осталось сегодня: <b>${r ?? m.daily_limit}</b> из ${m.daily_limit}`;
  }

  // HTML одного сообщения: аватар, имя модели, время, кнопка «Копировать», картинка или Markdown.
  function messageEl(m) {
    const mine = m.role === 'user';
    const el = document.createElement('div');
    el.className = `msg ${m.role} ${m.status === 'failed' ? 'failed' : ''}`;
    el.innerHTML = `<div class="avatar">${mine ? esc(initials(state.user.name)) : '✦'}</div><div class="body"></div>`;
    const body = $('.body', el);
    if (mine) {
      body.textContent = m.content;
      if (m.status === 'failed') {
        const retry = document.createElement('div');
        retry.className = 'meta';
        retry.style.marginTop = '6px';
        retry.innerHTML = '⚠ Не отправлено <button class="mini">↻ Повторить</button>';
        $('button', retry).onclick = () => send(m.content);
        body.append(retry);
      }
      return el;
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<b>${esc(m.model_name || 'Mansur AI')}</b> <span>${fmtDate(m.created_at)}</span>`;
    body.append(meta);
    if (m.image_url) {
      body.insertAdjacentHTML('beforeend', `<a href="${esc(m.image_url)}" target="_blank" rel="noopener"><img class="msg-img" src="${esc(m.image_url)}" alt="${esc(m.content)}" loading="lazy"></a>
        <div class="meta" style="margin-top:6px"><a class="mini" href="${esc(m.image_url)}" download>⬇ Скачать</a><button class="mini" data-again>↻ Ещё вариант</button></div>`);
      $('[data-again]', body).onclick = () => send(m.content);
    } else {
      body.append(renderMarkdown(m.content));
      const copy = document.createElement('button');
      copy.className = 'mini';
      copy.textContent = '⧉ Копировать';
      copy.onclick = () => navigator.clipboard.writeText(m.content).then(() => toast('Ответ скопирован', 'ok'));
      meta.append(copy);
    }
    return el;
  }

  // Нарисовать все сообщения открытого чата и прокрутить вниз.
  function renderMessages() {
    const box = $('#messages');
    if (!box) return;
    const msgs = state.chat?.messages || [];
    if (!msgs.length) {
      const m = currentModel();
      const kind = m?.type === 'image' ? 'image' : (m?.slug?.includes('coder') ? 'coder' : 'text');
      box.innerHTML = `<div class="welcome">
        <h1>Привет, ${esc(state.user.name)}! 👋</h1>
        <p class="muted">Сейчас выбрана нейросеть <b>${esc(m?.name || '')}</b>${m?.description ? ' — ' + esc(m.description) : ''}.</p>
        <div class="templates">${TEMPLATES[kind].map(([t, p]) => `<div class="template" data-p="${esc(p)}"><b>${esc(t)}</b><span class="muted">${esc(p)}</span></div>`).join('')}</div>
      </div>`;
      $$('.template', box).forEach(t => t.onclick = () => send(t.dataset.p));
      return;
    }
    box.innerHTML = '<div class="msg-wrap" id="msg-wrap"></div>';
    const wrap = $('#msg-wrap');
    msgs.forEach(m => wrap.append(messageEl(m)));
    box.scrollTop = box.scrollHeight;
    $$('.msg-img', wrap).forEach(img => img.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, { once: true }));
  }

  // Отправить сообщение: при необходимости создать чат (POST /api/chats), затем POST /api/chats/{id}/messages; пока ждём — анимация «печатает…».
  async function send(text) {
    const input = $('#input');
    const content = (text ?? input.value).trim();
    if (!content || state.sending) return;
    const model = currentModel();
    state.sending = true;
    $('#send').disabled = true;
    if (text === undefined) { input.value = ''; input.style.height = 'auto'; }

    try {
      if (!state.chat) {
        const res = await api('POST', '/chats', { ai_model_id: model.id });
        state.chat = { ...res.data, messages: [] };
        history.replaceState(null, '', '#/chat/' + state.chat.id);
        $('#export').disabled = false;
      }
      state.chat.messages = state.chat.messages.filter(m => !(m.status === 'failed' && m.content === content));
      state.chat.messages.push({ role: 'user', content, status: 'ok' });
      renderMessages();
      const wrap = $('#msg-wrap');
      const typing = document.createElement('div');
      typing.className = 'msg assistant';
      typing.innerHTML = `<div class="avatar">✦</div><div class="body"><div class="meta"><b>${esc(model.name)}</b> ${model.type === 'image' ? 'рисует…' : 'печатает…'}</div><div class="typing"><span></span><span></span><span></span></div></div>`;
      wrap.append(typing);
      $('#messages').scrollTop = $('#messages').scrollHeight;

      const res = await api('POST', `/chats/${state.chat.id}/messages`, { content, ai_model_id: model.id });
      state.chat.messages.pop();
      state.chat.messages.push(res.user_message, res.assistant_message);
      state.chat.title = res.chat.title;
      $('#chat-title').textContent = res.chat.title;
      const u = state.usage.find(x => x.ai_model_id === model.id);
      if (u) u.remaining = res.remaining;
      updateLimitChip();
      renderMessages();
      loadChats();
    } catch (err) {
      if (state.chat?.messages?.length) {
        const last = state.chat.messages[state.chat.messages.length - 1];
        if (last.role === 'user') last.status = 'failed';
        renderMessages();
      }
      toast(err.message, 'err');
    } finally {
      state.sending = false;
      const b = $('#send');
      if (b) b.disabled = false;
    }
  }

  // Экспорт чата в файл .md (Markdown) — скачивается прямо из браузера.
  function exportChat() {
    if (!state.chat) return;
    const lines = [`# ${state.chat.title}`, ''];
    state.chat.messages.forEach(m => {
      lines.push(m.role === 'user' ? '## 🧑 Вы' : `## ✦ ${m.model_name || 'Mansur AI'}`, '');
      lines.push(m.image_url ? `![${m.content}](${m.image_url})` : m.content, '');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `mansur-chat-${state.chat.id}.md` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Голосовой ввод: кнопка микрофона через Web Speech API браузера (распознавание речи на русском).
  function setupVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = $('#mic');
    if (!SR) { mic.title = 'Голосовой ввод не поддерживается этим браузером'; mic.disabled = true; return; }
    if (!window.isSecureContext) {
      mic.title = 'Микрофон работает только по https:// или на localhost';
    }
    // Chrome on Android repeats words in continuous mode, so there each phrase is its own session.
    const android = /Android/i.test(navigator.userAgent);
    const ERR = {
      'not-allowed': 'Нет доступа к микрофону. Нажмите на значок 🔒 слева от адреса сайта и разрешите микрофон.',
      'service-not-allowed': 'Браузер запретил распознавание речи. Попробуйте Chrome или Edge.',
      'audio-capture': 'Микрофон не найден. Проверьте, что он подключён и не занят другой программой.',
      network: 'Распознавание речи недоступно: нет связи с сервисом браузера. Используйте Chrome или Edge с интернетом.',
      'language-not-supported': 'Браузер не умеет распознавать русскую речь. Попробуйте Chrome или Edge.',
    };
    let rec = null, keep = false, silence = null;
    const input = () => $('#input');
    const stop = () => { keep = false; clearTimeout(silence); rec?.stop(); };
    const setText = text => {
      const el = input();
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true })); // grow the box, enable "send"
    };

    // Слушать микрофон и вставлять распознанный текст в поле ввода; автостоп после 3 секунд тишины.
    function listen(base) {
      rec = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = !android;
      rec.maxAlternatives = 1;
      let finals = '';
      rec.onresult = e => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finals += (finals && !/^\s/.test(t) ? ' ' : '') + t;
          else interim += t;
        }
        setText([base, finals, interim].map(s => s.trim()).filter(Boolean).join(' '));
        // three seconds of silence end the dictation
        clearTimeout(silence);
        silence = setTimeout(stop, 3000);
      };
      rec.onerror = e => {
        if (e.error === 'no-speech') { toast('Ничего не услышал — говорите чуть громче или ближе к микрофону', ''); }
        else if (e.error !== 'aborted') toast(ERR[e.error] || 'Микрофон: ' + e.error, 'err');
        keep = false;
      };
      rec.onend = () => {
        const text = input().value;
        if (keep) { listen(text); return; } // Android: continue with the next phrase
        rec = null;
        clearTimeout(silence);
        mic.classList.remove('on');
        mic.title = 'Голосовой ввод';
        input().placeholder = input().dataset.ph || input().placeholder;
        input().focus();
      };
      try { rec.start(); } catch { /* already started */ }
    }

    mic.onclick = () => {
      if (rec) { stop(); return; }
      if (!window.isSecureContext) { toast('Микрофон работает только на защищённом адресе https:// (или на localhost).', 'err'); return; }
      keep = true;
      mic.classList.add('on');
      mic.title = 'Нажмите, чтобы остановить';
      const el = input();
      el.dataset.ph = el.placeholder;
      el.placeholder = '🎙 Слушаю… говорите';
      listen(el.value);
      silence = setTimeout(stop, 8000); // nothing said at all
    };
  }

  // Открыть пустой новый чат (сам чат создастся при первом сообщении).
  function openNewChat() {
    state.chat = null;
    renderChatPage();
    renderChatList();
  }

  // Открыть существующий чат с сообщениями (GET /api/chats/{id}).
  async function openChat(id) {
    try {
      const res = await api('GET', '/chats/' + id);
      state.chat = res.data;
      if (state.chat.ai_model_id && state.models.some(m => m.id === state.chat.ai_model_id)) state.modelId = state.chat.ai_model_id;
      renderChatPage();
      renderChatList();
    } catch (e) {
      toast(e.message, 'err');
      location.hash = '#/chat';
    }
  }

  // ---------------------------------------------------------------- agent team — команда ИИ-агентов (3D-персонажи)
  // Загрузить команду агентов (GET /api/agents).
  async function loadTeam() {
    state.team = await api('GET', '/agents').catch(() => state.team);
    renderDock();
  }

  // 3D scenes are loaded on demand; without WebGL the PNG pictures stay.
  let agents3d = null;
  // Показать 3D-модель агента на canvas (подгружает agents3d.js и three.js только когда нужно).
  async function mount3d(canvas, opts) {
    if (!canvas) return null;
    try {
      agents3d ||= await import('/js/agents3d.js');
      if (!canvas.isConnected) return null;
      const stage = agents3d.createStage(canvas, opts);
      canvas.closest('.stage-wrap')?.classList.add('ready');
      return stage;
    } catch (e) {
      console.warn('3D недоступно:', e.message);
      return null;
    }
  }
  const workingMap = () => Object.fromEntries((state.team?.agents || []).map(a => [a.slug, !!a.task]));

  // Owned agents live in the corner of every page and show what they are busy with.
  // Плашка агентов в правом нижнем углу: кто свободен, кто чем занят.
  function renderDock() {
    let dock = $('#agent-dock');
    const owned = (state.team?.agents || []).filter(a => a.owned);
    if (!state.user || !owned.length) { dock?.remove(); return; }
    if (!dock) {
      dock = document.createElement('div');
      dock.id = 'agent-dock';
      document.body.append(dock);
    }
    const hidden = store.get('dock_hidden', false);
    dock.className = 'agent-dock' + (hidden ? ' collapsed' : '');
    dock.innerHTML = `
      <button class="dock-toggle" title="${hidden ? 'Показать команду' : 'Свернуть'}">${hidden ? '<img class="dock-ico" src="/img/icons/team.png" alt="">' : '›'}</button>
      ${owned.map((a, i) => `
        <a class="dock-agent ${a.task ? 'working' : ''}" href="#/agents" style="--ac:${a.color};--i:${i}" title="${esc(a.name)}${a.task ? ' — ' + esc(a.task.title) : ' — свободен'}">
          ${a.task ? `<span class="dock-bubble">⚙ ${esc(a.task.title)}</span>` : ''}
          <img src="${a.image}" alt="${esc(a.name)}">
          <span class="dock-name">${esc(a.name)}</span>
        </a>`).join('')}`;
    $('.dock-toggle', dock).onclick = () => { store.set('dock_hidden', !hidden); renderDock(); };
  }
  setInterval(async () => {
    if (!state.user || document.hidden) return;
    const before = JSON.stringify(workingMap());
    await loadTeam();
    if (JSON.stringify(workingMap()) !== before) { renderDock(); state.teamStage?.setWorking(workingMap()); }
  }, 8000);

  // Картинка-аватар агента по номеру слота.
  function agentAvatar(slot) {
    const a = state.team?.agents.find(x => x.slot === slot);
    return a ? `<img class="task-agent" src="${a.image}" alt="${esc(a.name)}" title="Выполнял(а): ${esc(a.name)}">` : '';
  }

  // Карточка агента: имя, описание, цена, куплен / купить.
  function agentCard(a) {
    const status = a.task
      ? `<div class="agent-status busy">⚙ Работает: «${esc(a.task.title)}»</div>`
      : '<div class="agent-status free">● Свободен</div>';
    const prev = state.team.agents.find(x => x.slot === a.slot - 1);
    return `
      <div class="agent-card ${a.owned ? 'owned' : 'locked'} ${a.next ? 'next' : ''} ${a.task ? 'working' : ''}" style="--ac:${a.color}" data-slot="${a.slot}">
        <span class="agent-num">#${a.slot}</span>
        <div class="agent-art"><img src="${a.image}" alt="${esc(a.name)}">${a.owned ? '' : '<span class="agent-lock">🔒</span>'}</div>
        <h3>${esc(a.name)}</h3><div class="agent-sub">${esc(a.title)}</div>
        <p>${esc(a.description)}</p>
        ${a.owned ? status + (a.price ? '' : '<div class="agent-price">Бесплатно</div>')
          : a.next ? `<button class="btn btn-primary agent-buy" data-buy="${a.slot}">Добавить за ${tenge(a.price)}</button>`
          : `<div class="agent-price">${tenge(a.price)}</div><div class="muted small">Откроется после агента ${esc(prev?.name || '')}</div>`}
      </div>`;
  }

  // Страница «Команда агентов»: все 5 агентов и покупка следующего.
  async function renderAgentsPage(joined = 0) {
    await loadTeam();
    const t = state.team;
    if (!$('#main') || !t) return;
    $('#main').innerHTML = `
      <div class="topbar">${menuButton}<div class="title"><img class="title-ico" src="/img/icons/team.png" alt=""> Команда агентов</div></div>
      <div class="page"><div class="page-inner">
        <div class="card team-head">
          <div>
            <h2 style="margin:0 0 6px">У вас ${t.owned} из ${t.max} агентов</h2>
            <p>Каждый агент — это отдельный исполнитель в Windows-приложении. Агенты работают одновременно: пока один делает сайт, другой пишет отчёт. Покупка разовая — агент остаётся с вами навсегда.</p>
          </div>
          <div class="team-dots">${t.agents.map(a => `<i class="${a.owned ? 'on' : ''}" style="--ac:${a.color}"></i>`).join('')}</div>
        </div>
        <div class="stage-wrap team-stage"><canvas id="team-stage"></canvas>
          <div class="stage-hint">Покрутите команду мышкой · агенты следят за курсором</div></div>
        <div class="team-grid">${t.agents.map(agentCard).join('')}</div>
        <div class="row" style="margin-top:18px;justify-content:space-between">
          <a class="btn" href="#/tasks">📋 Поставить задачу агентам</a>${downloadButton('')}
        </div>
      </div></div>`;
    bindMenu();
    if (joined) $(`.agent-card[data-slot="${joined}"]`)?.classList.add('just-joined');
    mount3d($('#team-stage'), {
      agents: t.agents.filter(a => a.owned).map(a => ({ slug: a.slug, working: !!a.task })),
      onPick: slug => $(`.agent-card[data-slot="${t.agents.find(a => a.slug === slug).slot}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      paused: () => !!$('.overlay'),
    }).then(s => (state.teamStage = s));
    $$('[data-buy]').forEach(b => b.onclick = () => buyAgentModal(t.agents.find(a => a.slot === +b.dataset.buy)));
    clearInterval(state.taskTimer);
    state.taskTimer = setInterval(async () => {
      if (!location.hash.startsWith('#/agents') || $('.overlay')) return;
      await loadTeam();
      state.team.agents.forEach(a => {
        const card = $(`.agent-card[data-slot="${a.slot}"]`);
        if (card && a.owned && card.classList.contains('working') !== !!a.task) card.outerHTML = agentCard(a);
      });
      state.teamStage?.setWorking(workingMap());
    }, 5000);
  }

  // Окно покупки агента (демо-оплата): POST /api/agents/buy.
  function buyAgentModal(a) {
    const t = state.team;
    const m = modal(`
      <div class="buy-agent" style="--ac:${a.color}">
        <div class="stage-wrap buy-stage" style="background-image:url(${a.image})"><canvas id="buy-stage"></canvas></div>
        <h2 style="margin:6px 0 2px">${esc(a.name)} <span class="agent-sub">· ${esc(a.title)}</span></h2>
        <p class="muted">${esc(a.description)}</p>
        <div class="buy-lines">
          <div><span>Агентов сейчас</span><b>${t.owned}</b></div>
          <div><span>После покупки</span><b>${t.owned + 1} — одновременно ${t.owned + 1} задачи</b></div>
          <div class="total"><span>К оплате (разово)</span><b>${tenge(a.price)}</b></div>
        </div>
        ${t.payment_mode === 'demo' ? '<p class="small muted">🧪 Демо-режим оплаты: деньги не списываются, агент добавляется сразу.</p>' : ''}
        <div class="modal-actions"><button class="btn" data-close>Отмена</button><button class="btn btn-primary" id="buy-ok">Оплатить ${tenge(a.price)}</button></div>
      </div>`);
    mount3d($('#buy-stage'), { agents: [{ slug: a.slug }], spin: true });
    $('#buy-ok').onclick = async e => {
      e.target.disabled = true;
      try {
        const r = await api('POST', '/agents/buy');
        m.close();
        state.team = r;
        toast('🎉 ' + r.message, 'ok');
        renderLayout('agents');
        renderAgentsPage(a.slot);
      } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    };
  }

  // ---------------------------------------------------------------- tasks page — задачи для ИИ-агента (ключевой сценарий 2 на стороне клиента)
  const STATUS = { queued: 'В очереди', running: 'Выполняется', completed: 'Готово', failed: 'Ошибка', cancelled: 'Отменена' };
  const statusBadge = s => `<span class="status st-${s}">${STATUS[s] || s}</span>`;

  // Страница «Задачи агенту»: форма новой задачи (один агент или «Вместе») и список задач по статусам.
  async function renderTasksPage(filter = '') {
    $('#main').innerHTML = `
      <div class="topbar">${menuButton}<div class="title">${ico('tasks', 'title-ico')} Задачи для ИИ-агента</div></div>
      <div class="page"><div class="page-inner">
        <div class="card" style="margin-bottom:22px">
          <h3 style="margin-top:0">Новая задача</h3>
          <p class="muted small" style="margin:0 0 12px">Задачу выполнит Windows-приложение Mansur AI на вашем компьютере: создаст файлы, напишет код, запустит команды. Приложение должно быть запущено и подключено к аккаунту.</p>
          <form id="task-form">
            <label class="field"><span>Что нужно сделать</span><textarea class="textarea" name="prompt" required minlength="3" placeholder="Например: создай сайт-портфолио с тремя страницами, запусти его и проверь, что всё работает"></textarea></label>
            <label class="together ${(state.team?.owned || 1) < 2 ? 'off' : ''}">
              <input type="checkbox" name="mode" value="team" ${(state.team?.owned || 1) < 2 ? 'disabled' : ''}>
              <span class="mini-team">${(state.team?.agents || []).filter(a => a.owned).map(a => `<i style="--ac:${a.color}" title="${esc(a.name)}"><img src="${a.image}" alt=""></i>`).join('')}</span>
              <span><b>Вместе</b> — главный агент разделит задачу на части, вся команда сделает их одновременно, а он проверит итог
              ${(state.team?.owned || 1) < 2 ? '<br><a href="#/agents">Нужно минимум 2 агента →</a>' : ''}</span>
            </label>
            <div class="row">
              <input class="input" name="workspace" placeholder="Папка на ПК (необязательно), например C:\\Projects\\site" style="flex:1;min-width:220px">
              <button class="btn btn-primary" type="submit">Отправить на ПК</button>
            </div>
            <div class="error-text" id="task-err"></div>
          </form>
        </div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px">
          <h3 style="margin:0">Мои задачи</h3>
          <select class="select" id="task-filter" style="width:auto">
            <option value="">Все статусы</option>
            ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${filter === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </div>
        <div id="task-list"><p class="muted">Загрузка…</p></div>
        <div class="row" style="margin-top:14px">${downloadButton('')}</div>
      </div></div>`;
    bindMenu();

    $('#task-filter').onchange = e => renderTasksPage(e.target.value);
    $('#task-form').onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v.trim()));
      try {
        await api('POST', '/agent-tasks', data);
        toast(data.mode === 'team' ? 'Задача отправлена команде. Главный агент разделит её на части.' : 'Задача отправлена. Windows-приложение возьмёт её в работу.', 'ok');
        e.target.reset();
        loadTasks(filter);
      } catch (err) { $('#task-err').textContent = Object.values(err.errors).flat()[0] || err.message; }
    };
    loadTasks(filter);
    clearInterval(state.taskTimer);
    state.taskTimer = setInterval(() => { if (location.hash.startsWith('#/tasks') && !$('.overlay')) loadTasks($('#task-filter')?.value || ''); }, 5000);
  }

  // Загрузить задачи (GET /api/agent-tasks?status=) и нарисовать карточки со статусами.
  async function loadTasks(filter) {
    try {
      const res = await api('GET', '/agent-tasks' + (filter ? '?status=' + filter : ''));
      const list = $('#task-list');
      if (!list) return;
      list.innerHTML = res.data.length ? res.data.map(t => `
        <div class="task" data-id="${t.id}">
          ${t.mode === 'team' ? '<span class="team-badge" title="Задача для всей команды">👥</span>' : agentAvatar(t.agent_slot)}
          <div class="grow"><b>${esc(t.title)}</b><span class="muted small">${fmtDate(t.created_at)}${t.workspace ? ' · ' + esc(t.workspace) : ''} · шагов: ${t.log_count}</span>
            ${t.subtasks?.length ? `<div class="subtasks">${t.subtasks.map(s => `<span class="subtask st-${s.status}">${agentAvatar(s.agent_slot)}${esc(s.title)}</span>`).join('')}</div>` : ''}</div>
          ${statusBadge(t.status)}
        </div>`).join('') : '<p class="muted">Задач пока нет.</p>';
      $$('.task', list).forEach(el => el.onclick = () => taskModal(+el.dataset.id));
    } catch (e) { toast(e.message, 'err'); }
  }

  // Окно задачи: журнал шагов агента, результат, кнопка «Отменить» (обновляется, пока задача идёт).
  async function taskModal(id) {
    let timer;
    const m = modal('<p class="muted">Загрузка…</p>', { wide: true, onClose: () => clearInterval(timer) });
    const draw = async () => {
      let t;
      try { t = (await api('GET', '/agent-tasks/' + id)).data; } catch (e) { toast(e.message, 'err'); return; }
      if (!document.body.contains(m.el)) return;
      const log = (t.log || []).map(l => `<div><span class="l-time">${new Date(l.at).toLocaleTimeString('ru-RU')}</span> <span class="l-${esc(l.type)}">${esc(l.text)}</span></div>`).join('');
      m.el.innerHTML = `
        <div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(t.title)}</h2>${statusBadge(t.status)}</div>
        <p class="muted small">${esc(t.prompt)}</p>
        ${t.workspace ? `<p class="small">📁 ${esc(t.workspace)}</p>` : ''}
        ${t.subtasks?.length ? `<h3>Команда работает над частями</h3><div class="subtasks big">${t.subtasks.map(s => `<span class="subtask st-${s.status}">${agentAvatar(s.agent_slot)}${esc(s.title)} · ${STATUS[s.status]}</span>`).join('')}</div>` : ''}
        <div class="log" id="tlog">${log || '<span class="l-time">Журнал пуст — задача ждёт Windows-приложение.</span>'}</div>
        ${t.result ? `<h3>Результат</h3><div class="card">${renderMarkdown(t.result).outerHTML}</div>` : ''}
        <div class="modal-actions">
          ${['queued', 'running'].includes(t.status) ? '<button class="btn btn-danger" id="t-cancel">Отменить задачу</button>' : ''}
          <button class="btn" id="t-close">Закрыть</button>
        </div>`;
      const lg = $('#tlog'); lg.scrollTop = lg.scrollHeight;
      $('#t-close').onclick = m.close;
      $('#t-cancel')?.addEventListener('click', async () => {
        try { await api('POST', `/agent-tasks/${id}/cancel`); toast('Задача отменена'); draw(); loadTasks($('#task-filter')?.value || ''); } catch (e) { toast(e.message, 'err'); }
      });
      if (!['queued', 'running'].includes(t.status)) clearInterval(timer);
    };
    await draw();
    timer = setInterval(draw, 3000);
  }

  // ---------------------------------------------------------------- design page — страница «Оформление»
  // Страница «Оформление»: тема, цвета, шрифт, свой фон (фото/GIF/видео) — PUT /api/me/appearance.
  function renderDesignPage() {
    $('#main').innerHTML = `
      <div class="topbar">${menuButton}<div class="title">${ico('style', 'title-ico')} Оформление</div><span class="muted small">Сохраняется в аккаунте — будет и на сайте, и в приложении</span></div>
      <div class="page"><div class="page-inner" id="design-box"></div></div>`;
    bindMenu();
    MansurTheme.renderEditor($('#design-box'), {
      appearance: state.user.appearance,
      background: { url: state.user.background_url, type: state.user.background_type },
      notify: toast,
      save: async appearance => { state.user = (await api('PUT', '/me/appearance', appearance)).data; applyDesign(state.user); },
      upload: async file => {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/me/background', { method: 'POST', headers: { Accept: 'application/json', Authorization: 'Bearer ' + state.token }, body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(Object.values(data.errors || {}).flat()[0] || data.message || 'Не удалось загрузить файл');
        state.user = data.data;
        store.set('background', { url: state.user.background_url, type: state.user.background_type });
        return { url: state.user.background_url, type: state.user.background_type };
      },
      removeBackground: async () => {
        await api('DELETE', '/me/background');
        state.user.background_url = null; state.user.background_type = null;
        store.set('background', {});
      },
    });
  }

  // ---------------------------------------------------------------- admin page — админ-панель
  // Админ-панель с вкладками: статистика, провайдеры, нейросети, соцсети, пользователи, покупки, почта.
  async function renderAdminPage(tab = 'stats') {
    $('#main').innerHTML = `
      <div class="topbar">${menuButton}<div class="title">${ico('settings', 'title-ico')} Админ-панель</div></div>
      <div class="page"><div class="page-inner">
        <div class="tabs">
          <button class="tab ${tab === 'stats' ? 'active' : ''}" data-tab="stats">Статистика</button>
          <button class="tab ${tab === 'providers' ? 'active' : ''}" data-tab="providers">Провайдеры</button>
          <button class="tab ${tab === 'models' ? 'active' : ''}" data-tab="models">Нейросети</button>
          <button class="tab ${tab === 'social' ? 'active' : ''}" data-tab="social">Вход через соцсети</button>
          <button class="tab ${tab === 'users' ? 'active' : ''}" data-tab="users">Пользователи</button>
          <button class="tab ${tab === 'purchases' ? 'active' : ''}" data-tab="purchases">Покупки</button>
          <button class="tab ${tab === 'mail' ? 'active' : ''}" data-tab="mail">Почта</button>
        </div>
        <div id="admin-body"><p class="muted">Загрузка…</p></div>
      </div></div>`;
    bindMenu();
    $$('.tab').forEach(b => b.onclick = () => renderAdminPage(b.dataset.tab));
    try {
      if (tab === 'stats') await adminStats();
      if (tab === 'models') await adminModels();
      if (tab === 'providers') await adminProviders();
      if (tab === 'users') await adminUsers();
      if (tab === 'social') await adminSocial();
      if (tab === 'purchases') await adminPurchases();
      if (tab === 'mail') await adminMail();
    } catch (e) { $('#admin-body').innerHTML = `<p class="error-text">${esc(e.message)}</p>`; }
  }

  // Вкладка «Статистика»: онлайн сейчас (автообновление каждые 30 с), регистрации, запросы по моделям и дням.
  async function adminStats(from = '', to = '') {
    const p = new URLSearchParams();
    if (from) p.set('date_from', from);
    if (to) p.set('date_to', to);
    const s = await api('GET', '/admin/stats?' + p);
    const max = Math.max(1, ...s.by_model.map(r => r.requests));
    const maxDay = Math.max(1, ...s.by_day.map(r => r.requests));
    $('#admin-body').innerHTML = `
      <div class="row" style="margin-bottom:16px">
        <span class="muted small">Период:</span>
        <input type="date" class="input" id="st-from" value="${s.period.from}" style="width:auto">
        <input type="date" class="input" id="st-to" value="${s.period.to}" style="width:auto">
        <button class="btn" id="st-apply">Показать</button>
      </div>
      <div class="card online-card">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><h3 style="margin:0">🟢 Сейчас онлайн</h3><p class="muted small" style="margin:4px 0 0">Активность за последние 3 минуты · обновляется каждые 30 секунд</p></div>
          <div class="online-nums">
            <div><b>${s.online.total}</b><span>всего</span></div>
            <div><b>${s.online.site}</b><span>🌐 на сайте</span></div>
            <div><b>${s.online.app}</b><span>💻 в приложении</span></div>
          </div>
        </div>
        <div class="online-list">${s.online_users.map(u => `<span class="online-chip" title="${esc(u.email)}"><i></i>${esc(u.name)}${u.site ? ' 🌐' : ''}${u.app ? ' 💻' : ''}</span>`).join('') || '<span class="muted small">Сейчас никого нет</span>'}</div>
      </div>
      <div class="stats">
        ${[['Пользователи', s.totals.users], ['Новых сегодня', s.totals.users_today], ['Новых за период', s.totals.users_period], ['Установили приложение', s.totals.app_users], ['Чаты', s.totals.chats], ['Сообщения', s.totals.messages], ['Задачи агенту', s.totals.agent_tasks], ['Запросов за период', s.totals.requests], ['Покупателей', s.totals.buyers], ['Продано агентов', s.totals.agents_sold], ['Выручка от агентов', tenge(s.totals.agents_revenue)]]
          .map(([k, v]) => `<div class="stat"><span class="muted small">${k}</span><b>${v}</b></div>`).join('')}
      </div>
      <h3>Как регистрируются</h3>
      ${(() => { const sg = { email: 'Email и пароль', google: 'Google', github: 'GitHub', apple: 'Apple' }; const total = Math.max(1, ...Object.values(s.signup)); return Object.entries(s.signup).map(([k, v]) => `<div class="bar-row"><span>${sg[k] || k}</span><div class="bar"><i style="width:${(v / total) * 100}%"></i></div><b>${v}</b></div>`).join(''); })()}
      <h3>Запросы по нейросетям</h3>
      ${s.by_model.map(r => `<div class="bar-row"><span>${esc(r.name)}</span><div class="bar"><i style="width:${(r.requests / max) * 100}%"></i></div><b>${r.requests}</b></div>`).join('') || '<p class="muted">Нет данных за период</p>'}
      <h3>По дням</h3>
      ${s.by_day.map(r => `<div class="bar-row"><span>${new Date(r.date).toLocaleDateString('ru-RU')}</span><div class="bar"><i style="width:${(r.requests / maxDay) * 100}%"></i></div><b>${r.requests}</b></div>`).join('') || '<p class="muted">Нет данных за период</p>'}`;
    $('#st-apply').onclick = () => adminStats($('#st-from').value, $('#st-to').value).catch(e => toast(e.message, 'err'));
    // Live "online now": refresh while this tab stays open.
    clearTimeout(state.statsTimer);
    state.statsTimer = setTimeout(() => {
      if ($('.tab.active')?.dataset.tab === 'stats' && location.hash.startsWith('#/admin') && !$('.overlay')) adminStats($('#st-from')?.value || from, $('#st-to')?.value || to).catch(() => {});
    }, 30000);
  }

  // Вкладка «Покупки»: кто, какого агента и за сколько купил, итоги по агентам.
  async function adminPurchases(q = '') {
    const res = await api('GET', '/admin/purchases' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const sm = res.summary;
    $('#admin-body').innerHTML = `
      <div class="stats">
        ${[['Покупок', sm.count], ['Покупателей', sm.buyers], ['Выручка', tenge(sm.revenue)]].map(([k, v]) => `<div class="stat"><span class="muted small">${k}</span><b>${v}</b></div>`).join('')}
        ${sm.by_agent.map(a => `<div class="stat"><span class="muted small">${esc(a.agent)}</span><b>${a.count}</b><span class="muted small">${tenge(a.amount)}</span></div>`).join('')}
      </div>
      <input class="input" id="p-q" placeholder="🔎 Поиск покупателя по email или имени" value="${esc(q)}" style="margin:6px 0 12px">
      <div style="overflow-x:auto"><table class="table">
        <tr><th>Покупатель</th><th>Агент</th><th>Сумма</th><th>Способ</th><th>Дата</th></tr>
        ${res.data.map(p => `<tr>
          <td>${p.user ? `<b>${esc(p.user.name)}</b><div class="muted small">${esc(p.user.email)}</div>` : '<span class="muted">удалён</span>'}</td>
          <td><span class="agent-tag" style="--ac:${esc(p.color || '#7c5cff')}"><img src="/img/agents/${['', 'mansur', 'barys', 'tulpar', 'berkut', 'samruk'][p.slot] || 'mansur'}.png" alt="">${esc(p.agent)}</span></td>
          <td><b>${tenge(p.amount)}</b></td>
          <td class="small">${esc(p.method)}</td>
          <td class="small">${fmtDate(p.paid_at)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="muted">Покупок пока нет</td></tr>'}
      </table></div>
      ${res.meta.total > res.data.length ? `<p class="muted small">Показаны последние ${res.data.length} из ${res.meta.total}</p>` : ''}`;
    $('#p-q').oninput = debounce(e => adminPurchases(e.target.value.trim()).then(() => { const i = $('#p-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 350);
  }

  // Вкладка «Почта»: SMTP-настройки для писем сброса пароля и тестовое письмо.
  async function adminMail() {
    const m = await api('GET', '/admin/mail');
    $('#admin-body').innerHTML = `
      <div class="card">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">Почта для писем «Забыли пароль?»</h3>
          ${m.ready ? '<span class="status st-completed">Настроена</span>' : '<span class="status st-queued">Не настроена</span>'}</div>
        <p class="muted small">Проще всего — через Gmail: включите двухэтапную аутентификацию в аккаунте Google, создайте <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">пароль приложения</a> (16 букв) и вставьте его ниже. Сервер: smtp.gmail.com, порт 587. Обычный пароль от почты не подойдёт.</p>
        <form id="mail-form" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">
          <label class="field"><span>SMTP-сервер</span><input class="input" name="host" required value="${esc(m.host || 'smtp.gmail.com')}"></label>
          <label class="field"><span>Порт</span><select class="select" name="port">${[587, 465, 25, 2525].map(p => `<option ${String(m.port || 587) === String(p) ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
          <label class="field"><span>Логин (обычно ваш email)</span><input class="input" name="username" value="${esc(m.username)}"></label>
          <label class="field"><span>Пароль приложения</span><input class="input" type="password" name="password" placeholder="${m.password_filled ? '•••••••• сохранён' : 'Вставьте пароль'}"></label>
          <label class="field"><span>Адрес отправителя</span><input class="input" type="email" name="from_address" required value="${esc(m.from_address)}"></label>
          <label class="field"><span>Имя отправителя</span><input class="input" name="from_name" value="${esc(m.from_name || 'Mansur AI')}"></label>
          <div class="row" style="grid-column:1/-1"><button class="btn btn-primary" type="submit">Сохранить</button>
            ${m.configured ? '<button class="btn btn-danger" type="button" id="mail-clear">Удалить настройки</button>' : ''}</div>
        </form>
      </div>
      <div class="card" style="margin-top:14px">
        <h3 style="margin-top:0">Проверка</h3>
        <div class="row"><input class="input" id="mail-to" type="email" placeholder="Куда отправить тестовое письмо" value="${esc(state.user.email)}" style="flex:1;min-width:200px"><button class="btn" id="mail-test" ${m.ready ? '' : 'disabled'}>✉ Отправить тест</button></div>
        <div class="small" id="mail-out" style="margin-top:8px"></div>
      </div>`;
    $('#mail-form').onsubmit = async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target));
      data.port = +data.port;
      try { await api('PUT', '/admin/mail', data); toast('Настройки почты сохранены', 'ok'); adminMail(); }
      catch (err) { toast(Object.values(err.errors).flat()[0] || err.message, 'err'); }
    };
    $('#mail-clear')?.addEventListener('click', async () => {
      if (!(await confirmBox('Удалить настройки почты? Письма для сброса пароля перестанут отправляться.'))) return;
      try { await api('PUT', '/admin/mail', { clear: true }); adminMail(); } catch (err) { toast(err.message, 'err'); }
    });
    $('#mail-test').onclick = async () => {
      const out = $('#mail-out');
      out.textContent = 'Отправка…'; out.className = 'small muted';
      try { const r = await api('POST', '/admin/mail/test', { to: $('#mail-to').value.trim() }); out.textContent = '✓ ' + r.message; out.className = 'small ok-text'; }
      catch (err) { out.textContent = err.message; out.className = 'small error-text'; }
    };
  }

  // Вкладка «Провайдеры»: ввод API-ключей нейросетей и кнопка «Проверить модели».
  async function adminProviders() {
    const res = await api('GET', '/admin/providers');
    const body = $('#admin-body');
    body.innerHTML = `
      <p class="muted">Подключите бесплатные нейросети: зарегистрируйтесь у провайдера, получите ключ и вставьте его сюда. Пользователям платить ничего не нужно — запросы идут через ваш ключ в пределах бесплатных лимитов провайдера.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        ${res.data.map(p => `
          <div class="card" data-p="${p.name}">
            <div class="row" style="justify-content:space-between"><h3 style="margin:0">${esc(p.title)}</h3>
              ${p.configured ? '<span class="status st-completed">Подключён</span>' : '<span class="status st-queued">Нет ключа</span>'}</div>
            <p style="margin:8px 0">${esc(p.note)}</p>
            <p class="small muted" style="margin:0 0 10px">Моделей: ${p.models_active} активных из ${p.models_total}${p.key_hint ? ` · ключ ${esc(p.key_hint)}${p.key_source === 'env' ? ' (из .env)' : ''}` : ''}</p>
            <div class="row"><input class="input" type="password" placeholder="${p.key_required ? 'Вставьте API-ключ' : 'Ключ (необязательно)'}" data-key style="flex:1;min-width:150px">
              <button class="btn btn-primary btn-sm" data-save>Сохранить</button></div>
            <div class="row" style="margin-top:10px">
              <a class="btn btn-sm" href="${esc(p.key_url)}" target="_blank" rel="noopener">🔑 Получить ключ</a>
              ${p.configured ? '<button class="btn btn-sm" data-import>＋ Импорт моделей</button><button class="btn btn-sm" data-check>✓ Проверить модели</button>' : ''}
              ${p.key_source === 'admin' ? '<button class="btn btn-sm btn-danger" data-clear>Удалить ключ</button>' : ''}
            </div>
            <div class="small" data-out style="margin-top:8px"></div>
          </div>`).join('')}
      </div>`;

    $$('[data-p]', body).forEach(card => {
      const name = card.dataset.p;
      const out = $('[data-out]', card);
      const saveKey = async key => {
        try { await api('PUT', '/admin/providers/' + name, { key }); toast(key ? 'Ключ сохранён' : 'Ключ удалён', 'ok'); await refreshModels(); adminProviders(); }
        catch (e) { toast(e.message, 'err'); }
      };
      $('[data-save]', card).onclick = () => { const k = $('[data-key]', card).value.trim(); if (k) saveKey(k); else toast('Вставьте ключ', 'err'); };
      $('[data-clear]', card)?.addEventListener('click', async () => { if (await confirmBox('Удалить ключ провайдера? Его модели скроются у пользователей.')) saveKey(null); });
      $('[data-check]', card)?.addEventListener('click', async e => {
        e.target.disabled = true;
        out.innerHTML = '<span class="muted">Проверяю каждую модель… (бесплатные тарифы могут отвечать медленно)</span>';
        try {
          const r = await api('POST', `/admin/providers/${name}/check`);
          out.innerHTML = r.data.map(m => `<div>${m.ok ? '✅' : '❌'} ${esc(m.name)}${m.ok ? '' : ` — <span class="muted">${esc(m.error)}</span>`}</div>`).join('') || 'Нет моделей — импортируйте их.';
          await refreshModels();
        } catch (err) { out.textContent = err.message; }
        e.target.disabled = false;
      });
      $('[data-import]', card)?.addEventListener('click', () => importModels(name));
    });
  }

  // Вкладка «Вход через соцсети»: ключи Google/GitHub/Apple и адрес callback.
  async function adminSocial() {
    const res = await api('GET', '/admin/social');
    const body = $('#admin-body');
    body.innerHTML = `
      <p class="muted">Кнопки «Войти через Google / GitHub / Apple» появятся на сайте и в Windows-приложении, как только вы сохраните ключи сервиса. Создайте приложение в консоли сервиса и укажите там адрес перенаправления.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
        ${res.data.map(p => `
          <form class="card" data-s="${p.name}">
            <div class="row" style="justify-content:space-between"><h3 style="margin:0" class="row">${SOCIAL_ICON[p.name] || ''} ${esc(p.title)}</h3>
              ${p.configured ? '<span class="status st-completed">Включён</span>' : '<span class="status st-queued">Не настроен</span>'}</div>
            <p class="small" style="margin:8px 0">${esc(p.note)}</p>
            <label class="field"><span>Адрес перенаправления (callback)</span>
              <div class="row"><input class="input" readonly value="${esc(p.callback_url)}" style="flex:1"><button type="button" class="btn btn-sm" data-copy="${esc(p.callback_url)}">Копировать</button></div></label>
            ${p.fields.map(f => f.key === 'private_key'
              ? `<label class="field"><span>${esc(f.label)}</span><textarea class="input" name="${f.key}" rows="4" placeholder="${f.filled ? 'Сохранён — вставьте новый, чтобы заменить' : '-----BEGIN PRIVATE KEY-----'}"></textarea></label>`
              : `<label class="field"><span>${esc(f.label)}</span><input class="input" name="${f.key}" ${f.secret ? 'type="password"' : ''} value="${esc(f.value)}" placeholder="${f.secret && f.filled ? 'Сохранён — введите новый, чтобы заменить' : ''}"></label>`).join('')}
            <div class="row">
              <button class="btn btn-primary btn-sm" type="submit">Сохранить</button>
              <a class="btn btn-sm" href="${esc(p.console_url)}" target="_blank" rel="noopener">🔑 Открыть консоль ${esc(p.title)}</a>
              ${p.configured ? '<button type="button" class="btn btn-sm btn-danger" data-clear>Отключить</button>' : ''}
            </div>
          </form>`).join('')}
      </div>`;

    $$('[data-copy]', body).forEach(b => b.onclick = () => navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Скопировано', 'ok')));
    $$('[data-s]', body).forEach(form => {
      const name = form.dataset.s;
      form.onsubmit = async e => {
        e.preventDefault();
        try {
          const r = await api('PUT', '/admin/social/' + name, Object.fromEntries(new FormData(form)));
          toast(r.configured ? 'Сохранено — кнопка входа включена' : 'Сохранено. Заполните все поля, чтобы включить вход', r.configured ? 'ok' : '');
          await loadSocial();
          adminSocial();
        } catch (err) { toast(Object.values(err.errors).flat()[0] || err.message, 'err'); }
      };
      $('[data-clear]', form)?.addEventListener('click', async () => {
        if (!(await confirmBox(`Отключить вход через ${socialTitle(name)}? Кто входил так, сможет войти по email, если задал пароль в профиле.`, 'Отключить'))) return;
        try { await api('PUT', '/admin/social/' + name, { clear: true }); await loadSocial(); adminSocial(); } catch (err) { toast(err.message, 'err'); }
      });
    });
  }

  // Какие кнопки «Войти через…» показывать (GET /api/oauth/providers).
  async function loadSocial() {
    state.social = (await api('GET', '/oauth/providers').catch(() => ({ data: [] }))).data;
  }

  // Импорт моделей провайдера: список с галочками → POST /api/admin/models/import.
  async function importModels(provider) {
    const m = modal('<p class="muted">Загружаю список моделей у провайдера…</p>', { wide: true });
    let list;
    try {
      list = (await api('GET', `/admin/providers/${provider}/models`)).data;
    } catch (e) {
      m.el.innerHTML = `<p class="error-text">${esc(e.message)}</p><div class="modal-actions"><button class="btn" id="imp-close">Закрыть</button></div>`;
      $('#imp-close').onclick = m.close;
      return;
    }
    m.el.innerHTML = `
      <h2>Импорт моделей</h2>
      <p class="muted small">Отметьте модели, которые появятся у пользователей. Доступно: ${list.length}.</p>
      <input class="input" id="imp-q" placeholder="🔎 Фильтр" style="margin-bottom:8px">
      <div id="imp-list" style="max-height:50vh;overflow-y:auto;border:1px solid var(--line);border-radius:10px;padding:8px">
        ${list.map(x => `<label class="row" style="padding:3px 4px" data-id="${esc(x.id)}"><input type="checkbox" value="${esc(x.id)}" data-name="${esc(x.name)}"> <span>${esc(x.name)}</span> <span class="muted small">${esc(x.id)}</span></label>`).join('') || '<p class="muted">Провайдер не вернул моделей</p>'}
      </div>
      <div class="modal-actions"><button class="btn" id="imp-cancel">Отмена</button><button class="btn btn-primary" id="imp-ok">Добавить выбранные</button></div>`;
    $('#imp-cancel').onclick = m.close;
    $('#imp-q').oninput = e => { const q = e.target.value.toLowerCase(); $$('#imp-list [data-id]').forEach(l => l.classList.toggle('hidden', !l.textContent.toLowerCase().includes(q))); };
    $('#imp-ok').onclick = async () => {
      const models = $$('#imp-list input:checked').map(i => ({ id: i.value, name: i.dataset.name }));
      if (!models.length) { toast('Отметьте хотя бы одну модель', 'err'); return; }
      try {
        const r = await api('POST', '/admin/models/import', { provider, models });
        m.close();
        toast(`Добавлено моделей: ${r.created}. Нажмите «Проверить модели», чтобы отключить неработающие.`, 'ok');
        await refreshModels();
        adminProviders();
      } catch (e) { toast(e.message, 'err'); }
    };
  }

  // Вкладка «Нейросети»: таблица моделей, включение/выключение, лимиты, редактирование.
  async function adminModels() {
    const res = await api('GET', '/admin/models');
    const prov = res.providers;
    $('#admin-body').innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <span class="muted small">Провайдеры: ${Object.entries(prov).map(([k, p]) => `${esc(p.title)} ${p.configured ? '✅' : '— нет ключа в .env'}`).join(' · ')}</span>
        <button class="btn btn-primary" id="m-add">＋ Добавить нейросеть</button>
      </div>
      <div style="overflow-x:auto"><table class="table">
        <tr><th>Нейросеть</th><th>Провайдер / модель</th><th>Тип</th><th>Лимит/день</th><th>Активна</th><th></th></tr>
        ${res.data.map(m => `<tr>
          <td><b>${esc(m.name)}</b><div class="muted small">${esc(m.slug)}</div></td>
          <td>${esc(m.provider)} ${m.provider_configured ? '' : '<span class="tag">нет ключа</span>'}<div class="muted small">${esc(m.model)}</div></td>
          <td>${esc(m.type)}</td>
          <td><input class="input" type="number" min="0" value="${m.daily_limit}" data-limit="${m.id}" style="width:90px"></td>
          <td><label class="switch"><input type="checkbox" data-active="${m.id}" ${m.is_active ? 'checked' : ''}><i></i></label></td>
          <td><button class="btn btn-sm" data-edit="${m.id}">✎</button> <button class="btn btn-sm btn-danger" data-del="${m.id}">🗑</button></td>
        </tr>`).join('')}
      </table></div>`;
    const save = async (id, data) => {
      try { await api('PATCH', '/admin/models/' + id, data); toast('Сохранено', 'ok'); await refreshModels(); } catch (e) { toast(e.message, 'err'); }
    };
    $$('[data-limit]').forEach(i => i.onchange = () => save(i.dataset.limit, { daily_limit: +i.value }));
    $$('[data-active]').forEach(i => i.onchange = () => save(i.dataset.active, { is_active: i.checked }));
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!(await confirmBox('Удалить нейросеть? Чаты останутся, но без привязки к модели.'))) return;
      await api('DELETE', '/admin/models/' + b.dataset.del).catch(e => toast(e.message, 'err'));
      await refreshModels(); adminModels();
    });
    $$('[data-edit]').forEach(b => b.onclick = () => modelForm(res.data.find(m => m.id === +b.dataset.edit), prov));
    $('#m-add').onclick = () => modelForm(null, prov);
  }

  // Форма добавления / изменения нейросети (название, провайдер, id модели, лимит, системный промпт).
  function modelForm(m, prov) {
    const v = m || { slug: '', name: '', provider: 'pollinations', model: '', type: 'text', description: '', system_prompt: '', daily_limit: 50, sort: 100, is_active: true };
    modal(`
      <h2>${m ? 'Изменить нейросеть' : 'Новая нейросеть'}</h2>
      <form id="mf">
        <div class="row"><label class="field" style="flex:1"><span>Название</span><input class="input" name="name" value="${esc(v.name)}" required></label>
        <label class="field" style="flex:1"><span>Код (латиница)</span><input class="input" name="slug" value="${esc(v.slug)}" required></label></div>
        <div class="row"><label class="field" style="flex:1"><span>Провайдер</span><select class="select" name="provider">${Object.entries(prov).map(([k, p]) => `<option value="${k}" ${k === v.provider ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1"><span>ID модели у провайдера</span><input class="input" name="model" value="${esc(v.model)}" required></label></div>
        <div class="row"><label class="field" style="flex:1"><span>Тип</span><select class="select" name="type">${['text', 'image', 'agent'].map(t => `<option ${t === v.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field" style="flex:1"><span>Лимит в день</span><input class="input" type="number" name="daily_limit" value="${v.daily_limit}" min="0"></label>
        <label class="field" style="flex:1"><span>Порядок</span><input class="input" type="number" name="sort" value="${v.sort}" min="0"></label></div>
        <label class="field"><span>Описание</span><input class="input" name="description" value="${esc(v.description || '')}"></label>
        <label class="field"><span>Системная инструкция</span><textarea class="textarea" name="system_prompt">${esc(v.system_prompt || '')}</textarea></label>
        <div class="error-text" id="mf-err"></div>
        <div class="modal-actions"><button type="button" class="btn" data-close>Отмена</button><button class="btn btn-primary">Сохранить</button></div>
      </form>`, { wide: true });
    $('#mf').onsubmit = async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      d.daily_limit = +d.daily_limit; d.sort = +d.sort;
      try {
        await api(m ? 'PATCH' : 'POST', '/admin/models' + (m ? '/' + m.id : ''), d);
        $('#modal-root').innerHTML = '';
        toast('Сохранено', 'ok');
        await refreshModels(); adminModels();
      } catch (err) { $('#mf-err').textContent = Object.values(err.errors).flat()[0] || err.message; }
    };
  }

  const SIGNUP = { google: 'Google', github: 'GitHub', apple: 'Apple' };
  const seenText = u => {
    if (u.online) return '<span class="online-dot"></span>онлайн';
    if (!u.last_seen_at) return '<span class="muted">не заходил</span>';
    return fmtDate(u.last_seen_at);
  };

  // Вкладка «Пользователи»: поиск, сортировка, «только онлайн», блокировка, выдача агентов.
  async function adminUsers(q = '', opts = state.userOpts || { sort: 'new', online: false }) {
    state.userOpts = opts;
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (opts.sort !== 'new') p.set('sort', opts.sort);
    if (opts.online) p.set('online', '1');
    const res = await api('GET', '/admin/users?' + p);
    const body = $('#admin-body');
    body.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <input class="input" id="u-q" placeholder="🔎 Поиск по email или имени" value="${esc(q)}" style="flex:1;min-width:200px">
        <select class="select" id="u-sort" style="width:auto">
          <option value="new" ${opts.sort === 'new' ? 'selected' : ''}>Сначала новые</option>
          <option value="seen" ${opts.sort === 'seen' ? 'selected' : ''}>Недавно заходили</option>
          <option value="spent" ${opts.sort === 'spent' ? 'selected' : ''}>Больше потратили</option>
        </select>
        <label class="row small" style="gap:6px"><input type="checkbox" id="u-online" ${opts.online ? 'checked' : ''}> Только онлайн</label>
        <span class="muted small">Всего: ${res.meta?.total ?? res.data.length}</span>
      </div>
      <div style="overflow-x:auto"><table class="table users-table">
        <tr><th>Пользователь</th><th>Был в сети</th><th>Где</th><th>Вход</th><th>Чатов / запросов</th><th>Агенты</th><th>Потратил</th><th>Регистрация</th><th>Статус</th><th></th></tr>
        ${res.data.map(u => `<tr>
          <td><b>${esc(u.name)}</b>${u.role === 'admin' ? ' <span class="status st-running">админ</span>' : ''}<div class="muted small">${esc(u.email)}</div></td>
          <td class="small nowrap">${seenText(u)}</td>
          <td class="small nowrap">🌐 Сайт${u.uses_app ? '<br>💻 Приложение' : ''}</td>
          <td class="small">${[u.has_password ? 'Email' : '', ...(u.signup_via || []).map(s => SIGNUP[s] || s)].filter(Boolean).join(', ')}</td>
          <td class="small">${u.chats_count} / ${u.requests_total ?? 0}</td>
          <td><select class="select" data-agents="${u.id}" style="width:auto;padding:4px 8px" title="Подарить или забрать агентов">${[1, 2, 3, 4, 5].map(n => `<option ${u.agents === n ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
          <td class="nowrap">${u.spent ? `<b>${tenge(u.spent)}</b>` : '<span class="muted">—</span>'}</td>
          <td class="small nowrap">${fmtDate(u.created_at)}</td>
          <td>${u.is_blocked ? '<span class="status st-failed">Заблокирован</span>' : '<span class="status st-completed">Активен</span>'}</td>
          <td>${u.id === state.user.id ? '' : `<button class="btn btn-sm ${u.is_blocked ? '' : 'btn-danger'}" data-u="${u.id}" data-b="${u.is_blocked ? 0 : 1}">${u.is_blocked ? 'Разблокировать' : 'Заблокировать'}</button>`}</td>
        </tr>`).join('') || '<tr><td colspan="10" class="muted">Никого не найдено</td></tr>'}
      </table></div>
      ${res.meta && res.meta.total > res.data.length ? `<p class="muted small">Показаны ${res.data.length} из ${res.meta.total} — уточните поиск</p>` : ''}`;
    $('#u-sort').onchange = e => adminUsers($('#u-q').value.trim(), { ...opts, sort: e.target.value });
    $('#u-online').onchange = e => adminUsers($('#u-q').value.trim(), { ...opts, online: e.target.checked });
    $('#u-q').oninput = debounce(e => adminUsers(e.target.value.trim()).then(() => { const i = $('#u-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 350);
    $$('[data-agents]').forEach(s => s.onchange = async () => {
      try { await api('PUT', `/admin/users/${s.dataset.agents}/agents`, { count: +s.value }); toast(`Агентов у пользователя: ${s.value}`, 'ok'); }
      catch (e) { toast(e.message, 'err'); }
    });
    $$('[data-u]').forEach(b => b.onclick = async () => {
      try { await api('POST', `/admin/users/${b.dataset.u}/${b.dataset.b === '1' ? 'block' : 'unblock'}`); adminUsers($('#u-q').value.trim()); } catch (e) { toast(e.message, 'err'); }
    });
  }

  // Перечитать каталог моделей после изменений в админ-панели.
  async function refreshModels() {
    state.models = (await api('GET', '/models')).data;
    if (state.token) state.usage = (await api('GET', '/usage')).data;
  }

  // ---------------------------------------------------------------- router — маршрутизатор SPA: какая страница по адресу #/…
  let lastPage = null;
  // Маршрутизатор: по адресу после # (#/chat/5, #/tasks, #/admin…) решает, какую страницу показать; гостя отправляет на вход.
  async function render() {
    const hash = location.hash || '#/';
    // Password reset links (from the letter) and "forgot password" (from the Windows app).
    if (hash.startsWith('#/reset') || hash.startsWith('#/forgot')) {
      const q = new URLSearchParams(hash.split('?')[1] || '');
      history.replaceState(null, '', location.pathname + '#/');
      lastPage = null;
      renderLanding();
      if (hash.startsWith('#/reset') && q.get('token')) resetModal(q.get('token'), q.get('email') || '');
      else forgotModal(q.get('email') || '');
      return;
    }
    const [, page, id] = hash.match(/^#\/?([a-z]*)\/?(\d+)?/) || [];
    clearInterval(state.taskTimer);

    if (!state.user || !page) {
      lastPage = null;
      renderLanding();
      if (page && !state.user) authModal('login');
      return;
    }
    if (page === 'admin' && state.user.role !== 'admin') { location.hash = '#/chat'; return; }

    const appPage = ['chat', 'tasks', 'agents', 'admin', 'design'].includes(page) ? page : 'chat';
    if (lastPage === null) renderLayout(appPage);
    lastPage = appPage;

    if (appPage === 'chat') {
      if (id) { if (state.chat?.id !== +id || !$('#messages')) await openChat(+id); }
      else openNewChat();
    } else {
      state.chat = null;
      renderChatList();
      if (appPage === 'tasks') renderTasksPage();
      if (appPage === 'agents') renderAgentsPage();
      if (appPage === 'admin') renderAdminPage();
      if (appPage === 'design') renderDesignPage();
      $('#main')?.classList.remove('mt-enter-soft');
      void $('#main')?.offsetWidth;
      $('#main')?.classList.add('mt-enter-soft');
    }
  }

  window.addEventListener('hashchange', render);

  (async function boot() {
    await finishSocialLogin();
    const [models, appInfo] = await Promise.all([
      api('GET', '/models').catch(() => ({ data: [] })),
      api('GET', '/app').catch(() => null),
      loadMe(),
      loadSocial(),
    ]);
    await loadTeam();
    state.models = models.data;
    state.appInfo = appInfo;
    render();
  })();
})();
