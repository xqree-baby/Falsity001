// Day 24 余力加练：对新接口做刁钻输入压测（清单「卡住降级」方案）
// 目的不是测「正常能用」，是测「不正常的时候会不会崩、会不会说人话、会不会写出脏数据」
import { spawn } from "child_process";

const ROOT = "D:/VibeCoding_StudyDay01_MyFirstWorkspace";

const child = spawn(process.execPath, [`${ROOT}/functions/api/index.js`], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, CLOUDBASE_API_KEY: "local-test-not-a-real-key" },
});
let port = null;
child.stdout.on("data", d => { const m = String(d).match(/listening on port (\d+)/); if (m) port = Number(m[1]); });
for (let i = 0; i < 40 && !port; i++) await new Promise(r => setTimeout(r, 200));
if (!port) { console.log(JSON.stringify({ status: "fail", error: "服务没起来" })); child.kill(); process.exit(1); }

async function post(raw, as = "verified", label = "") {
  const c = new AbortController(); setTimeout(() => c.abort(), 8000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/posts?as=${as}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: raw, signal: c.signal,
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    return { status: r.status, j, rawLen: raw.length };
  } catch (e) { return { status: 0, err: e.message, rawLen: raw.length }; }
}

const long200 = "标".repeat(200);
const body10k = "正".repeat(10000);

const cases = [
  ["空 body", ""],
  ["纯空白 body", "   \n\t  "],
  ["坏 JSON", "{坏 json"],
  ["截断的 JSON", '{"type":"opinion"'],
  ["JSON 是数组", "[1,2,3]"],
  ["JSON 是字符串", '"hello"'],
  ["JSON 是 null", "null"],
  ["JSON 是数字", "42"],
  ["字段全是 null", JSON.stringify({ type: null, title: null, body: null, category: null })],
  ["type 大小写错", JSON.stringify({ type: "Opinion", title: "t", body: "b" })],
  ["type 空字符串", JSON.stringify({ type: "", title: "t", body: "b" })],
  ["标题正好 200 字（边界内）", JSON.stringify({ type: "opinion", title: long200, body: "b" })],
  ["标题 201 字（边界外）", JSON.stringify({ type: "opinion", title: long200 + "1", body: "b" })],
  ["正文正好 10000 字（边界内）", JSON.stringify({ type: "opinion", title: "t", body: body10k })],
  ["正文 10001 字（边界外）", JSON.stringify({ type: "opinion", title: "t", body: body10k + "1" })],
  ["分类 32 字（边界内）", JSON.stringify({ type: "opinion", title: "t", body: "b", category: "类".repeat(32) })],
  ["分类 33 字（边界外）", JSON.stringify({ type: "opinion", title: "t", body: "b", category: "类".repeat(33) })],
  ["标题里塞 HTML 标签", JSON.stringify({ type: "opinion", title: "<script>alert(1)</script>", body: "<img src=x onerror=alert(1)>" })],
  ["SQL 注入串", JSON.stringify({ type: "opinion", title: "'; DROP TABLE posts;--", body: "1' OR '1'='1" })],
  ["emoji 和生僻字", JSON.stringify({ type: "opinion", title: "打工人 🤧 的Day24 𠮷", body: "𠮷面 🍜" })],
  ["正文带换行和制表", JSON.stringify({ type: "opinion", title: "t", body: "第一行\n第二行\t制表" })],
  ["未认证发观点帖", JSON.stringify({ type: "opinion", title: "t", body: "b" }), "anonymous"],
  ["未认证发提问帖（应放行到写库）", JSON.stringify({ type: "question", title: "t", body: "b" }), "anonymous"],
  ["as 参数乱填", JSON.stringify({ type: "opinion", title: "t", body: "b" }), "hacker"],
  ["as 传数组", JSON.stringify({ type: "opinion", title: "t", body: "b" }), "verified&x=1"],
  ["超大 body（200KB）", JSON.stringify({ type: "opinion", title: "t", body: "x".repeat(200000) })],
];

const results = [];
for (const [label, raw, as] of cases) {
  const r = await post(raw, as ?? "verified", label);
  results.push({ 用例: label, 字节数: r.rawLen, 状态码: r.status, errorCode: r.j?.errorCode ?? null, 说明: r.j?.detail ? String(r.j.detail).slice(0, 60) : null });
}

// ---- 汇总判据 ----
const summary = {
  总用例数: results.length,
  服务崩溃: results.some(r => r.状态码 === 0),
  返回非预期状态码: results.filter(r => ![200, 201, 400, 413, 502, 503].includes(r.状态码)),
  写入成功的用例: results.filter(r => r.状态码 === 201).map(r => r.用例),
  被400拦下的用例数: results.filter(r => r.状态码 === 400).length,
  走到数据库的用例数: results.filter(r => r.状态码 === 502 || r.状态码 === 503).length,
};

console.log("【逐条结果】");
for (const r of results) console.log(`  ${String(r.状态码).padEnd(4)} ${String(r.errorCode ?? "").padEnd(18)} ${r.用例}`);
console.log("\n【汇总】");
console.log(JSON.stringify(summary, null, 2));

// ---- 快速连点压测：20 次并发，看会不会撞出重复 id / 服务挂掉 ----
const burst = await Promise.all(Array.from({ length: 20 }, (_, i) =>
  post(JSON.stringify({ type: "question", title: `压测${i}`, body: "b" }), "verified")
));
const burstOk = burst.filter(r => r.status === 502 || r.status === 503 || r.status === 201).length;
console.log("\n【快速连点压测】20 个并发请求：");
console.log(JSON.stringify({
  全部有响应: burst.every(r => r.status !== 0),
  通过校验走到写库或成功: burstOk,
  服务崩溃数: burst.filter(r => r.status === 0).length,
  状态码分布: burst.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}),
}, null, 2));

const out = {逐条: results, 汇总: summary};
const fs = await import("fs");
fs.writeFileSync(`${ROOT}/day24-out/day24-edge-report.json`, JSON.stringify(out, null, 2));
child.kill();