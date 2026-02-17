---
name: blog-post
description: Draft, edit, and publish blog posts for e9n.dev. Use when creating new posts, editing drafts, or refining existing content. Handles Eleventy frontmatter, Tailwind formatting, and Espen's authentic voice.
---

# Blog Post — e9n.dev

Write and publish blog posts for Espen's blog at `/Users/espen/Dev/e9n.dev/`.

## Voice & Style

Espen's writing style:
- **Direct and practical** — No fluff, no generic AI-sounding filler
- **First-person narrative** — Personal experience and honest takes
- **Technical credibility** — Can go deep but always ties back to real outcomes
- **Conversational authority** — Reads like a senior practitioner sharing field notes, not a textbook
- **Anti-hype** — De-hyped, outcome-first perspective on AI and tech

Avoid:
- "In today's rapidly evolving landscape…" and similar generic openings
- Buzzword stacking without substance
- Overly formal or academic tone
- Listicles without narrative thread

## Process

1. **Read existing posts** to match voice and format:
   ```bash
   ls /Users/espen/Dev/e9n.dev/src/posts/
   ```
   Read 2-3 recent posts to calibrate tone.

2. **Create the post file** using the project's naming convention:
   ```
   /Users/espen/Dev/e9n.dev/src/posts/YYYY-MM-DD-slug.md
   ```

3. **Frontmatter template:**
   ```yaml
   ---
   title: "Post Title"
   description: "One-line description for SEO and social sharing"
   date: YYYY-MM-DD
   tags:
     - ai
     - sales
     - self-growth
   ---
   ```

4. **Structure:**
   - Hook in the first paragraph (personal anecdote, bold claim, or question)
   - 2-4 main sections with practical takeaways
   - Concrete examples, code snippets, or frameworks where relevant
   - Close with a next action or reflection, not a generic summary

5. **Review checklist:**
   - [ ] Does it sound like Espen, not an AI?
   - [ ] Is there a concrete takeaway in every section?
   - [ ] Would a senior technical/sales reader find this worth their time?
   - [ ] Is the frontmatter complete (title, description, date, tags)?

## Preview

```bash
cd /Users/espen/Dev/e9n.dev && npm run dev
```

## Common Tags

`ai`, `sales`, `self-growth`, `agentic-ai`, `productivity`, `leadership`, `stoicism`, `infrastructure`, `devops`, `typescript`
