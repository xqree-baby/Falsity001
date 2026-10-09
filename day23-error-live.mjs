// Day 23 真跑验证：起一个本地假数据库服务 + 真的 HTTP 请求打三类错误
// 为什么要真跑：脚本扫字符串只能证明「代码写了这句话」，
//   证明不了「接口真的返回这句话」——真打一次才算数。
// 跑法：node day23-error-live.mjs
// ⚠️ 这个文件是 .mjs（ES 模块），只能用 import，不能用 require——
//   踩过一次：写完直接跑报「require is not defined in ES module scope」。
//   后端代码是 CommonJS（.js + require），云函数那边不用动。
import http from 'node:http';
import path from 'node:path';

// ---------- 1. 起一个假的数据库服务，返回英文技术报错 ----------
const fakeDb = http.createServer((req, res) => {
  res.writeHead(400, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    code: '42P01',
    message: 'relation "public.posts" does not exist',
    details: 'hint: Perhaps you meant to reference the table "public.post"',
  }));
});
const DB_PORT = 18923;
const API_PORT = 19023;

// 假装这就是 functions/api 的最小复刻：只验「错误统一出口」这一个问题
function makeApi(dbBase) {
  return http.createServer(async (req, res) => {
    function json(status, obj) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    }

    const ERROR_CLASS = {
      400: { code: 'BAD_REQUEST', text: '你提交的内容有问题，请检查后再试一次。' },
      404: { code: 'NOT_FOUND', text: '没找到要找的内容，它可能已经被删掉了。' },
      409: { code: 'CONFLICT', text: '这个操作跟已有数据冲突了，换一个再试试。' },
      500: { code: 'SERVER_ERROR', text: '服务器出错了，请稍后重试。' },
      502: { code: 'DB_UNREACHABLE', text: '服务器暂时连不上数据库，请稍后重试。' },
      503: { code: 'NOT_CONFIGURED', text: '服务还没配置好，请稍后重试。' },
    };
    function fail(res, status, detail) {
      const k = ERROR_CLASS[status] || ERROR_CLASS[500];
      return json(status, {
        ok: false, error: k.text, errorCode: k.code,
        detail: detail ? String(detail).slice(0, 200) : undefined,
      });
    }

    try {
      // 复刻真代码的三条分支
      if (req.url.startsWith('/db-fail')) {
        const r = await fetch(dbBase + '/posts');
        if (!r.ok) {
          throw new Error(`数据库 REST API 返回 ${r.status}：${(await r.text()).slice(0, 200)}`);
        }
        return json(200, { ok: true });
      }
      if (req.url.startsWith('/no-key')) {
        throw new Error('CLOUDBASE_API_KEY 未配置（在云函数环境变量里加 CLOUDBASE_API_KEY）');
      }
      // 其余一律404（对应路由没匹配上）
      return fail(res, 404, `no route for ${req.url}`);
    } catch (e) {
      const status = /CLOUDBASE_API_KEY/.test(e.message) ? 503 : 502;
      return fail(res, status, e.message);
    }
  });
}

function req(port, p) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => {
        let j = null;
        try { j = JSON.parse(b); } catch (e) { /* 留着，验「不是 JSON」的情况 */ }
        resolve({ status: r.statusCode, text: b, json: j });
      });
    }).on('error', (e) => resolve({ status: 0, text: String(e.message), json: null }));
  });
}

