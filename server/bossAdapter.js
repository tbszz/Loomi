import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

let context = null;
let page = null;
let logs = [];

const DEFAULT_SEARCH_URL = "https://www.zhipin.com/web/geek/job";

export function getBossStatus() {
  return {
    connected: Boolean(context && page),
    currentUrl: page?.url?.() || "",
    logs: logs.slice(-80)
  };
}

export async function startBossBrowser({ url = DEFAULT_SEARCH_URL } = {}) {
  if (context && page) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
    pushLog(`已复用 Boss 浏览器会话：${url}`);
    return getBossStatus();
  }
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error("没有找到 Chrome 或 Edge。请安装 Chrome/Edge 后重试。");
  }
  const userDataDir = path.join(os.homedir(), ".resume-protocol", "boss-browser-profile");
  fs.mkdirSync(userDataDir, { recursive: true });
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    viewport: null,
    args: ["--start-maximized"]
  });
  page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(12000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch((error) => {
    pushLog(`打开 Boss 页面失败：${error.message}`);
  });
  pushLog("Boss 浏览器已启动。请在弹出的 Chrome 窗口中手动登录。");
  return getBossStatus();
}

export async function scrapeBossJobs({ max = 20 } = {}) {
  ensurePage();
  await safetyCheck();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1200);
  const jobs = await page.evaluate((limit) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const selectors = [
      ".job-card-wrapper",
      ".job-card-box",
      ".job-list-box li",
      ".job-primary",
      "[class*='job-card']"
    ];
    const cards = [];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (!cards.includes(node)) cards.push(node);
      });
      if (cards.length >= limit) break;
    }
    return cards.slice(0, limit).map((card, index) => {
      const anchor = card.querySelector("a[href]") || card.closest("a[href]");
      const title =
        clean(card.querySelector(".job-name")?.textContent) ||
        clean(card.querySelector("[class*='job-name']")?.textContent) ||
        clean(card.querySelector(".job-title")?.textContent) ||
        clean(card.querySelector("a")?.textContent).slice(0, 40) ||
        `Boss 岗位 ${index + 1}`;
      const company =
        clean(card.querySelector(".company-name")?.textContent) ||
        clean(card.querySelector("[class*='company']")?.textContent) ||
        "";
      const salary =
        clean(card.querySelector(".salary")?.textContent) ||
        clean(card.querySelector("[class*='salary']")?.textContent) ||
        "";
      const jobLocation =
        clean(card.querySelector(".job-area")?.textContent) ||
        clean(card.querySelector("[class*='area']")?.textContent) ||
        "";
      const href = anchor ? new URL(anchor.getAttribute("href"), window.location.origin).href : window.location.href;
      return {
        id: `boss-${Date.now()}-${index}`,
        title,
        company,
        salary,
        location: jobLocation,
        url: href,
        description: clean(card.textContent).slice(0, 900),
        source: "boss"
      };
    });
  }, Number(max) || 20);
  pushLog(`抓取 Boss 岗位 ${jobs.length} 条。`);
  return { jobs, status: getBossStatus() };
}

export async function runBossApply({ jobs = [], greeting = "", dryRun = true, limit = 3, delayMs = 9000, blacklist = [] } = {}) {
  if (!dryRun) ensurePage();
  const selectedJobs = jobs.slice(0, Math.max(1, Number(limit) || 1));
  const results = [];
  const normalizedBlacklist = blacklist.map((item) => String(item).toLowerCase()).filter(Boolean);
  for (const job of selectedJobs) {
    const haystack = `${job.title} ${job.company} ${job.description}`.toLowerCase();
    if (normalizedBlacklist.some((word) => haystack.includes(word))) {
      results.push({ job, status: "skipped_blacklist" });
      pushLog(`跳过黑名单岗位：${job.company} / ${job.title}`);
      continue;
    }
    if (dryRun) {
      results.push({ job, status: "dry_run", greeting });
      pushLog(`[DRY-RUN] 将投递：${job.company} / ${job.title}`);
      continue;
    }
    try {
      await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await safetyCheck();
      await page.waitForTimeout(1200);
      const clicked = await clickFirstText(["立即沟通", "继续沟通", "投递简历", "立即投递"]);
      await page.waitForTimeout(1600);
      const sent = await fillAndSendGreeting(greeting);
      results.push({ job, status: clicked ? (sent ? "sent_greeting" : "opened_chat") : "no_apply_button" });
      pushLog(`执行结果：${job.company} / ${job.title} => ${results.at(-1).status}`);
      await page.waitForTimeout(Math.max(3000, Number(delayMs) || 9000));
    } catch (error) {
      results.push({ job, status: "failed", error: error.message });
      pushLog(`投递失败：${job.company} / ${job.title} => ${error.message}`);
    }
  }
  return { results, status: getBossStatus() };
}

export async function closeBossBrowser() {
  if (context) {
    await context.close().catch(() => {});
  }
  context = null;
  page = null;
  pushLog("Boss 浏览器已关闭。");
  return getBossStatus();
}

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function ensurePage() {
  if (!page) {
    throw new Error("Boss 浏览器未启动。请先点击“启动 Boss 浏览器”。");
  }
}

async function safetyCheck() {
  const bodyText = await page.locator("body").innerText({ timeout: 4000 }).catch(() => "");
  if (/验证码|安全验证|请登录|登录后|滑块|异常访问/.test(bodyText)) {
    pushLog("检测到登录/验证码/安全验证页面，自动化已暂停，需要人工处理。");
    throw new Error("检测到登录、验证码或安全验证，已暂停自动化。");
  }
}

async function clickFirstText(labels) {
  for (const label of labels) {
    const locator = page.getByText(label, { exact: false }).first();
    if ((await locator.count().catch(() => 0)) > 0) {
      const clicked = await locator.click({ timeout: 5000 }).then(() => true).catch(() => false);
      if (clicked) return true;
    }
  }
  return false;
}

async function fillAndSendGreeting(greeting) {
  if (!greeting) return false;
  const selectors = ["textarea", "[contenteditable='true']", ".chat-input", "[class*='input']"];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if ((await locator.count().catch(() => 0)) > 0) {
      await locator.fill(greeting).catch(async () => {
        await locator.click();
        await page.keyboard.type(greeting, { delay: 15 });
      });
      return clickFirstText(["发送", "Send"]);
    }
  }
  return false;
}

function pushLog(message) {
  logs.push({ at: new Date().toISOString(), message });
  logs = logs.slice(-200);
}
