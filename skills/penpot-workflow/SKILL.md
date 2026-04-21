---
name: penpot-workflow
description: >
  Manage design work in Penpot — create projects, organize pages, build components, export assets,
  review designs visually, and handle design-to-code handoff. Use when asked to create designs,
  manage Penpot projects, build components, export tokens, set up a new design project,
  review a design, take screenshots, or show what something looks like.
---

# Penpot Workflow

Step-by-step workflows for managing design work in Penpot via the `pi-penpot` extension.

## Project Setup

When starting a new design project:

1. **Create the Penpot project** with a clear, matching name (same as the code repo)
2. **Set up standard pages:**
   - `Design System` — shared components, tokens, and styles
   - `Wireframes` — low-fidelity layouts and flows
   - One page per major screen or user flow (e.g., `Dashboard`, `Settings`, `Onboarding`)
3. **Define foundations first:**
   - Color palette (primary, secondary, neutral, semantic: success/warning/error/info)
   - Typography scale (headings h1-h6, body, caption, label, mono)
   - Spacing scale (aligned with Tailwind: 4px base unit)
   - Border radius tokens
   - Shadow/elevation tokens

## Shape Creation

### Creating shapes with full styling

Use `penpot_page` tool actions. All shapes support `fills`, `opacity`, and `rotation` on creation.

**Rectangles and frames** also support `r1`-`r4` for border radius on creation:

```
penpot_page add-rectangle fileId=X pageId=Y x=0 y=0 width=200 height=100
  fills=[{fillColor: "#1E293B", fillOpacity: 1}]
  r1=12 r2=12 r3=12 r4=12
```

**Text** supports `fontSize`, `fontWeight`, `fontFamily`, `fontColor` on creation:

```
penpot_page add-text fileId=X pageId=Y x=0 y=0 width=200 height=40
  text="Hello World"
  fontSize="24" fontWeight="700" fontFamily="sourcesanspro" fontColor="#FFFFFF"
```

### Available font families
- `sourcesanspro` — Source Sans Pro (default, always available)
- Custom fonts can be uploaded via `create-font-variant`

### Font size and weight are STRINGS
Always pass `fontSize` and `fontWeight` as strings: `"24"` not `24`, `"700"` not `700`.

## Shape Styling (modify-shape)

After creation, use `modify-shape` to add advanced styling. First-class params:

### Border Radius
```
penpot_page modify-shape fileId=X pageId=Y shapeId=Z r1=16 r2=16 r3=16 r4=16
```
- `r1` = top-left, `r2` = top-right, `r3` = bottom-right, `r4` = bottom-left

### Shadows
```
penpot_page modify-shape fileId=X pageId=Y shapeId=Z
  shadow=[{
    style: "drop-shadow",
    color: {color: "#000000", opacity: 0.3},
    offsetX: 0, offsetY: 4, blur: 12, spread: 0
  }]
```
- Styles: `drop-shadow`, `inner-shadow`
- UUID is auto-generated if not provided
- Multiple shadows supported (array)

### Blur
```
penpot_page modify-shape fileId=X pageId=Y shapeId=Z
  blur={type: "layer-blur", value: 4}
```
- Types: `layer-blur`, `background-blur`
- UUID is auto-generated

### Strokes
```
penpot_page modify-shape fileId=X pageId=Y shapeId=Z
  strokes=[{strokeColor: "#7C3AED", strokeOpacity: 0.5, strokeWidth: 2, strokeAlignment: "inner"}]
```
- Alignment: `inner`, `center`, `outer`
- Style (via attrs): `solid`, `dotted`, `dashed`, `mixed`, `none`

### Text Content (re-style existing text)
```
penpot_page modify-shape fileId=X pageId=Y shapeId=Z
  textContent={
    type: "root",
    children: [{type: "paragraph-set", children: [{type: "paragraph", children: [{
      text: "Updated text",
      fontFamily: "sourcesanspro",
      fontSize: "32",
      fontWeight: "700",
      fontStyle: "normal",
      fillColor: "#FFFFFF",
      fillOpacity: 1
    }]}]}]
  }
```

### Generic attrs (any shape attribute)
Use `attrs` as a catch-all for any shape property not covered above:
```
penpot_page modify-shape fileId=X pageId=Y shapeId=Z
  attrs={hidden: true, blocked: false}
```

## Design Workflow — Best Practices

### Step-by-step for polished designs

1. **Create shapes** with basic geometry + fills + border radius
2. **Style shapes** with modify-shape: shadows, strokes, blur
3. **Create text** with proper fontSize/fontWeight/fontColor from the start
4. **Re-style text** with textContent on modify-shape if needed later
5. **Batch work** — create all shapes first, then style them (reduces API calls)

### Performance tips
- Create shapes in rapid succession (each is one API call)
- Use modify-shape to batch multiple styling changes on one shape (fills + strokes + shadow in one call)
- Always get file features from `penpot get-file` before manual API calls

### What works with the extension tools
| Feature | Create | Modify | Notes |
|---------|--------|--------|-------|
| Position & size | ✅ | ✅ | x, y, width, height |
| Fills | ✅ | ✅ | Array of fill objects |
| Border radius | ✅ | ✅ | r1, r2, r3, r4 params |
| Shadows | ❌ | ✅ | shadow param, UUID auto-generated |
| Blur | ❌ | ✅ | blur param, UUID auto-generated |
| Strokes | ✅ | ✅ | strokes param |
| Text styling | ✅ | ✅ | fontSize/fontWeight/fontColor on create; textContent on modify |
| Opacity | ✅ | ✅ | 0-1 number |
| Rotation | ✅ | ✅ | degrees |

