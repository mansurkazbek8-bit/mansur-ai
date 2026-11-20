// Превращает Markdown (заголовки, абзацы, списки, **жирный**, таблицы) в настоящий документ Word .docx
// (библиотека docx). Понимает и «рисованные» таблицы (┌─┬─┐ │ a │ b │), которые часто пишут модели.
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, LevelFormat, PageOrientation, VerticalAlign,
} = require('docx');

const FONT = 'Times New Roman';
const runs = (text, o = {}) => String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
  .map(p => new TextRun({ text: p.startsWith('**') ? p.slice(2, -2) : p, bold: p.startsWith('**') || o.bold, font: FONT, size: o.size || 24, color: o.color }));

const splitRow = (line, sep) => line.trim().replace(new RegExp(`^\\${sep}|\\${sep}$`, 'g'), '').split(sep).map(c => c.trim());
const isBoxBorder = l => /^[\s┌├└┬┼┴┐┤┘─═╔╠╚╦╬╩╗╣╝+\-|:]+$/.test(l) && /[─═\-]/.test(l);

/** Box-drawing table: rows are separated by ├───┤ lines, a row may span several │ lines. */
// Разобрать «рисованную» таблицу из символов ┌─┬─┐.
function parseBoxTable(lines) {
  const rows = [];
  let cur = null;
  for (const l of lines) {
    if (isBoxBorder(l)) { if (cur) rows.push(cur); cur = null; continue; }
    const cells = splitRow(l, '│');
    if (!cur) cur = cells.map(() => '');
    cells.forEach((c, i) => { if (c) cur[i] = cur[i] ? cur[i] + ' ' + c : c; });
  }
  if (cur) rows.push(cur);
  return rows;
}

// Разбить Markdown на блоки: заголовки, абзацы, списки, таблицы.
function parseBlocks(md) {
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    if (t.includes('│') || /^[┌╔]/.test(t)) {
      const tbl = [];
      while (i < lines.length && (lines[i].includes('│') || isBoxBorder(lines[i].trim())) && lines[i].trim()) tbl.push(lines[i++]);
      i--;
      blocks.push({ type: 'table', rows: parseBoxTable(tbl) });
    } else if (t.startsWith('|')) {
      const tbl = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) tbl.push(lines[i++].trim());
      i--;
      blocks.push({ type: 'table', rows: tbl.filter(r => !/^\|[\s:\-|]+\|?$/.test(r)).map(r => splitRow(r, '|')) });
    } else if (/^#{1,3}\s/.test(t)) {
      blocks.push({ type: 'heading', level: t.match(/^#+/)[0].length, text: t.replace(/^#+\s*/, '') });
    } else if (/^[-*•]\s+/.test(t)) {
      blocks.push({ type: 'bullet', text: t.replace(/^[-*•]\s+/, '') });
    } else if (/^\d+[.)]\s+/.test(t)) {
      blocks.push({ type: 'number', text: t.replace(/^\d+[.)]\s+/, '') });
    } else {
      blocks.push({ type: 'paragraph', text: t });
    }
  }
  return blocks;
}

// Построить таблицу Word с шапкой и рамками.
function buildTable(rows, contentWidth) {
  const cols = Math.max(...rows.map(r => r.length));
  const norm = rows.map(r => [...r, ...Array(cols - r.length).fill('')]);
  // column widths follow the length of their content, with a sensible minimum
  const weight = Array.from({ length: cols }, (_, j) => Math.max(4, Math.min(60, Math.max(...norm.map(r => r[j].length)))));
  const sum = weight.reduce((a, b) => a + b, 0);
  const widths = weight.map(w => Math.floor(contentWidth * w / sum));
  widths[cols - 1] += contentWidth - widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 6, color: '7F8C9D' };
  const borders = { top: border, bottom: border, left: border, right: border };
  return new Table({
    width: { size: contentWidth, type: WidthType.DXA },
    columnWidths: widths,
    rows: norm.map((r, i) => new TableRow({
      tableHeader: i === 0,
      cantSplit: true,
      children: r.map((c, j) => new TableCell({
        borders,
        width: { size: widths[j], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        shading: i === 0 ? { fill: '1F3864', type: ShadingType.CLEAR, color: 'auto' } : i % 2 === 0 ? { fill: 'F2F5FA', type: ShadingType.CLEAR, color: 'auto' } : undefined,
        margins: { top: 60, bottom: 60, left: 110, right: 110 },
        children: [new Paragraph({ alignment: i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT, children: runs(c, i === 0 ? { bold: true, color: 'FFFFFF', size: 22 } : { size: 22 }) })],
      })),
    })),
  });
}

// Markdown → настоящий документ Word (.docx) шрифтом Times New Roman.
async function markdownToDocx(md, { landscape = false } = {}) {
  const blocks = parseBlocks(md);
  // wide tables read better on a landscape page
  const wide = blocks.some(b => b.type === 'table' && Math.max(...b.rows.map(r => r.length)) >= 4);
  const land = landscape || wide;
  const contentWidth = land ? 16838 - 2 * 1134 : 11906 - 1701 - 850;
  const children = [];
  let tables = 0;
  for (const b of blocks) {
    if (b.type === 'table' && b.rows.length) {
      children.push(buildTable(b.rows, contentWidth));
      children.push(new Paragraph({ children: [] }));
      tables++;
    } else if (b.type === 'heading') {
      children.push(new Paragraph({ heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][b.level - 1], alignment: b.level === 1 ? AlignmentType.CENTER : AlignmentType.LEFT, spacing: { before: 200, after: 120 }, children: runs(b.text, { bold: true, size: [32, 28, 26][b.level - 1], color: '000000' }) }));
    } else if (b.type === 'bullet' || b.type === 'number') {
      children.push(new Paragraph({ numbering: { reference: b.type, level: 0 }, spacing: { after: 60 }, children: runs(b.text) }));
    } else if (b.type === 'paragraph') {
      children.push(new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: { after: 120 }, children: runs(b.text) }));
    }
  }
  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 24 } } } },
    numbering: { config: [
      { reference: 'bullet', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: 'number', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ] },
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838, ...(land ? { orientation: PageOrientation.LANDSCAPE } : {}) },
        margin: land ? { top: 1000, bottom: 1000, left: 1134, right: 1134 } : { top: 1134, bottom: 1134, left: 1701, right: 850 },
      } },
      children: children.length ? children : [new Paragraph({ children: [] })],
    }],
  });
  return { buffer: await Packer.toBuffer(doc), tables, paragraphs: children.length - tables * 2 };
}

module.exports = { markdownToDocx, parseBlocks };
