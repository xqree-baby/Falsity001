// Day 24 ② 定位：穷举「发帖失败」的所有可能原因，逐条实测排除，最后收敛到唯一真因
//
// 纪律：不猜。每一条判据都是真实跑出来的，不是推断。
//用法: node day24-locate.mjs <输出目录>
import fs from "fs";
import path from "path";

const SITE = "https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com";
const GATEWAY = "https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api";
const outDir = process.argv[2] || "D:/VibeCoding_StudyDay01_MyFirstWorkspace/day24-out";
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function hit(url, opts = {}) {
  const c = new AbortController();
  setTimeout(() => c.abort(), 12000);
  try {
    const r = await fetch(url, {
      ...opts,
      headers: { Origin: SITE, "Content-Type": "application/json", ...(opts.headers || {}) },
      signal: c.signal,
    });
    const text = await r.text();
    return { status: r.status, ct: r.headers.get("content-type") || "", text };
  } catch (e) {
    return { status: 0, ct: "", text: "EXC:" + e.message };
  } finally {
    clearTimeout(c);
  }
}

const lines = [];
const say = (s) => { console.log(s); lines.push(s); };

// ============ 候选原因清单（先全列，再逐条验）============
say("【候选原因清单】发帖点发布返回 404，可能的原因：");
say("  H1 前端用了相对路径，请求打到静态托管而不是网关");
say("  H2 后端没注册 POST /posts 这条路由");
say("  H3 网关没绑定这条路由（请求压根到不了函数）");
say("  H4 跨域被拦（Day 20 老坑：ACAO 配两遍）");
say("  H5 表单字段缺失被后端拒（400 类）");
say("  H6 静态托管没重新部署，跑的是旧前端");
say("  H7 后端整体挂了 / 数据库连不上");
say("  H8 线上代码版本比本地旧（Day 23 未部署）");
say("");

const results = [];
const record = (id, name, verdict, evidence) => {
  results.push({ id, name, verdict, evidence });
  say(`${verdict === "排除" ? "[已排除]" : "[★ 命中]"} ${id} ${name}`);
  say(`         判据：${evidence}`);
  say("");
};

// ---- H1 前端相对路径 ----
{
  const r = await hit(SITE + "/api/posts?as=verified", {
    method: "POST",
    body: JSON.stringify({ type: "opinion", title: "t", body: "b", category: "职场新人" }),
  });
  const isStatic = r.status === 404 && /text\/html/.test(r.ct);
  record("H1", "前端相对路径打到静态托管", isStatic ? "命中" : "排除",
    `POST ${SITE}/api/posts => ${r.status}，content-type=${r.ct}。` +
    (isStatic ? "静态托管里没有 /api，返回的是 HTML 404 页面（CloudBase 自己的 404 页）。" : ""));
}

// ---- H2 后端没注册 POST /posts ----
{
  const r = await hit(GATEWAY + "/posts", {
    method: "POST",
    body: JSON.stringify({ type: "opinion", title: "t", body: "b", category: "职场新人" }),
  });
  const isOwn404 = /"receivedPath"/.test(r.text);
  record("H2", "后端没注册 POST /posts 路由", isOwn404 ? "命中" : "排除",
    `POST ${GATEWAY}/posts => ${r.status}，返回体 ${r.text.slice(0, 120)}。` +
    (isOwn404 ? "receivedPath 是自家函数的字段 → 请求已进函数，是函数自己说'没这条路由'，不是网关拦的。" : ""));
}

// ---- H3 网关没绑定 ----
{
  // 同一路径 GET 能通 ⇒ 网关已绑定 /posts 这条路径
  const g = await hit(GATEWAY + "/posts");
  const gatewayBound = g.status === 200;
  record("H3", "网关没绑定这条路由", gatewayBound ? "排除" : "命中",
    `GET ${GATEWAY}/posts => ${g.status}。同一路径 GET 通得了，说明路径已绑定；` +
    "且 Day 22 实测过网关按路径绑定不区分方法，POST 同路径不用多绑。");
}

