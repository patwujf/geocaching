// ═══════════════════════════════════════════════════════════════════
//  地图配置 — 天地图 (Tianditu)
//  中国国家官方地图服务，100% 符合《测绘法》等中国法律法规
// ═══════════════════════════════════════════════════════════════════

const TIANDITU_TOKEN = 'dd6220138522abff3bf6ca478b345c89';

function getTileConfigs() {
  return [
    {
      url: `https://t{s}.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=${TIANDITU_TOKEN}`,
      options: {
        subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
        attribution: '&copy; <a href="https://tianditu.gov.cn">天地图</a>',
        maxZoom: 18,
      },
    },
    {
      url: `https://t{s}.tianditu.gov.cn/DataServer?T=cva_w&x={x}&y={y}&l={z}&tk=${TIANDITU_TOKEN}`,
      options: {
        subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
        attribution: '&copy; <a href="https://tianditu.gov.cn">天地图</a>',
        maxZoom: 18,
      },
    },
  ];
}

// ── Map Init ──
let map = null;
let mapReady = false;
let markers = {};
let addMarker = null;
let addMode = false;
let allCaches = [];

function initMap() {
  if (typeof L === 'undefined') {
    showMapError('地图库未加载，请检查网络');
    return;
  }

  if (!TIANDITU_TOKEN) {
    showMapError(
      '需要配置天地图开发密钥才能加载地图<br>' +
      '请编辑 <code>public/js/map.js</code> 顶部 <code>TIANDITU_TOKEN</code> 变量<br>' +
      '👉 <a href="https://console.tianditu.gov.cn/" target="_blank" style="color:var(--accent)">免费获取密钥</a>'
    );
    return;
  }

  try {
    map = L.map('map', {
      center: [30.0, 115.0],
      zoom: 5,
      zoomControl: true,
    });
    map.zoomControl.setPosition('topright');

    const configs = getTileConfigs();
    configs.forEach(cfg => L.tileLayer(cfg.url, cfg.options).addTo(map));

    mapReady = true;
    document.getElementById('map').classList.remove('map-error');

    // 地图移动/缩放后更新侧栏列表
    map.on('moveend', updateSidebarList);

    loadCaches();
    map.locate({ setView: false, maxZoom: 16 });
  } catch (e) {
    console.error('Map init failed:', e);
    showMapError('地图初始化失败，请刷新重试');
  }
}

function showMapError(html) {
  const el = document.getElementById('map');
  if (el) {
    el.innerHTML = `<div class="map-fallback-msg">${html}</div>`;
    el.classList.add('map-error');
  }
}

// ── Load Caches ──
async function loadCaches(query) {
  const url = query ? `/api/caches?q=${encodeURIComponent(query)}` : '/api/caches';
  try {
    const res = await fetch(url);
    allCaches = await res.json();
    renderMarkers(allCaches);
    updateSidebarList();
  } catch (e) {
    console.error('loadCaches failed:', e);
  }
}

function renderMarkers(caches) {
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

// ── 侧栏列表：显示当前地图范围内的藏宝点（最多20个） ──
function updateSidebarList() {
  const list = document.getElementById('sidebarList');
  const count = document.getElementById('sidebarCount');
  if (!list) return;

  if (!mapReady) {
    list.innerHTML = '<div class="sidebar-empty">地图加载中...</div>';
    if (count) count.textContent = '0';
    return;
  }

  const bounds = map.getBounds();
  const inView = allCaches.filter(c => bounds.contains([c.lat, c.lng]));
  const display = inView.slice(0, 20);

  if (count) count.textContent = `${display.length}${inView.length > 20 ? '+' : ''}`;

  if (display.length === 0) {
    list.innerHTML = '<div class="sidebar-empty">移动地图查看范围内的藏宝点</div>';
    return;
  }

  list.innerHTML = display.map(c => `
    <a href="/cache/${c.id}" class="list-item">
      <div class="list-item-name">${escapeHtml(c.name)}</div>
      <div class="list-item-meta">
        <span>👤 ${escapeHtml(c.author_name)}</span>
        <span>📝 ${c.log_count || 0}</span>
        <span>📍 ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</span>
      </div>
    </a>
  `).join('');
}

// ── Search ──
async function searchCaches() {
  const q = document.getElementById('searchInput').value.trim();
  loadCaches(q || undefined);
}



// ── Map-based Add ──
const ADD_BTN_LABEL = document.getElementById('btnAdd')?.textContent || '📍 创建藏宝点';

function toggleAddMode() {
  if (!mapReady) return;
  if (addMode) { cancelAddMode(); return; }
  addMode = true;
  if (!addMarker) {
    addMarker = L.marker([0, 0], { draggable: true }).addTo(map);
  } else {
    addMarker.addTo(map);
  }
  addMarker.on('dragend', updateAddFormPos);
  map.on('click', onMapClickForAdd);
  document.getElementById('btnAdd').textContent = '✕ 取消';
  document.getElementById('addModal').style.display = 'flex';
}

function cancelAddMode() {
  addMode = false;
  if (addMarker) map.removeLayer(addMarker);
  map.off('click', onMapClickForAdd);
  document.getElementById('btnAdd').textContent = ADD_BTN_LABEL;
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
}

function closeAddModal(e) {
  if (e && e.target !== e.currentTarget) return;
  cancelAddMode();
}

async function submitCache(event) {
  event.preventDefault();
  const form = document.getElementById('addForm');
  const fd = new FormData(form);
  const lat = fd.get('lat');
  const lng = fd.get('lng');
  const name = fd.get('name');
  console.log('[提交]', { name, lat, lng });
  try {
    const res = await fetch('/api/caches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: fd.get('description'), lat, lng }),
    });
    if (res.redirected) {
      window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
      return;
    }
    const data = await res.json();
    console.log('[提交结果]', data);
    if (data.ok) {
      const newId = data.cache.id;
      cancelAddMode();
      // 重新加载所有藏宝点
      await loadCaches();
      // 飞到新创建的位置
      const lats = parseFloat(lat);
      const lngs = parseFloat(lng);
      if (!isNaN(lats) && !isNaN(lngs)) {
        map.setView([lats, lngs], 14, { animate: true });
      }
    } else {
      document.getElementById('addError').textContent = data.error;
    }
  } catch (e) {
    document.getElementById('addError').textContent = '提交失败: ' + e.message;
  }
}

function initSearchFromQuery() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput && searchInput.value) {
    loadCaches(searchInput.value);
  }
}

// ── Helpers ──
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──
function startApp() {
  initMap();
  initSearchFromQuery();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
