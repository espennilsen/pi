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
// Shared project list accessible to other modules
window._projectsList = [];
(function () {
	let projects = [];
	let currentView = "cards";
	let currentSort = "name";

	async function fetchProjects() {
		try { projects = await fetch(API).then((r) => r.json()); window._projectsList = projects; }
		catch (e) { projects = []; window._projectsList = []; }
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

		const escapedPath = esc(p.path).replace(/'/g, "\\'");
		return '<div class="proj-card ' + cls + '" onclick="projDetail.open(\'' + escapedPath + '\')" style="cursor:pointer;">' +
			'<div class="proj-card-actions"><button onclick="event.stopPropagation();projManage.hide(\'' + escapedPath + "'\">Hide</button></div>" +
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
		const escapedPath = esc(p.path).replace(/'/g, "\\'");
		return '<div class="proj-card no-git" onclick="projDetail.open(\'' + escapedPath + '\')" style="cursor:pointer;">' +
			'<div class="proj-card-actions"><button onclick="event.stopPropagation();projManage.hide(\'' + escapedPath + "'\">Hide</button></div>" +
			'<div class="proj-card-header"><span class="proj-card-name">' + esc(p.name) + "</span></div>" +
			'<div style="font-size:12px;color:var(--fg3);">No git repository</div></div>';
	}

	function renderTable(items) {
		const el = $("proj-table-body");
		if (items.length === 0) { el.innerHTML = '<tr><td colspan="7" style="color:var(--fg3);text-align:center;padding:24px">No projects found</td></tr>'; return; }
		el.innerHTML = items.map((p) => {
			const escapedPath = esc(p.path).replace(/'/g, "\\'");
			if (!p.is_git) {
				return '<tr style="opacity:0.5;cursor:pointer;" onclick="projDetail.open(\'' + escapedPath + '\')"><td><span class="proj-table-name">' + esc(p.name) + '</span></td><td colspan="5" style="color:var(--fg3);font-size:12px;">No git repository</td><td></td></tr>';
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

			return '<tr style="cursor:pointer;" onclick="projDetail.open(\'' + escapedPath + '\')">' +
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

// ── Markdown renderer (lightweight) ──────────────────────────────
function renderMarkdown(src) {
	if (!src) return '<div class="no-readme"><p>No README.md found</p></div>';

	// Normalize line endings
	let md = src.replace(/\r\n/g, "\n");

	// Escape HTML first
	md = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	// Code blocks (``` ... ```)
	md = md.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
		return '<pre><code class="lang-' + lang + '">' + code.replace(/\n$/, "") + "</code></pre>";
	});

	// Inline code
	md = md.replace(/`([^`\n]+)`/g, "<code>$1</code>");

	// Images
	md = md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');

	// Links
	md = md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

	// Headings
	md = md.replace(/^#### (.+)$/gm, "<h4>$1</h4>");
	md = md.replace(/^### (.+)$/gm, "<h3>$1</h3>");
	md = md.replace(/^## (.+)$/gm, "<h2>$1</h2>");
	md = md.replace(/^# (.+)$/gm, "<h1>$1</h1>");

	// Horizontal rule
	md = md.replace(/^---+$/gm, "<hr>");

	// Bold / italic
	md = md.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	md = md.replace(/\*([^*]+)\*/g, "<em>$1</em>");
	md = md.replace(/__([^_]+)__/g, "<strong>$1</strong>");
	md = md.replace(/_([^_]+)_/g, "<em>$1</em>");
	md = md.replace(/~~([^~]+)~~/g, "<s>$1</s>");

	// Blockquotes
	md = md.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
	// Merge adjacent blockquotes
	md = md.replace(/<\/blockquote>\n<blockquote>/g, "\n");

	// Tables
	md = md.replace(/^(\|.+\|)\n(\|[\s:|-]+\|)\n((?:\|.+\|\n?)+)/gm, function (_, headerRow, _sep, bodyRows) {
		const headers = headerRow.split("|").filter(c => c.trim()).map(c => "<th>" + c.trim() + "</th>");
		const rows = bodyRows.trim().split("\n").map(function (row) {
			const cells = row.split("|").filter(c => c.trim()).map(c => "<td>" + c.trim() + "</td>");
			return "<tr>" + cells.join("") + "</tr>";
		});
		return "<table><thead><tr>" + headers.join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table>";
	});

	// Unordered lists
	md = md.replace(/^([ \t]*)[*-] (.+)$/gm, function (_, indent, content) {
		return '<li class="ul">' + content + "</li>";
	});
	// Ordered lists
	md = md.replace(/^([ \t]*)\d+\. (.+)$/gm, function (_, indent, content) {
		return '<li class="ol">' + content + "</li>";
	});
	// Wrap consecutive li.ul in <ul> and li.ol in <ol>
	md = md.replace(/((?:<li class="ul">.*<\/li>\n?)+)/g, function (block) {
		return "<ul>" + block.replace(/ class="ul"/g, "") + "</ul>";
	});
	md = md.replace(/((?:<li class="ol">.*<\/li>\n?)+)/g, function (block) {
		return "<ol>" + block.replace(/ class="ol"/g, "") + "</ol>";
	});

	// Paragraphs: wrap remaining standalone text lines
	const lines = md.split("\n");
	const result = [];
	let inParagraph = false;
	const blockTags = /^<(h[1-6]|p|ul|ol|li|pre|blockquote|table|thead|tbody|tr|th|td|hr|div|img)/;
	const closeTags = /^<\/(ul|ol|table|thead|tbody|pre|blockquote)/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed === "") {
			if (inParagraph) { result.push("</p>"); inParagraph = false; }
			continue;
		}
		if (blockTags.test(trimmed) || closeTags.test(trimmed)) {
			if (inParagraph) { result.push("</p>"); inParagraph = false; }
			result.push(line);
			continue;
		}
		if (!inParagraph) {
			result.push("<p>" + line);
			inParagraph = true;
		} else {
			result.push(line);
		}
	}
	if (inParagraph) result.push("</p>");

	return result.join("\n");
}

// ── Detail modal ─────────────────────────────────────────────────
(function () {
	let detail = null;
	let currentTab = "readme";

	window.projDetail = {
		async open(projectPath) {
			detail = null;
			currentTab = "readme";

			// Find project in the main list to populate header immediately
			const proj = window._projectsList.find(function (p) { return p.path === projectPath; });

			const overlay = $("proj-detail-overlay");
			overlay.classList.add("open");

			// Set initial header from the project data
			const name = (proj && proj.name) || projectPath.split("/").pop() || projectPath;
			$("proj-detail-name").textContent = name;
			$("proj-detail-branch").textContent = (proj && proj.branch) || "";
			$("proj-detail-branch").style.display = (proj && proj.branch) ? "inline-block" : "none";

			let metaHtml = '<span style="font-family:monospace;font-size:11px;">' + esc(projectPath) + "</span>";
			if (proj && proj.is_git) {
				if (proj.dirty_count > 0) metaHtml += '<span style="color:var(--yellow);">⚠ ' + proj.dirty_count + " uncommitted</span>";
				else metaHtml += '<span style="color:var(--green);">✅ clean</span>';
				if (proj.ahead > 0) metaHtml += '<span style="color:var(--blue);">↑' + proj.ahead + " ahead</span>";
				if (proj.behind > 0) metaHtml += '<span style="color:var(--orange);">↓' + proj.behind + " behind</span>";
			}
			$("proj-detail-meta").innerHTML = metaHtml;
			$("proj-detail-body").innerHTML = '<div class="proj-detail-loading"><div class="spinner"></div><p>Loading…</p></div>';

			// Reset tabs
			$("proj-tab-readme").classList.add("active");
			$("proj-tab-tasks").classList.remove("active");
			$("proj-tab-commits").classList.remove("active");

			// Fetch detail
			try {
				const resp = await fetch(API + "/detail?path=" + encodeURIComponent(projectPath));
				detail = await resp.json();
			} catch (e) {
				$("proj-detail-body").innerHTML = '<div class="no-readme"><p>Failed to load project details</p></div>';
				return;
			}

			// Update header with richer info
			if (detail.packageJson) {
				const pkg = detail.packageJson;
				let meta = '<span style="font-family:monospace;font-size:11px;">' + esc(projectPath) + "</span>";
				if (pkg.version) meta += "<span>v" + esc(pkg.version) + "</span>";
				if (pkg.license) meta += "<span>📄 " + esc(pkg.license) + "</span>";
				if (pkg.dependencies > 0) meta += "<span>📦 " + pkg.dependencies + " deps</span>";
				if (pkg.scripts && pkg.scripts.length > 0) meta += "<span>⚡ " + pkg.scripts.length + " scripts</span>";
				$("proj-detail-meta").innerHTML = meta;
			}

			// Update task count badge on tab
			if (detail.tasks && detail.tasks.length > 0) {
				const openCount = detail.tasks.filter(t => t.status !== "closed").length;
				$("proj-tab-tasks").textContent = "Tasks (" + openCount + ")";
			} else if (detail.tasks === null) {
				$("proj-tab-tasks").textContent = "Tasks";
			} else {
				$("proj-tab-tasks").textContent = "Tasks (0)";
			}

			this.renderTab();
		},
		close() {
			$("proj-detail-overlay").classList.remove("open");
			detail = null;
		},
		setTab(tab) {
			currentTab = tab;
			$("proj-tab-readme").classList.toggle("active", tab === "readme");
			$("proj-tab-tasks").classList.toggle("active", tab === "tasks");
			$("proj-tab-commits").classList.toggle("active", tab === "commits");
			this.renderTab();
		},
		renderTab() {
			if (!detail) return;
			const body = $("proj-detail-body");

			if (currentTab === "readme") {
				body.innerHTML = '<div class="proj-readme">' + renderMarkdown(detail.readme) + "</div>";
			} else if (currentTab === "tasks") {
				body.innerHTML = renderTasks(detail.tasks);
			} else if (currentTab === "commits") {
				body.innerHTML = renderCommits(detail.recentCommits);
			}
		},
	};

	function renderTasks(tasks) {
		if (tasks === null) {
			return '<div class="proj-no-tasks"><p>📋 No <code>.todos</code> folder found</p><p style="margin-top:8px;font-size:12px;">Run <code>td init</code> in this project to enable task tracking.</p></div>';
		}
		if (tasks.length === 0) {
			return '<div class="proj-no-tasks"><p>✅ No open tasks</p></div>';
		}

		// Summary stats
		const open = tasks.filter(t => t.status === "open").length;
		const inProgress = tasks.filter(t => t.status === "in_progress").length;
		const inReview = tasks.filter(t => t.status === "in_review").length;
		const blocked = tasks.filter(t => t.status === "blocked").length;
		const closed = tasks.filter(t => t.status === "closed").length;

		let html = '<div class="proj-tasks-summary">';
		if (open > 0) html += '<div class="proj-tasks-stat open"><span class="num">' + open + '</span> open</div>';
		if (inProgress > 0) html += '<div class="proj-tasks-stat progress"><span class="num">' + inProgress + '</span> in progress</div>';
		if (inReview > 0) html += '<div class="proj-tasks-stat review"><span class="num">' + inReview + '</span> in review</div>';
		if (blocked > 0) html += '<div class="proj-tasks-stat" style="color:var(--red)"><span class="num">' + blocked + '</span> blocked</div>';
		if (closed > 0) html += '<div class="proj-tasks-stat closed"><span class="num">' + closed + '</span> closed</div>';
		html += "</div>";

		// Group: epics first, then by status
		const statusOrder = ["in_progress", "blocked", "in_review", "open", "closed"];
		const sorted = tasks.slice().sort(function (a, b) {
			// Epics first
			if (a.type === "epic" && b.type !== "epic") return -1;
			if (a.type !== "epic" && b.type === "epic") return 1;
			const ai = statusOrder.indexOf(a.status);
			const bi = statusOrder.indexOf(b.status);
			return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
		});

		html += '<div class="proj-task-list">';
		for (const task of sorted) {
			const statusCls = task.status.replace(/\s+/g, "_");
			const statusLabel = task.status.replace(/_/g, " ");
			html += '<div class="proj-task-item">';
			html += '<span class="proj-task-status ' + statusCls + '">' + esc(statusLabel) + "</span>";
			html += '<div class="proj-task-info">';
			html += '<div class="proj-task-title">' + esc(task.title) + "</div>";
			html += '<div class="proj-task-meta">';
			html += '<span class="proj-task-type">' + esc(task.type || "task") + "</span>";
			if (task.priority) html += '<span class="proj-task-priority ' + esc(task.priority) + '">' + esc(task.priority) + "</span>";
			if (task.labels && task.labels.length > 0) {
				for (const label of task.labels) {
					html += '<span class="proj-task-label">' + esc(label) + "</span>";
				}
			}
			html += '<span style="color:var(--fg3)">' + esc(task.id) + "</span>";
			html += "</div></div></div>";
		}
		html += "</div>";
		return html;
	}

	function renderCommits(commits) {
		if (!commits || commits.length === 0) {
			return '<div class="proj-no-tasks"><p>No commit history available</p></div>';
		}
		let html = '<div class="proj-commit-list">';
		for (const c of commits) {
			html += '<div class="proj-commit-item">';
			html += '<span class="proj-commit-hash">' + esc(c.hash) + "</span>";
			html += '<span class="proj-commit-msg">' + esc(c.msg) + "</span>";
			html += '<span class="proj-commit-author">' + esc(c.author) + "</span>";
			html += '<span class="proj-commit-date">' + ago(c.date) + "</span>";
			html += "</div>";
		}
		html += "</div>";
		return html;
	}

	$("proj-detail-overlay").addEventListener("click", function (e) { if (e.target === this) projDetail.close(); });
	document.addEventListener("keydown", function (e) {
		if (e.key === "Escape" && $("proj-detail-overlay").classList.contains("open")) {
			e.preventDefault();
			e.stopImmediatePropagation();
			projDetail.close();
		}
	}, true); // capture phase so it fires before manage overlay handler
})();