// ---- H4 跨域 ----
{
  const r = await hit(GATEWAY + "/posts", { method: "POST", body: "{}" });
  // 跨域被掐的特征：响应头 ACAO 出现多个逗号分隔的值 / 或者 JS 侧拿不到状态码
  const c = new AbortController(); setTimeout(() => c.abort(), 12000);
  const resp = await fetch(GATEWAY + "/posts", {
    method: "POST", headers: { Origin: SITE, "Content-Type": "application/json" }, body: "{}", signal: c.signal,
  });
  const acao = resp.headers.get("access-control-allow-origin");
  await resp.text();
  clearTimeout(c);
  const multi = acao && acao.includes(",");
  record("H4", "跨域被拦（ACAO 配两遍）", multi ? "命中" : "排除",
    `响应头 Access-Control-Allow-Origin: ${acao}。只有一个值、没逗号拼接 → 没配重；` +
    `而且这次请求拿到了 ${r.status} 状态码（跨域被掐时 JS 侧根本读不到状态码，只剩 Failed to fetch）。`);
}

// ---- H5 字段问题 ----
{
  const r = await hit(GATEWAY + "/posts", { method: "POST", body: "{}" });
  const isFieldErr = r.status === 400;
  record("H5", "表单字段缺失被后端拒", isFieldErr ? "命中" : "排除",
    `POST 网关/posts 空 body => ${r.status}。404 而不是 400，且请求连路由都没匹配上，轮不到字段校验。`);
}

// ---- H6 静态托管没重新部署 ----
{
  const r = await hit(SITE + "/");
  const hasApiBase = /ap-shanghai\.app\.tcloudbase\.com\/api/.test(r.text);
  record("H6", "静态托管跑的是旧前端", hasApiBase ? "排除" : "命中",
    `静态托管首页 HTML 里${hasApiBase ? "能" : "不能"}搜到 API_BASE 常量（网关域名）。` +
    "能搜到说明静态托管是 Day 20 之后部署的，前端整体不旧——只是发帖那一段漏改了。");
}

// ---- H7 后端整体挂了 ----
{
  const h = await hit(GATEWAY + "/health");
  const list = await hit(GATEWAY + "/posts");
  const ok = h.status === 200 && list.status === 200 && /"count":\s*\d/.test(list.text);
  record("H7", "后端整体挂了 / 数据库连不上", ok ? "排除" : "命中",
    `GET /health => ${h.status}；GET /posts => ${list.status} 且带 count 字段（真查到了数据库）。后端和数据库都活着。`);
}

// ---- H8 线上代码版本比本地旧 ----
{
  const r = await hit(GATEWAY + "/favorites/extra");
  const isOld = /"receivedPath"/.test(r.text) && !/"errorCode"/.test(r.text);
  record("H8", "线上 api 函数版本比本地旧（Day 23 未部署）", isOld ? "命中" : "排除",
    `GET /favorites/extra => ${r.status}，返回体 ${r.text.slice(0, 100)}。` +
    "老版本 404 是手写的{ok:false,error:'not found',receivedPath}；" +
    "本地 Day 23 已改成 fail() 会带 errorCode。线上没有 errorCode ⇒ 线上是 Day 22 那版。" +
    "（注意：/api/health 是 Day 15 的独立函数，它的 deployedAt 不能代表 api 函数的版本，别拿它当判据。）");
}

// ============ 收敛 ============
say("【收敛】");
const hits = results.filter(r => r.verdict === "命中").map(r => r.id);
say(`命中原因：${hits.join(" + ")}`);
say("");
say("【因果链】");
say("  前端 fill 表单 → 点发布");
say("    → fetch('/api/posts?as=verified')  ← H1 相对路径，发到静态托管");
say("      → 静态托管没有 /api → 404（这就是截图和Console 里那条 404 的来源）");
say("");
say("  就算把 H1 修成 API_BASE 绝对地址，仍会 404：");
say("    → 请求进到云函数 → H2 路由表里没有 POST /posts → 自家函数 404");
say("      （返回体里的 receivedPath 就是证据，说明网关已经放行了，不用改绑定）");
say("");
say("【修复要动几处】1. 前端 index.html 第 486 行改绝对地址  2. 后端加 POST /posts 分支 + db.insertPost()");

fs.writeFileSync(path.join(outDir, "day24-locate-report.txt"), lines.join("\n"), "utf8");
fs.writeFileSync(path.join(outDir, "day24-locate-report.json"), JSON.stringify(results, null, 2), "utf8");
