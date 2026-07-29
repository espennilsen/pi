/* pi-jobs — Client-side dashboard logic */

const $ = (s) => document.getElementById(s);
const API = "api/jobs";

function fmt(n, d = 0) { return n == null ? "—" : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); }
function cost(n) { return n == null ? "—" : "$" + Number(n).toFixed(4); }
function dur(ms) { return ms == null ? "—" : (ms / 1000).toFixed(1) + "s"; }
function esc(s) { if (!s) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function ago(iso) {
	if (!iso) return "—";
	const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return s + "s ago";
	if (s < 3600) return Math.floor(s / 60) + "m ago";
	if (s < 86400) return Math.floor(s / 3600) + "h ago";
	return Math.floor(s / 86400) + "d ago";
}

async function loadStats() {
	try {
		const channel = $("filter-channel")?.value || "";
		const qs = channel ? `?channel=${channel}` : "";
		const data = await fetch(`${API}/stats${qs}`).then((r) => r.json());

		$("stats").innerHTML = [
			{ l: "Jobs", v: fmt(data.jobs), c: "accent" },
			{ l: "Errors", v: fmt(data.errors), c: data.errors > 0 ? "red" : "green" },
			{ l: "Tokens", v: fmt(data.tokens), c: "blue" },
			{ l: "Cost", v: cost(data.cost), c: "yellow" },
			{ l: "Tool Calls", v: fmt(data.toolCalls), c: "accent" },
			{ l: "Avg Duration", v: dur(data.avgDurationMs), c: "" },
		].map((s) =>
			'<div class="card"><div class="label">' + s.l + '</div><div class="value ' + s.c + '">' + s.v + "</div></div>"
		).join("");
	} catch (e) { console.error("Stats load failed:", e); }
}

async function loadJobs() {
	try {
		const channel = $("filter-channel")?.value || "";
		const qs = channel ? `?channel=${channel}&limit=50` : "?limit=50";
		const jobs = await fetch(`${API}/recent${qs}`).then((r) => r.json());

		$("jobs-table").innerHTML = jobs.map((j) =>
			"<tr>" +
			'<td><span class="status ' + j.status + '">' + j.status + "</span></td>" +
			'<td><span class="channel">' + esc(j.channel) + "</span></td>" +
			'<td class="prompt-preview" title="' + esc(j.prompt) + '">' + esc(j.prompt.slice(0, 80)) + "</td>" +
			'<td class="tokens">' + fmt(j.total_tokens) + "</td>" +
			'<td class="cost">' + cost(j.cost_total) + "</td>" +
			"<td>" + fmt(j.tool_call_count) + "</td>" +
			"<td>" + dur(j.duration_ms) + "</td>" +
			"<td>" + ago(j.created_at) + "</td>" +
			"</tr>"
		).join("") || '<tr><td colspan="8" style="color:var(--fg3);text-align:center;padding:24px">No jobs yet</td></tr>';
	} catch (e) { console.error("Jobs load failed:", e); }
}

async function loadModels() {
	try {
		const days = $("filter-period")?.value || "30";
		const models = await fetch(`${API}/models?days=${days}`).then((r) => r.json());

		$("models-table").innerHTML = models.map((m) =>
			"<tr><td>" + esc((m.provider || "") + "/" + m.model) + "</td>" +
			"<td>" + fmt(m.job_count) + "</td>" +
			'<td class="tokens">' + fmt(m.total_tokens) + "</td>" +
			'<td class="cost">' + cost(m.cost_total) + "</td></tr>"
		).join("") || '<tr><td colspan="4" style="color:var(--fg3)">—</td></tr>';
	} catch (e) { console.error("Models load failed:", e); }
}

async function loadTools() {
	try {
		const days = $("filter-period")?.value || "30";
		const tools = await fetch(`${API}/tools?days=${days}`).then((r) => r.json());

		$("tools-table").innerHTML = tools.map((t) =>
			"<tr><td>" + esc(t.tool_name) + "</td>" +
			"<td>" + fmt(t.call_count) + "</td>" +
			"<td>" + (t.error_count > 0 ? '<span style="color:var(--red)">' + t.error_count + "</span>" : "0") + "</td>" +
			"<td>" + dur(t.avg_duration_ms) + "</td></tr>"
		).join("") || '<tr><td colspan="4" style="color:var(--fg3)">—</td></tr>';
	} catch (e) { console.error("Tools load failed:", e); }
}

async function loadCostChart() {
	try {
		const days = parseInt($("filter-period")?.value || "30");
		const channel = $("filter-channel")?.value || "";
		const qs = `?days=${days}` + (channel ? `&channel=${channel}` : "");
		const daily = await fetch(`${API}/daily${qs}`).then((r) => r.json());

		// Group by date
		const byDate = new Map();
		for (const row of daily) {
			const existing = byDate.get(row.date) || { cost: 0, tokens: 0, jobs: 0 };
			existing.cost += row.cost_total;
			existing.tokens += row.total_tokens;
			existing.jobs += row.job_count;
			byDate.set(row.date, existing);
		}

		// Sort by date ascending
		const entries = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
		if (entries.length === 0) {
			$("cost-chart").innerHTML = '<div style="color:var(--fg3);text-align:center;padding:40px">No data</div>';
			return;
		}

		const maxCost = Math.max(...entries.map(([, d]) => d.cost), 0.001);

		const barsHtml = entries.map(([date, d]) => {
			const pct = Math.max((d.cost / maxCost) * 100, 2);
			const label = date.slice(5); // MM-DD
			return '<div class="chart-bar" style="height:' + pct + '%">' +
				'<div class="tip">' + date + ": " + cost(d.cost) + " · " + d.jobs + " runs</div></div>";
		}).join("");

		const labelsHtml = entries.map(([date]) =>
			"<span>" + date.slice(5) + "</span>"
		).join("");

		$("cost-chart").innerHTML =
			'<div class="chart-bars">' + barsHtml + "</div>" +
			'<div class="chart-labels">' + labelsHtml + "</div>";
	} catch (e) { console.error("Chart load failed:", e); }
}

function refresh() {
	loadStats();
	loadJobs();
	loadModels();
	loadTools();
	loadCostChart();
}

refresh();
setInterval(refresh, 30000);
