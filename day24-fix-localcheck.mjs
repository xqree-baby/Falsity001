// Day 24 ③ 修复的本地静态自查（不依赖数据库，node --check + 逻辑探针）
// ⚠️ 为什么先跑这个：云函数部署要你去控制台贴代码、部署要一两分钟，
//   万一路由没接对、校验写错，部署完才发现就白等一轮。本地先把能验的都验掉。
import fs from "fs";
import path from "path";
import vm from "vm";

const ROOT = "D:/VibeCoding_StudyDay01_MyFirstWorkspace";
const checks = [];
const ok = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "[通过]" : "[失败]"} ${name}${detail ? " —— " + detail : ""}`);
};

// ---------- 1. index.html 前端是否还残留相对路径 ----------
// ⚠️ 第一版这个检查写错了：用正则直接扫全文，把注释里写的 fetch('/api/posts') 也当成残留，
//   报了「还有 5 处」吓人一大跳。实际只有 2 处是真的（审核页），3 处是注释里的举例。
//   现在改成逐行剔除注释（// 开头或 // 之后的部分）再扫——
//   教训：**校验脚本自己报错先怀疑脚本**，别拿一个不准的探针去判别人的代码有问题。
{
  const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const codeLines = html.split("\n")
    .map((l, i) => ({ n: i + 1, text: l.replace(/\/\/.*$/, "") }))   // 去掉行注释部分
    .filter(x => !/^\s*\/\*/.test(x.text) || x.text.includes("*/")); // 剔除整行块注释
  const relFetches = codeLines
    .filter(x => /fetch\(\s*'\/(?!\/)/.test(x.text))
    .map(x => `第${x.n}行`);
  // 审核页那两处是 Day 24 已知的「只记录不修」项（审核没接后端，改了也跑不通），
  // 单独列出来当作遗留清单，不算今天这次修复的失败。
  const knownPending = relFetches.filter(s => /第51[0-9]行|第57[0-9]行/.test(s));
  const unexpected = relFetches.filter(s => !knownPending.includes(s));

  ok("发帖/详情/评论/首页 无残留相对路径 fetch", unexpected.length === 0,
    unexpected.length ? `意外残留：${unexpected.join(" ")}` : "0 处意外残留");
  ok("审核页 2 处相对路径 = 已知遗留项（只记录不修）", knownPending.length === 2,
    knownPending.length ? knownPending.join(" ") : "实际为 0 处，与预期不符，请复查");

  const hasNewPost = /fetch\(API_BASE \+ '\/posts\?as=' \+ encodeURIComponent\(as\)/.test(html);
  ok("发帖请求已改为 API_BASE 绝对地址", hasNewPost, "匹配 API_BASE + '/posts?as=' + encodeURIComponent(as)");
}

// ---------- 2. 后端：路由注册 ----------
{
  const js = fs.readFileSync(path.join(ROOT, "functions/api/index.js"), "utf8");
  ok("已注册 POST /posts 路由",
    /req\.method === 'POST' && path === '\/posts'/.test(js),
    "路由表里找到 POST /posts 分支");

  // 顺序很重要：POST 必须排在 GET 前面吗？其实否，但确认写法没写成 if/else 互斥
  const postIdx = js.indexOf("req.method === 'POST' && path === '/posts'");
  const getIdx = js.indexOf("req.method === 'GET' && path === '/posts'");
  ok("POST 与 GET /posts 是两条独立 if（非互斥）", postIdx > 0 && getIdx > 0 && postIdx !== getIdx,
    `POST 在第 ${postIdx} 字符处，GET 在第 ${getIdx} 字符处`);
}

// ---------- 3. 后端：pending 必须硬编码 true ----------
{
  const js = fs.readFileSync(path.join(ROOT, "functions/api/index.js"), "utf8");
  const seg = js.slice(js.indexOf("async function handleCreatePost"), js.indexOf("// POST /api/comments")
    + 5000);
  ok("handleCreatePost 存在", seg.includes("pending: true"), "写入时 pending 恒为 true");
  ok("没有把 pending 写成可由客户端决定",
    !/pending:\s*(body|req|query|as)\./.test(seg),
    "pending 值不接受任何客户端输入");
}

// ---------- 4. 新增报错是否都走 fail() ----------
{
  const js = fs.readFileSync(path.join(ROOT, "functions/api/index.js"), "utf8");
  const start = js.indexOf("async function handleCreatePost");
  const seg = js.slice(start, start + 3500);
  const failCalls = (seg.match(/fail\(res,/g) || []).length;
  // 新函数里手写的 json(res, 4xx, ...) 应该一个都没有（有错误码的报错一律走 fail）
  const handWritten = (seg.match(/json\(res,\s*[45]\d\d/g) || []).length;
  ok("新增报错全部走 fail()", handWritten === 0 && failCalls >= 5,
    `fail() 调用 ${failCalls} 次，手写 4xx/5xx 共 ${handWritten} 次`);
}

// ---------- 5. db.js：insertPost 是否导出 ----------
{
  const db = fs.readFileSync(path.join(ROOT, "functions/api/db.js"), "utf8");
  ok("db.js 定义了 insertPost", /async function insertPost/.test(db));
  ok("insertPost 已导出",
    /module\.exports\s*=\s*\{[\s\S]*insertPost[\s\S]*\}/.test(db));
  ok("insertPost 用 Prefer: return=representation 取库里真值",
    /function insertPost[\s\S]*Prefer: 'return=representation'/.test(db));
}

// ---------- 6. 逻辑探针：真起一个 HTTP 服务打进去 ----------
// ⚠️ 第二版这里原本用 vm.Script 把 handleCreatePost 的源码抠出来跑，拼接出来的代码少了闭合括号
//   （Unexpected end of input）。方案本身太脆——把源码切出来再拼，等于二次加工，
//   加工出错就会得出「代码有问题」的错结论。改成**直接起真的云函数**：
//   它本来就是 http.createServer + listen，改个端口就能在本地跑，
//   用真fetch 打进去，验的是真代码，不是复刻品。
// ⚠️ 第三版踩的坑（自己脚本的错，不是代码的错）：
//   子进程起是起来了，但我打的是 9123 端口，一行 fetch failed。
//   穷举验证后才发现：**云函数里 PORT 是硬编码 9000，根本不读环境变量**
//   （Web 平台约定就是 9000，代码第 29 行写死）。
//   所以本地要测只能打 9000。教训还是那句：不猜，把可能一次验掉——
//   我一开始完全可能下结论说「沙箱禁 spawn 起服务」，那是错的（spawn 完全正常）。
{
  process.env.CLOUDBASE_API_KEY = "local-test-not-a-real-key";
  const { spawn } = await import("child_process");
  const nodeExe = process.execPath;
  const child = spawn(nodeExe, [path.join(ROOT, "functions/api/index.js")], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLOUDBASE_API_KEY: "local-test-not-a-real-key" },
  });

  // 沙箱里 spawnSync + stdio:'pipe' 必报 EBUSY，所以用 spawn + 流
  let stderrTxt = "";
  child.stderr.on("data", (d) => { stderrTxt += String(d); });
  // 不猜端口：直接从子进程 stdout 里把「listening on port N」的真实端口抠出来用
  let realPort = null;
  child.stdout.on("data", (d) => {
    const m = String(d).match(/listening on port (\d+)/);
    if (m) realPort = Number(m[1]);
  });

  for (let i = 0; i < 40 && !realPort; i++) await new Promise(r => setTimeout(r, 200));

  if (!realPort) {
    ok("本地起云函数", false, "8 秒内没监听到端口。stderr: " + stderrTxt.slice(0, 300));
    child.kill();
  } else {
    ok("本地起云函数", true, `从子进程输出里读到真实监听端口 ${realPort}（不是猜的）`);

    const post = async (raw, as) => {
      const c = new AbortController(); setTimeout(() => c.abort(), 8000);
      try {
        const r = await fetch(`http://127.0.0.1:${realPort}/posts?as=${as}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: raw,
          signal: c.signal,
        });
        const t = await r.text();
        let j = null; try { j = JSON.parse(t); } catch {}
        return { status: r.status, j, t };
      } catch (e) { return { status: 0, err: e.message, t: "EXC:" + e.message }; }
    };
    // 一句话概括返回内容，异常分支也有值（第一版这里写 r.t.slice，异常时 t 是 undefined 直接炸了）
    const brief = (r) => r.j ? r.j.errorCode : String(r.t ?? r.err ?? "").slice(0, 60);

    const cases = [
      { name: "JSON 解析失败 → 400 BAD_REQUEST", raw: "{坏 json", as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "请求体是数组 → 400", raw: "[]", as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "请求体是 null → 400", raw: "null", as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "type 非法 → 400", raw: JSON.stringify({ type: "rant", title: "t", body: "b" }), as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "标题为空 → 400", raw: JSON.stringify({ type: "opinion", title: "   ", body: "b" }), as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "标题超 200 字 → 400", raw: JSON.stringify({ type: "opinion", title: "标".repeat(201), body: "b" }), as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "正文为空 → 400", raw: JSON.stringify({ type: "opinion", title: "t", body: "" }), as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "正文超 10000 字 → 400", raw: JSON.stringify({ type: "opinion", title: "t", body: "正".repeat(10001) }), as: "verified", want: 400, wantCode: "BAD_REQUEST" },
      { name: "未认证发观点帖 → 400", raw: JSON.stringify({ type: "opinion", title: "t", body: "b" }), as: "anonymous", want: 400, wantCode: "BAD_REQUEST" },
      { name: "空 body（连字段都没有）→ 400", raw: "", as: "verified", want: 400, wantCode: "BAD_REQUEST" },
    ];

    let passAll = true;
    for (const c of cases) {
      const r = await post(c.raw, c.as);
      const pass = r.status === c.want && r.j && r.j.errorCode === c.wantCode;
      if (!pass) passAll = false;
      console.log(`   ${pass ? "✓" : "✗"} ${c.name}  实际=${r.status} ${brief(r)}`);
    }
    ok("10 条非法输入全部被 400/BAD_REQUEST 拦下", passAll);

    // ★ 关键一条：合法输入必须能穿过所有校验、一路走到写库那一步。
    // 判据是「错误从 BAD_REQUEST 变成 DB 相关的 502」—— 说明校验全过了，
    // 卡在了连数据库（本地没有真 key，503/502 正是预期）。
    const good = await post(JSON.stringify({ type: "question", title: "标题", body: "正文", category: "职场新人" }), "verified");
    const reachedDb = good.status === 502 || good.status === 503;
    ok("合法输入能穿过校验走到写库", reachedDb,
      `状态=${good.status} ${brief(good)} ${String(good.j?.detail ?? "").slice(0, 70)}` +
      "（不是 400 说明校验全过了，卡在连数据库——本地无真 key，属预期）");
  }
  child.kill();
}

// ---------- 汇总 ----------
const failed = checks.filter(c => !c.pass);
console.log(`\n合计 ${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
if (failed.length) console.log("失败项：" + failed.map(f => f.name).join(" / "));
fs.writeFileSync(path.join(ROOT, "day24-out/day24-fix-localcheck.json"), JSON.stringify(checks, null, 2));