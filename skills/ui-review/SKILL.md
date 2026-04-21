---
name: ui-review
description: >
  Review UI designs and implementations for accessibility, consistency, usability, and visual quality.
  Use when asked to review a design, audit accessibility, check UI consistency, compare implementation
  against mockups, or evaluate a user interface.
---

# UI Review

Systematic UI/UX review methodology for designs (in Penpot) and implementations (in code).

## Process

1. **Understand context** — what product, who are the users, what's the goal of this screen?
2. **Gather materials** — pull the Penpot designs and/or the live implementation
3. **Run the checklist** — score each category
4. **Report** — use the structured output format

## Review Checklist

### 1. Accessibility (WCAG 2.1 AA)

#### Color & Contrast
- [ ] Text contrast ≥ 4.5:1 against background (normal text)
- [ ] Text contrast ≥ 3:1 against background (large text ≥ 18px or 14px bold)
- [ ] UI component contrast ≥ 3:1 against adjacent colors (borders, icons, controls)
- [ ] Information not conveyed by color alone (use icons, patterns, labels too)
- [ ] Tested with color blindness simulation (protanopia, deuteranopia, tritanopia)

#### Keyboard Navigation
- [ ] All interactive elements reachable via Tab key
- [ ] Logical tab order (left-to-right, top-to-bottom, follows visual flow)
- [ ] Visible focus indicator on all focusable elements (no outline:none without replacement)
- [ ] Escape closes modals/dropdowns
- [ ] Enter/Space activates buttons and links
- [ ] Arrow keys navigate within composite widgets (tabs, menus, radio groups)

#### Screen Reader
- [ ] All images have meaningful alt text (or aria-hidden if decorative)
- [ ] Form inputs have associated labels (not just placeholder text)
- [ ] ARIA landmarks used (main, nav, aside, footer)
- [ ] Dynamic content changes announced (aria-live regions for toasts, errors)
- [ ] Headings follow a logical hierarchy (h1 → h2 → h3, no skipping)

#### Motion & Interaction
- [ ] Animations respect `prefers-reduced-motion`
- [ ] No content that flashes more than 3 times per second
- [ ] Touch targets ≥ 44x44px on mobile
- [ ] Adequate time for timed interactions (or ability to extend)

### 2. Design System Compliance

- [ ] All colors from the token palette (no hex codes outside the system)
- [ ] Typography uses defined scale (no arbitrary font sizes)
- [ ] Spacing uses the 4px grid (no magic numbers)
- [ ] Components match design system variants (no custom one-offs)
- [ ] Icons from the approved set (Lucide)
- [ ] Border radius from token scale
- [ ] Shadows from token scale

### 3. Layout & Responsiveness

- [ ] Works at all breakpoints: 375px, 768px, 1280px, 1536px
- [ ] No horizontal scroll on mobile
- [ ] Text remains readable at all sizes (no text smaller than 12px)
- [ ] Touch-friendly spacing on mobile (no cramped click targets)
- [ ] Images and media scale properly
- [ ] Content hierarchy maintained across breakpoints

### 4. Interaction Design

- [ ] Clear affordances (buttons look clickable, links look linkable)
- [ ] Hover states on all interactive elements (desktop)
- [ ] Loading states for async operations (skeleton screens or spinners)
- [ ] Empty states designed (no blank pages — always guide the user)
- [ ] Error states with clear recovery actions
- [ ] Success feedback for completed actions
- [ ] Confirmation for destructive actions (delete, discard)
- [ ] Undo available where possible

### 5. Visual Quality

- [ ] Consistent alignment (nothing looks "off" by a pixel)
- [ ] Visual hierarchy clear (primary action stands out, secondary is quieter)
- [ ] Whitespace used effectively (not cramped, not wastefully sparse)
- [ ] Typography hierarchy clear (heading → subheading → body → caption)
- [ ] Icon sizes consistent and proportional to surrounding text
- [ ] No orphaned words in headings (line breaks make sense)

### 6. Content & Copy

- [ ] Labels are clear and concise (no jargon)
- [ ] Error messages explain what went wrong AND how to fix it
- [ ] Button text describes the action ("Save changes" not "Submit")
- [ ] Placeholder text is a hint, not a label
- [ ] Consistent terminology throughout (don't mix "delete"/"remove"/"trash")

## Output Format

```markdown
## UI Review — [Screen/Component Name]

**Reviewed:** [date]
**Context:** [product, screen, purpose]
**Overall:** 🟢 Good | 🟡 Needs Work | 🔴 Significant Issues

### Accessibility
Score: X/10
[Specific findings with severity]

### Design System Compliance
Score: X/10
[Specific findings]

### Layout & Responsiveness
Score: X/10
[Specific findings]

### Interaction Design
Score: X/10
[Specific findings]

### Visual Quality
Score: X/10
[Specific findings]

### Content & Copy
Score: X/10
[Specific findings]

### 🔴 Must Fix
1. [Critical issues — accessibility violations, broken layouts]

### 🟡 Should Fix
1. [Important issues — inconsistencies, missing states]

### 🔵 Nice to Have
1. [Polish items — minor alignment, copy tweaks]

### ✅ What's Working Well
1. [Call out good patterns — reinforces what to keep doing]
```

## Quick Review (for smaller changes)

For minor changes or single components, use a shortened format:

1. **Accessibility** — contrast OK? Keyboard accessible? Screen reader friendly?
2. **Consistency** — matches the design system?
3. **States** — all states present? (hover, focus, disabled, error, loading)
4. **Responsive** — works on mobile?
5. **Copy** — labels clear and actionable?

Report as: ✅ Pass | 🟡 Minor issues | 🔴 Blocking issues
