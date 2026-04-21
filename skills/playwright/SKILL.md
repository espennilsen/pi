---
name: playwright
description: >
  Take screenshots and interact with web pages using a headed Playwright browser.
  Use when you need to visually inspect a URL, capture a screenshot, interact with
  a page (click, type, scroll), or verify what a page looks like rendered.

  **Triggers — use this skill when:**
  - You need to screenshot a URL (Penpot share link, localhost, public site)
  - User says "show me", "how does it look", "take a screenshot"
  - You want to visually verify your own work (e.g. after creating Penpot designs)
  - User asks to review a live page or prototype
  - You need to interact with a page (click buttons, fill forms, trigger states)
---

# Playwright — Browser Screenshots & Interaction

Use Playwright to open a real browser, navigate to URLs, take screenshots, and
interact with pages. This is the go-to approach for visual verification of any
web content — Penpot designs, local dev servers, production sites, etc.

## Setup

Playwright is installed at `/Users/espen/node_modules/playwright`.

When writing scripts, always require from the absolute path:
```javascript
const { chromium } = require('/Users/espen/node_modules/playwright');
```

## Quick Screenshot

Write a `.cjs` script to `/tmp/`, run it with `node`, then `read` the resulting PNG.

```javascript
const { chromium } = require('/Users/espen/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: '/tmp/screenshot.png' });
  await browser.close();
})();
```

```bash
node /tmp/screenshot.cjs
```

Then view it:
```
read /tmp/screenshot.png
```

## Key Rules

### Always use `headless: false`

Many SPAs (Penpot, React apps, ClojureScript apps) fail or render blank in
headless mode. Always launch headed:

```javascript
chromium.launch({ headless: false })
```

### Always use CommonJS (`.cjs`)

Write scripts as `.cjs` files with `require()`. ESM imports fail because
Playwright isn't in the local `node_modules`:

```javascript
// ✅ Works
const { chromium } = require('/Users/espen/node_modules/playwright');

// ❌ Fails — "Cannot find package 'playwright'"
import { chromium } from 'playwright';
```

### Wait for SPA rendering

SPAs need time to hydrate after the initial HTML loads. Always add a wait:

| Site type | Wait time |
|-----------|-----------|
| Static HTML | 1-2 seconds |
| Simple SPA (React, Svelte) | 3-4 seconds |
| Complex SPA (Penpot, Figma) | 6-8 seconds |

```javascript
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000); // adjust per site type
```

Use `waitUntil: 'domcontentloaded'` instead of `'networkidle'` — network-idle
can time out on SPAs that keep WebSocket connections open.

### Write to /tmp

Always save screenshots and scripts to `/tmp/` to avoid polluting the workspace:

```javascript
await page.screenshot({ path: '/tmp/my-screenshot.png' });
```

## Viewport & Device Emulation

### Custom viewport

```javascript
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
```

### Mobile device

```javascript
const { devices } = require('/Users/espen/node_modules/playwright');
const iPhone = devices['iPhone 15'];
const context = await browser.newContext({ ...iPhone });
```

### Common viewports

| Use case | Width × Height |
|----------|---------------|
| Desktop (default) | 1400 × 1000 |
| Mobile | 390 × 844 |
| Tablet | 768 × 1024 |
| Wide | 1920 × 1080 |

## Interactions

### Click, type, scroll

```javascript
await page.click('button.submit');
await page.fill('input[name="email"]', 'test@example.com');
await page.keyboard.press('Enter');
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
```

### Hover states

```javascript
await page.hover('.card');
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/card-hover.png' });
```

### Wait for specific elements

```javascript
await page.waitForSelector('.loaded-content', { timeout: 10000 });
```

## Multi-Page Screenshots

Loop over multiple URLs and save each:

```javascript
const pages_to_capture = [
  { url: 'https://example.com/', name: 'home' },
  { url: 'https://example.com/about', name: 'about' },
];

for (const p of pages_to_capture) {
  await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `/tmp/${p.name}.png` });
}
```

## Setting Cookies / Auth

For pages that require authentication:

```javascript
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.addCookies([{
  name: 'auth-token',
  value: 'your-token-here',
  domain: 'example.com',
  path: '/',
}]);
const page = await context.newPage();
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Internal Error" / blank page | Headless mode | Use `headless: false` |
| "Cannot find package" | ESM import or wrong cwd | Use absolute `require()` path, `.cjs` extension |
| Black / empty screenshot | SPA not rendered yet | Increase `waitForTimeout` |
| Timeout on goto | `networkidle` on WebSocket app | Switch to `domcontentloaded` |
| Wrong page content | Auth required | Set cookies or use share link |
| Blurry screenshots | Low DPR | Set `deviceScaleFactor: 2` in context |

## Full Example — Screenshot with Console Debugging

When a page isn't rendering as expected, capture console output:

```javascript
const { chromium } = require('/Users/espen/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const title = await page.title();
  console.log('Title:', title);

  await page.screenshot({ path: '/tmp/debug.png' });
  await browser.close();
})();
```
