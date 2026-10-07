// Day 21 前端接线验证：确认详情页与评论真的发公网绝对地址（不是相对路径）
// 跑法：node day21-frontend-check.cjs
// 为什么要单独验：后端 40 项全过不代表前端接线对了。
//   Day 21 的 bug 恰恰出在前端——代码写的是相对路径 fetch('/api/posts/'+id)，
//   请求发到静态托管自己名下必然 404。**后端有接口 ≠ 前端会调用它**。
// 做法：抽出 index.html 的 script，用 jsdom 起页面，拦截 fetch 记录 URL。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log('没找到 script 块'); process.exit(1); }
const script = m[1];

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};

console.log('\n=== 1. 静态检查：代码里还有没有相对路径 /api/ ===');
// ⚠️ 区分「注释里的示例」和「真代码」：注释行以 // 开头或前面是 * / * /
//   注释里写 fetch('/api/posts') 是在解释「为什么不能这么写」，不是真调用。
//   Day 21 第一版没区分，把我自己写的注释也报成 FAIL 了。
const lines = script.split('\n');
const commentRel = [];   // 注释里的示例（不算问题）
const codeRel = [];      // 真代码里的相对路径（算问题）
lines.forEach((l, i) => {
  if (!l.includes('fetch(') || !l.includes('/api/')) return;
  const t = l.trim();
  const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
  // 拼了 API_BASE 的行没问题（那正是修好的形态）
  if (l.includes('API_BASE')) return;
  if (isComment) commentRel.push('L' + (i + 1));
  else codeRel.push({ line: 'L' + (i + 1), code: t });
});

console.log('    注释里的示例（不算问题）：' + (commentRel.length ? commentRel.join(', ') : '无'));
check('注释里的相对路径示例已被识别（不误报）', commentRel.length > 0, '一条都没识别到，检查逻辑可能坏了');

console.log('    真代码里的相对路径：');
if (codeRel.length === 0) console.log('      无');
codeRel.forEach(c => console.log('      ' + c.line + '  ' + c.code));

// 已知遗留：发帖页与审核页的请求（Day 10 就有，今天清单明确不做新功能）
const KNOWN = [
  { re: /fetch\('\/api\/posts\?as=/, why: '发帖页提交（Day 10 遗留，今日不改）' },
  { re: /fetch\('\/api\/admin\/pending'\)/, why: '审核页读待审列表（Day 10 遗留，今日不改）' },
  { re: /fetch\('\/api\/admin\/posts\//, why: '审核页通过/拒绝（Day 10 遗留，今日不改）' },
];
const unexpected = codeRel.filter(c => !KNOWN.some(k => k.re.test(c.code)));
KNOWN.forEach(k => {
  const found = codeRel.some(c => k.re.test(c.code));
  console.log('      已知遗留：' + (found ? '✓ 在' : '✗ 不在') + ' —— ' + k.why);
});
check('相对路径只剩「已知遗留」，没有意料之外的新问题', unexpected.length === 0,
  JSON.stringify(unexpected));

console.log('\n=== 2. API_BASE 常量在不在 ===');
check('定义了 API_BASE', /const API_BASE\s*=\s*'https:\/\//.test(script));
const apiBase = (script.match(/const API_BASE\s*=\s*'([^']+)'/) || [])[1];
console.log('    API_BASE = ' + apiBase);

console.log('\n=== 3. jsdom 实跑：拦截 fetch 记录真实请求地址 ===');
const dom = new JSDOM(html, { url: 'https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com/#/post/p001', runScripts: 'dangerously' });
const w = dom.window;

const calls = [];
w.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url);
  calls.push({ url, method: (init && init.method) || 'GET', body: init && init.body });
  return Promise.resolve({
    ok: false, status: 404,
    json: () => Promise.resolve({ ok: false }),
    text: () => Promise.resolve('mock 404（不真连库）'),
  });
};

try { w.eval(script); } catch (e) { /* 页面脚本里报错不影响我们要的断言 */ }

setTimeout(() => {
  console.log('    抓到 ' + calls.length + ' 个请求：');
  calls.forEach(c => console.log('      ' + c.method + ' ' + c.url));

  console.log('\n=== 4. 断言：关键请求必须是公网绝对地址 ===');
  // Day 21 改用query 传 id：详情 = /api/post?id=xx，评论 = /api/comments
  const detailCall = calls.find(c => /\/post\?id=/.test(c.url) && c.method === 'GET');
  check('有请求打帖子详情（/api/post?id=）', !!detailCall);
  if (detailCall) {
    check('详情请求以 API_BASE 开头（公网网关）',
      detailCall.url.startsWith('https://falsity001-') && detailCall.url.includes('.app.tcloudbase.com'),
      detailCall.url);
    check('详情请求不是相对路径', !detailCall.url.startsWith('/api/'), detailCall.url);
    check('详情 id 走 query（网关不支持 {id} 路径参数）', /\/api\/post\?id=/.test(detailCall.url),
      detailCall.url);
  }

  const listCall = calls.find(c => /\/posts$/.test(c.url));
  check('首页列表请求打公网（回归 Day 20）',
    !!listCall && listCall.url.startsWith('https://'), listCall ? listCall.url : '没抓到');

  // 评论提交：手动触发一次表单提交，验证地址
  const before = calls.length;
  const form = w.document.getElementById('commentForm');
  if (form) {
    w.document.getElementById('cBody').value = 'Day 21 接线验证评论';
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  }
  setTimeout(() => {
    const commentCall = calls.slice(before).find(c => c.method === 'POST' && /\/comments(\?|$)/.test(c.url));
    check('有评论 POST 请求', !!commentCall);
    if (commentCall) {
      check('评论请求以 API_BASE 开头（公网网关）',
        commentCall.url.startsWith('https://falsity001-') && commentCall.url.includes('.app.tcloudbase.com'),
        commentCall.url);
      check('评论请求不是相对路径', !commentCall.url.startsWith('/api/'), commentCall.url);
      check('评论走固定路径 /api/comments（无路径参数）',
        /\/api\/comments$/.test(commentCall.url), commentCall.url);
      check('评论请求体带 body 字段', !!(commentCall.body && commentCall.body.includes('"body"')), commentCall.body);
      check('评论请求体带 post_id（编号在 body 不在 URL）',
        !!(commentCall.body && commentCall.body.includes('"post_id"')), commentCall.body);
    }

    console.log('\n=== 5. 其余该保持相对的（静态资源）===');
    check('posts.json 回退仍是相对路径（正确，同目录文件）', script.includes("fetch('posts.json')"));

    console.log('\n-----------------------------------');
    console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
    console.log('-----------------------------------\n');
    process.exit(fail ? 1 : 0);
  }, 400);
}, 600);
