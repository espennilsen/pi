#!/usr/bin/env node
/**
 * extract.mjs — Reverse-engineer a design system from a live website.
 *
 * Launches a headed (visible) Chromium browser with Playwright, navigates the
 * target site, extracts computed styles, and captures screenshots at multiple
 * device profiles.
 *
 * Usage:
 *   node extract.mjs <url> [outDir] [subpage1,subpage2,...]
 *
 * Examples:
 *   node extract.mjs https://example.com
 *   node extract.mjs https://example.com ./my-tokens "/about,/pricing,/docs"
 *   node extract.mjs http://localhost:3000 extracted "/dashboard,/settings"
 *
 * Output structure:
 *   {outDir}/
 *   ├── screenshots/
 *   │   ├── pages/          — full-page captures at 4 breakpoints per page
 *   │   └── components/     — isolated component + interactive state captures
 *   └── raw/
 *       ├── colors.json     — CSS custom properties + computed colors
 *       ├── typography.json — font families, type styles, @font-face rules
 *       ├── spacing.json    — spacing, radii, shadows, borders, max-widths
 *       └── components.json — component manifest + responsive layout data
 */

import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve, relative } from 'path';

const url = process.argv[2];
const rawOutDir = process.argv[3] || 'extracted-design-system';
const subpages = (process.argv[4] || '').split(',').filter(Boolean);

if (!url) {
  console.error('Usage: node extract.mjs <url> [outDir] [subpage1,subpage2,...]');
  process.exit(1);
}

// Validate outDir to prevent path traversal
const resolvedOut = resolve(rawOutDir);
const resolvedCwd = resolve(process.cwd());
const rel = relative(resolvedCwd, resolvedOut);
if (rel.startsWith('..') || (rel === '..' && resolvedOut !== resolvedCwd)) {
  console.error('❌ outDir must be inside the current working directory.');
  process.exit(1);
}
const outDir = rawOutDir;

// ── Output directories ────────────────────────────────────────────────
for (const sub of ['screenshots/pages', 'screenshots/components', 'raw']) {
  mkdirSync(join(outDir, sub), { recursive: true });
}

// ── Device profiles ───────────────────────────────────────────────────
// Real device descriptors for mobile/tablet (correct viewport, DPR, UA,
// isMobile, hasTouch). Desktop/wide use 2x DPR for retina screenshots.
const profiles = {
  mobile:  { ...devices['iPhone 15'],                                        name: 'mobile'  },  // 393×659 @3x
  tablet:  { ...devices['iPad Pro 11'],                                      name: 'tablet'  },  // 834×1194 @2x
  desktop: { viewport: { width: 1440, height: 900  }, deviceScaleFactor: 2,  name: 'desktop' },  // 1440×900 @2x
  wide:    { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2,  name: 'wide'    },  // 1920×1080 @2x
};

// ── Launch headed browser ─────────────────────────────────────────────
const browser = await chromium.launch({
  headless: false,
  slowMo: 100,  // slight delay so interactions are visible — remove for speed
});

let exitCode = 0;

try {

// Desktop context for token extraction + component screenshots
const context = await browser.newContext({
  viewport: profiles.desktop.viewport,
  deviceScaleFactor: profiles.desktop.deviceScaleFactor,
});
const page = await context.newPage();

console.log(`\n🌐 Opening ${url} ...\n`);
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

// ── 1. CSS custom properties ──────────────────────────────────────────
console.log('🎨 Extracting CSS custom properties...');
const customProperties = await page.evaluate(() => {
  const props = {};
  const root = getComputedStyle(document.documentElement);
  for (let i = 0; i < root.length; i++) {
    const name = root[i];
    if (name.startsWith('--')) {
      props[name] = root.getPropertyValue(name).trim();
    }
  }
  return props;
});

// ── 2. Computed colors ────────────────────────────────────────────────
console.log('🎨 Extracting computed colors...');
const colors = await page.evaluate(() => {
  const colorSet = new Set();
  const elements = document.querySelectorAll('*');
  const sampled = Array.from(elements).slice(0, 800);
  for (const el of sampled) {
    const cs = getComputedStyle(el);
    for (const prop of ['color', 'backgroundColor', 'borderColor', 'borderTopColor',
                         'borderBottomColor', 'outlineColor', 'textDecorationColor',
                         'caretColor', 'accentColor']) {
      const val = cs[prop];
      if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent' &&
          val !== 'inherit' && val !== 'currentcolor') {
        colorSet.add(val);
      }
    }
    // Colors from box-shadow
    const shadow = cs.boxShadow;
    if (shadow && shadow !== 'none') {
      const rgbMatches = shadow.match(/rgba?\([^)]+\)/g);
      if (rgbMatches) rgbMatches.forEach(c => colorSet.add(c));
    }
  }
  return [...colorSet];
});

