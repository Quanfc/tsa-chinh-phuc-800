#!/usr/bin/env node
// Kiểm tra toàn bộ đề trong thư mục exams/.  Cách dùng:
//   node validate.js            -> kiểm tra ./exams
//   node validate.js exams/de2.json   -> kiểm tra riêng một file
// Thoát với mã 1 nếu có lỗi (✗). Cảnh báo (⚠) không làm fail.
const fs = require('fs'), path = require('path');
const target = process.argv[2] || 'exams';
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

function checkQ(f, q, i) {
  const w = `câu ${i + 1}`, ph = [...String(q.q).matchAll(/\[\[(\d+)\]\]/g)].map(m => +m[1]);
  if (typeof q.q !== 'string' || !q.q.trim()) bad(f, `${w}: thiếu nội dung "q"`);
  if (!['mc', 'mcm', 'tf', 'fill', 'drag'].includes(q.t)) return bad(f, `${w}: "t" phải là mc | mcm | tf | fill | drag (đang là ${JSON.stringify(q.t)})`);
  if (q.warn) warn(f, `${w}: Gemini ghi chú: ${q.warn}`);
  latex(f, w, q.q);
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
  if (!d) return 0;
  if (!d.title) warn(f, 'thiếu "title" (sẽ lấy tên trong index.json)');
  if (d.minutes !== undefined && !isInt(d.minutes, 1, 600)) bad(f, '"minutes" phải là số nguyên dương');
  if (!Array.isArray(d.questions) || !d.questions.length) { bad(f, 'thiếu mảng "questions"'); return 0; }
  d.questions.forEach((q, i) => checkQ(f, q, i));
  console.log(`  ${f}: ${d.questions.length} câu`);
  return d.questions.length;
}

if (isFile) checkExam(target);
else {
  const idx = path.join(dir, 'index.json'), known = new Set();
  if (!fs.existsSync(idx)) bad('index.json', `không thấy ${idx}`);
  else {
    const c = read(idx);
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
          if (!fs.existsSync(p)) bad('index.json', `${w}: không thấy file ${fn}`); else checkExam(p);
        });
      }
      if (c.webhook && !/^https:\/\//.test(c.webhook)) warn('index.json', '"webhook" nên là URL https');
    }
  }
  fs.readdirSync(dir).filter(x => x.endsWith('.json') && x !== 'index.json' && !known.has(x)).forEach(x => warn(x, 'có file nhưng chưa khai báo trong index.json'));
}
console.log(errs ? `\n✗ ${errs} lỗi, ${warns} cảnh báo` : `\n✓ OK, 0 lỗi, ${warns} cảnh báo`);
process.exit(errs ? 1 : 0);
