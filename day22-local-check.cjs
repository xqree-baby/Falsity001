// Day 22 本地验证：PATCH / DELETE 的路由、校验、白名单、确认顺序
// 跑法：node day22-local-check.cjs
// 为什么需要它：规则五.5——要推到 GitHub / 要部署的东西，先在本地真跑一遍。
//   而且这次改的是「危险操作」，光看代码不算验证过，要看它真的挡得住脏输入。
// 做法：不连真数据库，把 ./db 这个模块换成一个假的（记录每次被调了什么），
//   然后起真HTTP 请求打进去，验状态码和返回体。
//   ⚠️ 验的是「业务逻辑对不对」，不是「数据库通不通」——数据库那头要等部署后实测。
const http = require('http');
const Module = require('module');

// ---------------- 假 db ----------------
const calls = [];
let postRow = null;      // 模拟「这篇帖子存在」
let commentRow = null;   // 模拟「这条评论存在」
const fakeDb = {
  async findPostForDetail(id) { calls.push('findPostForDetail:' + id); return postRow; },
  async updatePost(id, patch) {
    calls.push('updatePost:' + id + ':' + JSON.stringify(patch));
    if (!postRow) return undefined;                 // 命中 0 行
    postRow = { ...postRow, ...patch };
    return { ...postRow };                          // 模拟数据库退回改后那一行
  },
  async findCommentById(id) { calls.push('findCommentById:' + id); return commentRow; },
  async deleteComment(id) {
    calls.push('deleteComment:' + id);
    if (!commentRow) return undefined;
    const gone = commentRow; commentRow = null; return { ...gone };
  },
};
// 把 require('./db') 换成 fakeDb
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === './db' && parent && /api[\\/]index\.js$/.test(parent.filename)) return fakeDb;
  return origLoad.apply(this, arguments);
};
require('./functions/api/index.js');   // 起在 9000

// ---------------- 请求小工具 ----------------
function req(method, path, body, headers = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const r = http.request(
      { host: '127.0.0.1', port: 9000, path, method,
        headers: Object.assign(
          payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
          headers) },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (e) { /* 非 JSON 原样留 null */ }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
        });
      }
    );
    r.on('error', (e) => resolve({ status: 0, error: e.message }));
    if (payload) r.write(payload);
    r.end();
  });
}

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
};
const section = (t) => console.log('\n=== ' + t + ' ===');
const reset = () => { calls.length = 0; };

