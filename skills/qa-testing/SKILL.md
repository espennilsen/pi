---
name: qa-testing
description: >
  Perform QA testing on running web applications using cmux_browser.
  Covers functional testing, accessibility auditing, edge case testing,
  and structured reporting with evidence.

  **Triggers — use this skill when:**
  - User says "test this", "QA this", "QA this PR", "check the app"
  - User says "run QA", "verify the build", "test the UI"
  - User asks to "check if it works", "validate the feature"
  - User says "acceptance testing", "smoke test", "regression test"
  - User asks to "find bugs", "test for bugs", "break it"
  - User wants to "check accessibility", "run axe", "a11y audit"

  **Covers:** Any web application accessible via HTTP. Uses cmux_browser
  (Playwright under the hood) for all browser interactions.
---

# QA Testing — Web Application Testing with cmux_browser

Test running web applications by interacting as a real user via cmux_browser, then report findings with structured evidence.

## Prerequisites

- The application must be running and accessible via HTTP
- cmux_browser tool must be available
- If the app isn't running, start it first (see Setup below)

## Workflow

### Step 1: Setup

**If the app is already running**, skip to Step 2.

**If the app needs to be started:**

```
# Start in a background cmux pane
cmux_split({ direction: "down", command: "cd /path/to/project && npm run dev\n" })

# Wait for it to be ready (check the pane output)
cmux_read({ surface: "surface:N" })

# Or poll the URL
cmux_browser({ action: "open", url: "http://localhost:3000" })
cmux_browser({ action: "wait", waitCondition: "load-state", loadState: "networkidle" })
```

**If Docker is needed:**
```bash
cd /path/to/project && docker compose up -d
# Wait for healthy
timeout 60 bash -c 'until curl -sf http://localhost:3000 > /dev/null; do sleep 2; done'
```

### Step 2: Smoke Test

Verify the app loads at all before deeper testing.

```
# Open the app
cmux_browser({ action: "open", url: "http://localhost:3000" })

# Wait for it to load
cmux_browser({ action: "wait", waitCondition: "load-state", loadState: "networkidle" })

# Screenshot the initial state
cmux_browser({ action: "screenshot" })

# Check for JavaScript errors
cmux_browser({ action: "errors" })

# Check console output
cmux_browser({ action: "console" })

# Get a DOM snapshot (accessibility tree)
cmux_browser({ action: "snapshot" })
```

If the smoke test fails (page doesn't load, crash errors), stop and report immediately.

### Step 3: Functional Testing

For each acceptance criterion, follow this pattern:

```
# 1. Navigate to the relevant state
cmux_browser({ action: "navigate", url: "/some-page" })
cmux_browser({ action: "wait", waitCondition: "load-state", loadState: "networkidle" })

# 2. Interact as a real user
cmux_browser({ action: "click", selector: "button.submit" })
cmux_browser({ action: "fill", selector: "input[name='email']", value: "test@example.com" })
cmux_browser({ action: "press", key: "Enter" })

# 3. Verify outcomes
cmux_browser({ action: "wait", waitCondition: "text", text: "Success" })
cmux_browser({ action: "snapshot", interactive: true })  # check element states
cmux_browser({ action: "get", selector: ".result", subaction: "textContent" })
cmux_browser({ action: "is", selector: ".modal", subaction: "visible" })

# 4. Screenshot as evidence
cmux_browser({ action: "screenshot" })

# 5. Check for errors after the interaction
cmux_browser({ action: "errors" })
```

**Tips for reliable element selection:**
- Use `snapshot` to see the accessibility tree and find the right selectors
- Use `find` with `role` for semantic targeting: `cmux_browser({ action: "find", subaction: "role", name: "Submit" })`
- Use `identify` to see interactive elements on the page
- Prefer `data-testid`, `aria-label`, or semantic selectors over fragile CSS paths

### Step 4: Edge Case Testing

**Be skeptical.** Agents often ship code that works for the happy path but breaks on edge cases. Actively try to break things:

| Test | How | What to look for |
|------|-----|-----------------|
| **Empty state** | Clear all data, visit pages with no content | Crashes, blank screens, missing "no data" messages |
| **Empty inputs** | Submit forms with empty required fields | Missing validation, silent failures, crashes |
| **Long text** | Paste 500+ character strings into inputs | Overflow, layout breaking, truncation without indication |
| **Special characters** | Input `<script>alert(1)</script>`, emoji 🎉, Unicode ñ | XSS, encoding errors, display issues |
| **Rapid clicks** | Double-click submit buttons, rapidly toggle switches | Duplicate submissions, race conditions, broken state |
| **Back button** | Navigate forward through a flow, then press back | Lost state, stale data, errors |
| **Refresh** | F5 / reload mid-flow | Lost state, errors, unexpected redirects |
| **Network errors** | Disconnect WiFi / block API calls (if possible) | Missing error handling, infinite spinners, blank screens |

```
# Example: test empty form submission
cmux_browser({ action: "click", selector: "button[type='submit']" })
cmux_browser({ action: "screenshot" })
cmux_browser({ action: "errors" })

# Example: test long text
cmux_browser({ action: "fill", selector: "input[name='title']", value: "A".repeat(500) })
cmux_browser({ action: "screenshot" })

# Example: test special characters
cmux_browser({ action: "fill", selector: "input[name='name']", value: "<script>alert('xss')</script>" })
cmux_browser({ action: "click", selector: "button[type='submit']" })
cmux_browser({ action: "screenshot" })
cmux_browser({ action: "errors" })
```

### Step 5: Accessibility Audit

Inject axe-core and run a full accessibility audit:

```
# Inject axe-core library
cmux_browser({ action: "eval", value: `
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  const results = await axe.run();
  return JSON.stringify({
    violations: results.violations.map(v => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      helpUrl: v.helpUrl,
      nodes: v.nodes.length
    })),
    passes: results.passes.length,
    incomplete: results.incomplete.length,
    inapplicable: results.inapplicable.length
  }, null, 2);
