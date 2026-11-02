#!/usr/bin/env node
// Kiểm tra toàn bộ đề trong thư mục exams/.  Cách dùng:
//   node validate.js            -> kiểm tra ./exams
//   node validate.js exams/de2.json   -> kiểm tra riêng một file
//   node validate.js --fix     -> tự cập nhật trường "parts" trong index.json
// Thoát với mã 1 nếu có lỗi (✗). Cảnh báo (⚠) không làm fail.
const fs = require('fs'), path = require('path');
const FIX = process.argv.includes('--fix'), target = process.argv.slice(2).find(x => !x.startsWith('--')) || 'exams';
const isFile = fs.existsSync(target) && fs.statSync(target).isFile();
const dir = isFile ? path.dirname(target) : target;
const root = path.dirname(path.resolve(dir));          // thư mục chứa index.html (để kiểm tra ảnh "fig")
let errs = 0, warns = 0;
const bad = (f, m) => { console.log(`✗ ${f}: ${m}`); errs++; };
const warn = (f, m) => { console.log(`⚠ ${f}: ${m}`); warns++; };
const isInt = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { bad(path.basename(f), 'JSON sai cú pháp: ' + e.message); return null; } };

function latex(f, where, s) {
  if (typeof s !== 'string') return;
  const t = s.replace(/\\\$/g, '');
  if ((t.match(/\$/g) || []).length % 2) warn(f, `${where}: số dấu $ bị lẻ (thiếu đóng/mở công thức)`);
  (t.match(/\$[^$]+\$/g) || []).forEach(m => {
    let d = 0; for (const c of m) { if (c === '{') d++; if (c === '}') d--; if (d < 0) break; }
    if (d !== 0) warn(f, `${where}: ngoặc { } không cân trong ${m.slice(0, 40)}`);
  });
  if (/[\u{1D400}-\u{1D7FF}]/u.test(s)) warn(f, `${where}: có ký tự toán Unicode dạng 𝑥/𝑦 (rác copy từ PDF), nên viết LaTeX`);
  if (/\\\\(frac|sqrt|int|sum|vec|overrightarrow)/.test(s)) warn(f, `${where}: có \\\\ kép trước lệnh LaTeX, có thể bị escape thừa`);
}


const FORB = /L['’]?H[oô]pital|Lagrange|Taylor|Maclaurin|ma trận|định thức|đạo hàm riêng|tích phân bội|chuỗi (số|hàm|lũy thừa)|Jacobi|phương trình vi phân/i;
const OKF = new Set('x sin cos tan asin acos atan sqrt abs exp log ln log10 log2 pow pi e floor ceil sign cbrt'.split(' '));
function checkExtras(f, q, w) {
  // Lời giải chi tiết
  if (q.sol === undefined || q.sol === null || q.sol === '' ) warn(f, `${w}: thiếu lời giải "sol"`);
  else {
    const txt = [].concat(q.sol).join(' ');
    if (txt.length < 120) warn(f, `${w}: lời giải quá ngắn (${txt.length} ký tự), cần chi tiết hơn`);
    latex(f, w + ' (sol)', txt);
    if (FORB.test(txt)) warn(f, `${w}: lời giải có kiến thức ngoài chương trình THPT (${txt.match(FORB)[0]})`);
  }
  if (q.solved) warn(f, `${w}: đáp án do Gemini tự giải, nên kiểm tra lại`);
  // Đồ thị vẽ từ công thức
  if (q.graph) {
    const g = q.graph, rng = r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] < r[1];
    if (!rng(g.x) || !rng(g.y)) bad(f, `${w}: graph.x và graph.y phải là [min, max] với min < max`);
    else {
      if (!Array.isArray(g.fn) && !Array.isArray(g.lines) && !Array.isArray(g.pts)) bad(f, `${w}: graph cần ít nhất một trong fn / lines / pts`);
      (g.fn || []).forEach((e, k) => {
        e = String(e);
        const toks = e.match(/[a-z_0-9]+/gi) || [];
        if (!toks.every(t => OKF.has(t) || /^\d/.test(t)) || /[^0-9a-z+\-*\/^().,\s]/i.test(e)) return bad(f, `${w}: graph.fn[${k}] "${e}" có ký tự/hàm không cho phép (chỉ x, số, + - * / ^ ( ) và sin cos tan sqrt abs exp log ln pi)`);
        let fn; try { fn = new Function('x', 'with(Math){var ln=log;return ' + e.replace(/\^/g, '**') + '}'); } catch (_) { return bad(f, `${w}: graph.fn[${k}] "${e}" sai cú pháp (nhân phải viết dấu *, ví dụ 2*x)`); }
        let ok = 0; for (let i = 0; i <= 200; i++) { const x = g.x[0] + (g.x[1] - g.x[0]) * i / 200, y = fn(x); if (Number.isFinite(y) && y >= g.y[0] && y <= g.y[1]) ok++; }
        if (ok < 5) warn(f, `${w}: graph.fn[${k}] gần như không có điểm nào nằm trong khung x=${g.x}, y=${g.y}`);
      });
    }
  }
  // Hình vẽ SVG do Gemini tự code
  if (q.svg !== undefined) {
    const v = String(q.svg);
    if (!/^\s*<svg[\s>]/i.test(v) || !/<\/svg>\s*$/i.test(v)) bad(f, `${w}: "svg" phải bắt đầu bằng <svg và kết thúc bằng </svg>`);
    if (/<script|\son\w+\s*=|javascript:|<foreignObject/i.test(v)) bad(f, `${w}: "svg" chứa script/sự kiện không an toàn`);
    if (!/viewBox/i.test(v)) warn(f, `${w}: "svg" thiếu viewBox nên có thể bị méo/tràn khung`);
  }
}

