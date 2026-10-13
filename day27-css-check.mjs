// Day 27：本地 CSS 语法自检（提交前必须过，AGENTS.md 第五条第 5 点）
// 只做两件事：① 大括号配平 ② 确认这次要加的规则真的写进去了
import fs from 'fs';
import path from 'path';

const file = process.argv[2] || 'public/style.css';
const css = fs.readFileSync(file, 'utf8');

let depth = 0, line = 1, badLine = 0;
for (const ch of css) {
  if (ch === '\n') line++;
  if (ch === '{') depth++;
  if (ch === '}') {
    depth--;
    if (depth < 0 && !badLine) { badLine = line; break; }
  }
}

const checks = [
  ['大括号配平', depth === 0 && !badLine, depth === 0 && !badLine ? '平衡' : `差 ${depth}${badLine ? '，第' + badLine + '行多了 }' : ''}`],
  ['nav链接禁止换行', /white-space:\s*nowrap/.test(css), ''],
  ['手机端断点 640px', /@media\s*\(max-width:\s*640px\)/.test(css), ''],
  ['发帖入口视觉区分', /nav\s+a\[data-nav=["']submit["']\]/.test(css), ''],
  ['原有 960px 断点仍在', /@media\s*\(max-width:\s*960px\)/.test(css), '不能被误删'],
  ['reduced-motion 未被动', /prefers-reduced-motion/.test(css), ''],
];

console.log(`CSS 自检：${file}（${css.length} 字节）\n`);
let fail = 0;
for (const [name, ok, note] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? '[通过]' : '[失败]'} ${name}${note ? '  —— ' + note : ''}`);
}
console.log(fail ? `\n结论：${fail} 项失败` : '\n结论：全部通过');
process.exit(fail ? 1 : 0);