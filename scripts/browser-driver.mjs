/**
 * Persistent headed-browser driver for manual-in-the-loop automation.
 * Polls artifacts/browser-cmd.json for commands, writes artifacts/browser-result.json.
 * Commands: goto{url} | snap | click{selector|text|role,name} | fill{selector,value}
 *           press{key} | shot{path} | eval{js} | wait{ms|selector|text} | type{selector,text}
 * Usage: node scripts/browser-driver.mjs   (stays alive; stop with cmd {"quit":true})
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

mkdirSync("artifacts", { recursive: true });
const CMD = "artifacts/browser-cmd.json";
const RES = "artifacts/browser-result.json";

const ctx = await chromium.launchPersistentContext("artifacts/browser-profile-chrome", {
  headless: false,
  channel: "chrome",
  args: ["--disable-blink-features=AutomationControlled"],
  viewport: { width: 1440, height: 900 },
});
let page = ctx.pages()[0] || (await ctx.newPage());
writeFileSync(RES, JSON.stringify({ ready: true }));

async function snap() {
  // Compact interactive-element map: links, buttons, inputs, headings.
  return await page.evaluate(() => {
    const els = [...document.querySelectorAll("a,button,input,select,textarea,[role=button],h1,h2,h3,[role=heading]")];
    return els.slice(0, 400).map((el) => {
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.value || "").trim().slice(0, 80);
      return { tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute("role") || "", label, href: el.href || "", visible, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }).filter((e) => e.visible && (e.label || e.href || e.tag === "input" || e.tag === "select"));
  });
}

let busy = false;
setInterval(async () => {
  if (busy || !existsSync(CMD)) return;
  busy = true;
  let cmd = {};
  try { cmd = JSON.parse(readFileSync(CMD, "utf8")); } catch {}
  if (Object.keys(cmd).length === 0) { busy = false; return; }
  try {
    let out = {};
    if (cmd.quit) { out.done = true; }
    else if (cmd.goto) { await page.goto(cmd.goto, { waitUntil: "domcontentloaded", timeout: 45000 }); out.url = page.url(); }
    else if (cmd.back) { await page.goBack({ timeout: 15000 }); out.url = page.url(); }
    else if (cmd.snap) { out = { url: page.url(), title: await page.title(), elements: await snap() }; }
    else if (cmd.clickText) { await page.getByText(cmd.clickText, { exact: cmd.exact ?? false }).first().click({ timeout: 8000 }); out.url = page.url(); }
    else if (cmd.clickRole) { await page.getByRole(cmd.clickRole, { name: cmd.name }).first().click({ timeout: 8000 }); out.url = page.url(); }
    else if (cmd.click) { await page.locator(cmd.click).first().click({ timeout: 8000 }); out.url = page.url(); }
    else if (cmd.clickXY) { await page.mouse.click(cmd.clickXY[0], cmd.clickXY[1]); out.clicked = cmd.clickXY; }
    else if (cmd.fill) { await page.locator(cmd.fill).first().fill(cmd.value ?? "", { timeout: 8000 }); out.filled = cmd.fill; }
    else if (cmd.fillLabel) { await page.getByLabel(cmd.fillLabel).first().fill(cmd.value ?? "", { timeout: 8000 }); out.filled = cmd.fillLabel; }
    else if (cmd.type) { await page.locator(cmd.type).first().pressSequentially(cmd.text ?? "", { timeout: 8000 }); out.typed = true; }
    else if (cmd.press) { await page.keyboard.press(cmd.press); out.pressed = cmd.press; }
    else if (cmd.select) { await page.locator(cmd.select).first().selectOption(cmd.value, { timeout: 8000 }); out.selected = cmd.value; }
    else if (cmd.check) { await page.locator(cmd.check).first().check({ timeout: 8000 }); out.checked = true; }
    else if (cmd.wait) {
      if (typeof cmd.wait === "number") await page.waitForTimeout(cmd.wait);
      else if (cmd.wait.selector) await page.locator(cmd.wait.selector).first().waitFor({ timeout: cmd.wait.timeout ?? 20000 });
      else if (cmd.wait.text) await page.getByText(cmd.wait.text).first().waitFor({ timeout: cmd.wait.timeout ?? 20000 });
      else if (cmd.wait.url) await page.waitForURL(cmd.wait.url, { timeout: cmd.wait.timeout ?? 20000 });
      out.url = page.url();
    }
    else if (cmd.shot) { await page.screenshot({ path: cmd.shot, fullPage: cmd.full ?? false }); out.shot = cmd.shot; }
    else if (cmd.eval) { out = { result: await page.evaluate(cmd.eval) }; }
    else if (cmd.content) { out = { url: page.url(), html: (await page.content()).slice(0, 20000) }; }
    else if (cmd.tabs) { out = { pages: ctx.pages().map((p, i) => ({ i, url: p.url() })) }; }
    else if (cmd.switchTab !== undefined) { page = ctx.pages()[cmd.switchTab] || page; out = { url: page.url() }; }
    else if (cmd.newTab) { page = await ctx.newPage(); if (cmd.newTab !== true) await page.goto(cmd.newTab, { waitUntil: "domcontentloaded" }); out.url = page.url(); }
    writeFileSync(RES, JSON.stringify({ ok: true, ...out }));
  } catch (e) {
    writeFileSync(RES, JSON.stringify({ ok: false, error: String(e).slice(0, 400), url: page.url() }));
  }
  try { if (existsSync(CMD)) writeFileSync(CMD, "{}"); } catch {}
  if (cmd.quit) { await ctx.close(); process.exit(0); }
  busy = false;
}, 600);

console.log("driver ready — write commands to artifacts/browser-cmd.json");
