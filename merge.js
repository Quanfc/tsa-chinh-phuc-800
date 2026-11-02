#!/usr/bin/env node
// Ghép nhiều phần (mỗi phần Gemini xuất một file) thành một đề nhiều phần.
//   node merge.js "Đề Số 02" exams/de02.json toan.json dochieu.json khoahoc.json
//   node merge.js "Đề Số 02" exams/de02.json toan1.json+toan2.json dochieu.json   (toan1+toan2 = một phần)
// Mỗi file vào có thể là: một phần {title, minutes, questions}, hoặc {sections:[...]}, hoặc mảng câu hỏi.
const fs = require('fs'), path = require('path');
const [title, out, ...ins] = process.argv.slice(2);
if (!title || !out || !ins.length) { console.log('Cách dùng: node merge.js "Tên đề" exams/de02.json phan1.json phan2.json ...'); process.exit(1); }
const sections = [];
const load = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')); } catch (e) { console.log(`✗ ${f}: JSON sai cú pháp: ${e.message}`); process.exit(1); } };
const qs = d => Array.isArray(d) ? d : (d.questions || []);
for (const arg of ins) {
  // "toan1.json+toan2.json" = nối các file thành CÙNG MỘT phần (khi Gemini xuất một phần dài thành nhiều lượt)
  const ds = arg.split('+').map(load);
  if (ds[0].sections) { sections.push(...ds[0].sections); continue; }
  const first = ds[0];
  sections.push({ title: first.title || path.basename(arg.split('+')[0], '.json'), minutes: first.minutes || 60, questions: ds.flatMap(qs) });
}
fs.writeFileSync(out, JSON.stringify({ title, sections }, null, 1));
console.log(`✓ Đã ghi ${out}: ${sections.length} phần, ${sections.reduce((n, s) => n + (s.questions || []).length, 0)} câu. Chạy tiếp: node validate.js --fix`);
