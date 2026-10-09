// Day 23 自查脚本：验证三类错误提示统一改到位了
// 跑法：node day23-error-check.cjs
// 做两件事：
//   1. 把四个 HTML 里的 <script> 抠出来交给 node --check，抓语法错（最容易翻车的地方）
//   2. 扫一遍「还在直接显示裸报错」的老写法，确认都改掉了
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const PUB = path.join(__dirname, 'public');
const pages = ['index.html', 'post.html', 'admin.html', 'submit.html'];

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  [${tag}] ${name}${extra ? '  → ' + extra : ''}`);
  ok ? pass++ : fail++;
}

// ---------- 第一部分：JS 语法 ----------
console.log('\n=== 1. 四个页面的内联 JS 语法检查 ===\n');
for (const p of pages) {
  const html = fs.readFileSync(path.join(PUB, p), 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) { check(`${p} 有 <script>`, false, '没找到 script 块'); continue; }
  // ⚠️ 这里不用 node --check 起子进程，两个原因都踩过：
  //   1) 临时文件放项目目录会被文件监听器占用 → EBUSY
  //   2) 挪到系统临时目录后仍 EBUSY —— 这个沙箱不允许 node 进程再 spawn 自己
  //   所以改用 vm.Script 在当前进程内「只解析不执行」：
  //   它调的正是 V8 的编译器，跟 node --check 是同一套语法判定，够用了。
  //   （教训跟 Day 21 那次一样：探针自己坏掉时，别拿它的失败当结论。）
  try {
    new vm.Script(m[1], { filename: p });
    check(`${p} 内联 JS 语法`, true);
  } catch (e) {
    check(`${p} 内联 JS 语法`, false, String(e.message).split('\n')[0]);
  }
}

// ---------- 第二部分：三类错误提示 ----------
console.log('\n=== 2. 三类错误提示（按 HTTP 语义）都在不在 ===\n');

const idx = fs.readFileSync(path.join(__dirname, 'functions/api/index.js'), 'utf8');

check('400 类：内容不对，有中文文案',
  /400:\s*\{\s*code:\s*'BAD_REQUEST',\s*text:\s*'[^']*[一-龥]/.test(idx));
check('404 类：找不到，有中文文案',
  /404:\s*\{\s*code:\s*'NOT_FOUND',\s*text:\s*'[^']*[一-龥]/.test(idx));
check('5xx 类：服务器出错，有中文文案',
  /500:\s*\{\s*code:\s*'SERVER_ERROR',\s*text:\s*'[^']*[一-龥]/.test(idx) &&
  /502:\s*\{\s*code:\s*'DB_UNREACHABLE',\s*text:\s*'[^']*[一-龥]/.test(idx) &&
  /503:\s*\{\s*code:\s*'NOT_CONFIGURED',\s*text:\s*'[^']*[一-龥]/.test(idx));
check('三类都有稳定的机器可读 code（前端不用猜中文）',
  ['BAD_REQUEST', 'NOT_FOUND', 'SERVER_ERROR', 'DB_UNREACHABLE', 'NOT_CONFIGURED']
    .every(c => idx.includes(c)));
check('技术原文单独放 detail，不再混进用户可见的 error',
  /detail:\s*detail\s*\?/.test(idx));
check('路由没匹配上时不再回英文 not found',
  !/error:\s*'not found'/.test(idx) && idx.includes('fail(res, 404'));
check('兜底 catch 走统一出口，不再原样吐 e.message',
  /return fail\(res, status, e\.message\)/.test(idx));

// ---------- 第三部分：前端不再显示裸报错 ----------
console.log('\n=== 3. 前端四个页面：英文裸报错都换掉了 ===\n');

for (const p of pages) {
  const html = fs.readFileSync(path.join(PUB, p), 'utf8');
  check(`${p} 已有 friendlyText/friendlyError 翻译函数`,
    /function friendlyText|friendlyText/.test(html));
}

// 只在错误展示语境里出现的才算问题，声明定义本身不算
const BAD_PATTERNS = [
  { name: 'escapeHtml(String(e))', re: /escapeHtml\(String\(e\)\)/g },
  { name: "escapeHtml(String(e.message || e))", re: /escapeHtml\(String\(e\.message \|\| e\)\)/g },
  { name: "'失败：' + e.message", re: /'失败：'\s*\+\s*e\.message/g },
  { name: '加载失败：+ r.status（数字给用户看）', re: /(?:data|err)\.error \|\| r\.status/g },
];

for (const p of pages) {
  const html = fs.readFileSync(path.join(PUB, p), 'utf8');
  for (const bp of BAD_PATTERNS) {
    const hits = (html.match(bp.re) || []).length;
    check(`${p} 无「${bp.name}」`, hits === 0, hits ? `还剩 ${hits} 处` : '');
  }
}

// ---------- 第四部分：三类前端网络错误都能翻成人话 ----------
console.log('\n=== 4. 前端三类网络错误都能翻成人话 ===\n');
const idxHtml = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
check('网络不通（Failed to fetch）→ 有中文',
  /Failed to fetch[\s\S]{0,120}连不上服务器/.test(idxHtml));
check('响应超时（timeout/abort）→ 有中文',
  /timeout\|abort[\s\S]{0,120}响应太慢/.test(idxHtml));
check('返回不是 JSON → 有中文',
  /Unexpected token[\s\S]{0,140}格式不对/.test(idxHtml));

// ---------- 汇总 ----------
console.log('\n=== 汇总 ===\n');
console.log(`  通过 ${pass}　失败 ${fail}\n`);
process.exit(fail === 0 ? 0 : 1);