try {
  writeFileSync(join(outDir, 'raw/colors.json'), JSON.stringify({ customProperties, computedColors: colors }, null, 2));
} catch (e) {
  console.error(`⚠️  Failed to write colors.json: ${e.message}`);
}
console.log(`   Found ${Object.keys(customProperties).length} CSS vars, ${colors.length} computed colors`);

// ── 3. Typography ─────────────────────────────────────────────────────
console.log('📝 Extracting typography...');
const typography = await page.evaluate(() => {
  const fonts = new Set();
  const styles = [];
  const seen = new Set();

  const selectors = 'h1,h2,h3,h4,h5,h6,p,a,span,li,td,th,label,button,input,textarea,blockquote,figcaption,code,pre,small,strong,em,dt,dd';
  const elements = document.querySelectorAll(selectors);
  for (const el of elements) {
    const cs = getComputedStyle(el);
    const key = `${cs.fontFamily}|${cs.fontSize}|${cs.fontWeight}|${cs.lineHeight}|${cs.letterSpacing}`;
    if (seen.has(key)) continue;
    seen.add(key);

    fonts.add(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
    styles.push({
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString().slice(0, 80) || '',
      sample: el.textContent?.slice(0, 50).trim() || '',
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      textTransform: cs.textTransform,
    });
  }

  // @font-face declarations
  const fontFaces = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule instanceof CSSFontFaceRule) {
          fontFaces.push(rule.cssText);
        }
      }
    } catch(e) { /* cross-origin */ }
  }

  return { fonts: [...fonts], styles, fontFaces };
});

try {
  writeFileSync(join(outDir, 'raw/typography.json'), JSON.stringify(typography, null, 2));
} catch (e) {
  console.error(`⚠️  Failed to write typography.json: ${e.message}`);
}
console.log(`   Found ${typography.fonts.length} font families, ${typography.styles.length} unique type styles`);

// ── 4. Spacing, radii, shadows, borders ───────────────────────────────
console.log('📏 Extracting spacing, radii, shadows...');
const layout = await page.evaluate(() => {
  const spacing = new Set();
  const radii = new Set();
  const shadows = new Set();
  const borders = new Set();
  const maxWidths = new Set();

  const elements = document.querySelectorAll('*');
  const sampled = Array.from(elements).slice(0, 800);

  for (const el of sampled) {
    const cs = getComputedStyle(el);

    for (const prop of ['marginTop','marginRight','marginBottom','marginLeft',
                         'paddingTop','paddingRight','paddingBottom','paddingLeft',
                         'gap','rowGap','columnGap']) {
      const val = cs[prop];
      if (val && val !== '0px' && val !== 'auto' && val !== 'normal') spacing.add(val);
    }

    const r = cs.borderRadius;
    if (r && r !== '0px') radii.add(r);

    const s = cs.boxShadow;
    if (s && s !== 'none') shadows.add(s);

    const bw = cs.borderTopWidth;
    if (bw && bw !== '0px') borders.add(`${bw} ${cs.borderTopStyle} ${cs.borderTopColor}`);

    const mw = cs.maxWidth;
    if (mw && mw !== 'none' && mw !== '0px') maxWidths.add(mw);
  }

  return {
    spacing: [...spacing].sort((a,b) => parseFloat(a) - parseFloat(b)),
    radii: [...radii].sort((a,b) => parseFloat(a) - parseFloat(b)),
    shadows: [...shadows],
    borders: [...borders],
    maxWidths: [...maxWidths].sort((a,b) => parseFloat(a) - parseFloat(b)),
  };
});

