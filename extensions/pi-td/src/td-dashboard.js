(function() {
  var issues = [];
  var currentView = 'board';
  var sortColumn = 'updated_at';
  var sortDirection = 'desc';
  var currentPage = 1;
  var pageSize = 25;
  var BOARD_COLUMNS = ['open', 'in_progress', 'in_review', 'blocked', 'closed'];
  var COLUMN_LABELS = { open: 'Open', in_progress: 'In Progress', in_review: 'In Review', blocked: 'Blocked', closed: 'Closed' };

  // ── API helpers ───────────────────────────────────────

  async function fetchIssues() {
    try {
      var params = new URLSearchParams();
      var type = document.getElementById('td-filter-type').value;
      var priority = document.getElementById('td-filter-priority').value;
      var showClosed = document.getElementById('td-show-closed').checked;
      if (type) params.set('type', type);
      if (priority) params.set('priority', priority);
      if (showClosed) params.set('all', '1');
      var resp = await fetch('/api/td?' + params.toString());
      issues = await resp.json();
    } catch(e) { issues = []; }
  }

  async function fetchIssueDetail(id) {
    try {
      var resp = await fetch('/api/td/detail?id=' + encodeURIComponent(id));
      return await resp.json();
    } catch(e) { return null; }
  }

  // ── View toggle ───────────────────────────────────────

  window.tdUI = {
    setView: function(view) {
      currentView = view;
      document.getElementById('td-view-board').classList.toggle('active', view === 'board');
      document.getElementById('td-view-table').classList.toggle('active', view === 'table');
      document.getElementById('td-board').style.display = view === 'board' ? 'grid' : 'none';
      document.getElementById('td-table').style.display = view === 'table' ? 'block' : 'none';
      render();
    },
    reload: async function() {
      await fetchIssues();
      currentPage = 1;
      render();
    },
    filterLocal: function() {
      currentPage = 1;
      render();
    },
    sortBy: function(column) {
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = column === 'updated_at' ? 'desc' : 'asc';
      }
      currentPage = 1;
      render();
    },
    goToPage: function(page) {
      currentPage = page;
      render();
    },
    setPageSize: function(size) {
      pageSize = size;
      currentPage = 1;
      render();
    },
    showDetail: async function(id) {
      var detail = await fetchIssueDetail(id);
      if (!detail) return;
      // If this issue has uncertain handoff items, show the decision form
      if (detail.handoff && detail.handoff.uncertain && detail.handoff.uncertain.length) {
        tdUI.showDecisionModal(detail);
        return;
      }
      renderDetail(detail);
    },
    closeDetail: function() {
      document.getElementById('td-detail-overlay').classList.remove('open');
    },
    showDecisionModal: function(issue) {
      var existing = document.getElementById('td-decision-modal');
      if (existing) existing.remove();

      var items = issue.handoff.uncertain || [];
      var overlay = document.createElement('div');
      overlay.id = 'td-decision-modal';
      overlay.className = 'td-modal-overlay';

      var itemsHtml = items.map(function(item, idx) {
        return '<div class="td-decision-item">' +
          '<div class="td-decision-question">❓ ' + esc(item) + '</div>' +
          '<textarea id="td-decision-input-' + idx + '" rows="2" placeholder="Your decision for this item..."></textarea>' +
        '</div>';
      }).join('');

      overlay.innerHTML =
        '<div class="td-modal">' +
          '<h3>Resolve Uncertain Items</h3>' +
          '<p class="td-modal-hint">' + esc(issue.id) + ' — ' + esc(issue.title) + '</p>' +
          '<p class="td-modal-hint">Provide decisions for the open questions below. Leave blank to skip.</p>' +
          '<div class="td-decision-items">' + itemsHtml + '</div>' +
          '<div class="td-modal-actions">' +
            '<button class="td-modal-cancel" onclick="tdUI.closeDecisionModal()">Cancel</button>' +
            '<button class="td-modal-cancel" onclick="tdUI.viewFullDetail(\'' + esc(issue.id) + '\')">View Full Detail</button>' +
            '<button class="td-modal-submit" onclick="tdUI.submitDecisions(\'' + esc(issue.id) + '\', ' + items.length + ')">Submit Decisions</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) tdUI.closeDecisionModal();
      });
      setTimeout(function() {
        var first = document.getElementById('td-decision-input-0');
        if (first) first.focus();
      }, 50);
    },
    closeDecisionModal: function() {
      var modal = document.getElementById('td-decision-modal');
      if (modal) modal.remove();
    },
    viewFullDetail: async function(id) {
      tdUI.closeDecisionModal();
      var detail = await fetchIssueDetail(id);
      if (!detail) return;
      renderDetail(detail);
    },
    submitDecisions: async function(id, count) {
      var decisions = [];
      for (var i = 0; i < count; i++) {
        var val = document.getElementById('td-decision-input-' + i).value.trim();
        if (val) decisions.push(val);
      }
      if (decisions.length === 0) {
        alert('Enter at least one decision.');
        return;
      }
      try {
        var resp = await fetch('/api/td/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, decisions: decisions })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Handoff failed' }; });
          alert('Submit decisions failed: ' + (err.error || 'Unknown error'));
          return;
        }
        tdUI.closeDecisionModal();
        await tdUI.reload();
      } catch(e) { alert('Submit decisions failed: ' + e.message); }
    },
    updateStatus: async function(id, newStatus) {
      try {
        var resp = await fetch('/api/td', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, status: newStatus })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Update failed' }; });
          alert('Status update failed: ' + (err.error || 'Unknown error'));
          return;
        }
        tdUI.closeDetail();
        await tdUI.reload();
      } catch(e) { alert('Status update failed: ' + e.message); }
    },
    reviewIssue: function(id) {
      tdUI.showHandoffModal(id);
    },
    showHandoffModal: function(id) {
      // Remove existing modal if any
      var existing = document.getElementById('td-handoff-modal');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'td-handoff-modal';
      overlay.className = 'td-modal-overlay';
      overlay.innerHTML =
        '<div class="td-modal">' +
          '<h3>Handoff for Review</h3>' +
          '<p class="td-modal-hint">Capture what was done before submitting for review.</p>' +
          '<div class="td-modal-field">' +
            '<label>✓ Done <span class="td-modal-field-hint">(one per line)</span></label>' +
            '<textarea id="td-handoff-done" rows="3" placeholder="What was completed..."></textarea>' +
          '</div>' +
          '<div class="td-modal-field">' +
            '<label>⏳ Remaining <span class="td-modal-field-hint">(one per line)</span></label>' +
            '<textarea id="td-handoff-remaining" rows="2" placeholder="What still needs to be done..."></textarea>' +
          '</div>' +
          '<div class="td-modal-field">' +
            '<label>📋 Decisions <span class="td-modal-field-hint">(one per line)</span></label>' +
            '<textarea id="td-handoff-decisions" rows="2" placeholder="Key decisions made..."></textarea>' +
          '</div>' +
          '<div class="td-modal-field">' +
            '<label>❓ Uncertain <span class="td-modal-field-hint">(one per line)</span></label>' +
            '<textarea id="td-handoff-uncertain" rows="2" placeholder="Open questions..."></textarea>' +
          '</div>' +
          '<div class="td-modal-actions">' +
            '<button class="td-modal-cancel" onclick="tdUI.closeHandoffModal()">Cancel</button>' +
            '<button class="td-modal-submit" onclick="tdUI.submitHandoffAndReview(\'' + esc(id) + '\')">Submit for Review</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) tdUI.closeHandoffModal();
      });
      // Focus the first textarea
      setTimeout(function() { document.getElementById('td-handoff-done').focus(); }, 50);
    },
    closeHandoffModal: function() {
      var modal = document.getElementById('td-handoff-modal');
      if (modal) modal.remove();
    },
    submitHandoffAndReview: async function(id) {
      try {
        var parseLines = function(val) {
          return val.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
        };
        var done = parseLines(document.getElementById('td-handoff-done').value);
        var remaining = parseLines(document.getElementById('td-handoff-remaining').value);
        var decisions = parseLines(document.getElementById('td-handoff-decisions').value);
        var uncertain = parseLines(document.getElementById('td-handoff-uncertain').value);

        // Submit handoff if any fields are filled
        if (done.length || remaining.length || decisions.length || uncertain.length) {
          var hResp = await fetch('/api/td/handoff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: id, done: done, remaining: remaining, decisions: decisions, uncertain: uncertain })
          });
          if (!hResp.ok) {
            var hErr = await hResp.json().catch(function() { return { error: 'Handoff failed' }; });
            alert('Handoff failed: ' + (hErr.error || 'Unknown error'));
            return;
          }
        }

        // Now submit for review
        var resp = await fetch('/api/td/review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Review failed' }; });
          alert('Submit for review failed: ' + (err.error || 'Unknown error'));
          return;
        }
        tdUI.closeHandoffModal();
        tdUI.closeDetail();
        await tdUI.reload();
      } catch(e) { alert('Submit for review failed: ' + e.message); }
    },
    approveIssue: async function(id) {
      try {
        var resp = await fetch('/api/td/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Approve failed' }; });
          alert('Approve failed: ' + (err.error || 'Unknown error'));
          return;
        }
        tdUI.closeDetail();
        await tdUI.reload();
      } catch(e) { alert('Approve failed: ' + e.message); }
    },
    rejectIssue: async function(id, reason) {
      if (!reason) reason = prompt('Rejection reason:');
      if (!reason) return;
      try {
        var resp = await fetch('/api/td/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, reason: reason })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Reject failed' }; });
          alert('Reject failed: ' + (err.error || 'Unknown error'));
          return;
        }
        tdUI.closeDetail();
        await tdUI.reload();
      } catch(e) { alert('Reject failed: ' + e.message); }
    },
    showActivityModal: function(id) {
      var existing = document.getElementById('td-activity-modal');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.id = 'td-activity-modal';
      overlay.className = 'td-modal-overlay';
      overlay.innerHTML =
        '<div class="td-modal">' +
          '<h3>Add Activity</h3>' +
          '<div class="td-modal-field">' +
            '<label>Type</label>' +
            '<select id="td-activity-type">' +
              '<option value="progress">Progress</option>' +
              '<option value="decision">Decision</option>' +
              '<option value="blocker">Blocker</option>' +
              '<option value="hypothesis">Hypothesis</option>' +
              '<option value="tried">Tried</option>' +
              '<option value="result">Result</option>' +
            '</select>' +
          '</div>' +
          '<div class="td-modal-field">' +
            '<label>Message</label>' +
            '<textarea id="td-activity-message" rows="3" placeholder="What happened..."></textarea>' +
          '</div>' +
          '<div class="td-modal-actions">' +
            '<button class="td-modal-cancel" onclick="tdUI.closeActivityModal()">Cancel</button>' +
            '<button class="td-modal-submit" onclick="tdUI.submitActivity(\'' + esc(id) + '\')">Add</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) tdUI.closeActivityModal();
      });
      setTimeout(function() { document.getElementById('td-activity-message').focus(); }, 50);
    },
    closeActivityModal: function() {
      var modal = document.getElementById('td-activity-modal');
      if (modal) modal.remove();
    },
    submitActivity: async function(id) {
      var message = document.getElementById('td-activity-message').value.trim();
      if (!message) { alert('Message is required'); return; }
      var type = document.getElementById('td-activity-type').value;
      try {
        var resp = await fetch('/api/td/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id, message: message, type: type })
        });
        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Failed' }; });
          alert('Add activity failed: ' + (err.error || 'Unknown error'));
          return;
        }
        tdUI.closeActivityModal();
        // Refresh the detail panel
        tdUI.showDetail(id);
        await tdUI.reload();
      } catch(e) { alert('Add activity failed: ' + e.message); }
    },
    deleteIssue: async function(id) {
      if (!confirm('Delete issue ' + id + '?')) return;
      try {
        await fetch('/api/td', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: id })
        });
        tdUI.closeDetail();
        await tdUI.reload();
      } catch(e) {}
    }
  };

  // ── Rendering ─────────────────────────────────────────

  function getFilteredIssues() {
    var search = (document.getElementById('td-search').value || '').toLowerCase().trim();
    var uncertainOnly = document.getElementById('td-show-uncertain').checked;
    var filtered = issues;
    if (uncertainOnly) {
      filtered = filtered.filter(function(i) {
        return i.has_handoff && i.uncertain_items && i.uncertain_items.length > 0;
      });
    }
    if (search) {
      filtered = filtered.filter(function(i) {
        return i.title.toLowerCase().includes(search) ||
               i.id.toLowerCase().includes(search) ||
               (i.description || '').toLowerCase().includes(search) ||
               (i.labels || []).some(function(l) { return l.toLowerCase().includes(search); });
      });
    }
    return filtered;
  }

  function render() {
    var filtered = getFilteredIssues();
    if (currentView === 'board') renderBoard(filtered);
    else renderTable(filtered);
    updateSortIcons();
  }

  function updateSortIcons() {
    document.querySelectorAll('.td-sort-icon').forEach(function(el) {
      var col = el.getAttribute('data-col');
      if (col === sortColumn) {
        el.textContent = sortDirection === 'asc' ? '▲' : '▼';
        el.classList.add('active');
      } else {
        el.textContent = '';
        el.classList.remove('active');
      }
    });
  }

  function renderBoard(items) {
    var el = document.getElementById('td-board');
    var showClosed = document.getElementById('td-show-closed').checked;
    var columns = showClosed ? BOARD_COLUMNS : BOARD_COLUMNS.filter(function(c) { return c !== 'closed'; });

    if (items.length === 0) {
      el.innerHTML = '<div class="td-empty"><p>No issues found</p><p>Create one with the + button above</p></div>';
      return;
    }

    el.innerHTML = columns.map(function(status) {
      var colItems = items.filter(function(i) { return i.status === status; });
      return '<div class="td-column">' +
        '<div class="td-column-header">' + esc(COLUMN_LABELS[status] || status) +
        ' <span class="td-column-count">' + colItems.length + '</span></div>' +
        (colItems.length === 0 ? '<div style="color:var(--fg3);font-size:12px;text-align:center;padding:20px 0;">—</div>' :
        colItems.map(function(i) { return renderCard(i); }).join('')) +
        '</div>';
    }).join('');
  }

  function renderCard(issue) {
    var labels = (issue.labels || []).map(function(l) {
      return '<span class="td-label">' + esc(l) + '</span>';
    }).join('');

    var badges = '';
    if (issue.log_count) badges += '<span class="td-badge td-badge-log" title="' + issue.log_count + ' log entries">📝 ' + issue.log_count + '</span>';
    if (issue.uncertain_items && issue.uncertain_items.length) badges += '<span class="td-badge td-badge-uncertain" title="' + issue.uncertain_items.length + ' uncertain items">❓ ' + issue.uncertain_items.length + '</span>';
    else if (issue.has_handoff) badges += '<span class="td-badge td-badge-handoff" title="Has handoff">🤝</span>';

    var lastLog = '';
    if (issue.last_log) {
      lastLog = '<div class="td-card-last-log">' + esc(issue.last_log.message.substring(0, 80)) + (issue.last_log.message.length > 80 ? '…' : '') + '</div>';
    }

    return '<div class="td-card" onclick="tdUI.showDetail(\'' + esc(issue.id) + '\')">' +
      '<div class="td-card-title">' + esc(issue.title) + '</div>' +
      '<div class="td-card-meta">' +
        '<span class="td-card-id">' + esc(issue.id) + '</span>' +
        '<span class="td-priority ' + esc(issue.priority) + '">' + esc(issue.priority) + '</span>' +
        '<span class="td-type ' + esc(issue.type) + '">' + esc(issue.type) + '</span>' +
        labels +
        badges +
      '</div>' +
      lastLog +
      '</div>';
  }

  var PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  var STATUS_ORDER = { open: 0, in_progress: 1, in_review: 2, blocked: 3, closed: 4 };

  function sortItems(items) {
    return items.slice().sort(function(a, b) {
      var va, vb;
      if (sortColumn === 'priority') {
        va = PRIORITY_ORDER[a.priority] != null ? PRIORITY_ORDER[a.priority] : 9;
        vb = PRIORITY_ORDER[b.priority] != null ? PRIORITY_ORDER[b.priority] : 9;
      } else if (sortColumn === 'status') {
        va = STATUS_ORDER[a.status] != null ? STATUS_ORDER[a.status] : 9;
        vb = STATUS_ORDER[b.status] != null ? STATUS_ORDER[b.status] : 9;
      } else if (sortColumn === 'updated_at') {
        va = a.updated_at || '';
        vb = b.updated_at || '';
      } else {
        va = (a[sortColumn] || '').toString().toLowerCase();
        vb = (b[sortColumn] || '').toString().toLowerCase();
      }
      var cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }

  function renderTable(items) {
    var el = document.getElementById('td-table-body');
    items = sortItems(items);
    var totalItems = items.length;

    if (totalItems === 0) {
      el.innerHTML = '<tr><td colspan="8" style="color:var(--fg3);text-align:center;padding:24px">No issues found</td></tr>';
      renderPagination(0);
      return;
    }

    var totalPages = Math.ceil(totalItems / pageSize);
    if (currentPage > totalPages) currentPage = totalPages;
    var start = (currentPage - 1) * pageSize;
    var pageItems = items.slice(start, start + pageSize);

    el.innerHTML = pageItems.map(function(i) {
      var labels = (i.labels || []).map(function(l) {
        return '<span class="td-label">' + esc(l) + '</span>';
      }).join('');

      var activity = '';
      if (i.log_count) activity += '<span class="td-badge td-badge-log">📝 ' + i.log_count + '</span>';
      if (i.uncertain_items && i.uncertain_items.length) activity += '<span class="td-badge td-badge-uncertain">❓ ' + i.uncertain_items.length + '</span>';
      else if (i.has_handoff) activity += '<span class="td-badge td-badge-handoff">🤝</span>';

      return '<tr>' +
        '<td><span class="td-id" onclick="tdUI.showDetail(\'' + esc(i.id) + '\')">' + esc(i.id) + '</span></td>' +
        '<td><span class="td-priority ' + esc(i.priority) + '">' + esc(i.priority) + '</span></td>' +
        '<td><span class="td-type ' + esc(i.type) + '">' + esc(i.type) + '</span></td>' +
        '<td><span class="td-title">' + esc(i.title) + '</span></td>' +
        '<td><span class="td-status ' + esc(i.status) + '">' + esc(COLUMN_LABELS[i.status] || i.status) + '</span></td>' +
        '<td>' + labels + '</td>' +
        '<td>' + (activity || '<span style="color:var(--fg3)">—</span>') + '</td>' +
        '<td>' + ago(i.updated_at) + '</td>' +
        '</tr>';
    }).join('');

    renderPagination(totalItems);
  }

  function renderPagination(totalItems) {
    var pag = document.getElementById('td-pagination');
    if (!pag) return;
    if (totalItems <= pageSize) {
      pag.innerHTML = totalItems > 0 ? '<span class="td-pag-info">' + totalItems + ' issue' + (totalItems !== 1 ? 's' : '') + '</span>' : '';
      return;
    }
    var totalPages = Math.ceil(totalItems / pageSize);
    var start = (currentPage - 1) * pageSize + 1;
    var end = Math.min(currentPage * pageSize, totalItems);

    var buttons = '';
    buttons += '<button class="td-pag-btn" ' + (currentPage <= 1 ? 'disabled' : '') + ' onclick="tdUI.goToPage(1)" title="First">«</button>';
    buttons += '<button class="td-pag-btn" ' + (currentPage <= 1 ? 'disabled' : '') + ' onclick="tdUI.goToPage(' + (currentPage - 1) + ')" title="Previous">‹</button>';

    // Page number buttons — show up to 5 pages around current
    var startPage = Math.max(1, currentPage - 2);
    var endPage = Math.min(totalPages, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

    for (var p = startPage; p <= endPage; p++) {
      buttons += '<button class="td-pag-btn' + (p === currentPage ? ' active' : '') + '" onclick="tdUI.goToPage(' + p + ')">' + p + '</button>';
    }

    buttons += '<button class="td-pag-btn" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="tdUI.goToPage(' + (currentPage + 1) + ')" title="Next">›</button>';
    buttons += '<button class="td-pag-btn" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="tdUI.goToPage(' + totalPages + ')" title="Last">»</button>';

    pag.innerHTML =
      '<span class="td-pag-info">' + start + '–' + end + ' of ' + totalItems + '</span>' +
      '<div class="td-pag-buttons">' + buttons + '</div>' +
      '<select class="td-pag-size" onchange="tdUI.setPageSize(Number(this.value))">' +
        [10, 25, 50, 100].map(function(n) {
          return '<option value="' + n + '"' + (n === pageSize ? ' selected' : '') + '>' + n + ' / page</option>';
        }).join('') +
      '</select>';
  }

  // ── Detail panel ──────────────────────────────────────

  function renderDetail(issue) {
    var panel = document.getElementById('td-detail-panel');
    var labels = (issue.labels || []).map(function(l) {
      return '<span class="td-label">' + esc(l) + '</span>';
    }).join('') || '<span style="color:var(--fg3)">none</span>';

    // Build context-aware action buttons based on current status
    var statusButtons = '';
    var id = issue.id;
    if (issue.status === 'in_review') {
      // Review actions: approve or reject
      statusButtons =
        '<button class="btn-approve" onclick="tdUI.approveIssue(\'' + esc(id) + '\')">✓ Approve</button>' +
        '<button class="btn-reject" onclick="tdUI.rejectIssue(\'' + esc(id) + '\')">✗ Reject</button>';
    } else if (issue.status === 'in_progress') {
      // Can submit for review, block, or move to other statuses
      statusButtons =
        '<button class="btn-review" onclick="tdUI.reviewIssue(\'' + esc(id) + '\')">Submit for Review</button>' +
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'blocked\')">Blocked</button>' +
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'open\')">Back to Open</button>';
    } else if (issue.status === 'open') {
      statusButtons =
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'in_progress\')">Start</button>' +
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'blocked\')">Blocked</button>';
    } else if (issue.status === 'blocked') {
      statusButtons =
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'open\')">Unblock</button>' +
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'in_progress\')">Resume</button>';
    } else if (issue.status === 'closed') {
      statusButtons =
        '<button onclick="tdUI.updateStatus(\'' + esc(id) + '\', \'open\')">Reopen</button>';
    }

    // Build handoff section
    var handoffHtml = '';
    if (issue.handoff) {
      var h = issue.handoff;
      var parts = [];
      if (h.done && h.done.length) {
        parts.push('<div class="td-handoff-group"><strong class="td-handoff-label td-handoff-done">✓ Done</strong><ul>' +
          h.done.map(function(d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>');
      }
      if (h.remaining && h.remaining.length) {
        parts.push('<div class="td-handoff-group"><strong class="td-handoff-label td-handoff-remaining">⏳ Remaining</strong><ul>' +
          h.remaining.map(function(d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>');
      }
      if (h.decisions && h.decisions.length) {
        parts.push('<div class="td-handoff-group"><strong class="td-handoff-label td-handoff-decisions">📋 Decisions</strong><ul>' +
          h.decisions.map(function(d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>');
      }
      if (h.uncertain && h.uncertain.length) {
        parts.push('<div class="td-handoff-group"><strong class="td-handoff-label td-handoff-uncertain">❓ Uncertain</strong><ul>' +
          h.uncertain.map(function(d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>');
      }
      if (parts.length) {
        var handoffMeta = h.session ? '<span class="td-handoff-meta">Session: ' + esc(h.session) + (h.timestamp ? ' · ' + ago(h.timestamp) : '') + '</span>' : '';
        handoffHtml = '<div class="td-detail-section"><h4>Handoff</h4>' + handoffMeta + parts.join('') + '</div>';
      }
    }

    // Build logs section
    var addActivityBtn = '<button class="btn-add-activity" onclick="tdUI.showActivityModal(\'' + esc(issue.id) + '\')">+ Add Activity</button>';
    var logsHtml = '';
    if (issue.logs && issue.logs.length) {
      var logItems = issue.logs.map(function(l) {
        var typeClass = 'td-log-' + (l.type || 'progress');
        var typeLabel = (l.type || 'progress').charAt(0).toUpperCase() + (l.type || 'progress').slice(1);
        return '<div class="td-log-entry ' + typeClass + '">' +
          '<span class="td-log-type">' + esc(typeLabel) + '</span>' +
          '<span class="td-log-message">' + esc(l.message) + '</span>' +
          '<span class="td-log-time">' + ago(l.timestamp) + '</span>' +
        '</div>';
      });
      logsHtml = '<div class="td-detail-section"><h4>Activity Log</h4><div class="td-logs">' + logItems.join('') + '</div>' + addActivityBtn + '</div>';
    } else {
      logsHtml = '<div class="td-detail-section"><h4>Activity Log</h4><div class="td-logs" style="color:var(--fg3);font-size:12px;">No activity yet</div>' + addActivityBtn + '</div>';
    }

    panel.innerHTML =
      '<h3>' + esc(issue.title) + '</h3>' +
      '<div class="td-detail-meta">' +
        '<span class="td-card-id">' + esc(issue.id) + '</span>' +
        '<span class="td-status ' + esc(issue.status) + '">' + esc(COLUMN_LABELS[issue.status] || issue.status) + '</span>' +
        '<span class="td-priority ' + esc(issue.priority) + '">' + esc(issue.priority) + '</span>' +
        '<span class="td-type ' + esc(issue.type) + '">' + esc(issue.type) + '</span>' +
        (issue.points ? '<span style="color:var(--fg3);font-size:11px">' + issue.points + ' pts</span>' : '') +
      '</div>' +
      (issue.description ? '<div class="td-detail-section"><h4>Description</h4><pre>' + esc(issue.description) + '</pre></div>' : '') +
      (issue.acceptance ? '<div class="td-detail-section"><h4>Acceptance Criteria</h4><pre>' + esc(issue.acceptance) + '</pre></div>' : '') +
      handoffHtml +
      logsHtml +
      '<div class="td-detail-section"><h4>Labels</h4><p>' + labels + '</p></div>' +
      '<div class="td-detail-section"><h4>Details</h4><p>' +
        'Created: ' + ago(issue.created_at) + '<br>' +
        'Updated: ' + ago(issue.updated_at) +
        (issue.parent_id ? '<br>Parent: <span class="td-id" onclick="tdUI.showDetail(\'' + esc(issue.parent_id) + '\')">' + esc(issue.parent_id) + '</span>' : '') +
      '</p></div>' +
      '<div class="td-detail-section"><h4>Move to</h4><div class="td-detail-actions">' + statusButtons + '</div></div>' +
      '<div class="td-detail-actions">' +
        '<button style="color:var(--red,#ef4444);border-color:var(--red,#ef4444);" onclick="tdUI.deleteIssue(\'' + esc(issue.id) + '\')">Delete</button>' +
        '<button class="btn-close-detail" onclick="tdUI.closeDetail()">Close</button>' +
      '</div>';

    document.getElementById('td-detail-overlay').classList.add('open');
  }

  // Close overlays on click outside / Escape
  document.getElementById('td-detail-overlay').addEventListener('click', function(e) {
    if (e.target === this) tdUI.closeDetail();
  });

  // ── Create modal ──────────────────────────────────────

  window.tdModal = {
    open: function() {
      document.getElementById('td-modal-title').textContent = 'New Issue';
      document.getElementById('td-f-title').value = '';
      document.getElementById('td-f-desc').value = '';
      document.getElementById('td-f-type').value = 'task';
      document.getElementById('td-f-priority').value = 'P2';
      document.getElementById('td-f-labels').value = '';
      document.getElementById('td-f-parent').value = '';
      document.getElementById('td-f-error').style.display = 'none';
      document.getElementById('td-modal-overlay').classList.add('open');
    },
    close: function() {
      document.getElementById('td-modal-overlay').classList.remove('open');
    },
    save: async function() {
      var title = document.getElementById('td-f-title').value.trim();
      var errEl = document.getElementById('td-f-error');
      if (!title) {
        errEl.textContent = 'Title is required.';
        errEl.style.display = 'block';
        return;
      }

      var body = {
        title: title,
        description: document.getElementById('td-f-desc').value.trim() || undefined,
        type: document.getElementById('td-f-type').value,
        priority: document.getElementById('td-f-priority').value,
        labels: document.getElementById('td-f-labels').value.trim() || undefined,
        parent: document.getElementById('td-f-parent').value.trim() || undefined
      };

      try {
        var resp = await fetch('/api/td', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        var data = await resp.json();
        if (!resp.ok) {
          errEl.textContent = data.error || 'Request failed';
          errEl.style.display = 'block';
          return;
        }
        tdModal.close();
        await tdUI.reload();
      } catch(e) {
        errEl.textContent = 'Network error: ' + e.message;
        errEl.style.display = 'block';
      }
    }
  };

  document.getElementById('td-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) tdModal.close();
  });

  // Global Escape handler for td modals
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var decisionModal = document.getElementById('td-decision-modal');
      if (decisionModal) tdUI.closeDecisionModal();
      else if (document.getElementById('td-detail-overlay').classList.contains('open')) tdUI.closeDetail();
      else if (document.getElementById('td-modal-overlay').classList.contains('open')) tdModal.close();
    }
  });

  // ── Initial load ──────────────────────────────────────

  async function loadTd() {
    await fetchIssues();
    render();
  }
  loadTd();
  _extRefreshFns.push(loadTd);
})();
