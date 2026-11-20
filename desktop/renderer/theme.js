/* Mansur AI — движок оформления, общий для сайта и Windows-приложения (один и тот же файл).
 * Темы (тёмная / светлая / своя), фон из фото / GIF / видео, акцентные цвета,
 * подбор цветов по фону, шрифты, анимации и редактор оформления. Настройки хранятся в аккаунте. */
(() => {
  'use strict';

  const FONTS = ['Manrope', 'Inter', 'Montserrat', 'Rubik', 'Nunito', 'Comfortaa', 'Unbounded', 'System'];
  const PRESETS = [
    ['Mansur', '#7c5cff', '#22d3ee'], ['Закат', '#ff6b6b', '#feca57'], ['Океан', '#0ea5e9', '#2dd4bf'],
    ['Неон', '#f72585', '#7209b7'], ['Лес', '#22c55e', '#a3e635'], ['Золото', '#f59e0b', '#fde68a'],
    ['Лёд', '#60a5fa', '#e0f2fe'], ['Графит', '#94a3b8', '#e2e8f0'],
  ];
  const DEFAULTS = { theme: 'dark', accent: '#7c5cff', accent2: '#22d3ee', font: 'Manrope', bg_dim: 35, bg_blur: 0, glass: true, animations: true, radius: 14, palette: [] };
  const MAX_VIDEO_SECONDS = 15;

  // ------------------------------------------------------------ colors
  const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgbToHex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const luminance = h => {
    const [r, g, b] = hexToRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  };
  const hslToHex = (h, s, l) => {
    const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
  };
  const rgba = (h, a) => { const [r, g, b] = hexToRgb(h); return `rgba(${r},${g},${b},${a})`; };

  // ------------------------------------------------------------ apply
  function bgLayer() {
    let el = document.getElementById('mt-bg');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mt-bg';
      el.innerHTML = '<div class="mt-bg-media"></div><div class="mt-bg-dim"></div>';
      document.body.prepend(el);
    }
    return el;
  }

  /**
   * @param {object} appearance saved settings (see DEFAULTS)
   * @param {{url?: string, type?: 'image'|'video'}} background
   */
  function apply(appearance, background = {}) {
    const a = { ...DEFAULTS, ...(appearance || {}) };
    const root = document.documentElement;
    const custom = a.theme === 'custom';
    root.dataset.theme = a.theme === 'light' ? 'light' : 'dark';
    root.classList.toggle('mt-no-anim', a.animations === false);

    const accent = a.accent || DEFAULTS.accent, accent2 = a.accent2 || DEFAULTS.accent2;
    const st = root.style;
    st.setProperty('--accent', accent);
    st.setProperty('--accent-2', accent2);
    st.setProperty('--grad', `linear-gradient(135deg, ${accent} 0%, ${accent2} 100%)`);
    st.setProperty('--accent-soft', rgba(accent, 0.16));
    st.setProperty('--soft', rgba(accent, 0.16));
    // readable text on buttons: dark text on light accents
    st.setProperty('--on-accent', (luminance(accent) + luminance(accent2)) / 2 > 0.45 ? '#111318' : '#ffffff');
    st.setProperty('--font', a.font === 'System' ? '"Segoe UI", system-ui, sans-serif' : `"${a.font}", "Segoe UI", system-ui, sans-serif`);
    st.setProperty('--radius', a.radius + 'px');

    const hasBg = custom && background && background.url;
    root.classList.toggle('mt-has-bg', !!hasBg);
    root.classList.toggle('mt-glass', !!hasBg && a.glass !== false);
    const layer = bgLayer();
    const media = layer.querySelector('.mt-bg-media');
    if (hasBg) {
      if (media.dataset.src !== background.url) {
        media.dataset.src = background.url;
        media.innerHTML = background.type === 'video'
          ? `<video src="${background.url}" autoplay muted loop playsinline></video>`
          : `<img src="${background.url}" alt="">`;
        const v = media.querySelector('video');
        if (v) v.play().catch(() => {});
      }
      media.style.filter = a.bg_blur ? `blur(${a.bg_blur}px)` : '';
      media.style.transform = a.bg_blur ? 'scale(1.06)' : '';
      layer.querySelector('.mt-bg-dim').style.background = `rgba(0,0,0,${a.bg_dim / 100})`;
      layer.hidden = false;
    } else {
      media.innerHTML = '';
      media.dataset.src = '';
      layer.hidden = true;
    }
  }

  // ------------------------------------------------------------ palette from a photo / GIF / video
  function loadMedia(src, isVideo) {
    return new Promise((resolve, reject) => {
      const el = document.createElement(isVideo ? 'video' : 'img');
      el.crossOrigin = 'anonymous';
      if (isVideo) { el.muted = true; el.preload = 'auto'; el.onloadeddata = () => resolve(el); } else { el.onload = () => resolve(el); }
      el.onerror = () => reject(new Error('Не удалось открыть файл'));
      el.src = src;
    });
  }
  const seek = (v, t) => new Promise(r => { v.onseeked = () => r(); v.currentTime = t; });

  /** Most vivid distinct colors of the media (k-means over sampled pixels). */
  async function palette(src, isVideo) {
    const el = await loadMedia(src, isVideo);
    const c = document.createElement('canvas');
    c.width = c.height = 72;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const pixels = [];
    const grab = () => {
      ctx.drawImage(el, 0, 0, 72, 72);
      const d = ctx.getImageData(0, 0, 72, 72).data;
      for (let i = 0; i < d.length; i += 8) pixels.push([d[i], d[i + 1], d[i + 2]]);
    };
    if (isVideo) {
      const dur = isFinite(el.duration) ? el.duration : 1;
      for (const f of [0.1, 0.35, 0.6, 0.85]) { await seek(el, dur * f); grab(); }
    } else grab();

    const k = 8;
    let centers = Array.from({ length: k }, (_, i) => pixels[Math.floor((i + 0.5) * pixels.length / k)]);
    let groups = [];
    for (let it = 0; it < 10; it++) {
      groups = centers.map(() => []);
      for (const p of pixels) {
        let best = 0, bd = Infinity;
        centers.forEach((cc, i) => { const dd = (p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2 + (p[2] - cc[2]) ** 2; if (dd < bd) { bd = dd; best = i; } });
        groups[best].push(p);
      }
      centers = groups.map((g, i) => g.length ? [0, 1, 2].map(j => g.reduce((s, p) => s + p[j], 0) / g.length) : centers[i]);
    }

    const scored = centers.map((cc, i) => {
      const [h, s, l] = rgbToHsl(...cc);
      const share = groups[i].length / pixels.length;
      return { h, s, l, score: (s + 0.15) * Math.sqrt(share) * (l > 0.12 && l < 0.92 ? 1 : 0.15) };
    }).sort((x, y) => y.score - x.score);

    // Make each color usable for buttons: enough saturation, mid lightness.
    const result = [];
    for (const c2 of scored) {
      const hex = hslToHex(c2.h, Math.min(1, Math.max(c2.s, 0.55)), Math.min(0.68, Math.max(c2.l, 0.5)));
      if (result.every(r => Math.abs(rgbToHsl(...hexToRgb(r))[0] - c2.h) > 18)) result.push(hex);
      if (result.length >= 6) break;
    }
    // Always offer a complementary pair if the media is almost monochrome.
    if (result.length < 3) {
      const base = scored[0] || { h: 260 };
      result.push(hslToHex((base.h + 40) % 360, 0.75, 0.6), hslToHex((base.h + 180) % 360, 0.75, 0.6));
    }
    return result.slice(0, 6);
  }

  function mediaDuration(src) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => resolve(v.duration);
      v.onerror = () => resolve(0);
      v.src = src;
    });
  }

  // ------------------------------------------------------------ editor
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * Renders the design editor.
   * @param {HTMLElement} box
   * @param {object} opts { appearance, background, save(appearance), upload(file) => {url,type}, removeBackground(), notify(text, kind) }
   */
  function renderEditor(box, opts) {
    let a = { ...DEFAULTS, ...(opts.appearance || {}) };
    let bg = { ...(opts.background || {}) };
    const preview = () => apply(a, bg);

    box.innerHTML = `
      <div class="mt-editor">
        <section class="mt-sec">
          <h3>Тема</h3>
          <div class="mt-themes">
            ${[['dark', '🌙', 'Тёмная'], ['light', '☀️', 'Светлая'], ['custom', '🖼', 'Своя (фон)']].map(([v, i, t]) =>
              `<button class="mt-theme ${a.theme === v ? 'on' : ''}" data-theme="${v}"><span class="mt-theme-prev mt-prev-${v}">${i}</span>${t}</button>`).join('')}
          </div>
        </section>

        <section class="mt-sec mt-bg-sec ${a.theme === 'custom' ? '' : 'mt-dim-sec'}">
          <h3>Фон — фото, GIF или видео до ${MAX_VIDEO_SECONDS} секунд</h3>
          <div class="mt-drop" id="mt-drop">
            <div class="mt-drop-prev" id="mt-drop-prev">${bg.url ? (bg.type === 'video' ? `<video src="${esc(bg.url)}" autoplay muted loop playsinline></video>` : `<img src="${esc(bg.url)}" alt="">`) : '<span>Перетащите файл сюда<br>или нажмите, чтобы выбрать</span>'}</div>
            <input type="file" id="mt-file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" hidden>
          </div>
          <div class="mt-row">
            <button class="btn btn-sm" id="mt-pick">📁 Выбрать файл</button>
            ${bg.url ? '<button class="btn btn-sm btn-danger" id="mt-remove">Убрать фон</button>' : ''}
            <span class="muted small" id="mt-upload-state"></span>
          </div>
          <label class="mt-slider">Затемнение <input type="range" min="0" max="90" value="${a.bg_dim}" data-k="bg_dim"><b>${a.bg_dim}%</b></label>
          <label class="mt-slider">Размытие <input type="range" min="0" max="30" value="${a.bg_blur}" data-k="bg_blur"><b>${a.bg_blur}px</b></label>
          <label class="mt-check"><input type="checkbox" data-k="glass" ${a.glass !== false ? 'checked' : ''}> Эффект «стекла» у панелей</label>
        </section>

        <section class="mt-sec">
          <h3>Цвет кнопок</h3>
          <div id="mt-suggest" class="mt-suggest ${a.palette?.length ? '' : 'hidden'}">
            <div class="muted small">✨ Подобрано из вашего фона:</div>
            <div class="mt-swatches" id="mt-palette"></div>
          </div>
          <div class="mt-presets">
            ${PRESETS.map(([n, c1, c2]) => `<button class="mt-preset" data-c1="${c1}" data-c2="${c2}" title="${n}" style="background:linear-gradient(135deg,${c1},${c2})"></button>`).join('')}
          </div>
          <div class="mt-row">
            <label class="mt-color">Основной <input type="color" value="${a.accent}" data-k="accent"></label>
            <label class="mt-color">Второй <input type="color" value="${a.accent2}" data-k="accent2"></label>
            <button class="btn btn-primary btn-sm" disabled>Пример кнопки</button>
          </div>
        </section>

        <section class="mt-sec">
          <h3>Шрифт</h3>
          <div class="mt-fonts">
            ${FONTS.map(f => `<button class="mt-font ${a.font === f ? 'on' : ''}" data-font="${f}" style="font-family:${f === 'System' ? 'system-ui' : `'${f}'`}">${f === 'System' ? 'Системный' : f}<small>Привет, мир! 123</small></button>`).join('')}
          </div>
        </section>

        <section class="mt-sec">
          <h3>Детали</h3>
          <label class="mt-slider">Скругление <input type="range" min="0" max="28" value="${a.radius}" data-k="radius"><b>${a.radius}px</b></label>
          <label class="mt-check"><input type="checkbox" data-k="animations" ${a.animations !== false ? 'checked' : ''}> Плавные анимации</label>
        </section>

        <div class="mt-row mt-actions">
          <button class="btn" id="mt-reset">Сбросить</button>
          <button class="btn btn-primary" id="mt-save">Сохранить оформление</button>
        </div>
      </div>`;

    const $ = s => box.querySelector(s);
    const $$ = s => [...box.querySelectorAll(s)];

    const drawPalette = () => {
      const list = a.palette || [];
      $('#mt-suggest').classList.toggle('hidden', !list.length);
      const pairs = list.map((c, i) => [c, list[(i + 1) % list.length]]);
      $('#mt-palette').innerHTML = list.map(c => `<button class="mt-swatch" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')
        + pairs.slice(0, 3).map(([c1, c2]) => `<button class="mt-preset" data-c1="${c1}" data-c2="${c2}" style="background:linear-gradient(135deg,${c1},${c2})" title="Пара цветов"></button>`).join('');
      bindColorButtons();
    };
    const setColors = (c1, c2) => {
      a.accent = c1; if (c2) a.accent2 = c2;
      $('[data-k=accent]').value = a.accent; $('[data-k=accent2]').value = a.accent2;
      preview();
    };
    function bindColorButtons() {
      $$('.mt-preset').forEach(b => b.onclick = () => setColors(b.dataset.c1, b.dataset.c2));
      $$('.mt-swatch').forEach(b => b.onclick = () => setColors(b.dataset.c, a.accent));
    }

    $$('.mt-theme').forEach(b => b.onclick = () => {
      a.theme = b.dataset.theme;
      $$('.mt-theme').forEach(x => x.classList.toggle('on', x === b));
      $('.mt-bg-sec').classList.toggle('mt-dim-sec', a.theme !== 'custom');
      preview();
    });
    $$('.mt-font').forEach(b => b.onclick = () => { a.font = b.dataset.font; $$('.mt-font').forEach(x => x.classList.toggle('on', x === b)); preview(); });
    $$('input[type=range]').forEach(i => i.oninput = () => { a[i.dataset.k] = +i.value; i.nextElementSibling.textContent = i.value + (i.dataset.k === 'bg_dim' ? '%' : 'px'); preview(); });
    $$('input[type=checkbox]').forEach(i => i.onchange = () => { a[i.dataset.k] = i.checked; preview(); });
    $$('input[type=color]').forEach(i => i.oninput = () => { a[i.dataset.k] = i.value; preview(); });
    bindColorButtons();
    drawPalette();

    const handleFile = async file => {
      if (!file) return;
      const isVideo = file.type.startsWith('video/');
      const local = URL.createObjectURL(file);
      if (file.size > 30 * 1024 * 1024) { opts.notify('Файл больше 30 МБ', 'err'); return; }
      if (isVideo) {
        const d = await mediaDuration(local);
        if (d > MAX_VIDEO_SECONDS + 0.5) { opts.notify(`Видео длиннее ${MAX_VIDEO_SECONDS} секунд (${Math.round(d)} с). Обрежьте его и попробуйте снова.`, 'err'); return; }
      }
      const state = $('#mt-upload-state');
      state.textContent = 'Подбираю цвета…';
      try {
        a.palette = await palette(local, isVideo);
        drawPalette();
        setColors(a.palette[0], a.palette[1]);
      } catch { /* palette is optional */ }
      state.textContent = 'Загрузка…';
      try {
        bg = await opts.upload(file);
        a.theme = 'custom';
        $$('.mt-theme').forEach(x => x.classList.toggle('on', x.dataset.theme === 'custom'));
        $('.mt-bg-sec').classList.remove('mt-dim-sec');
        $('#mt-drop-prev').innerHTML = isVideo ? `<video src="${local}" autoplay muted loop playsinline></video>` : `<img src="${local}" alt="">`;
        state.textContent = '✓ Фон загружен — не забудьте сохранить';
        preview();
      } catch (e) {
        state.textContent = '';
        opts.notify(e.message, 'err');
      }
    };
    $('#mt-pick').onclick = () => $('#mt-file').click();
    $('#mt-drop').onclick = e => { if (!e.target.closest('video')) $('#mt-file').click(); };
    $('#mt-file').onchange = e => handleFile(e.target.files[0]);
    const drop = $('#mt-drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handleFile(e.dataTransfer.files[0]); };
    $('#mt-remove')?.addEventListener('click', async () => {
      await opts.removeBackground();
      bg = {};
      if (a.theme === 'custom') a.theme = 'dark';
      preview();
      renderEditor(box, { ...opts, appearance: a, background: bg });
    });
    $('#mt-reset').onclick = () => { a = { ...DEFAULTS, palette: a.palette }; preview(); renderEditor(box, { ...opts, appearance: a, background: bg }); };
    $('#mt-save').onclick = async () => {
      try { await opts.save(a); opts.notify('Оформление сохранено — оно будет и на сайте, и в приложении', 'ok'); } catch (e) { opts.notify(e.message, 'err'); }
    };
    preview();
  }

  window.MansurTheme = { apply, palette, renderEditor, DEFAULTS, FONTS };
})();
