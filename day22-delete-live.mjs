// Day 22 板块②：DELETE /api/comments 在**真实环境**上的验证脚本
// 跑法：node day22-delete-live.mjs
//
// ⚠️ 为什么必须带 Origin 头（Day 20 血的教训，不重犯）：
//   node 的 fetch 不发 Origin 头 → CloudBase 网关不加自己那份 ACAO →
//   响应里只剩代码里的那份 → 「看起来一切正常」，但浏览器照样失败。
//   → 验跨域/网关必须伪装成浏览器：headers 里带 Origin。
//
// ⚠️ 这个脚本会**真的删掉一条评论**（它自己现发的那条，不碰你的种子数据）。
//   流程：POST 发一条 → GET 确认在 → DELETE 删掉 → GET 确认不在。
//   全程只动这一条，其他数据不碰。

const BASE = 'https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com';
// 静态托管域名，用作 Origin 模拟浏览器
const ORIGIN = 'https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com';
const POST_ID = 'p006';   // 选它是因为开工前查过：这条帖子评论数= 0，干净不怕搞乱

const H = { Origin: ORIGIN, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '\n         -> ' + extra : '')); }
};
const section = (t) => console.log('\n=== ' + t + ' ===');

async function call(method, path, body) {
  const opt = { method, headers: { ...H }, signal: AbortSignal.timeout(30000) };
  if (body !== undefined) opt.body = JSON.stringify(body);
  let res, text;
  try {
    res = await fetch(BASE + path, opt);
    text = await res.text();
  } catch (e) {
    return { status: 0, netError: e.message, raw: '' };
  }
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON 就留null */ }
  return { status: res.status, json, raw: text, acao: res.headers.get('access-control-allow-origin') };
}