function checkQ(f, q, i, pre = '') {
  const w = pre + `câu ${i + 1}`, ph = [...String(q.q).matchAll(/\[\[(\d+)\]\]/g)].map(m => +m[1]);
  if (typeof q.q !== 'string' || !q.q.trim()) bad(f, `${w}: thiếu nội dung "q"`);
  if (!['mc', 'mcm', 'tf', 'fill', 'drag'].includes(q.t)) return bad(f, `${w}: "t" phải là mc | mcm | tf | fill | drag (đang là ${JSON.stringify(q.t)})`);
  if (q.warn) warn(f, `${w}: Gemini ghi chú: ${q.warn}`);
  checkExtras(f, q, w);
  latex(f, w, q.q);
  if (q.p) latex(f, w + ' (p)', q.p);
  if (q.fig) { if (typeof q.fig !== 'string' || !fs.existsSync(path.join(root, q.fig))) warn(f, `${w}: không thấy ảnh "${q.fig}" (tính từ thư mục chứa index.html)`); }
  if (q.a === null || q.a === undefined) return bad(f, `${w}: chưa có đáp án ("a" là null/thiếu), gửi câu này cho Claude giải`);
  const L = (key, arr) => { if (!Array.isArray(arr) || arr.length < 2) { bad(f, `${w}: "${key}" phải là mảng ≥ 2 phần tử`); return false; } arr.forEach((x, k) => { if (typeof x !== 'string' || !x.trim()) bad(f, `${w}: ${key}[${k}] rỗng`); else latex(f, `${w} ${key}[${k}]`, x); }); return true; };
  if (q.t === 'mc') {
    if (!L('o', q.o)) return;
    if (q.o.length > 6) warn(f, `${w}: nhiều hơn 6 phương án`);
    if (!isInt(q.a, 0, q.o.length - 1)) bad(f, `${w}: "a" phải là số nguyên 0..${q.o.length - 1}`);
    if (new Set(q.o.map(x => x.trim())).size < q.o.length) warn(f, `${w}: có phương án trùng nhau (lỗi hay gặp khi trích từ PDF)`);
  }
  if (q.t === 'mcm') {
    if (!L('o', q.o)) return;
    if (!Array.isArray(q.a) || !q.a.length || !q.a.every(x => isInt(x, 0, q.o.length - 1)) || new Set(q.a).size !== q.a.length) bad(f, `${w}: "a" phải là mảng chỉ số không trùng, mỗi giá trị 0..${q.o.length - 1}`);
    if (new Set(q.o.map(x => x.trim())).size < q.o.length) warn(f, `${w}: có phương án trùng nhau`);
  }
  if (q.t === 'tf') {
    if (!Array.isArray(q.s) || !q.s.length) return bad(f, `${w}: thiếu mảng phát biểu "s"`);
    q.s.forEach((x, k) => latex(f, `${w} s[${k}]`, x));
    if (!Array.isArray(q.a) || q.a.length !== q.s.length || !q.a.every(x => x === 0 || x === 1)) bad(f, `${w}: "a" phải là mảng ${q.s.length} giá trị 0 (Sai) hoặc 1 (Đúng)`);
  }
  if (q.t === 'fill' || q.t === 'drag') {
    const n = Array.isArray(q.a) ? q.a.length : 0;
    if (!ph.length) bad(f, `${w}: không có ô trống [[0]], [[1]]... trong "q"`);
    if (new Set(ph).size !== ph.length || ph.some(x => x >= ph.length)) bad(f, `${w}: các ô trống phải đánh số liên tiếp từ 0, không trùng (đang là ${ph.map(x => `[[${x}]]`).join('')})`);
    if (n !== ph.length) bad(f, `${w}: có ${ph.length} ô trống nhưng "a" có ${n} giá trị`);
    if (q.t === 'fill') {
      if (!Array.isArray(q.a) || !q.a.every(x => typeof x === 'number' && isFinite(x))) bad(f, `${w}: "a" của câu điền phải là mảng số (không dùng chuỗi)`);
      if (q.e !== undefined && !(typeof q.e === 'number' && q.e >= 0)) bad(f, `${w}: "e" (sai số) phải là số ≥ 0`);
      if (/làm tròn/i.test(q.q) && q.e === undefined) warn(f, `${w}: đề có "làm tròn" nhưng thiếu "e" (ví dụ 0.006 cho 2 chữ số thập phân)`);
    } else {
      if (!L('c', q.c)) return;
      if (!q.a.every(x => isInt(x, 0, q.c.length - 1))) bad(f, `${w}: "a" phải là chỉ số 0..${q.c.length - 1} của "c"`);
      if (new Set(q.a).size !== q.a.length) warn(f, `${w}: cùng một chip được dùng cho nhiều ô, mỗi chip chỉ kéo được một lần`);
    }
  }
}

