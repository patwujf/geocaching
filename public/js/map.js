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

let userMarker = null;
let initialCenterSet = false;

// ═══════════════════════════════════════════════════════════════════
//  宝藏图标 — 宝箱样式
// ═══════════════════════════════════════════════════════════════════

const TREASURE_ICON = L.divIcon({
  className: 'treasure-icon',
  html: `<svg viewBox="0 0 32 32" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <!-- 宝箱主体 -->
    <rect x="3" y="11" width="26" height="15" rx="2" fill="#8B4513"/>
    <rect x="3" y="11" width="26" height="15" rx="2" fill="none" stroke="#5C2E00" stroke-width="1.5"/>
    <!-- 宝箱盖 -->
    <path d="M3,12 L5,4 L27,4 L29,12 Z" fill="#A0522D"/>
    <path d="M3,12 L5,4 L27,4 L29,12 Z" fill="none" stroke="#5C2E00" stroke-width="1.5"/>
    <!-- 金色镶边 -->
    <rect x="3" y="11" width="26" height="2.5" fill="#DAA520" opacity="0.9"/>
    <line x1="11" y1="4" x2="11" y2="11" stroke="#DAA520" stroke-width="1.2" opacity="0.6"/>
    <line x1="21" y1="4" x2="21" y2="11" stroke="#DAA520" stroke-width="1.2" opacity="0.6"/>
    <!-- 锁扣 -->
    <rect x="14" y="10" width="4" height="4" rx="1" fill="#DAA520" stroke="#B8860B" stroke-width="0.8"/>
    <circle cx="16" cy="12.5" r="1" fill="#5C2E00"/>
    <!-- 金币溢出 -->
    <ellipse cx="9" cy="28" rx="2.5" ry="1.2" fill="#FFD700" opacity="0.7"/>
    <ellipse cx="13" cy="29" rx="2" ry="1" fill="#FFD700" opacity="0.7"/>
    <ellipse cx="17" cy="28" rx="2.5" ry="1.2" fill="#FFD700" opacity="0.7"/>
    <ellipse cx="21" cy="29" rx="2" ry="1" fill="#FFD700" opacity="0.7"/>
  </svg>`,
  iconSize: [28, 30],
  iconAnchor: [14, 30],
  popupAnchor: [0, -34],
});

// ── Map Init ──
let map = null;
let mapReady = false;
let markers = {};
let addMarker = null;
let addMode = false;
let allCaches = [];

function initMap(savedPrefs) {
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
    const initCenter = savedPrefs ? [savedPrefs.lat, savedPrefs.lng] : [30.0, 115.0];
    const initZoom = savedPrefs ? savedPrefs.zoom : 5;
    map = L.map('map', {
      center: initCenter,
      zoom: initZoom,
      zoomControl: true,
    });
    map.zoomControl.setPosition('topright');

    const configs = getTileConfigs();
    configs.forEach(cfg => L.tileLayer(cfg.url, cfg.options).addTo(map));

    mapReady = true;
    document.getElementById('map').classList.remove('map-error');

    // 地图中心十字标记
    addMapOverlays();

    // 地图移动/缩放后更新侧栏列表
    map.on('moveend', updateSidebarList);
    map.on('moveend', debouncedSavePrefs);

    loadCaches();
    // 用户定位：找到后自动移动地图中心并添加位置标记
    map.on('locationfound', onLocationFound);
    map.on('locationerror', onLocationError);
    map.locate({ setView: false, maxZoom: 16, enableHighAccuracy: true });
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

// ── 地图中心十字标记 ──
function addMapOverlays() {
  const mapEl = document.getElementById('map');

  // 十字标记
  const crosshair = document.createElement('div');
  crosshair.className = 'map-crosshair';
  crosshair.innerHTML = '<div class="map-crosshair-dot"></div>';
  mapEl.appendChild(crosshair);
}

// ── 用户定位回调 ──
function onLocationFound(e) {
  // 用户位置标记（蓝色圆点）
  userMarker = L.circleMarker(e.latlng, {
    radius: 7,
    fillColor: '#4285F4',
    color: '#fff',
    weight: 3,
    opacity: 1,
    fillOpacity: 0.9,
  }).addTo(map);

  // 精度圈
  L.circle(e.latlng, Math.max(e.accuracy || 50, 10), {
    color: '#4285F4',
    fillColor: '#4285F4',
    fillOpacity: 0.08,
    weight: 1,
  }).addTo(map);

  // 首次定位才移动地图中心
  if (!initialCenterSet) {
    map.setView(e.latlng, 15);
    initialCenterSet = true;
  }
}

function onLocationError(e) {
  console.log('定位失败:', e.message);
  if (!initialCenterSet) {
    map.setView([30.0, 115.0], 5);
    initialCenterSet = true;
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

    const marker = L.marker([c.lat, c.lng], { icon: TREASURE_ICON })
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
  // 取地图中心（即十字位置）设为初始坐标
  const center = map.getCenter();
  if (!addMarker) {
    addMarker = L.marker([center.lat, center.lng], { draggable: true }).addTo(map);
  } else {
    addMarker.setLatLng([center.lat, center.lng]);
    addMarker.addTo(map);
  }
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
}

function closeAddModal(e) {
  if (e && e.target !== e.currentTarget) return;
  cancelAddMode();
}

async function submitCache(event) {
  event.preventDefault();
  const form = document.getElementById('addForm');
  const fd = new FormData(form);
  const name = fd.get('name');
  const pos = addMarker.getLatLng();
  const lat = pos.lat;
  const lng = pos.lng;
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
      // 重新加载所有藏宝点，不动地图位置
      await loadCaches();
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
// ── 保存地图位置偏好 ──
let savePrefsTimer = null;
function debouncedSavePrefs() {
  if (savePrefsTimer) clearTimeout(savePrefsTimer);
  savePrefsTimer = setTimeout(saveMapPrefs, 800);
}

async function saveMapPrefs() {
  if (!mapReady || !map) return;
  const center = map.getCenter();
  const zoom = map.getZoom();
  try {
    await fetch('/api/user/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        map_lat: center.lat,
        map_lng: center.lng,
        map_zoom: zoom,
      }),
    });
  } catch (e) {
    // 未登录或无网络时忽略
  }
}

async function loadMapPrefs() {
  try {
    const res = await fetch('/api/user/prefs');
    const data = await res.json();
    if (data.ok && data.data && data.data.map_lat && data.data.map_lng) {
      initialCenterSet = true;
      return {
        lat: data.data.map_lat,
        lng: data.data.map_lng,
        zoom: data.data.map_zoom || 5,
      };
    }
  } catch (e) {
    // 未登录或无网络时忽略
  }
  return null;
}

async function startApp() {
  const prefs = await loadMapPrefs();
  initMap(prefs);
  initSearchFromQuery();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