try {
  writeFileSync(join(outDir, 'raw/spacing.json'), JSON.stringify(layout, null, 2));
} catch (e) {
  console.error(`⚠️  Failed to write spacing.json: ${e.message}`);
}
console.log(`   Spacing: ${layout.spacing.length}, Radii: ${layout.radii.length}, Shadows: ${layout.shadows.length}`);

// ── 5. Responsive page screenshots ────────────────────────────────────
// Each breakpoint uses its own browser context with the correct device
// profile (viewport, DPR, UA, isMobile, hasTouch) so sites that serve
// different layouts based on these signals render correctly.
console.log('\n📸 Capturing responsive screenshots...');

const allPages = [{ name: 'home', url }];
for (const sub of subpages) {
  let subUrl;
  try {
    subUrl = sub.startsWith('http') ? sub : new URL(sub, url).href;
  } catch {
    console.warn(`⚠️  Skipping invalid subpage URL: ${sub}`);
    continue;
  }
  const name = sub.replace(/^\//, '').replace(/\//g, '-') || 'home';
  allPages.push({ name, url: subUrl });
}

const responsiveData = {};

for (const pg of allPages) {
  responsiveData[pg.name] = {};
  for (const [bpName, profile] of Object.entries(profiles)) {
    try {
      const bpCtx = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: profile.deviceScaleFactor || 1,
        userAgent: profile.userAgent || undefined,
        isMobile: profile.isMobile || false,
        hasTouch: profile.hasTouch || false,
      });
      try {
        const bpPage = await bpCtx.newPage();
        try {
          await bpPage.goto(pg.url, { waitUntil: 'networkidle', timeout: 30000 });
          await bpPage.waitForTimeout(500);

          const filename = `${pg.name}-${bpName}.png`;
          await bpPage.screenshot({
            path: join(outDir, 'screenshots/pages', filename),
            fullPage: true,
          });
          console.log(`   📸 ${filename} (${profile.viewport.width}×${profile.viewport.height} @${profile.deviceScaleFactor || 1}x)`);

          responsiveData[pg.name][bpName] = await bpPage.evaluate(() => {
            const nav = document.querySelector('nav');
            const main = document.querySelector('main') || document.querySelector('[role="main"]');
            const sidebar = document.querySelector('aside') || document.querySelector('[class*="sidebar"]');
            return {
              viewport: `${window.innerWidth}x${window.innerHeight}`,
              devicePixelRatio: window.devicePixelRatio,
              navVisible: nav ? getComputedStyle(nav).display !== 'none' : null,
              sidebarVisible: sidebar ? getComputedStyle(sidebar).display !== 'none' : null,
              mainWidth: main ? getComputedStyle(main).width : null,
              bodyFontSize: getComputedStyle(document.body).fontSize,
            };
          });
        } finally {
          await bpPage.close();
        }
      } finally {
        await bpCtx.close();
      }
    } catch (e) {
      console.error(`   ⚠️  ${pg.name} @${bpName}: ${e.message.slice(0, 80)}`);
      responsiveData[pg.name][bpName] = { error: e.message };
    }
  }
}

// ── 6. Component screenshots (desktop 1440×900 @2x) ──────────────────
console.log('\n📸 Capturing component screenshots...');
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

