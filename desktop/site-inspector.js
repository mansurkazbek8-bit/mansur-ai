// Проверка качества сайтов, которые делает агент. Модель не может «посмотреть» на страницу,
// поэтому получает объективный список: битые ссылки, отсутствующие картинки, заглушки, основы вёрстки.
const fs = require('fs');
const path = require('path');

const exists = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const lines = s => (s ? s.split(/\r?\n/).length : 0);

/**
 * @param {string} root site folder
 * @param {string} entry html file inside it
 * @returns {string} report for the model: problems first, then what is fine
 */
// Проверить сайт как строгий заказчик: битые ссылки и картинки, заглушки, адаптив, объём; отчёт — для модели.
function inspectSite(root, entry = 'index.html', { pending = new Set() } = {}) {
  const htmlFile = path.resolve(root, entry);
  if (!exists(htmlFile)) return `Ошибка: нет файла ${htmlFile}. Сначала создай главную страницу.`;
  const html = read(htmlFile);
  const dir = path.dirname(htmlFile);
  const problems = [], good = [];

  // linked local files
  const refs = [...html.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']/gi)].map(m => m[1])
    .filter(u => !/^(https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(u));
  const css = [], js = [], imgs = [], drawing = new Set();
  // A picture that is still being drawn in the background is not a broken link yet.
  const missing = (file, text) => (pending.has(file) ? drawing.add(path.relative(dir, file)) : problems.push(text));
  for (const ref of new Set(refs)) {
    const file = path.resolve(dir, decodeURI(ref));
    if (!exists(file)) missing(file, `Файл не найден: «${ref}» (ссылка в ${entry}) — создай его или исправь путь.`);
    else if (/\.css$/i.test(ref)) css.push(file);
    else if (/\.m?js$/i.test(ref)) js.push(file);
    else if (/\.(jpe?g|png|webp|gif|svg)$/i.test(ref)) imgs.push(file);
  }
  const cssText = css.map(read).join('\n') + [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  // images referenced from CSS (backgrounds)
  for (const f of css) {
    for (const m of read(f).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
      const u = m[1];
      if (/^(https?:|data:|\/\/)/i.test(u)) continue;
      const file = path.resolve(path.dirname(f), u);
      if (!exists(file)) missing(file, `Картинка из CSS не найдена: «${u}» (${path.basename(f)}).`);
      else imgs.push(file);
    }
  }
  // pictures named in scripts (galleries and sliders built by JS) and in inline styles
  for (const [source, text] of [[entry, html], ...js.map(f => [path.basename(f), read(f)])]) {
    for (const m of text.matchAll(/["'(]((?:\.\/)?[\w\-./]+\.(?:jpe?g|png|webp|gif))["')]/gi)) {
      if (/^(https?:|\/\/)/i.test(m[1])) continue;
      const file = path.resolve(dir, m[1]);
      if (imgs.includes(file) || drawing.has(path.relative(dir, file))) continue;
      if (!exists(file)) missing(file, `Картинка не найдена: «${m[1]}» (упоминается в ${source}) — на сайте будет пустой блок.`);
      else imgs.push(file);
    }
  }

  // placeholders and unfinished content
  const allText = html + '\n' + cssText + '\n' + js.map(read).join('\n');
  const junk = allText.match(/lorem ipsum|placeholder\.(jpg|png)|via\.placeholder|placehold\.co|TODO|FIXME|Название\s*\d|Текст\s+(здесь|тут)|example\.com/gi);
  if (junk) problems.push(`Заглушки вместо настоящего содержимого: ${[...new Set(junk.map(j => j.toLowerCase()))].join(', ')} — замени реальным текстом и сгенерированными картинками.`);
  // "Images" that show nothing: tiny inline data (a transparent pixel) instead of a real picture.
  const blanks = [...html.matchAll(/<img[^>]+src\s*=\s*["'](data:image\/[^"']{0,300})["']/gi)].length;
  if (blanks) problems.push(`Пустые картинки (${blanks} шт.): вместо фото стоит прозрачная заглушка data:image — на сайте будут пустые блоки. Убери эти блоки или используй существующие картинки / CSS-градиент.`);
  const used = {};
  for (const m of html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+\.(?:jpe?g|png|webp))["']/gi)) used[m[1]] = (used[m[1]] || 0) + 1;
  const repeated = Object.entries(used).filter(([, n]) => n > 3);
  if (repeated.length) problems.push(`Одна и та же картинка повторяется: ${repeated.map(([f, n]) => `${f} ×${n}`).join(', ')}. Это выглядит однообразно: в карточках меню вместо одинаковых фото используй крупные эмодзи или цветные плашки, а фото оставь для заголовка категории.`);
  if (/api-inference\.huggingface|openai\.com\/v1|replicate\.com|stability\.ai/i.test(allText)) problems.push('Сайт обращается к внешнему API нейросети — так нельзя: картинки создавай заранее инструментом generate_image и подключай как файлы.');

  // structure and design basics
  if (!/<meta[^>]+name=["']viewport/i.test(html)) problems.push('Нет <meta name="viewport"> — на телефоне сайт будет мелким.');
  if (!/<title>[^<]{3,}<\/title>/i.test(html)) problems.push('Нет осмысленного <title>.');
  const sections = (html.match(/<section\b/gi) || []).length;
  if (sections < 4) problems.push(`Мало смысловых разделов (<section>): ${sections}. Для полноценного сайта нужно 5–7 (например: главный экран, о нас, услуги/меню, преимущества, галерея, отзывы, контакты).`);
  if (!/<header\b/i.test(html) || !/<nav\b/i.test(html)) problems.push('Нет шапки с навигацией (<header> и <nav> с якорными ссылками на разделы).');
  if (!/<footer\b/i.test(html)) problems.push('Нет подвала (<footer>) с контактами.');
  const cssLines = lines(cssText);
  if (cssLines < 200) problems.push(`Стилей мало (${cssLines} строк). Продуманный дизайн обычно занимает 300+ строк: переменные цветов, типографика, сетки, карточки, кнопки, hover-эффекты, адаптив.`);
  if (!/@media/i.test(cssText)) problems.push('Нет адаптивности: добавь @media для планшета (до 900px) и телефона (до 600px).');
  if (!/--[\w-]+\s*:/.test(cssText)) problems.push('Нет CSS-переменных цветов (:root { --accent: … }) — палитра будет несогласованной.');
  if (!/fonts\.googleapis|@font-face/i.test(html + cssText)) problems.push('Шрифты по умолчанию: подключи 1–2 шрифта Google Fonts (для заголовков и текста).');
  if (!/:hover/i.test(cssText)) problems.push('Нет hover-эффектов у кнопок и карточек.');
  if (!/transition|animation/i.test(cssText)) problems.push('Нет плавных переходов и анимаций (transition / @keyframes).');
  const uniqueImgs = new Set(imgs);
  if (uniqueImgs.size + drawing.size < 3) problems.push(`Картинок мало (${uniqueImgs.size}). Для живого сайта нужно 4–6: главный экран и тематические (через generate_image).`);
  for (const f of uniqueImgs) {
    try { if (fs.statSync(f).size < 3000) problems.push(`Картинка подозрительно маленькая (возможно, битая): ${path.basename(f)}.`); } catch { /* checked above */ }
  }
  const textLen = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  if (textLen < 1500) problems.push(`Мало текста на странице (${textLen} символов). Напиши настоящие тексты: описание, позиции с описаниями и ценами, отзывы, адрес и часы работы.`);

  good.push(`разделов: ${sections}`, `строк CSS: ${cssLines}`, `картинок: ${uniqueImgs.size}`, `текста: ${textLen} символов`, `файлов JS: ${js.length}`);
  const note = drawing.size ? `\nЕщё рисуются в фоне (это нормально, ждать не нужно): ${[...drawing].join(', ')}.` : '';
  return (problems.length
    ? `Найдено проблем: ${problems.length}. Исправь их все, затем снова вызови inspect_site.\n- ${problems.join('\n- ')}\n\nСейчас: ${good.join(', ')}.`
    : `Проверка пройдена ✓ (${good.join(', ')}). Осталось запустить сайт, проверить check_url и открыть в браузере.`) + note;
}

module.exports = { inspectSite };
