---
name: design-system
description: >
  Build, maintain, and audit design systems — tokens, component libraries, style guides, and
  cross-project consistency. Use when asked to create a design system, define tokens, audit
  component consistency, generate a style guide, or sync design tokens with code.
---

# Design System Management

Structured workflows for building and maintaining design systems across Espen's projects.

## Design Token Architecture

Design tokens are the single source of truth — they flow from Penpot → JSON → Tailwind config → components.

### Token Categories

#### 1. Color Tokens
```
primitive/          — raw color values (gray-50 through gray-950, blue-500, etc.)
semantic/           — meaning-based aliases
  ├── background    — page, card, surface, overlay
  ├── foreground    — text-primary, text-secondary, text-muted, text-inverse
  ├── border        — default, muted, focus, error
  ├── accent        — primary, secondary
  └── status        — success, warning, error, info
interactive/        — state-based
  ├── hover         — bg-hover, text-hover
  ├── active        — bg-active
  ├── focus         — ring-color, ring-offset
  └── disabled      — bg-disabled, text-disabled
```

#### 2. Typography Tokens
```
font-family/        — sans, mono, serif (if used)
font-size/          — xs (12px), sm (14px), base (16px), lg (18px), xl (20px), 2xl-5xl
font-weight/        — normal (400), medium (500), semibold (600), bold (700)
line-height/        — tight (1.2), normal (1.5), relaxed (1.75)
letter-spacing/     — tight (-0.025em), normal (0), wide (0.025em)
```

#### 3. Spacing Tokens
Aligned with Tailwind's 4px base:
```
0: 0px, 0.5: 2px, 1: 4px, 1.5: 6px, 2: 8px, 2.5: 10px, 3: 12px, 4: 16px,
5: 20px, 6: 24px, 8: 32px, 10: 40px, 12: 48px, 16: 64px, 20: 80px, 24: 96px
```

#### 4. Layout Tokens
```
radius/             — none (0), sm (4px), md (8px), lg (12px), xl (16px), full (9999px)
shadow/             — none, sm, md, lg, xl, 2xl, inner
border-width/       — 0, 1px, 2px, 4px
z-index/            — dropdown (50), sticky (100), modal (200), popover (300), toast (400)
breakpoint/         — sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1536px)
```

#### 5. Motion Tokens
```
duration/           — fast (100ms), normal (200ms), slow (300ms), slower (500ms)
easing/             — ease-in, ease-out, ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)
```

### Token Format (JSON)

Store tokens in a structured JSON file that can be consumed by both Penpot and Tailwind:

```json
{
  "$schema": "design-tokens",
  "version": "1.0.0",
  "colors": {
    "primitive": { "gray": { "50": "#fafafa", "900": "#171717" } },
    "semantic": {
      "background": { "page": "{colors.primitive.gray.50}", "card": "#ffffff" },
      "foreground": { "text-primary": "{colors.primitive.gray.900}", "text-secondary": "#737373", "text-muted": "#a3a3a3" },
      "accent": { "primary": "#7c6ff0", "primary-foreground": "#ffffff", "secondary": "#6b7280" }
    }
  },
  "typography": { ... },
  "spacing": { ... }
}
```

## Component Library Structure

### Component Documentation Template

For each component in the design system, maintain:

```markdown
## Component: [Name]

**Category:** atoms | molecules | organisms
**Shadcn equivalent:** [shadcn-svelte component name, if applicable]

### Variants
- [List all visual variants]

### States
- Default, Hover, Active, Focus, Disabled, Loading, Error

### Props / Slots
- [What's configurable — size, color, icon, label, etc.]

### Accessibility
- Role: [ARIA role]
- Keyboard: [Tab, Enter, Escape, Arrow keys behavior]
- Screen reader: [What gets announced]

### Usage Guidelines
- When to use vs. alternatives
- Do's and don'ts

### Token Dependencies
- Colors: [which tokens]
- Typography: [which tokens]
- Spacing: [which tokens]
```

## Design System Audit

Run periodically to catch drift between design and code:

### Audit Checklist

1. **Token sync** — do Penpot colors/typography match the exported token JSON?
2. **Component coverage** — are all coded components represented in Penpot?
3. **Orphan styles** — any one-off colors, fonts, or spacing in Penpot that aren't in the token set?
4. **Naming consistency** — do component names match between Penpot and code?
5. **State completeness** — does every interactive component have all required states?
6. **Accessibility** — do all color combinations pass WCAG AA contrast ratios?
7. **Dark mode** — if supported, are all semantic tokens mapped for both themes?
8. **Documentation** — is the component documentation up to date?

### Audit Output Format

```markdown
## Design System Audit — [Date]

### Summary
- Components: X in Penpot, Y in code, Z fully synced
- Token drift: [list mismatches]
- Missing states: [list components with incomplete states]

### 🔴 Critical
- [Issues that break consistency or accessibility]

### 🟡 Important
- [Issues that should be fixed soon]

### 🔵 Minor
- [Nice-to-haves, polish items]

### ✅ Healthy
- [What's in good shape]
```

## Cross-Project Consistency

When multiple projects share a design system:

1. **Shared token package** — publish tokens as a versioned JSON/NPM package
2. **Penpot shared library** — use Penpot's shared library feature for cross-project components
3. **Version the system** — use semver for breaking changes (color removal, spacing scale changes)
4. **Changelog** — track every design system change with rationale

## Tailwind Integration

Map design tokens to Tailwind config:

```javascript
// tailwind.config.js (generated from tokens)
export default {
  theme: {
    extend: {
      colors: {
        // From semantic tokens
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        primary: { DEFAULT: 'var(--color-primary)', foreground: 'var(--color-accent-primary-foreground)' },
      },
      borderRadius: {
        // From radius tokens
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      }
    }
  }
}
```

This ensures design tokens are the single source of truth — change them in Penpot, export, and the Tailwind config updates automatically.