const componentSelectors = [
  { name: 'nav',              selector: 'nav, header' },
  { name: 'footer',           selector: 'footer' },
  { name: 'hero',             selector: '[class*="hero"], [class*="banner"], section:first-of-type' },
  { name: 'button-primary',   selector: 'button[class*="primary"], a[class*="primary"], button:not([class*="secondary"]):not([class*="ghost"])' },
  { name: 'button-secondary', selector: 'button[class*="secondary"], a[class*="secondary"]' },
  { name: 'card',             selector: '[class*="card"], article' },
  { name: 'form',             selector: 'form' },
  { name: 'input',            selector: 'input[type="text"], input[type="email"], input:not([type="hidden"]):not([type="submit"])' },
  { name: 'table',            selector: 'table, [class*="table"], [role="table"]' },
  { name: 'modal',            selector: '[class*="modal"], [class*="dialog"], [role="dialog"]' },
  { name: 'alert',            selector: '[class*="alert"], [class*="toast"], [class*="notification"], [role="alert"]' },
  { name: 'badge',            selector: '[class*="badge"], [class*="tag"], [class*="chip"]' },
  { name: 'avatar',           selector: '[class*="avatar"]' },
  { name: 'breadcrumb',       selector: '[class*="breadcrumb"], nav[aria-label="breadcrumb"]' },
  { name: 'tabs',             selector: '[role="tablist"], [class*="tabs"]' },
  { name: 'dropdown',         selector: '[class*="dropdown"], [class*="menu"]' },
  { name: 'sidebar',          selector: 'aside, [class*="sidebar"]' },
];

const foundComponents = [];

for (const comp of componentSelectors) {
  const el = await page.$(comp.selector);
  if (el) {
    try {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await el.screenshot({ path: join(outDir, `screenshots/components/${comp.name}.png`) });
      console.log(`   📸 ${comp.name}`);
      foundComponents.push(comp.name);
    } catch(e) {
      console.log(`   ⚠️  ${comp.name}: could not screenshot (${e.message.slice(0, 60)})`);
    }
  }
}

// ── 7. Interactive state screenshots ──────────────────────────────────
console.log('\n📸 Capturing interactive states...');

// Hover states
const hoverTargets = [
  { name: 'button-primary-hover', selector: 'button[class*="primary"], a[class*="primary"], button:first-of-type' },
  { name: 'link-hover',           selector: 'a:not(nav a):not(header a)' },
  { name: 'card-hover',           selector: '[class*="card"]:first-of-type, article:first-of-type' },
  { name: 'nav-item-hover',       selector: 'nav a, header nav a' },
];

for (const target of hoverTargets) {
  const el = await page.$(target.selector);
  if (el) {
    try {
      await el.scrollIntoViewIfNeeded();
      await el.hover();
      await page.waitForTimeout(400);
      await el.screenshot({ path: join(outDir, `screenshots/components/${target.name}.png`) });
      console.log(`   📸 ${target.name}`);
    } catch(e) {
      console.log(`   ⚠️  ${target.name}: ${e.message.slice(0, 60)}`);
    }
  }
}

// Focus states (with padding to capture focus ring)
const focusTargets = [
  { name: 'button-primary-focus', selector: 'button:first-of-type' },
  { name: 'input-focus',          selector: 'input[type="text"], input[type="email"], input:not([type="hidden"]):first-of-type' },
  { name: 'link-focus',           selector: 'a:first-of-type' },
];

for (const target of focusTargets) {
  const el = await page.$(target.selector);
  if (el) {
    try {
      await el.scrollIntoViewIfNeeded();
      await el.focus();
      await page.waitForTimeout(400);
      const box = await el.boundingBox();
      if (box) {
        const pad = 8;
        await page.screenshot({
          path: join(outDir, `screenshots/components/${target.name}.png`),
          clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: box.width + pad * 2,
            height: box.height + pad * 2,
          }
        });
        console.log(`   📸 ${target.name}`);
      }
    } catch(e) {
      console.log(`   ⚠️  ${target.name}: ${e.message.slice(0, 60)}`);
    }
  }
}

