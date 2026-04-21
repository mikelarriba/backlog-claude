// ── Doc list ───────────────────────────────────────────────────
async function loadDocs() {
  try {
    const res = await fetch('/api/docs');
    allDocs = await res.json();
    renderDocList(allDocs);
  } catch (e) {
    console.warn('Could not load docs:', e.message);
  }
}

function buildTreeOrder(docs) {
  const byFilename = new Map(docs.map(d => [d.filename, d]));
  const ordered = [];
  const placed  = new Set();

  function place(doc, indent) {
    if (placed.has(doc.filename)) return;
    placed.add(doc.filename);
    ordered.push({ doc, indent });
    docs.filter(c => c.parentFilename === doc.filename)
        .forEach(child => place(child, indent + 1));
  }

  // Roots first: docs whose parent is absent from the filtered list
  docs.forEach(d => {
    if (!d.parentFilename || !byFilename.has(d.parentFilename)) place(d, 0);
  });
  // Catch orphans
  docs.forEach(d => { if (!placed.has(d.filename)) place(d, 0); });

  return ordered;
}

function renderDocList(docs) {
  const list  = document.getElementById('epic-list');
  const count = document.getElementById('epic-count');
  count.textContent = docs.length;

  if (!docs.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        Nothing matches the current filters.
      </div>`;
    return;
  }

  const ordered = buildTreeOrder(docs);

  list.innerHTML = ordered.map(({ doc: d, indent }) => {
    const statusClass = (d.status || 'Draft').replace(/\s+/g, '-');
    const connector   = indent > 0 ? `<span class="tree-connector">└</span>` : '';
    return `
    <div class="epic-item"
         data-filename="${escHtml(d.filename)}"
         data-doctype="${d.docType}"
         data-indent="${indent}"
         onclick="openDoc('${escHtml(d.filename)}','${d.docType}')">
      <div class="drag-handle"><span></span><span></span><span></span><span></span><span></span><span></span></div>
      ${connector}
      <div class="epic-dot"></div>
      <div style="flex:1">
        <div class="epic-title-text">${escHtml(d.title)}</div>
      </div>
      <span class="status-badge ${statusClass}">${STATUS_LABEL[d.status] || d.status || 'Draft'}</span>
      <span class="type-badge ${d.docType}">${TYPE_LABEL[d.docType] || d.docType}</span>
      <div class="epic-date">${d.date}</div>
    </div>`;
  }).join('');
}

function setTypeFilter(type) {
  activeTypeFilter = type;
  document.querySelectorAll('[data-type]').forEach(el => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  applyFilters();
}

function setStatusFilter(status) {
  activeStatusFilter = status;
  document.querySelectorAll('[data-status]').forEach(el => {
    el.classList.toggle('active', el.dataset.status === status);
  });
  applyFilters();
}

function applyFilters() {
  const q = document.getElementById('search').value.toLowerCase();
  let filtered = allDocs;
  if (activeTypeFilter !== 'all')   filtered = filtered.filter(d => d.docType === activeTypeFilter);
  if (activeStatusFilter !== 'all') filtered = filtered.filter(d => (d.status || 'Draft') === activeStatusFilter);
  if (q) filtered = filtered.filter(d => d.title.toLowerCase().includes(q) || d.filename.toLowerCase().includes(q));
  renderDocList(filtered);
}
