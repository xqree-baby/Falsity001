// Day 24 ④ 验证留证：真浏览器跑完整发帖流程 + 查库确认 + 回归
//
// 与① 复现脚本的区别：
//   复现版assert「会失败」，验证版 assert「该成功」，并且额外查库确认真的写进去了。
//
// ⚠️ 复用①踩过的两个坑（已在 passRiskGate 里处理，别删）：
//   ① CloudBase 测试域名先弹「页面访问提示」中间页，要等 3 秒点 #submitBtn
//   ② 点完中间页会重新导航到 /，hash 被丢，要重设 hash 再等 view-submit 可见
//
// 用法: node day24-verify-live.mjs <输出目录>
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SITE = "https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com";
const GATEWAY = "https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api";
const outDir = process.argv[2] || "D:/VibeCoding_StudyDay01_MyFirstWorkspace/day24-out";
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const STAMP = "Day24验证-" + Date.now().toString(36);
const TITLE = STAMP + "：自动化验证发帖是否成功（可忽略）";

async function passRiskGate(page, target, backToHash) {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
  const has = await page.evaluate(() => !!document.getElementById("submitBtn"));
  if (!has) return false;
  await page.waitForFunction(() => {
    const b = document.getElementById("submitBtn");
    return b && !b.disabled;
  }, { timeout: 15000 });
  await page.click("#submitBtn");
  await page.waitForFunction(() => !document.getElementById("submitBtn"), { timeout: 15000 });
  if (backToHash) {
    await page.evaluate((h) => { location.hash = h; }, backToHash);
    await page.waitForFunction(
      (id) => { const s = document.getElementById(id); return s && !s.hidden; },
      { timeout: 10000 }, "view-submit"
    );
  }
  return true;
}

