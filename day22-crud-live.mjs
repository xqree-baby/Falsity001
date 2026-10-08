// Day 22 板块③：增 / 删 / 改 / 查 四类操作闭环验证（打真公网）
// 跑法：node day22-crud-live.mjs
//
// 目标：把四类操作在同一篇帖子上走完一遍，每一步都留下真实返回，供截图。
// 为什么单独一个脚本：板块①② 各验一段（PATCH 逻辑、DELETE 逻辑），
//   但「四类操作凑在一起还认不认得彼此」是另一回事——
//   比如改完的帖子列表页还认得出吗、删完再查会不会把整页搞挂。
//
// ⚠️ 会真改数据：p001 的 views 会被改成 1688（原来 1580）。
//   这是故意留下的痕迹——截图需要「改之前/之后」的对比。
//   改回原值的命令在最后一行输出里，你自己决定要不要跑。
//
// ⚠️ 脚本带 Origin 头（Day 20 教训）：node fetch 不发 Origin，
//   网关就不加自己那份 ACAO，看起来一切正常但浏览器照样失败。

import fs from 'node:fs';

const BASE = 'https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com';
const ORIGIN = 'https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com';
const H = { Origin: ORIGIN, 'Content-Type': 'application/json' };

// 闭环用p006（开工前评论数 = 0，干净）；改操作拿 p001（有 views 字段、好对比）
const P_CLEAN = 'p006';
const P_EDIT = 'p001';
const VIEWS_FROM = 1580;
const VIEWS_TO = 1688;
const MARKER = '【Day22 闭环测试】这条会被改完再删掉';

const steps = [];   // 每一步都记下来，最后渲染成截图
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '\n         -> ' + extra : '')); }
};
const step = (no, title, req, res, note) => {
  steps.push({ no, title, req, status: res.status, res, note });
  console.log(`\n--- 步骤${no} ${title} ---`);
  console.log('  请求：' + req);
  console.log('  状态：' + res.status);
  console.log('  返回：' + (res.json ? JSON.stringify(res.json) : res.raw).slice(0, 400));
};

async function call(method, path, body) {
  const opt = { method, headers: { ...H }, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) opt.body = JSON.stringify(body);
  let res, text;
  try {
    res = await fetch(BASE + path, opt);
    text = await res.text();
  } catch (e) {
    return { status: 0, netError: e.message, raw: '', json: null };
  }
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON 留 null */ }
  return { status: res.status, json, raw: text };
}
const j = (r) => JSON.stringify(r.json ?? r.raw);

