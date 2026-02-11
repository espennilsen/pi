/* pi-projects — Client-side dashboard logic */

const $ = (s) => document.getElementById(s);
const API = "api/projects";

function esc(s) { if (!s) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function ago(iso) {
	if (!iso) return "—";
	const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (s < 60) return s + "s ago";
	if (s < 3600) return Math.floor(s / 60) + "m ago";
	if (s < 86400) return Math.floor(s / 3600) + "h ago";
	const d = Math.floor(s / 86400);
	if (d < 30) return d + "d ago";
	if (d < 365) return Math.floor(d / 30) + "mo ago";
	return Math.floor(d / 365) + "y ago";
}

// ── Projects UI ──────────────────────────────────────────────────
(function () {
	let projects = [];
	let currentView = "cards";
	let currentSort = "name";

	async function fetchProjects() {
		try { projects = await fetch(API).then((r) => r.json()); }
		catch (e) { projects = []; }
	}

	function getFiltered() {
		const search = ($("proj-search")?.value || "").toLowerCase().trim();
		const filter = $("proj-filter-status")?.value || "";
		let result = projects;

		if (filter === "dirty") result = result.filter((p) => p.is_git && p.dirty_count > 0);
		else if (filter === "clean") result = result.filter((p) => p.is_git && p.dirty_count === 0);
		else if (filter === "no-git") result = result.filter((p) => !p.is_git);

		if (search) {
			result = result.filter((p) =>
				p.name.toLowerCase().includes(search) ||
				(p.branch || "").toLowerCase().includes(search) ||
				(p.last_commit_msg || "").toLowerCase().includes(search)
			);
		}
		return sortProjects(result);
	}

	function sortProjects(items) {
		const sorted = items.slice();
		if (currentSort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name));
		else if (currentSort === "recent") sorted.sort((a, b) => (b.last_commit_date || "").localeCompare(a.last_commit_date || ""));
		else if (currentSort === "dirty") sorted.sort((a, b) => {
			if (a.dirty_count > 0 && b.dirty_count === 0) return -1;
			if (a.dirty_count === 0 && b.dirty_count > 0) return 1;
			return (b.dirty_count || 0) - (a.dirty_count || 0) || a.name.localeCompare(b.name);
		});
		return sorted;
	}

	function updateStats() {
		const gitRepos = projects.filter((p) => p.is_git);
		const dirty = gitRepos.filter((p) => p.dirty_count > 0);
		$("proj-stats").textContent = projects.length + " projects · " + gitRepos.length + " git repos · " + dirty.length + " dirty";
	}

	window.projUI = {
		setView(view) {
			currentView = view;
			$("proj-view-cards").classList.toggle("active", view === "cards");
			$("proj-view-table").classList.toggle("active", view === "table");
			$("proj-grid").style.display = view === "cards" ? "grid" : "none";
			$("proj-table").style.display = view === "table" ? "block" : "none";
			this.render();
		},
		setSort(sort) {
			currentSort = sort;
			$("proj-sort-name").classList.toggle("active", sort === "name");
			$("proj-sort-recent").classList.toggle("active", sort === "recent");
			$("proj-sort-dirty").classList.toggle("active", sort === "dirty");
			this.render();
		},
		render() {
			const filtered = getFiltered();
			if (currentView === "cards") renderCards(filtered);
			else renderTable(filtered);
		},
		async reload() {
			$("proj-loading").style.display = "block";
			$("proj-grid").style.display = "none";
			$("proj-table").style.display = "none";
			await fetchProjects();
			updateStats();
			$("proj-loading").style.display = "none";
			if (currentView === "cards") $("proj-grid").style.display = "grid";
			else $("proj-table").style.display = "block";
			this.render();
		},
	};

	function renderCards(items) {
		const el = $("proj-grid");
		if (items.length === 0) { el.innerHTML = '<div class="proj-empty"><p>No projects match your filters</p></div>'; return; }
		el.innerHTML = items.map((p) => p.is_git ? renderGitCard(p) : renderNoGitCard(p)).join("");
	}

	function renderGitCard(p) {
		const cls = p.dirty_count > 0 ? "dirty" : "clean";
		let statsHtml = "";
		if (p.staged > 0) statsHtml += '<span class="proj-stat"><span class="dot green"></span>' + p.staged + " staged</span>";
		if (p.modified > 0) statsHtml += '<span class="proj-stat"><span class="dot yellow"></span>' + p.modified + " modified</span>";
		if (p.untracked > 0) statsHtml += '<span class="proj-stat"><span class="dot red"></span>' + p.untracked + " untracked</span>";
		if (p.deleted > 0) statsHtml += '<span class="proj-stat"><span class="dot purple"></span>' + p.deleted + " deleted</span>";

		let badges = p.dirty_count === 0
			? '<span class="proj-badge clean">Clean</span>'
			: '<span class="proj-badge dirty">' + p.dirty_count + " changes</span>";
		if (!p.remote_url) badges += '<span class="proj-badge no-remote">No remote</span>';
		if (p.ahead > 0) badges += '<span class="proj-badge ahead">↑' + p.ahead + " ahead</span>";
		if (p.behind > 0) badges += '<span class="proj-badge behind">↓' + p.behind + " behind</span>";

		return '<div class="proj-card ' + cls + '">' +
			'<div class="proj-card-actions"><button onclick="event.stopPropagation();projManage.hide(\'' + esc(p.path).replace(/'/g, "\\'") + "'\">Hide</button></div>" +
			'<div class="proj-card-header">' +
				'<span class="proj-card-name">' + esc(p.name) + "</span>" +
				'<span class="proj-card-branch">' + esc(p.branch) + "</span>" +
			"</div>" +
			(p.last_commit_msg
				? '<div class="proj-card-commit">' +
					'<span class="hash">' + esc(p.last_commit_hash) + "</span>" +
					'<span class="msg">' + esc(p.last_commit_msg) + "</span>" +
					'<span class="time">' + ago(p.last_commit_date) + "</span>" +
				"</div>" : "") +
			(statsHtml ? '<div class="proj-card-stats">' + statsHtml + "</div>" : "") +
			'<div class="proj-card-footer">' + badges + "</div>" +
		"</div>";
	}

	function renderNoGitCard(p) {
		return '<div class="proj-card no-git">' +
			'<div class="proj-card-actions"><button onclick="event.stopPropagation();projManage.hide(\'' + esc(p.path).replace(/'/g, "\\'") + "'\">Hide</button></div>" +
			'<div class="proj-card-header"><span class="proj-card-name">' + esc(p.name) + "</span></div>" +
			'<div style="font-size:12px;color:var(--fg3);">No git repository</div></div>';
	}

	function renderTable(items) {
		const el = $("proj-table-body");
		if (items.length === 0) { el.innerHTML = '<tr><td colspan="7" style="color:var(--fg3);text-align:center;padding:24px">No projects found</td></tr>'; return; }
		el.innerHTML = items.map((p) => {
			if (!p.is_git) {
				return '<tr style="opacity:0.5"><td><span class="proj-table-name">' + esc(p.name) + '</span></td><td colspan="5" style="color:var(--fg3);font-size:12px;">No git repository</td><td></td></tr>';
			}
			const statusBadge = p.dirty_count > 0
				? '<span class="proj-badge dirty">' + p.dirty_count + " changes</span>"
				: '<span class="proj-badge clean">Clean</span>';
			const changes = [];
			if (p.staged > 0) changes.push('<span style="color:var(--green)">' + p.staged + "S</span>");
			if (p.modified > 0) changes.push('<span style="color:var(--yellow)">' + p.modified + "M</span>");
			if (p.untracked > 0) changes.push('<span style="color:var(--red)">' + p.untracked + "U</span>");
			if (p.deleted > 0) changes.push('<span style="color:var(--purple)">' + p.deleted + "D</span>");
			if (p.ahead > 0) changes.push('<span style="color:var(--blue)">↑' + p.ahead + "</span>");
			if (p.behind > 0) changes.push('<span style="color:var(--orange)">↓' + p.behind + "</span>");

			return "<tr>" +
				'<td><span class="proj-table-name">' + esc(p.name) + "</span></td>" +
				'<td><span class="proj-card-branch">' + esc(p.branch) + "</span></td>" +
				'<td><span class="proj-table-hash">' + esc(p.last_commit_hash) + '</span> <span style="color:var(--fg3);font-size:11px;">' + ago(p.last_commit_date) + "</span></td>" +
				'<td><span class="proj-table-msg">' + esc(p.last_commit_msg) + "</span></td>" +
				"<td>" + statusBadge + "</td>" +
				'<td style="font-size:12px;">' + (changes.join(" ") || "—") + "</td>" +
				"<td></td></tr>";
		}).join("");
	}

	projUI.reload();
})();

// ── Manage panel ─────────────────────────────────────────────────
(function () {
	let sources = [];
	let hidden = [];

	async function loadManageData() {
		try {
			sources = await fetch(API + "/sources").then((r) => r.json());
			hidden = await fetch(API + "/hidden").then((r) => r.json());
		} catch (e) { sources = []; hidden = []; }
	}

	function renderSources() {
		const el = $("proj-sources-list");
		if (sources.length === 0) { el.innerHTML = '<div class="proj-manage-empty">No extra directories added yet.</div>'; return; }
		el.innerHTML = sources.map((s) =>
			'<div class="proj-manage-item"><span class="item-path">' + esc(s.path) + "</span>" +
			'<button onclick="projManage.removeSource(' + s.id + ')">Remove</button></div>'
		).join("");
	}

	function renderHidden() {
		const el = $("proj-hidden-list");
		if (hidden.length === 0) { el.innerHTML = '<div class="proj-manage-empty">No hidden projects.</div>'; return; }
		el.innerHTML = hidden.map((h) =>
			'<div class="proj-manage-item"><span class="item-path">' + esc(h.project_path) + "</span>" +
			'<button onclick="projManage.unhide(\'' + esc(h.project_path).replace(/'/g, "\\'") + "'\">Show</button></div>"
		).join("");
	}

	window.projManage = {
		async open() {
			await loadManageData();
			renderSources();
			renderHidden();
			$("proj-add-path").value = "";
			$("proj-add-error").style.display = "none";
			$("proj-manage-overlay").classList.add("open");
		},
		close() { $("proj-manage-overlay").classList.remove("open"); },
		async addSource() {
			const input = $("proj-add-path");
			const errEl = $("proj-add-error");
			const p = input.value.trim();
			if (!p) { errEl.textContent = "Path is required."; errEl.style.display = "block"; return; }
			try {
				const resp = await fetch(API + "/sources", {
					method: "POST", headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ path: p }),
				});
				const data = await resp.json();
				if (!resp.ok) { errEl.textContent = data.error || "Failed"; errEl.style.display = "block"; return; }
				errEl.style.display = "none"; input.value = "";
				await loadManageData(); renderSources(); projUI.reload();
			} catch (e) { errEl.textContent = "Network error"; errEl.style.display = "block"; }
		},
		async removeSource(id) {
			try { await fetch(API + "/sources", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); await loadManageData(); renderSources(); projUI.reload(); } catch (e) {}
		},
		async hide(projectPath) {
			try { await fetch(API + "/hide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }) }); projUI.reload(); } catch (e) {}
		},
		async unhide(projectPath) {
			try { await fetch(API + "/unhide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: projectPath }) }); await loadManageData(); renderHidden(); projUI.reload(); } catch (e) {}
		},
	};

	$("proj-manage-overlay").addEventListener("click", function (e) { if (e.target === this) projManage.close(); });
	document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $("proj-manage-overlay").classList.contains("open")) projManage.close(); });
})();