## Visual Review

When you need to **review your own work** or the user asks you to **review a design**, capture actual rendered screenshots from Penpot's viewer.

### When to do this

- After creating or modifying designs — always screenshot to verify the result
- When the user says "review", "show me", "how does it look", "screenshot"
- Before handoff — capture final state for documentation

### Workflow

#### 1. Get the file and page IDs

```
penpot get-file fileId=<fileId>
```

#### 2. Create a share link

```
penpot create-share-link fileId=<fileId> pages=[<pageId1>, <pageId2>] whoInspect="all"
```

Share links are required — Penpot's viewer won't render without either authentication or a share token.

#### 3. Screenshot each page with Playwright

The Penpot viewer URL format is:
```
https://penpot.e9n.dev/#/view?file-id=<fileId>&page-id=<pageId>&section=interactions&index=0&share-id=<shareId>
```

Use Playwright to screenshot each page URL. Penpot is a complex ClojureScript SPA — wait 6+ seconds after navigation for it to render.

Save screenshots to `/tmp/penpot-<page-name>.png`, then `read` them to view inline.

#### 4. Review what you see

After viewing the screenshot, evaluate:

- **Layout** — is there wasted space? Are elements aligned to a grid?
- **Visual hierarchy** — can you immediately tell what's important?
- **Consistency** — do similar elements (cards, tags, buttons) share the same styling?
- **Completeness** — are there missing states, empty areas, placeholder content?
- **Accessibility** — text contrast, touch target sizes, focus indicators
- **Polish** — border radius consistency, shadow consistency, proper spacing

## Component Creation

Follow atomic design methodology:

### Atoms (smallest building blocks)
- Buttons (primary, secondary, ghost, destructive — each with default/hover/active/disabled/focus)
- Inputs (text, textarea, select, checkbox, radio, toggle)
- Labels, badges, tags
- Icons (use Lucide as base set)
- Avatar, tooltip, separator

### Molecules (composed atoms)
- Form fields (label + input + helper text + error message)
- Search bar (input + icon + button)
- Card (container + content slots)
- Menu item (icon + label + shortcut badge)

### Organisms (composed molecules)
- Navigation (sidebar, topbar, breadcrumbs)
- Data tables (headers + rows + pagination + filters)
- Modals/dialogs (overlay + card + action buttons)
- Forms (multiple form fields + submit action)

### Naming Convention
Use slash-separated categories: `category/component-name/variant`
- `buttons/primary/default`
- `buttons/primary/hover`
- `forms/text-input/filled`
- `navigation/sidebar/collapsed`

## States & Variants

Every interactive component needs these states:
- **Default** — resting state
- **Hover** — mouse over (desktop)
- **Active/Pressed** — being clicked/tapped
- **Focus** — keyboard focus (visible focus ring, WCAG required)
- **Disabled** — non-interactive
- **Loading** — async operation in progress (skeleton or spinner)
- **Error** — validation failure

## Responsive Design

Design at these breakpoints (aligned with Tailwind):
- **Mobile**: 375px (iPhone SE baseline)
- **Tablet**: 768px
- **Desktop**: 1280px
- **Wide**: 1536px

Use Penpot's grid and layout features:
- Auto-layout for flex-like behavior
- Grid components for dashboard layouts
- Constraints for responsive positioning

## Design-to-Code Handoff

When preparing designs for developer handoff:

1. **Export design tokens** as JSON:
   ```json
   {
     "colors": { "primary-500": "#7c6ff0", ... },
     "spacing": { "1": "4px", "2": "8px", ... },
     "typography": { "heading-1": { "size": "36px", "weight": 700, "lineHeight": 1.2 } },
     "radii": { "sm": "4px", "md": "8px", "lg": "12px" },
     "shadows": { "sm": "0 1px 2px rgba(0,0,0,0.05)", ... }
   }
   ```

2. **Map components to shadcn-svelte** — document which Penpot component maps to which shadcn component and what customization is needed

3. **Annotate specs** — add notes on each page for:
   - Spacing between elements
   - Interaction behavior (transitions, animations)
   - Edge cases (empty states, error states, loading states)
   - Accessibility notes (ARIA labels, focus order)

4. **Export assets** — SVGs for icons and illustrations, optimized images

## Penpot API Patterns

Use the `pi-penpot` extension's three tools:

- **`penpot`** — org-level: projects, files, teams, libraries, webhooks, snapshots, share links
- **`penpot_page`** — design: pages, shapes (create/modify/delete/move), components
- **`penpot_comment`** — collaboration: comment threads and replies

### Critical API knowledge

1. **Always get the file first** — `penpot get-file` returns pageIds and file features
2. **File features must match** — features from `get-file` must be passed back in `update-file`
3. **Transit+JSON encoding** — the extension handles this automatically for all write operations
4. **UUIDs auto-generated** — shadow and blur IDs are auto-generated when not provided
5. **camelCase in params, kebab-case internally** — the extension converts automatically

## Checklist Before Handoff

- [ ] All components use the design system (no one-off styles)
- [ ] States documented (default, hover, active, focus, disabled, error, loading)
- [ ] Responsive layouts at all breakpoints
- [ ] Color contrast passes WCAG AA (4.5:1 text, 3:1 large text/UI)
- [ ] Focus indicators visible on all interactive elements
- [ ] Empty states, error states, and loading states designed
- [ ] Design tokens exported as JSON
- [ ] Component-to-shadcn mapping documented
- [ ] Spacing and typography use the defined scale (no magic numbers)