(async () => {
  console.log('=== Day 22 板块③ 四类操作闭环（真环境） ===');

  // ========== 环节一：查（读）—— 拿改之前的基准值 ==========
  console.log('\n\n########## 环节一：查 GET ##########');
  const r1 = await call('GET', `/api/post?id=${P_EDIT}`);
  step(1, `查 ${P_EDIT} 的原始值（改之前的基准）`,
    `GET /api/post?id=${P_EDIT}`, r1, '记下views 的原值，这就是「改之前」');
  check('GET 返回 200', r1.status === 200, '实际 ' + r1.status);
  const viewsBefore = r1.json?.post?.views;
  console.log('  ★ 改之前 views = ' + viewsBefore);
  check('★ 改之前 views 是 ' + VIEWS_FROM + '（和开工前查到的一致）',
    viewsBefore === VIEWS_FROM, '实际 ' + viewsBefore);

  const r2 = await call('GET', `/api/post?id=${P_CLEAN}`);
  step(2, `查 ${P_CLEAN} 现有评论（闭环起点）`,
    `GET /api/post?id=${P_CLEAN}`, r2, '开工前是 0 条');
  const cBefore = r2.json?.post?.comments?.length ?? -1;
  console.log('  ★ 闭环前评论数 = ' + cBefore);
  check('闭环前' + P_CLEAN + ' 评论数 = 0', cBefore === 0, '实际 ' + cBefore);

  // ========== 环节二：增（POST） ==========
  console.log('\n\n########## 环节二：增 POST ##########');
  const r3 = await call('POST', '/api/comments', { post_id: P_CLEAN, author: '宝宝', body: MARKER });
  step(3, '发一条评论（增）',
    `POST /api/comments  {"post_id":"${P_CLEAN}","author":"宝宝","body":"${MARKER}"}`,
    r3, '拿到新 id 供后面删');
  check('POST 返回 201', r3.status === 201, '实际 ' + r3.status);
  const newCid = r3.json?.comment?.id;
  console.log('  ★ 新评论 id = ' + newCid);
  check('拿到了新评论 id', !!newCid);

  // ========== 环节三：查（确认增生效） ==========
  console.log('\n\n########## 环节三：查 GET（确认增生效） ##########');
  const r4 = await call('GET', `/api/post?id=${P_CLEAN}`);
  const cAfterAdd = r4.json?.post?.comments ?? [];
  step(4, `再查 ${P_CLEAN}：新评论应该已经在了`,
    `GET /api/post?id=${P_CLEAN}`, r4, '确认「增」真的落库了');
  check('GET 返回 200', r4.status === 200);
  check('★ 新评论已出现在列表里', cAfterAdd.some((c) => c.id === newCid));
  console.log('  ★ 增之后评论数 = ' + cAfterAdd.length+ '，内容 = ' +
    JSON.stringify(cAfterAdd.map((c) => c.id)));

  // ========== 环节四：改（PATCH） ==========
  console.log('\n\n########## 环节四：改 PATCH ##########');
  const r5 = await call('PATCH', `/api/post?id=${P_EDIT}`, { views: VIEWS_TO });
  step(5, `把 ${P_EDIT} 的 views 从 ${VIEWS_FROM} 改成 ${VIEWS_TO}`,
    `PATCH /api/post?id=${P_EDIT}  {"views":${VIEWS_TO}}`, r5,
    'changed 数组里就是改前/改后对比');
  check('PATCH 返回 200', r5.status === 200, '实际 ' + r5.status + ' ' + r5.raw.slice(0, 200));
  const chg = r5.json?.changed?.[0];
  console.log('  ★ changed = ' + JSON.stringify(r5.json?.changed));
  check('★ changed 里 before = ' + VIEWS_FROM, chg?.before === VIEWS_FROM, JSON.stringify(chg));
  check('★ changed 里 after = ' + VIEWS_TO, chg?.after === VIEWS_TO, JSON.stringify(chg));
  check('★ after 值来自数据库不是回显请求体', r5.json?.post?.views === VIEWS_TO);

  // 改完立刻查一遍——证明「改了库里就真的变了」，不是只在响应里看着变了
  const r6 = await call('GET', `/api/post?id=${P_EDIT}`);
  step(6, `改完立刻再查 ${P_EDIT}（确认改落库了）`,
    `GET /api/post?id=${P_EDIT}`, r6, '这一步是「改」是否真生效的独立证据');
  check('★ 再查时 views 已是新值 ' + VIEWS_TO, r6.json?.post?.views === VIEWS_TO,
    '实际 ' + r6.json?.post?.views);

  // 列表接口也认这个新值吗（证明改的没把别的接口搞坏）
  const r6b = await call('GET', '/api/posts');
  const inList = r6b.json?.posts?.find((p) => p.id === P_EDIT);
  console.log('  ★ 列表接口里 ' + P_EDIT + ' 的 views = ' + inList?.views);
  check('★ 列表接口也返回新值（改没搞坏别的接口）', inList?.views === VIEWS_TO,
    '实际 ' + inList?.views);

  // ========== PATCH 的安全栏在真机上也要成立 ==========
  console.log('\n\n########## 附加：PATCH 安全栏在真机上生效吗 ##########');
  const r7 = await call('PATCH', `/api/post?id=${P_EDIT}`, { views: -1 });
  check('views 传负数 → 400（真机也挡得住）', r7.status === 400, '实际 ' + r7.status + ' ' + r7.raw.slice(0, 150));
  console.log('  ' + r7.raw.slice(0, 150));
  const r8 = await call('PATCH', `/api/post?id=p999`, { views: 5 });
  check('改不存在的帖子 → 404', r8.status === 404, '实际 ' + r8.status);
  console.log('  ' + r8.raw.slice(0, 150));
  const r9 = await call('PATCH', `/api/post?id=${P_EDIT}`, {});
  check('空请求体 → 400（不当成删空）', r9.status === 400, '实际 ' + r9.status);
  const r10 = await call('PATCH', `/api/post?id=${P_EDIT}`, { id: 'p999', pending: false, created_at: '1900-01-01T00:00:00Z' });
  check('只传系统字段 → 400（系统字段改不了）', r10.status === 400, '实际 ' + r10.status);
  // 验证系统字段真的没被改（这条最关键：要查库看，不是看响应）
  const r11 = await call('GET', `/api/post?id=${P_EDIT}`);
  check('★ 库里的 id 仍是 ' + P_EDIT + '（没被请求体改掉）', r11.json?.post?.id === P_EDIT,
    '实际 ' + r11.json?.post?.id);
  check('★ created_at 没被改掉（仍是 2026-09-15）',
    String(r11.json?.post?.createdAt || '').startsWith('2026-09-15'),
    '实际 ' + r11.json?.post?.createdAt);

  // ========== 环节五：删（DELETE） ==========
  console.log('\n\n########## 环节五：删 DELETE ##########');
  const r12 = await call('DELETE', `/api/comments?id=${newCid}`);
  step(7, '删掉刚才发的那条评论（删）',
    `DELETE /api/comments?id=${newCid}`, r12, '回执带回了删掉的是哪条');
  check('DELETE 返回 200', r12.status === 200, '实际 ' + r12.status);
  check('★ 回执里带回了正文（不可逆操作要留回执）',
    r12.json?.deleted?.body === MARKER, j(r12));

  // ========== 环节六：查（确认删后不再返回）—— 完成标准的核心 ==========
  console.log('\n\n########## 环节六：查 GET（确认删后不再返回） ##########');
  const r13 = await call('GET', `/api/post?id=${P_CLEAN}`);
  const cAfterDel = r13.json?.post?.comments ?? [];
  step(8, `最后再查 ${P_CLEAN}：那条评论必须已消失`,
    `GET /api/post?id=${P_CLEAN}`, r13,
    '★ 这就是今天第二张截图要的证据');
  check('GET 返回 200（删完之后接口还好好的）', r13.status === 200, '实际 ' + r13.status);
  check('★ 被删的那条已不再返回', !cAfterDel.some((c) => c.id === newCid));
  check('★ 它的正文也不再出现', !cAfterDel.some((c) => c.body === MARKER));
  check('★ 评论数回到 ' + cBefore + '（闭环了）', cAfterDel.length === cBefore,
    '实际 ' + cAfterDel.length);
  console.log('  ★ 闭环前 ' + cBefore + ' 条 → 增后 ' + cAfterAdd.length +
    ' 条 → 删后 ' + cAfterDel.length + ' 条');

  // ==========收尾：把 views 改回原值 ==========
  console.log('\n\n########## 收尾：把 views 改回原值（可选） ##########');
  const r14 = await call('PATCH', `/api/post?id=${P_EDIT}`, { views: VIEWS_FROM });
  console.log('  改回 ' + VIEWS_FROM + ' → ' + r14.status + ' ' + r14.raw.slice(0, 200));
  const r15 = await call('GET', `/api/post?id=${P_EDIT}`);
  console.log('  现在 views = ' + r15.json?.post?.views);
  check('已改回原值 ' + VIEWS_FROM, r15.json?.post?.views === VIEWS_FROM);

  // 全部真实返回存下来，供渲染截图
  fs.writeFileSync('.workbuddy/d22-crud.json', JSON.stringify({
    pass, fail, VIEWS_FROM, VIEWS_TO, P_EDIT, P_CLEAN, newCid, MARKER,
    steps: steps.map((s) => ({ no: s.no, title: s.title, req: s.req, status: s.status, res: s.res })),
  }, null, 2), 'utf8');
  console.log('\n  （真实返回已存到 .workbuddy/d22-crud.json，用于渲染截图）');

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail === 0 ? 0 : 1);
})();