(async () => {
  // ---------- 1. CORS 预检：PATCH / DELETE 必须在白名单里 ----------
  section('1. CORS 预检白名单（漏了会静默失败：浏览器压根不发请求）');
  const opt = await req('OPTIONS', '/api/post');
  const allow = (opt.headers['access-control-allow-methods'] || '');
  console.log('    Allow-Methods = ' + allow);
  check('OPTIONS 返回 204', opt.status === 204, '实际 ' + opt.status);
  check('白名单含 PATCH', /PATCH/.test(allow));
  check('白名单含 DELETE', /DELETE/.test(allow));
  check('白名单仍含 GET/POST（不能把老的挤掉）', /GET/.test(allow) && /POST/.test(allow));

  // ---------- 2. PATCH 的参数与格式校验 ----------
  section('2. PATCH 参数校验');
  postRow = { id: 'p001', type: 'opinion', category: '求职面试', title: '旧标题', body: '正文',
              author: '在职老张', author_verified: true, views: 1580, created_at: '2026-09-15T10:30:00+08:00' };

  check('缺 id → 400', (await req('PATCH', '/api/post', { views: 1 })).status === 400);
  check('id 格式不对（pABC）→ 400', (await req('PATCH', '/api/post?id=pABC', { views: 1 })).status === 400);
  const badJson = await new Promise((resolve) => {
    // ⚠️ 长度必须用 Buffer.byteLength 实算，不能手写数字：
    //   写错了服务端会一直等剩下的字节，这个请求就永远不返回，整个脚本卡死。
    //   （第一版我就是手写了 5 而实际只有 4 字节，卡在这儿排查了半天。）
    const raw = '{bad';
    const r = http.request({ host: '127.0.0.1', port: 9000, path: '/api/post?id=p001', method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } }, (res) => {
      let out = ''; res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode, raw: out }));
    });
    r.write(raw); r.end();
  });
  check('请求体不是合法 JSON → 400', badJson.status === 400);

  const empty = await req('PATCH', '/api/post?id=p001', {});
  check('空请求体 → 400（不能当成「删空」）', empty.status === 400, '实际 ' + empty.status);
  console.log('    提示文案：' + (empty.body && empty.body.error));

  // ---------- 3. 白名单：系统字段不许改 ----------
  section('3. 白名单（不能让人改 id / created_at / pending）');
  const sys = await req('PATCH', '/api/post?id=p001', { pending: false, author: '冒名' });
  check('只传系统字段（pending/author）→ 400（等于什么都没让改）', sys.status === 400, '实际 ' + sys.status);
  console.log('    提示文案：' + (sys.body && sys.body.error));

  // ---------- 4. 字段类型校验 ----------
  section('4. 字段值校验（脏数据不许进库）');
  const cases = [
    ['views 传字符串 "999"', { views: '999' }],
    ['views 传负数', { views: -1 }],
    ['views 传小数', { views: 1.5 }],
    ['title 传空字符串', { title: '   ' }],
    ['title 超长（>200）', { title: 'x'.repeat(201) }],
    ['category 超长（>32）', { category: 'x'.repeat(33) }],
  ];
  for (const [name, body] of cases) {
    reset();
    const r = await req('PATCH', '/api/post?id=p001', body);
    check(name + ' → 400', r.status === 400, '实际 ' + r.status);
    check('  └ 校验失败时没有碰数据库', !calls.some((c) => c.startsWith('updatePost')), calls.join(' | '));
  }

  // ---------- 5. 帖子不存在 → 404，且没发更新 ----------
  section('5. 确认①：对象必须存在');
  reset();
  postRow = null;
  const nf = await req('PATCH', '/api/post?id=p999', { views: 5 });
  check('帖子不存在 → 404', nf.status === 404, '实际 ' + nf.status);
  check('  └ 没有向数据库发更新（先查后改）', !calls.some((c) => c.startsWith('updatePost')), calls.join(' | '));
  console.log('    调用顺序：' + calls.join(' → '));

  // ---------- 6. 成功 PATCH：before/after 都来自数据库 ----------
  section('6. PATCH 成功：前后值对比');
  reset();
  postRow = { id: 'p001', type: 'opinion', category: '求职面试', title: '旧标题', body: '正文',
              author: '在职老张', author_verified: true, views: 1580, created_at: '2026-09-15T10:30:00+08:00' };
  const ok = await req('PATCH', '/api/post?id=p001', { views: 1699 });
  check('→ 200', ok.status === 200, '实际 ' + ok.status + ' ' + ok.raw.slice(0, 120));
  check('调用顺序是「先查后改」', calls[0] === 'findPostForDetail:p001' && calls[1].startsWith('updatePost'), calls.join(' → '));
  check('发给数据库的只有 views 一个键', calls[1] === 'updatePost:p001:{"views":1699}', calls[1]);
  console.log('    changed = ' + JSON.stringify(ok.body && ok.body.changed));
  check('changed 里 before 是旧值 1580', ok.body && ok.body.changed[0].before === 1580);
  check('changed 里 after 是新值 1699', ok.body && ok.body.changed[0].after === 1699);
  check('顶层 post.views 是库里的真值 1699', ok.body && ok.body.post.views === 1699);

  // 多字段 + 传了系统字段 → 明确回显 ignoredFields
  reset();
  postRow = { ...postRow, views: 1699 };
  const multi = await req('PATCH', '/api/post?id=p001', { views: 1700, category: '职场新人', id: 'p999' });
  check('多字段 PATCH → 200', multi.status === 200);
  console.log('    ignoredFields = ' + JSON.stringify(multi.body && multi.body.ignoredFields));
  check('被忽略的字段被明确回显（不无声吞掉）', Array.isArray(multi.body && multi.body.ignoredFields) && multi.body.ignoredFields.includes('id'));
  check('  └ id 没被真的改掉', multi.body && multi.body.post.id === 'p001', JSON.stringify(multi.body && multi.body.post));

  // ---------- 7. DELETE 的确认顺序 ----------
  section('7. DELETE：删之前必须先查（顺序反了就变成先删后看）');
  reset();
  commentRow = null;
  const dnf = await req('DELETE', '/api/comments?id=c999');
  check('评论不存在 → 404', dnf.status === 404, '实际 ' + dnf.status);
  console.log('    提示文案：' + (dnf.body && dnf.body.error));
  check('  └ 没有执行删除', !calls.some((c) => c.startsWith('deleteComment')), calls.join(' | '));
  console.log('    调用顺序：' + calls.join(' → '));

  check('DELETE 缺 id → 400', (await req('DELETE', '/api/comments')).status === 400);

  reset();
  commentRow = { id: 'cmtest01', post_id: 'p001', author: '宝宝', body: '这条待会被删掉',
                 created_at: '2026-10-08T10:00:00.000Z' };
  const dok = await req('DELETE', '/api/comments?id=cmtest01');
  check('评论存在 → 200', dok.status === 200, '实际 ' + dok.status);
  check('调用顺序是「先查后删」', calls[0] === 'findCommentById:cmtest01' && calls[1] === 'deleteComment:cmtest01', calls.join(' → '));
  console.log('    deleted = ' + JSON.stringify(dok.body && dok.body.deleted));
  check('回执里带回了被删那条的正文（删了就查不回来了）',
        dok.body && dok.body.deleted && dok.body.deleted.body === '这条待会被删掉');

  // ---------- 8. 真删之后不该还在 ----------
  reset();
  const again = await req('DELETE', '/api/comments?id=cmtest01');
  check('同一条再删一次 → 404（不会静默成功）', again.status === 404, '实际 ' + again.status);

  // ---------- 9. 老接口没被碰坏 ----------
  section('9. 回归：老路由还认（改了 Allow-Methods 别把 GET/POST 挤掉）');
  const g = await req('GET', '/api/posts');
  check('GET /api/posts 仍进业务层（此处会因假 db 报错，但不是 404）', g.status !== 404, '实际 ' + g.status);
  const gp = await req('GET', '/api/post?id=p001');
  check('GET /api/post?id=p001 仍进业务层', gp.status !== 404, '实际 ' + gp.status);
  const u404 = await req('GET', '/api/nothing');
  check('未注册路径仍是 404 且带 receivedPath', u404.status === 404 && u404.body && !!u404.body.receivedPath);

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail === 0 ? 0 : 1);
})();