function checkExam(file) {
  const f = path.basename(file), d = read(file);
  if (!d) return null;
  if (!d.title) warn(f, 'thiếu "title" (sẽ lấy tên trong index.json)');
  // Hỗ trợ cả đề 1 phần ("questions") lẫn đề nhiều phần ("sections")
  const secs = Array.isArray(d.sections) ? d.sections : (Array.isArray(d.questions) ? [{ title: d.title, minutes: d.minutes, questions: d.questions }] : null);
  if (!secs || !secs.length) { bad(f, 'thiếu mảng "sections" (hoặc "questions")'); return null; }
  let n = 0;
  secs.forEach((s, k) => {
    const pre = secs.length > 1 ? `[${s.title || 'phần ' + (k + 1)}] ` : '';
    if (!s.title) bad(f, `phần ${k + 1}: thiếu "title"`);
    if (s.minutes !== undefined && !isInt(s.minutes, 1, 600)) bad(f, `${pre}"minutes" phải là số nguyên dương`);
    if (!Array.isArray(s.questions) || !s.questions.length) return bad(f, `${pre}thiếu mảng "questions"`);
    s.questions.forEach((q, i) => checkQ(f, q, i, pre));
    n += s.questions.length;
    console.log(`  ${f}${secs.length > 1 ? ' / ' + s.title : ''}: ${s.questions.length} câu`);
  });
  return { parts: secs.length, qs: n };
}

if (isFile) checkExam(target);
else {
  const idx = path.join(dir, 'index.json'), known = new Set(); let fixed = false, cfg = null;
  if (!fs.existsSync(idx)) bad('index.json', `không thấy ${idx}`);
  else {
    const c = cfg = read(idx);
    if (c) {
      if (!Array.isArray(c.exams) || !c.exams.length) bad('index.json', 'thiếu mảng "exams"');
      else {
        const ids = new Set();
        c.exams.forEach((e, k) => {
          const w = `exams[${k}]`;
          if (!e.id || !/^[\w-]+$/.test(e.id)) bad('index.json', `${w}: "id" chỉ gồm chữ, số, - và _`);
          if (ids.has(e.id)) bad('index.json', `${w}: id "${e.id}" bị trùng`); ids.add(e.id);
          if (!e.title) bad('index.json', `${w}: thiếu "title"`);
          if (e.minutes !== undefined && !isInt(e.minutes, 1, 600)) bad('index.json', `${w}: "minutes" phải là số nguyên dương`);
          const fn = e.file || e.id + '.json'; known.add(fn);
          const p = path.join(dir, fn);
          if (!fs.existsSync(p)) bad('index.json', `${w}: không thấy file ${fn}`);
          else { const r = checkExam(p); if (r && e.parts !== r.parts) { if (FIX) { e.parts = r.parts; fixed = true; console.log(`  ↻ ${e.id}: parts = ${r.parts}`); } else warn('index.json', `${w}: "parts" là ${e.parts} nhưng đề có ${r.parts} phần (chạy --fix để sửa)`); } }
        });
      }
      if (c.package !== undefined && typeof c.package !== 'string') bad('index.json', '"package" phải là chuỗi');
      if (c.webhook && !/^https:\/\//.test(c.webhook)) warn('index.json', '"webhook" nên là URL https');
    }
  }
  if (fixed) { fs.writeFileSync(idx, JSON.stringify(cfg, null, 2) + '\n'); console.log('  đã ghi lại index.json'); }
  fs.readdirSync(dir).filter(x => x.endsWith('.json') && x !== 'index.json' && !known.has(x)).forEach(x => warn(x, 'có file nhưng chưa khai báo trong index.json'));
}
console.log(errs ? `\n✗ ${errs} lỗi, ${warns} cảnh báo` : `\n✓ OK, 0 lỗi, ${warns} cảnh báo`);
process.exit(errs ? 1 : 0);