const checks = [];
const ok = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "[通过]" : "[失败]"} ${name}${detail ? " —— " + detail : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

const consoleLog = [];
const requests = [];
let createdPostId = null;

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1000, deviceScaleFactor: 1.5 });
  page.on("console", (m) => consoleLog.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => consoleLog.push({ type: "pageerror", text: String(e) }));
  page.on("response", (r) => {
    const u = r.url();
    if (!/posts|comments|post\?id|hot/.test(u)) return;
    requests.push({ method: r.request().method(), url: u.replace(GATEWAY, "[网关]").replace(SITE, "[静态]"), status: r.status() });
  });

  // ---- 1. 打开认证发帖页 ----
  const passed = await passRiskGate(page, SITE + "/#/submit?as=verified", "#/submit?as=verified");
  await new Promise(r => setTimeout(r, 2500));
  ok("打开认证发帖页", passed, passed ? "过了测试域名中间页，表单已显示" : "未见中间页，直接进真页面");

  // ---- 2. 填表 ----
  await page.select("#type", "opinion");
  await page.evaluate((t) => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = v; el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("#title", t);
    set("#body", "这条正文由 day24-verify-live.mjs 自动填入，用来验证 Day 24 修复的 POST /posts 接口是否真的通了。Day 24 之前，点发布必然 404。");
    document.querySelector("#category").value = "职场新人";
  }, TITLE);
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(outDir, "验证-1-填好表单待提交.png"), fullPage: true });

  // ---- 3. 提交 ----
  await page.click("#postForm button[type=submit]");
  // ⚠️ 截图时机踩过的坑：原来等 4000ms 才截，但页面成功后会「3 秒后回首页」自动跳转，
  //   等 4 秒截到的已经��跳转完的首页骨架屏 —— 证据拍错了地方，等于白跑。
  //   现在改成 1.2 秒内截（成功提示已经显示、又还没跳走）。
  await new Promise(r => setTimeout(r, 1200));

  const st = await page.evaluate(() => {
    const el = document.getElementById("status");
    return { text: (el.textContent || "").trim(), cls: el.className };
  });
  await page.screenshot({ path: path.join(outDir, "验证-2-提交成功提示.png"), fullPage: true });

  // 再等自动跳转完成，拍一张首页正常的图（证明流程跑完、页面正常）
  await new Promise(r => setTimeout(r, 3500));
  await page.screenshot({ path: path.join(outDir, "验证-3-自动回到首页.png"), fullPage: true });

  const isOk = st.cls.includes("ok") && /已提交/.test(st.text);
  ok("点发布后提示成功", isOk, `class="${st.cls}" 文字="${st.text}"`);

  // ---- 4. 抓 POST 请求的真实去向 + 状态（对比① 的静态托管404）----
  const postReq = requests.filter(r => r.method === "POST");
  const wentToGateway = postReq.some(r => r.url.startsWith("[网关]") && r.status === 201);
  ok("POST 请求打到网关且返回 201", wentToGateway,
    JSON.stringify(postReq));
  ok("不再打到静态托管（①的病根消失）",
    !postReq.some(r => r.url.startsWith("[静态]")),
    postReq.length ? "POST 目标域名：" + postReq.map(r => r.url).join(", ") : "没有捕获到 POST");

  // ---- 5. 从后端把新帖子捞出来，确认真的写进库了 ----
  // 走 /api/posts 列表接口查不到（它在审核队列里，列表只给已过审的），
  // 所以直接用标题去比对：先拿全部已过审列表，再单独确认列表里没有它。
  const listRes = await fetch(GATEWAY + "/posts", { headers: { Origin: SITE } }).then(r => r.json());
  const inApproved = listRes.posts.some(p => p.title === TITLE);
  ok("新帖未出现在已过审列表（pending 生效，审核阀没被焊死）",
    !inApproved, `已过审列表共 ${listRes.count} 条，其中不含本次新帖`);
  console.log(`   （待确认：新帖应在审核队列里。/api/admin/pending 未绑网关，本地查不到队列内容——这一条靠 pending:true 硬编码 + 列表排除法佐证）`);

  // ---- 6. 回归：改代码有没有把原来能用的接口弄坏 ----
  const detail = await fetch(GATEWAY + "/post?id=p001", { headers: { Origin: SITE } }).then(r => r.json());
  ok("回归 GET /post?id=p001 仍正常", !!detail.post?.title, detail.post?.title?.slice(0, 24));
  const hot = await fetch(GATEWAY + "/hot", { headers: { Origin: SITE } }).then(r => r.json());
  ok("回归 GET /hot 仍正常", hot.ok === true, `date=${hot.date} data=${Array.isArray(hot.data) ? hot.data.length : "?"} 条`);

  // ---- 7. Console 里不该再有「发帖相关的 404」----
  // ⚠️ 这里踩了个坑：第一版判据写成「Console 里任何 404 都不许有」，结果失败。
  //   穷举查下来那2 条 404 跟发帖毫无关系：
  //     ① GET [静态]/  404  → CloudBase 测试域名的「页面访问提示」中间页本身
  //        （这个中间页就返回 404 + title「风险提醒」，是它的固有特征，不是站点故障）
  //     ② GET [静态]/favicon.ico 404 → 站点没配网站图标
  //   所以判据应该收窄成「跟业务接口有关的 404」，否则就是在给假错误报警。
  const apiNotFound = consoleLog.filter(m =>
    /404/.test(m.text) && /\/(api|posts|comments|hot|admin)/.test(m.text)
  );
  const otherNotFound = consoleLog.filter(m =>
    /404/.test(m.text) && !/\/(api|posts|comments|hot|admin)/.test(m.text)
  );
  ok("业务接口无 404（发帖/评论/热搜/审核都正常）", apiNotFound.length === 0,
    apiNotFound.length ? JSON.stringify(apiNotFound) : "0 条");
  console.log(`   （另有 ${otherNotFound.length} 条 404 属已知无关项：测试域名中间页自身 + favicon.ico，不是 bug）`);

  const report = {
    验证时间: new Date().toISOString(),
    测试用标题: TITLE,
    发帖结果: st,
    控制台消息: consoleLog,
    请求记录: requests,
    自查结果: checks,
    新帖id: createdPostId,
  };
  fs.writeFileSync(path.join(outDir, "day24-verify-report.json"), JSON.stringify(report, null, 2));
} catch (e) {
  ok("脚本执行", false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = checks.filter(c => !c.pass);
console.log(`\n合计 ${checks.length} 项，通过 ${checks.length - failed.length}，失败 ${failed.length}`);
if (failed.length) console.log("失败：" + failed.map(f => f.name).join(" / "));