(async () => {
  // ---------- 0. 网关活了没 ----------
  section('0. 部署状态自检（先确认新代码上线了没）');
  const health = await call('GET', '/api/post?id=p001');
  if (health.status === 0) {
    console.log('  连不上网关：' + health.netError);
    console.log('  → 八成是代码还没部署。先去控制台部署，再跑这个脚本。');
    process.exit(1);
  }
  console.log('  GET /api/post?id=p001 → ' + health.status + '，ACAO= ' + health.acao);
  check('网关返回 200（说明云函数在跑）', health.status === 200, '实际 ' + health.status + ' ' + health.raw.slice(0, 200));
  // 部署没生效的话，路由表里还没有 DELETE 分支，OPTIONS 不会回 PATCH/DELETE
  const opt = await call('OPTIONS', '/api/comments');
  const allow = opt.acao || '';
  console.log('  OPTIONS 回来的 ACAO= ' + allow);

  // ---------- 1. 造一条评论（增） ----------
  section('1. 增：POST /api/comments 发一条待会要删的');
  const marker = '【Day22 待删测试】这条会被 DELETE 掉';
  const created = await call('POST', '/api/comments', { post_id: POST_ID, author: '宝宝', body: marker });
  console.log('  → ' + created.status + ' ' + created.raw.slice(0, 300));
  check('POST 返回 201', created.status === 201, '实际 ' + created.status);
  if (created.status !== 201) {
    console.log('\n  发评论就失败了，后面的删除无从谈起——先解决这个。');
    if (created.status === 404) {
      console.log('  404 有两种可能，别急着下结论（Day 21 教训）：');
      console.log('   a) 帖子 ' + POST_ID + ' 真的不存在');
      console.log('   b) 网关没绑/没转到 /api/comments 这条路由');
      console.log('  区分办法：看返回体的形状——');
      console.log('   带 requestId 字段 = CloudBase 网关拒的（路由问题）');
      console.log('   只有 ok/error两个字段 = 我们自己函数的 404');
      console.log('  实际返回体：' + created.raw.slice(0, 300));
    }
    process.exit(1);
  }
  const newId = created.json.comment.id;
  console.log('  新评论 id = ' + newId);

  // ---------- 2. 确认它在（查） ----------
  section('2. 查：GET /api/post?id=' + POST_ID + ' 里应该能看到它');
  const before = await call('GET', '/api/post?id=' + POST_ID);
  check('GET 返回 200', before.status === 200, '实际 ' + before.status);
  const listBefore = (before.json && before.json.post && before.json.post.comments) || [];
  console.log('  删除前评论数 = ' + listBefore.length+ '，内容 = ' +
    JSON.stringify(listBefore.map((c) => c.id)));
  check('刚发的那条在列表里', listBefore.some((c) => c.id === newId));
  check('列表里能看到它的正文（用来对比删除后）',
    listBefore.some((c) => c.body === marker));

  // ---------- 3. 拒绝无效删除（确认①②） ----------
  section('3. 确认：删不存在的评论必须给404，不能静默成功');
  const del404 = await call('DELETE', '/api/comments?id=c999999');
  console.log('  → ' + del404.status + ' ' + del404.raw.slice(0, 200));
  check('删不存在的 → 404', del404.status === 404, '实际 ' + del404.status);
  check('提示说清了「没删掉任何东西」',
    del404.json && String(del404.json.error).includes('没有删掉任何东西'),
    del404.json && del404.json.error);

  section('4. 确认②：缺 id 必须 400');
  const del400 = await call('DELETE', '/api/comments');
  console.log('  → ' + del400.status + ' ' + del400.raw.slice(0, 200));
  check('缺 id → 400', del400.status === 400, '实际 ' + del400.status);

  // ---------- 5. 真删 ----------
  section('5. 删：DELETE /api/comments?id=' + newId);
  const del = await call('DELETE', '/api/comments?id=' + newId);
  console.log('  → ' + del.status);
  console.log('  ' + del.raw.slice(0, 500));
  check('DELETE 返回 200', del.status === 200, '实际 ' + del.status);
  check('回执里带回了被删那条的正文（不可逆操作要留回执）',
    del.json && del.json.deleted && del.json.deleted.body === marker,
    del.json && JSON.stringify(del.json));
  check('回执里带回了它属于哪篇帖子',
    del.json && del.json.deleted && del.json.deleted.postId === POST_ID);

  // ---------- 6. 删完必须真的不在（这才是完成标准的核心） ----------
  section('6. 删完再查：GET /api/post?id=' + POST_ID + ' 里它必须消失');
  const after = await call('GET', '/api/post?id=' + POST_ID);
  const listAfter = (after.json && after.json.post && after.json.post.comments) || [];
  console.log('  删除后评论数 = ' + listAfter.length + '，内容 = ' +
    JSON.stringify(listAfter.map((c) => c.id)));
  check('GET 返回 200', after.status === 200, '实际 ' + after.status);
  check('★ 刚发的那条已不再返回', !listAfter.some((c) => c.id === newId));
  check('★ 它的正文也不再出现', !listAfter.some((c) => c.body === marker));
  check('★ 评论数比删除前少了 1 条',
    listAfter.length === listBefore.length - 1,
    '删除前 ' + listBefore.length + ' → 删除后 ' + listAfter.length);

  // ---------- 7. 再删一次必须是 404（不是静默成功） ----------
  section('7. 不可逆的证据：同一条再删一次');
  const again = await call('DELETE', '/api/comments?id=' + newId);
  console.log('  → ' + again.status + ' ' + again.raw.slice(0, 200));
  check('再删一次 → 404（不会假装成功）', again.status === 404, '实际 ' + again.status);

  // ---------- 8. CORS 预检放行 DELETE 吗 ----------
  section('8. CORS 预检：浏览器放行 DELETE 吗');
  console.log('  （脚本看不到浏览器行为，只能看网关/函数回的 Allow-Methods）');
  const opt2 = await call('OPTIONS', '/api/comments');
  console.log('  OPTIONS → ' + opt2.status + '，ACAO= ' + opt2.acao);
  console.log('  ⚠️ Allow-Methods 在脚本里看不到（node fetch 不暴露所有响应头），');
  console.log('     要确认得用浏览器或curl -X OPTIONS -I 看完整响应头。');

  // ---------- 收尾：把测试数据清干净 ----------
  section('9. 收尾：确认没留下垃圾数据');
  const final = await call('GET', '/api/post?id=' + POST_ID);
  const listFinal = (final.json && final.json.post && final.json.post.comments) || [];
  console.log('  ' + POST_ID + ' 最终评论数 = ' + listFinal.length +
    '（开工前是 0 条，现在应该回到 0）');
  check('★ 测试数据已清干净，没留在库里', listFinal.length === 0,
    '现在还有 ' + listFinal.length + ' 条：' + JSON.stringify(listFinal.map((c) => c.body)));

  console.log('\n========================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('========================================');
  process.exit(fail === 0 ? 0 : 1);
})();
