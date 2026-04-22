---
name: extract-design-system
description: >
  Reverse-engineer a design system from a live website (public URL or localhost).
  Extracts colors, typography, spacing, shadows, radii, breakpoints, and component
  patterns using a headed Playwright browser. Captures screenshots of pages,
  components, and interactive states at real device resolutions.
  Produces structured design tokens and optionally seeds a Penpot project.

  **Triggers — use this skill when:**
  - User says "extract design system from [url]"
  - User asks to "reverse-engineer the styles from [site]"
  - User says "build a design system based on [website]"
  - User asks to "pull the design tokens from [url]"
  - User says "analyze the design of [site]"
  - User asks to "import styles from [website] into Penpot"
  - User points at a URL and asks about its colors, fonts, spacing, or components
---

# Extract Design System from Website

Reverse-engineer a complete design system from a live website using two passes:
1. **CSS source analysis** — fetch and parse stylesheets for declared values
2. **Headed Playwright extraction** — visually browse the site, interact with elements,
   extract computed styles, and capture screenshots at real device resolutions

## Prerequisites

- Playwright installed (`npx playwright install chromium` if not set up)
- `web_fetch` tool for fetching raw HTML/CSS source

## Quick Start

Run the extraction script against the target URL:

```bash
node scripts/extract.mjs <url> [outDir] [subpage1,subpage2,...]
```

Examples:
```bash
node scripts/extract.mjs https://example.com
node scripts/extract.mjs https://example.com ./my-tokens "/about,/pricing,/docs"
node scripts/extract.mjs http://localhost:3000 extracted "/dashboard,/settings"
```

The script opens a **visible browser** (`headless: false`) so you can watch the
extraction. It uses real device profiles for accurate screenshots:

| Breakpoint | Device | Viewport | DPR | Real image size |
|------------|--------|----------|-----|-----------------|
| Mobile | iPhone 15 | 393×659 | 3x | 1179×1977 |
| Tablet | iPad Pro 11 | 834×1194 | 2x | 1668×2388 |
| Desktop | — | 1440×900 | 2x | 2880×1800 |
| Wide | — | 1920×1080 | 2x | 3840×2160 |

Mobile and tablet use Playwright's built-in device descriptors (correct UA,
`isMobile`, `hasTouch`) so sites serving different layouts render correctly.

## Output Structure

```
{outDir}/
├── screenshots/
│   ├── pages/               — full-page at 4 breakpoints × each page
│   │   ├── home-mobile.png
│   │   ├── home-desktop.png
│   │   ├── home-dark-mode.png
│   │   └── ...
│   └── components/          — isolated component + hover/focus states
│       ├── nav.png
│       ├── button-primary.png
│       ├── button-primary-hover.png
│       ├── button-primary-focus.png
│       ├── nav-mobile-open.png
│       └── ...
└── raw/
    ├── colors.json          — CSS custom properties + computed colors
    ├── colors-dark.json     — dark mode variables (if detected)
    ├── typography.json      — font families, type styles, @font-face
    ├── spacing.json         — spacing, radii, shadows, borders, max-widths
    └── components.json      — component manifest + responsive layout data
```

## Workflow

### Step 1: Run the Extraction Script

```bash
node scripts/extract.mjs "TARGET_URL" "extracted-design-system" "/about,/pricing"
```

The script automatically:
- Extracts CSS custom properties and computed colors from 800 sampled elements
- Captures typography from all semantic elements (h1-h6, p, a, button, etc.)
- Measures spacing, radii, shadows, and borders
- Screenshots every page at 4 breakpoints with real device contexts
- Isolates and screenshots 17 common component types
- Captures hover and focus states on interactive elements
- Tests mobile nav by clicking hamburger-like buttons at iPhone viewport
- Detects dark mode via `prefers-color-scheme` emulation and toggle sniffing

### Step 2: CSS Source Analysis (supplementary)

The script captures computed values. This step catches declared values from CSS
source that may not be active on the current page:

```bash
# Fetch stylesheets identified in the HTML
web_fetch <stylesheet-url>

# Look for things the computed pass might miss:
# - Media query breakpoints
# - Keyframe animations
# - CSS custom property definitions with fallbacks
# - Commented-out or unused styles that reveal design intent
```

### Step 3: Organize Raw Data into Tokens

Review `raw/colors.json`, `raw/typography.json`, `raw/spacing.json` and the
screenshots. Then organize into a structured token file.

#### Colors → Palette

Group extracted colors into categories:

| Category | What to look for |
|----------|-----------------|
| **Primary** | Brand color, CTA buttons, most prominent accent |
| **Secondary** | Supporting accent, secondary buttons |
| **Neutral** | Backgrounds, text, borders — the gray scale |
| **Success** | Green tones (confirmations, checkmarks) |
| **Warning** | Yellow/amber tones (alerts) |
| **Error** | Red tones (errors, delete actions) |
| **Info** | Blue tones (informational messages) |

Deduplicate near-identical colors (ΔE < 3 in OKLCH space). A site with 47
slightly different grays probably intended 5-8.

#### Typography → Scale

Map extracted font sizes to a named scale:

| Name | Size range |
|------|-----------|
| caption | ≤12px |
| small | 13-14px |
| body (base) | 15-16px |
| large | 17-18px |
| h6-h1 | 18-48px |
| display | 48px+ |

#### Spacing → Grid

Snap raw pixel values to the nearest standard grid:

```
4px grid: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96
8px grid: 8, 16, 24, 32, 40, 48, 56, 64, 80, 96
```

Pick whichever grid the extracted values align to with the least rounding.

#### Components → Inventory

For each component in the screenshots, document:
- Visual appearance (size, colors, spacing)
- Variants observed (different sizes, states)
- Interactive behavior (from hover/focus screenshots)
- Closest shadcn-svelte equivalent

### Step 4: Compile Token File

Write the organized data to `tokens.json`:

```json
{
  "$schema": "extracted-design-tokens",
  "source": "https://example.com",
  "extracted": "2026-03-09",
  "framework_detected": "tailwind|bootstrap|custom|none",
  "dark_mode": true,
  "colors": {
    "light": {
      "primary": { "50": "#...", "500": "#...", "900": "#..." },
      "neutral": { "50": "#...", "950": "#..." }
    },
    "dark": { }
  },
  "typography": {
    "fontFamilies": { "sans": "...", "mono": "..." },
    "scale": { "h1": { "size": "36px", "weight": 700, "lineHeight": 1.2 } }
  },
  "spacing": { "grid": "4px", "scale": [0, 4, 8, 12, 16, 24, 32, 48, 64, 96] },
  "radii": { "sm": "4px", "md": "8px", "lg": "12px" },
  "shadows": { "sm": "...", "md": "...", "lg": "..." },
  "components": { "buttons": { "variants": ["primary", "secondary"] } }
}
```

### Step 5: Seed Penpot (optional)

If requested, create a Penpot project from the tokens using `pi-penpot`:

1. Create project named after the source site
2. Create a "Design System" page with color swatches, type samples, spacing ruler
3. Create pages for each major screen, importing screenshots as references
4. Build components matching the extracted inventory

### Step 6: Generate Tailwind Config (optional)

Map tokens to a Tailwind config with CSS custom properties for runtime theming.

## Tips

- **Pass 3-5 subpages** for broader component coverage
- **CSS custom properties are gold** — sites using them have self-documented tokens
- **Watch the browser** — headed mode reveals cookie banners, auth walls, and popups that block extraction
- **Interactive states matter** — hover/focus screenshots catch design intent static captures miss
- **Don't over-extract** — focus on intentional design decisions, not every computed value
- **Remove `slowMo`** in the script for faster extraction once verified
- **Check for dark mode** — the script detects it automatically via both `prefers-color-scheme` and toggle buttons
