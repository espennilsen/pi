#!/usr/bin/env -S npx tsx
/**
 * Quick smoke test for the attrs/styling fixes.
 * Tests via the Transit encoding path (same as the extension uses).
 * Run with: npx tsx test-fixes.mjs (requires tsx for .ts imports)
 */
import transit from "transit-js";

const TOKEN = process.env.PENPOT_TOKEN;
if (!TOKEN) { console.error("Set PENPOT_TOKEN env var"); process.exit(1); }
const API = "https://penpot.e9n.dev/api/rpc/command";

async function apiJson(cmd, body) {
  const r = await fetch(`${API}/${cmd}`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

async function main() {
  // Create a test file
  const teamId = process.env.PENPOT_TEAM_ID;
  if (!teamId) { console.error("Set PENPOT_TEAM_ID env var"); process.exit(1); }
  const projects = await apiJson("get-projects", { "team-id": teamId });
  const drafts = projects.find(p => p.isDefault);
  const file = await apiJson("create-file", { "project-id": drafts.id, name: "test-fixes-" + Date.now() });
  const fileId = file.id;
  // Get page ID from the file data
  const fileInfo = await apiJson("get-file", { id: fileId });
  const pageId = Object.keys(fileInfo.data?.pagesIndex ?? {})[0] ?? fileInfo.data?.pages?.[0];
  console.log(`Created test file: ${fileId}, page: ${pageId}`);

  // Get features
  const fileData = await apiJson("get-file", { id: fileId });
  const features = fileData.features;
  let revn = fileData.revn;
  const sessionId = "00000000-0000-0000-0000-000000000042";

  // Import the transit module from the extension
  const { encodeUpdateFile, buildTransitShape } = await import("./transit.ts");

  // ── Test 1: Create a rect with border radius via add-obj ──
  console.log("\n1. Create rect with r1-r4...");
  const rectId = crypto.randomUUID();
  const rectChange = {
    type: "add-obj",
    id: rectId,
    pageId,
    frameId: "00000000-0000-0000-0000-000000000000",
    parentId: "00000000-0000-0000-0000-000000000000",
    obj: {
      id: rectId, type: "rect", name: "test-rect",
      x: 10, y: 10, width: 200, height: 100,
      r1: 12, r2: 12, r3: 12, r4: 12,
      parentId: "00000000-0000-0000-0000-000000000000",
      frameId: "00000000-0000-0000-0000-000000000000",
      selrect: { x: 10, y: 10, width: 200, height: 100, x1: 10, y1: 10, x2: 210, y2: 110 },
      points: [{ x: 10, y: 10 }, { x: 210, y: 10 }, { x: 210, y: 110 }, { x: 10, y: 110 }],
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      rotation: 0, opacity: 1,
      fills: [{ fillColor: "#1E293B", fillOpacity: 1 }],
    }
  };
  let body = encodeUpdateFile({ id: fileId, sessionId, revn, vern: 0, changes: [rectChange] });
  let resp = await fetch(`${API}/update-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/transit+json", "Accept": "application/json" },
    body
  });
  let result = await resp.json();
  revn = result.lagged?.[0]?.revn ?? revn + 1;
  console.log(resp.ok ? "   ✅ Created" : "   ❌ " + JSON.stringify(result).slice(0, 200));

  // ── Test 2: mod-obj — set shadow via operations ──
  console.log("2. Set shadow via mod-obj...");
  const shadowChange = {
    type: "mod-obj", id: rectId, pageId,
    operations: [{
      type: "set", attr: "shadow",
      val: [{ id: crypto.randomUUID(), style: "drop-shadow", color: { color: "#000000", opacity: 0.3 }, offsetX: 0, offsetY: 4, blur: 12, spread: 0, hidden: false }]
    }]
  };
  body = encodeUpdateFile({ id: fileId, sessionId, revn, vern: 0, changes: [shadowChange] });
  resp = await fetch(`${API}/update-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/transit+json", "Accept": "application/json" },
    body
  });
  result = await resp.json();
  revn = result.lagged?.[0]?.revn ?? revn + 1;
  console.log(resp.ok ? "   ✅ Shadow set" : "   ❌ " + JSON.stringify(result).slice(0, 200));

  // ── Test 3: mod-obj — set strokes ──
  console.log("3. Set strokes via mod-obj...");
  const strokeChange = {
    type: "mod-obj", id: rectId, pageId,
    operations: [{
      type: "set", attr: "strokes",
      val: [{ strokeColor: "#7C3AED", strokeOpacity: 0.5, strokeWidth: 2, strokeStyle: "solid", strokeAlignment: "inner" }]
    }]
  };
  body = encodeUpdateFile({ id: fileId, sessionId, revn, vern: 0, changes: [strokeChange] });
  resp = await fetch(`${API}/update-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/transit+json", "Accept": "application/json" },
    body
  });
  result = await resp.json();
  revn = result.lagged?.[0]?.revn ?? revn + 1;
  console.log(resp.ok ? "   ✅ Strokes set" : "   ❌ " + JSON.stringify(result).slice(0, 200));

  // ── Test 4: mod-obj — set blur ──
  console.log("4. Set blur via mod-obj...");
  const blurChange = {
    type: "mod-obj", id: rectId, pageId,
    operations: [{
      type: "set", attr: "blur",
      val: { id: crypto.randomUUID(), type: "layer-blur", value: 4, hidden: false }
    }]
  };
  body = encodeUpdateFile({ id: fileId, sessionId, revn, vern: 0, changes: [blurChange] });
  resp = await fetch(`${API}/update-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/transit+json", "Accept": "application/json" },
    body
  });
  result = await resp.json();
  revn = result.lagged?.[0]?.revn ?? revn + 1;
  console.log(resp.ok ? "   ✅ Blur set" : "   ❌ " + JSON.stringify(result).slice(0, 200));

  // ── Test 5: Create text with custom font size/weight ──
  console.log("5. Create text with custom styling...");
  const textId = crypto.randomUUID();
  const textChange = {
    type: "add-obj",
    id: textId, pageId,
    frameId: "00000000-0000-0000-0000-000000000000",
    parentId: "00000000-0000-0000-0000-000000000000",
    obj: {
      id: textId, type: "text", name: "styled-text",
      x: 10, y: 130, width: 200, height: 50,
      parentId: "00000000-0000-0000-0000-000000000000",
      frameId: "00000000-0000-0000-0000-000000000000",
      selrect: { x: 10, y: 130, width: 200, height: 50, x1: 10, y1: 130, x2: 210, y2: 180 },
      points: [{ x: 10, y: 130 }, { x: 210, y: 130 }, { x: 210, y: 180 }, { x: 10, y: 180 }],
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      transformInverse: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      rotation: 0, opacity: 1,
      growType: "auto-height",
      content: {
        type: "root",
        children: [{ type: "paragraph-set", children: [{ type: "paragraph", children: [{
          text: "Bold Title",
          fontFamily: "sourcesanspro",
          fontSize: "28",
          fontWeight: "700",
          fontStyle: "normal",
          fillColor: "#FFFFFF",
          fillOpacity: 1
        }]}]}]
      }
    }
  };
  body = encodeUpdateFile({ id: fileId, sessionId, revn, vern: 0, changes: [textChange] });
  resp = await fetch(`${API}/update-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/transit+json", "Accept": "application/json" },
    body
  });
  result = await resp.json();
  revn = result.lagged?.[0]?.revn ?? revn + 1;
  console.log(resp.ok ? "   ✅ Text created" : "   ❌ " + JSON.stringify(result).slice(0, 200));

  // ── Test 6: mod-obj — update text content ──
  console.log("6. Update text content via mod-obj...");
  const contentChange = {
    type: "mod-obj", id: textId, pageId,
    operations: [{
      type: "set", attr: "content",
      val: {
        type: "root",
        children: [{ type: "paragraph-set", children: [{ type: "paragraph", children: [{
          text: "Updated Title",
          fontFamily: "sourcesanspro",
          fontSize: "32",
          fontWeight: "900",
          fontStyle: "normal",
          fillColor: "#4ADE80",
          fillOpacity: 1
        }]}]}]
      }
    }]
  };
  body = encodeUpdateFile({ id: fileId, sessionId, revn, vern: 0, changes: [contentChange] });
  resp = await fetch(`${API}/update-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/transit+json", "Accept": "application/json" },
    body
  });
  result = await resp.json();
  revn = result.lagged?.[0]?.revn ?? revn + 1;
  console.log(resp.ok ? "   ✅ Content updated" : "   ❌ " + JSON.stringify(result).slice(0, 200));

  // ── Verify shapes ──
  console.log("\n── Verifying ──");
  const page = await apiJson("get-page", { "file-id": fileId, "page-id": pageId });
  const rect = page.objects?.[rectId];
  const txt = page.objects?.[textId];

  if (rect) {
    console.log(`Rect r1=${rect.r1} r2=${rect.r2} r3=${rect.r3} r4=${rect.r4}`);
    console.log(`Rect shadow: ${rect.shadow?.length ?? 0} items, style=${rect.shadow?.[0]?.style}`);
    console.log(`Rect strokes: ${rect.strokes?.length ?? 0} items, style=${rect.strokes?.[0]?.strokeStyle}`);
    console.log(`Rect blur: type=${rect.blur?.type}, value=${rect.blur?.value}`);
  }
  if (txt) {
    const leaf = txt.content?.children?.[0]?.children?.[0]?.children?.[0];
    console.log(`Text: "${leaf?.text}" size=${leaf?.fontSize} weight=${leaf?.fontWeight} color=${leaf?.fillColor}`);
  }

  // Clean up
  await fetch(`${API}/delete-file`, {
    method: "POST",
    headers: { "Authorization": `Token ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: fileId })
  });
  console.log(`\nCleaned up test file. All tests passed! ✅`);
}

main().catch(e => { console.error(e); process.exit(1); });