` })
```

**CDN fallback:** If the CDN is unreachable (air-gapped CI, network restriction, outage), the script injection will fail. In that case, fall back to:
- `npx axe-cli http://localhost:3000 --save axe-report.json` (CLI-based audit)
- or skip the accessibility audit and note "A11y audit skipped — axe-core CDN unavailable" in the report

**Security note:** For production use, add Subresource Integrity (SRI) verification to the script tag: `script.integrity = "sha384-..."; script.crossOrigin = "anonymous";` (hash available on cdnjs.com).

**Interpreting axe-core results:**
- **critical** impact — Must fix. Screen readers can't use the page.
- **serious** impact — Should fix. Major barrier for some users.
- **moderate** impact — Nice to fix. Some users affected.
- **minor** impact — Optional. Best practice improvements.

**Scoring accessibility:**
| Violations | Score |
|-----------|-------|
| 0 violations | 10 |
| 1-3 minor | 8-9 |
| 1-3 serious | 6-7 |
| 4-10 mixed | 4-5 |
| 10+ or any critical | 2-3 |

### Step 6: Performance (Optional)

Run Lighthouse for performance auditing when requested:

```bash
npx lighthouse http://localhost:3000 \
  --output=json \
  --output-path=./lighthouse-report.json \
  --chrome-flags="--headless --no-sandbox" \
  --only-categories=performance,accessibility,best-practices \
  --quiet
```

Then read and summarize the results:
```
read lighthouse-report.json
```

### Step 7: Report

Produce a structured QA report. Always include:

1. **Verdict** — PASS (all dimensions ≥ 6, no critical failures) or FAIL
2. **Scores** — 1-10 for each dimension with brief justification
3. **Acceptance criteria checklist** — each item explicitly PASS or FAIL
4. **Bugs** — with severity, reproduction steps, expected vs actual, screenshot
5. **Edge cases tested** — what you tried and what happened
6. **Accessibility results** — axe-core violation count and details
7. **Screenshots** — numbered, referenced in bug descriptions

### Step 8: Cleanup

If you started a dev server or Docker container in Step 1, clean up:

```
# Stop a dev server running in a cmux pane
cmux_close({ surface: "surface:N" })

# Or stop Docker containers
bash cd /path/to/project && docker compose down
```

This prevents orphaned processes and keeps the environment clean for the next test run.

## Report Template

```markdown
# QA Report: [Feature/PR Name]

**Date:** YYYY-MM-DD
**App URL:** http://localhost:XXXX
**Tested by:** QA Agent

## Verdict: PASS ✅ / FAIL ❌

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | X/10 | Brief justification |
| Completeness | X/10 | Brief justification |
| UX | X/10 | Brief justification |
| Robustness | X/10 | Brief justification |
| Accessibility | X/10 | N violations (N critical, N serious) |

**Average:** X.X/10

## Acceptance Criteria

- [x] Criterion 1 — PASS
- [x] Criterion 2 — PASS
- [ ] Criterion 3 — FAIL: [specific issue]

## Bugs Found

### 🔴 Bug 1: [Title] (Critical)
- **Steps:** 1. Navigate to /page 2. Click button 3. ...
- **Expected:** Form submits and shows success
- **Actual:** Page crashes with TypeError in console
- **Screenshot:** #3

### 🟡 Bug 2: [Title] (Major)
...

### 🔵 Bug 3: [Title] (Minor)
...

## Edge Cases Tested

| Test | Result | Notes |
|------|--------|-------|
| Empty form submission | ✅ PASS | Shows validation errors |
| Long text (500 chars) | ⚠️ WARN | Text overflows container |
| Special characters | ✅ PASS | Properly escaped |
| Back button | ❌ FAIL | State lost, shows blank page |
| Rapid double-click | ✅ PASS | Button disabled after first click |

## Accessibility (axe-core)

- **Violations:** N
- **Passes:** N
- **Details:**
  - [serious] button-name: 2 buttons missing accessible names
  - [moderate] color-contrast: 3 elements with insufficient contrast

## Screenshots

1. Initial load — [description]
2. After form submission — [description]
3. Bug #1 evidence — [description]
```

## Grading Rubric Reference

| Dimension | 10 (Exceptional) | 8-9 (Very Good) | 6-7 (Good) | 4-5 (Acceptable) | 2-3 (Poor) |
|-----------|-------------------|-----------------|------------|------------------|------------|
| **Functionality** | All criteria pass, flows smooth | — | Most pass, minor issues | Some criteria fail | Core flows broken |
| **Completeness** | Everything built and working | — | Minor features missing | Significant gaps | Mostly stubs |
| **UX** | Polished, delightful | — | Good, minor rough edges | Functional but clunky | Confusing/broken |
| **Robustness** | Handles everything gracefully | — | Handles common cases | Some edge cases crash | Fragile |
| **Accessibility** | 0 violations | 1-3 minor violations | 1-3 serious violations | 4-10 mixed violations | 10+ or any critical |

## Verdict Rules

- **PASS** = All dimensions ≥ 6 AND no critical functionality failures
- **FAIL** = Any dimension < 6 OR acceptance criteria not met

When reporting FAIL, always provide specific, actionable feedback the builder can use to fix the issues. Reference exact elements, URLs, and steps.