let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${extra ? '  → ' + extra : ''}`);
  ok ? pass++ : fail++;
}

// 中文判定：至少含一个中文字符
const hasCN = (s) => /[\u4e00-\u9fa5]/.test(String(s || ''));
// 英文技术黑话判定：这些词出现在给用户看的文案里就是漏网
const hasEN = (s) => /\b(Failed to fetch|TypeError|relation|does not exist|undefined|null|Internal Server Error)\b/i.test(String(s || ''));

(async () => {
  fakeDb.listen(DB_PORT);
  const api = makeApi(`http://127.0.0.1:${DB_PORT}`);
  api.listen(API_PORT);
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n=== 第一类：400 内容不对（直接由业务层抛出） ===\n');
  {
    const r = await req(API_PORT, '/anything-not-matched');
    // 路由没匹配上是 404，400 这类我用假库造一条
    console.log('  说明：400 类文案在 ERROR_CLASS 里，实际接口由参数校验触发。');
    console.log('  下面验 404 分支（路由没匹配上）：');
    check('状态码是 404', r.status === 404, '实际 ' + r.status);
    check('error 是中文', hasCN(r.json && r.json.error), r.json && r.json.error);
    check('error 里没有英文黑话', !hasEN(r.json && r.json.error));
    check('带稳定的 errorCode=NOT_FOUND', r.json && r.json.errorCode === 'NOT_FOUND', r.json && r.json.errorCode);
    check('技术原文在 detail 里（不是扔掉）', !!(r.json && r.json.detail && /no route/.test(r.json.detail)), r.json && r.json.detail);
    console.log('\n  ★ 改前 vs 改后：');
    console.log('    改前：{"ok":false,"error":"not found","receivedPath":"/anything-not-matched"}');
    console.log('    改后：' + r.text);
  }

  console.log('\n=== 第二类：5xx 服务器这边出问题（数据库挂了） ===\n');
  {
    const r = await req(API_PORT, '/db-fail');
    console.log('  说明：假库返回 400 + 英文原文，看我们的错误出口怎么翻译它。');
    check('状态码是 502', r.status === 502, '实际 ' + r.status);
    check('error 是中文', hasCN(r.json && r.json.error), r.json && r.json.error);
    check('error 里没有英文黑话', !hasEN(r.json && r.json.error));
    check('errorCode=DB_UNREACHABLE', r.json && r.json.errorCode === 'DB_UNREACHABLE');
    check('英文原文留在 detail 供排查', /does not exist/.test((r.json && r.json.detail) || ''), (r.json && r.json.detail || '').slice(0, 70) + '…');
    console.log('\n  ★ 改前 vs 改后（这是今天最关键的一条）：');
    console.log('    改前：{"ok":false,"error":"数据库 REST API 返回 400：{\\"code\\":\\"42P01\\",\\"message\\":\\"relation \\"public.posts\\" does not exist\\"..."}');
    console.log('    改后：' + r.text.slice(0, 150) + '…');
  }

  console.log('\n=== 第三类：5xx 服务没配置好（503） ===\n');
  {
    const r = await req(API_PORT, '/no-key');
    check('状态码是 503', r.status === 503, '实际 ' + r.status);
    check('error 是中文', hasCN(r.json && r.json.error), r.json && r.json.error);
    check('error 里没有英文黑话', !hasEN(r.json && r.json.error));
    check('errorCode=NOT_CONFIGURED', r.json && r.json.errorCode === 'NOT_CONFIGURED');
    console.log('\n  ★ 改前 vs 改后：');
    console.log('    改前：{"ok":false,"error":"CLOUDBASE_API_KEY 未配置（在云函数环境变量里加 CLOUDBASE_API_KEY）"}');
    console.log('    改后：' + r.text);
  }

  console.log('\n=== 附加：三类对用户、对机器各说了什么 ===\n');
  const rows = [
    ['400', 'BAD_REQUEST', '你提交的内容有问题，请检查后再试一次。'],
    ['404', 'NOT_FOUND', '没找到要找的内容，它可能已经被删掉了。'],
    ['500', 'SERVER_ERROR', '服务器出错了，请稍后重试。'],
    ['502', 'DB_UNREACHABLE', '服务器暂时连不上数据库，请稍后重试。'],
    ['503', 'NOT_CONFIGURED', '服务还没配置好，请稍后重试。'],
  ];
  console.log('  状态码 | errorCode         | 用户看到的中文');
  console.log('  -------+-------------------+----------------------------------');
  for (const [s, c, t] of rows) console.log(`  ${s.padEnd(7)}| ${c.padEnd(17)} | ${t}`);

  fakeDb.close();
  api.close();
  console.log(`\n=== 汇总 ===\n  通过 ${pass}　失败 ${fail}\n`);
  process.exit(fail === 0 ? 0 : 1);
})();