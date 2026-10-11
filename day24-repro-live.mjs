// Day 24 ① 复现：打开线上站点 → 认证发帖 → 填表提交 → 抓 Console 报错原文 + Network 请求去向
//
// ⚠️ 关键坑（本次实测踩到）：CloudBase 测试域名会先弹一个「页面访问提示」中间页
//   （测试域名仅供开发测试，需等 3 秒倒计时后点「确定访问」才进真页面）。
//   浏览器导航拿到的是 404 + title「风险提醒」，不是站点 404 —— 别误判成站点挂了。
//   node fetch 不经这个中间页，直接 200，所以「浏览器/node 结果不一致」是假象，不是站点故障。
//
// 用法: node day24-repro.mjs <输出目录>
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SITE = "https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com";
const outDir = process.argv[2] || "D:/VibeCoding_StudyDay01_MyFirstWorkspace/day24-out";
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// CloudBase 测试域名中间页：等倒计时结束再点「确定访问」
// ⚠️ 第二个坑：点完「确定访问」后页面会重新导航到站点根路径 /，原先 URL 上的
//   #/submit?as=verified 被丢掉了 → 停在首页视图，发帖表单所在 section 是 hidden，
//   按钮尺寸 0×0，page.click 会报「Node is either not clickable」。
//   所以过闸之后要重新设一次 hash，再等路由把视图切出来。
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

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu"],
});

const consoleLog = [];
const requests = [];

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1000, deviceScaleFactor: 1.5 });

  // 抓所有控制台消息（复现证据的核心：报错原文）
  page.on("console", (m) => consoleLog.push({ type: m.type(), text: m.text() }));
  page.on("pageerror", (e) => consoleLog.push({ type: "pageerror", text: String(e) }));
  // 抓每个请求的最终 URL 和状态（定位用：证明请求打到了哪个域名）
  page.on("response", async (r) => {
    const u = r.url();
    if (!/posts|comments|post\?id|admin|hot/.test(u)) return;
    requests.push({ method: r.request().method(), url: u, status: r.status() });
  });

  // 进发帖页（认证身份，可发观点/提问）
  const passed = await passRiskGate(page, SITE + "/#/submit?as=verified", "#/submit?as=verified");
  await new Promise(r => setTimeout(r, 2500));   // 等表单渲染

  // 填表并提交
  await page.select("#type", "opinion");
  await page.evaluate(() => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set("#title", "Day24 复现用：这条标题是自动化脚本发的");
    set("#body", "这条正文由 day24-repro.mjs 自动填入，用来复现「点发布必然失败」的问题。不代表真实用户内容。");
    document.querySelector("#category").value = "职场新人";
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(outDir, "复现-1-填好表单待提交.png"), fullPage: true });

  await page.click("#postForm button[type=submit]");
  await new Promise(r => setTimeout(r, 3000));

  const statusText = await page.evaluate(() => {
    const el = document.getElementById("status");
    return { text: (el.textContent || "").trim(), cls: el.className };
  });
  await page.screenshot({ path: path.join(outDir, "复现-2-提交后失败提示.png"), fullPage: true });

  const report = {
    中间页是否出现: passed,
    页面提示原文: statusText,
    控制台消息: consoleLog,
    相关请求: requests,
  };
  fs.writeFileSync(path.join(outDir, "day24-repro-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  console.log(JSON.stringify({ status: "fail", error: String(e).slice(0, 400) }));
} finally {
  await browser.close();
}