// Mobile nav (hamburger) — use real iPhone profile
console.log('\n📸 Checking for mobile nav...');
try {
  const mobileCtx = await browser.newContext({
    viewport: profiles.mobile.viewport,
    deviceScaleFactor: profiles.mobile.deviceScaleFactor,
    userAgent: profiles.mobile.userAgent,
    isMobile: true,
    hasTouch: true,
  });
  try {
    const mobilePage = await mobileCtx.newPage();
    try {
      await mobilePage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await mobilePage.waitForTimeout(500);

      const hamburger = await mobilePage.$('button[class*="menu"], button[class*="hamburger"], button[class*="nav"], button[aria-label*="menu"], [class*="mobile-menu"] button');
      if (hamburger) {
        await hamburger.click();
        await mobilePage.waitForTimeout(600);
        await mobilePage.screenshot({
          path: join(outDir, 'screenshots/components/nav-mobile-open.png'),
          fullPage: true,
        });
        console.log('   📸 nav-mobile-open');
      }
    } finally {
      await mobilePage.close();
    }
  } finally {
    await mobileCtx.close();
  }
} catch (e) {
  console.error(`   ⚠️  Mobile nav detection failed: ${e.message.slice(0, 80)}`);
}

// ── 8. Dark mode detection ────────────────────────────────────────────
console.log('\n🌙 Checking for dark mode...');

// Method 1: system preference
await page.emulateMedia({ colorScheme: 'dark' });
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(500);

const darkModeDetected = await page.evaluate(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const match = bg.match(/\d+/g);
  if (match) {
    const [r, g, b] = match.map(Number);
    return (r + g + b) / 3 < 128; // dark background = dark mode active
  }
  return false;
});

if (darkModeDetected) {
  await page.screenshot({
    path: join(outDir, 'screenshots/pages/home-dark-mode.png'),
    fullPage: true,
  });
  console.log('   📸 Dark mode detected — captured screenshot');

  const darkColors = await page.evaluate(() => {
    const props = {};
    const root = getComputedStyle(document.documentElement);
    for (let i = 0; i < root.length; i++) {
      const name = root[i];
      if (name.startsWith('--')) {
        props[name] = root.getPropertyValue(name).trim();
      }
    }
    return props;
  });
  try {
    writeFileSync(join(outDir, 'raw/colors-dark.json'), JSON.stringify(darkColors, null, 2));
    console.log('   Extracted dark mode CSS variables');
  } catch (e) {
    console.error(`   ⚠️  Failed to write colors-dark.json: ${e.message}`);
  }
} else {
  // Method 2: look for a toggle button
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  const toggle = await page.$('button[class*="dark"], button[class*="theme"], button[aria-label*="dark"], button[aria-label*="theme"], [class*="theme-toggle"]');
  if (toggle) {
    console.log('   Found theme toggle button — click it manually to capture dark mode');
  } else {
    console.log('   No dark mode detected');
  }
}

await page.emulateMedia({ colorScheme: 'light' });

// ── 9. Component manifest ─────────────────────────────────────────────
const componentManifest = {
  found: foundComponents,
  interactive_states_captured: true,
  dark_mode: darkModeDetected,
  pages_screenshotted: allPages.map(p => p.name),
  responsive: responsiveData,
};

try {
  writeFileSync(join(outDir, 'raw/components.json'), JSON.stringify(componentManifest, null, 2));
} catch (e) {
  console.error(`   ⚠️  Failed to write components.json: ${e.message}`);
}

// ── Summary ───────────────────────────────────────────────────────────
console.log(`\n✅ Extraction complete. Output in: ${outDir}/`);
console.log(`   ${Object.keys(customProperties).length} CSS variables`);
console.log(`   ${colors.length} computed colors`);
console.log(`   ${typography.fonts.length} font families`);
console.log(`   ${layout.spacing.length} spacing values`);
console.log(`   ${foundComponents.length} components screenshotted`);
console.log(`   ${allPages.length * Object.keys(profiles).length} page screenshots`);
console.log(`   All screenshots at native device DPR (2x–3x) for pixel-accurate design reference`);

} catch (e) {
  console.error(`\n❌ Extraction failed: ${e.message}`);
  exitCode = 1;
} finally {
  try {
    await browser.close();
  } catch (e) {
    console.error(`   ⚠️  browser.close() failed: ${e.message}`);
  }
}

process.exit(exitCode);
