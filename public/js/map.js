// ── Map Init ──
const map = L.map('map', {
  center: [30.0, 115.0], // default center: China
  zoom: 5,
  zoomControl: true,
});

// OpenStreetMap tiles (free, no API key needed)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
  maxZoom: 19,
}).addTo(map);

// ── State ──
let markers = {};
let addMarker = null;
let addMode = false;

// ── Load Caches ──
async function loadCaches(query) {
  const url = query ? `/api/caches?q=${encodeURIComponent(query)}` : '/api/caches';
  const res = await fetch(url);
  const caches = await res.json();
  renderCaches(caches);
}

function renderCaches(caches) {
  // Clear existing markers
  for (const id in markers) {
    map.removeLayer(markers[id]);
  }
  markers = {};

  caches.forEach(c => {
    const popupContent = `
      <div style="min-width:160px">
        <strong>${escapeHtml(c.name)}</strong><br>
        <span style="font-size:12px;opacity:0.7">${escapeHtml(c.author_name)}</span><br>
        <span style="font-size:12px;opacity:0.7">📝 ${c.log_count || 0}</span><br>
        <a href="/cache/${c.id}" style="font-size:13px">${T.detailLink}</a>
      </div>
    `;

    const marker = L.marker([c.lat, c.lng])
      .addTo(map)
      .bindPopup(popupContent);

    markers[c.id] = marker;
  });
}

// ── Search ──
async function searchCaches() {
  const q = document.getElementById('searchInput').value.trim();
  loadCaches(q || undefined);
}

// ── Add Cache ──
function toggleAddMode() {
  if (addMode) {
    cancelAddMode();
    return;
  }

  addMode = true;

  if (!addMarker) {
    addMarker = L.marker([0, 0], { draggable: true }).addTo(map);
  } else {
    addMarker.addTo(map);
  }

  // Update form when marker is dragged
  addMarker.on('dragend', updateAddFormPos);

  map.on('click', onMapClickForAdd);

  document.getElementById('btnAdd').textContent = '✕';
  document.getElementById('addModal').style.display = 'flex';
}

function cancelAddMode() {
  addMode = false;
  if (addMarker) map.removeLayer(addMarker);
  map.off('click', onMapClickForAdd);
  document.getElementById('btnAdd').textContent = '+';
  document.getElementById('addModal').style.display = 'none';
  document.getElementById('addForm').reset();
  document.getElementById('addError').textContent = '';
}

function onMapClickForAdd(e) {
  addMarker.setLatLng(e.latlng);
  updateAddFormPos();
}

function updateAddFormPos() {
  const pos = addMarker.getLatLng();
  document.getElementById('cacheLat').value = pos.lat.toFixed(6);
  document.getElementById('cacheLng').value = pos.lng.toFixed(6);
  document.getElementById('posLat').textContent = pos.lat.toFixed(5);
  document.getElementById('posLng').textContent = pos.lng.toFixed(5);
}

function closeAddModal(e) {
  if (e && e.target !== e.currentTarget) return;
  cancelAddMode();
}

async function submitCache(event) {
  event.preventDefault();
  const form = document.getElementById('addForm');
  const formData = new FormData(form);
  const res = await fetch('/api/caches', { method: 'POST', body: formData });
  const data = await res.json();
  if (data.ok) {
    cancelAddMode();
    loadCaches();
  } else {
    document.getElementById('addError').textContent = data.error;
  }
}

// ── Cache Detail ──
async function showCacheDetail(id) {
  const res = await fetch(`/api/caches/details?id=${id}`);
  const data = await res.json();
  if (!data) return;

  const d = document.getElementById('detailContent');
  d.innerHTML = `
    <h2>${escapeHtml(data.name)}</h2>
    <p style="opacity:0.7;font-size:13px">${escapeHtml(data.author_name)} · ${data.created_at}</p>
    ${data.description ? `<p style="margin-top:8px">${escapeHtml(data.description)}</p>` : ''}
    <a href="/cache/${data.id}" style="display:inline-block;margin-top:12px;font-size:14px">查看详情 →</a>
  `;

  document.getElementById('detailModal').style.display = 'flex';
}

function closeDetail(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('detailModal').style.display = 'none';
}

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──
loadCaches();

// Add current location detection (optional, fails silently)
map.locate({ setView: false, maxZoom: 16 });
map.on('locationfound', (e) => {
  // Optionally center map on user's location
});
