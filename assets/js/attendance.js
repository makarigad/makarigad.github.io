import { supabase, initializeApplication, showNotification, getNepDateObj } from './core-app.js';

/**
 * ATTENDANCE MODULE - MAKARI GAD 10MW
 * Comprehensive Shift Tracking, Editable Polygon Geofencing, Monthly View, and Admin Staff Records.
 */

let currentUser = null;
let userRole = 'normal';
let userProfile = null;
let workZones = [];
let todayLogs = [];
let allStaffList = [];
let currentAdminData = [];
let adminViewMode = 'summary'; // 'summary' | 'logs'
let isStaffOrAdmin = false;

const GEOFENCE_STORAGE_KEY = 'makarigad_polygon_zones';
const LOGS_STORAGE_KEY = 'makarigad_attendance_logs';

// ── NEPALI MONTH APPROXIMATE GREGORIAN RANGES (FALLBACK) ──
const NEPALI_MONTH_FALLBACKS = {
    'Baisakh':  { startM: 4, startD: 14, endM: 5, endD: 14 },
    'Jestha':   { startM: 5, startD: 15, endM: 6, endD: 14 },
    'Ashadh':   { startM: 6, startD: 15, endM: 7, endD: 16 },
    'Shrawan':  { startM: 7, startD: 17, endM: 8, endD: 16 },
    'Bhadra':   { startM: 8, startD: 17, endM: 9, endD: 16 },
    'Ashoj':    { startM: 9, startD: 17, endM: 10, endD: 17 },
    'Kartik':   { startM: 10, startD: 18, endM: 11, endD: 16 },
    'Mangsir':  { startM: 11, startD: 17, endM: 12, endD: 15 },
    'Poush':    { startM: 12, startD: 16, endM: 1, endD: 14, crossYear: true },
    'Magh':     { startM: 1, startD: 15, endM: 2, endD: 12 },
    'Falgun':   { startM: 2, startD: 13, endM: 3, endD: 14 },
    'Chaitra':  { startM: 3, startD: 15, endM: 4, endD: 13 }
};

/**
 * Accurately calculate current Nepali Year and Month Name for today's date
 */
export function getCurrentNepaliDate() {
    try {
        const nep = getNepDateObj();
        if (nep && nep.year && nep.month) {
            return { year: String(nep.year), month: String(nep.month) };
        }
    } catch (e) {
        console.warn("getNepDateObj error, falling back to calculation:", e);
    }

    const now = new Date();
    const gYear = now.getFullYear();
    const gMonth = now.getMonth() + 1; // 1-12
    const gDay = now.getDate();

    let nepYear = gYear + 57;
    let nepMonth = 'Baisakh';

    if (gMonth === 1) {
        nepYear = gYear + 56;
        nepMonth = gDay < 15 ? 'Poush' : 'Magh';
    } else if (gMonth === 2) {
        nepYear = gYear + 56;
        nepMonth = gDay < 13 ? 'Magh' : 'Falgun';
    } else if (gMonth === 3) {
        nepYear = gYear + 56;
        nepMonth = gDay < 15 ? 'Falgun' : 'Chaitra';
    } else if (gMonth === 4) {
        if (gDay < 14) {
            nepYear = gYear + 56;
            nepMonth = 'Chaitra';
        } else {
            nepYear = gYear + 57;
            nepMonth = 'Baisakh';
        }
    } else if (gMonth === 5) {
        nepMonth = gDay < 15 ? 'Baisakh' : 'Jestha';
    } else if (gMonth === 6) {
        nepMonth = gDay < 15 ? 'Jestha' : 'Ashadh';
    } else if (gMonth === 7) {
        nepMonth = gDay < 17 ? 'Ashadh' : 'Shrawan';
    } else if (gMonth === 8) {
        nepMonth = gDay < 17 ? 'Shrawan' : 'Bhadra';
    } else if (gMonth === 9) {
        nepMonth = gDay < 17 ? 'Bhadra' : 'Ashoj';
    } else if (gMonth === 10) {
        nepMonth = gDay < 18 ? 'Ashoj' : 'Kartik';
    } else if (gMonth === 11) {
        nepMonth = gDay < 17 ? 'Kartik' : 'Mangsir';
    } else if (gMonth === 12) {
        nepMonth = gDay < 16 ? 'Mangsir' : 'Poush';
    }

    return { year: String(nepYear), month: nepMonth };
}

/**
 * Apply the current Nepali Month & Year to all dropdowns across views
 */
export function applyDefaultNepaliDates() {
    const { year, month } = getCurrentNepaliDate();

    const configureSelect = (yearSelectId, monthSelectId) => {
        const yearSelect = document.getElementById(yearSelectId);
        const monthSelect = document.getElementById(monthSelectId);

        if (yearSelect) {
            let yearExists = false;
            for (let i = 0; i < yearSelect.options.length; i++) {
                if (yearSelect.options[i].value === String(year)) {
                    yearExists = true;
                    break;
                }
            }
            if (!yearExists) {
                const opt = document.createElement('option');
                opt.value = String(year);
                opt.textContent = String(year);
                yearSelect.appendChild(opt);
            }
            yearSelect.value = String(year);
        }

        if (monthSelect) {
            monthSelect.value = month;
        }
    };

    configureSelect('att-nep-year', 'att-nep-month');
    configureSelect('admin-nep-year', 'admin-nep-month');
}

export async function initAttendance() {
    const sd = await initializeApplication(true);
    if (!sd) return;
    
    currentUser = sd.user;
    userRole = (sd.role || '').toLowerCase();
    isStaffOrAdmin = ['admin', 'staff', 'management', 'supervisor'].includes(userRole);

    // Apply default Nepali month & year immediately upon loading
    applyDefaultNepaliDates();

    await loadWorkZones();
    await fetchUserProfile();
    await loadTodayLogs();

    bindDatabaseUI();
    updateLiveStatus();
    setInterval(updateLiveStatus, 30000);

    // Setup Admin and Staff Features
    await populateAllStaffDropdowns();
    initAdminFeatures();
    
    if (isStaffOrAdmin) {
        document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
    }
}

// ── TAB SWITCHING & INSTANT UI BINDINGS ──
document.addEventListener('DOMContentLoaded', () => {
    // Initial default date application on DOM load
    applyDefaultNepaliDates();

    document.querySelectorAll('.section-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.section-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => {
                c.classList.remove('active');
                c.classList.add('hidden');
            });
            
            btn.classList.add('active');
            const targetId = btn.dataset.tab;
            const target = document.getElementById(targetId);
            
            if (target) {
                target.classList.remove('hidden');
                target.classList.add('active');
            }
            
            if (targetId === 'tab-zones') {
                setTimeout(initMap, 150);
            } else if (targetId === 'tab-monthly') {
                loadMonthlyAttendance();
            } else if (targetId === 'tab-manage') {
                loadAdminAttendance();
            }
        });
    });
});

function bindDatabaseUI() {
    const inBtn = document.getElementById('btn-check-in');
    const outBtn = document.getElementById('btn-check-out');
    if (inBtn) inBtn.addEventListener('click', () => handleAttendance('IN'));
    if (outBtn) outBtn.addEventListener('click', () => handleAttendance('OUT'));

    const loadAttBtn = document.getElementById('load-att-btn');
    if (loadAttBtn) loadAttBtn.addEventListener('click', loadMonthlyAttendance);
}

// ============================================================
// POLYGON GEOFENCING MAP & INTERACTIVE POINTS EDITOR
// ============================================================
let map = null;
let currentPolygonPoints = [];
let activePolygonLayer = null;
let activeVertexMarkers = [];
let editingZoneId = null;
let otherZoneLayers = [];

function initMap() {
    const container = document.getElementById('geofence-map');
    if (!container) return;

    if (map) {
        map.invalidateSize();
        renderAllWorkZonesOnMap();
        return;
    }
    
    // Centered around Makari Gad Hydroelectric Project (Darchula, Nepal)
    map = L.map('geofence-map').setView([29.74, 80.65], 14); 
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Map Click: Add Point to Active Polygon
    map.on('click', function(e) {
        const newPt = { lat: parseFloat(e.latlng.lat.toFixed(6)), lng: parseFloat(e.latlng.lng.toFixed(6)) };
        currentPolygonPoints.push(newPt);
        redrawActivePolygon();
        renderVertexList();
    });

    // Map control buttons
    const locateBtn = document.getElementById('map-locate-btn');
    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(pos => {
                    const lat = pos.coords.latitude;
                    const lng = pos.coords.longitude;
                    map.setView([lat, lng], 16);
                    L.circleMarker([lat, lng], { radius: 7, color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 0.9 })
                        .addTo(map)
                        .bindTooltip('Current GPS Location', { permanent: true, direction: 'top' });
                });
            }
        });
    }

    const resetBtn = document.getElementById('map-reset-btn');
    if (resetBtn) {
        resetBtn.addEventListener('click', fitMapToAllZones);
    }

    renderAllWorkZonesOnMap();
    renderSavedZonesList();
}

function renderAllWorkZonesOnMap() {
    if (!map) return;

    // Clear previous other layers
    otherZoneLayers.forEach(l => map.removeLayer(l));
    otherZoneLayers = [];

    workZones.forEach(zone => {
        // Don't render static polygon for the zone currently being edited
        if (editingZoneId && String(zone.id) === String(editingZoneId)) return;

        if (zone.coordinates && Array.isArray(zone.coordinates) && zone.coordinates.length >= 3) {
            const poly = L.polygon(zone.coordinates, {
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 0.25,
                weight: 2
            }).addTo(map);

            poly.bindTooltip(
                `<div class="font-bold text-xs text-emerald-900 uppercase tracking-wider">${zone.zone_name}</div>
                 <div class="text-[10px] text-slate-500">${zone.coordinates.length} vertices</div>`, 
                { permanent: false, direction: 'center', className: 'bg-white/95 border border-emerald-300 rounded shadow-md px-2 py-1' }
            );

            poly.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                editWorkZone(zone.id);
            });

            otherZoneLayers.push(poly);
        }
    });

    if (currentPolygonPoints.length > 0) {
        redrawActivePolygon();
    }
}

function redrawActivePolygon() {
    if (!map) return;

    // Remove old active polygon layer & markers
    if (activePolygonLayer) {
        map.removeLayer(activePolygonLayer);
        activePolygonLayer = null;
    }
    activeVertexMarkers.forEach(m => map.removeLayer(m));
    activeVertexMarkers = [];

    // Draw active polygon
    if (currentPolygonPoints.length > 1) {
        activePolygonLayer = L.polygon(currentPolygonPoints, {
            color: '#4f46e5',
            fillColor: '#6366f1',
            fillOpacity: 0.35,
            weight: 3,
            dashArray: '4, 4'
        }).addTo(map);
    }

    // Place Vertex Markers
    currentPolygonPoints.forEach((pt, index) => {
        const marker = L.circleMarker([pt.lat, pt.lng], {
            radius: 7,
            color: '#ffffff',
            fillColor: '#4f46e5',
            fillOpacity: 1,
            weight: 2.5
        }).addTo(map);

        marker.bindTooltip(`<b>P${index + 1}</b> (${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)})`, {
            permanent: false, direction: 'top', className: 'text-[10px] font-bold bg-slate-900 text-white rounded px-1.5 py-0.5'
        });

        // Click on vertex marker -> remove vertex
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            removePoint(index);
        });

        activeVertexMarkers.push(marker);
    });

    updateVertexCountBadge();
}

function updateVertexCountBadge() {
    const badge = document.getElementById('vertex-count');
    if (badge) badge.textContent = currentPolygonPoints.length;
}

function renderVertexList() {
    const list = document.getElementById('vertex-points-list');
    if (!list) return;

    if (currentPolygonPoints.length === 0) {
        list.innerHTML = '<div class="text-center text-xs text-slate-400 py-4 italic">No points drawn yet. Click anywhere on the map to place polygon vertices.</div>';
        updateVertexCountBadge();
        return;
    }

    list.innerHTML = currentPolygonPoints.map((pt, idx) => `
        <div class="flex items-center gap-2 p-1.5 hover:bg-slate-100/80 rounded transition text-xs">
            <span class="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 font-black text-[10px] flex items-center justify-center shrink-0">
                ${idx + 1}
            </span>
            <div class="grid grid-cols-2 gap-1 flex-grow">
                <input type="number" step="0.000001" value="${pt.lat}" 
                       data-idx="${idx}" data-field="lat"
                       class="vertex-coord-input w-full p-1 bg-white border border-slate-200 rounded text-[11px] font-mono font-bold text-slate-700 outline-none focus:border-indigo-500" 
                       placeholder="Latitude">
                <input type="number" step="0.000001" value="${pt.lng}" 
                       data-idx="${idx}" data-field="lng"
                       class="vertex-coord-input w-full p-1 bg-white border border-slate-200 rounded text-[11px] font-mono font-bold text-slate-700 outline-none focus:border-indigo-500" 
                       placeholder="Longitude">
            </div>
            <button onclick="window.removeGeofencePoint(${idx})" class="text-rose-500 hover:text-rose-700 p-1 font-bold text-xs shrink-0" title="Remove Point">
                ✕
            </button>
        </div>
    `).join('');

    // Attach change listeners to coordinate inputs
    list.querySelectorAll('.vertex-coord-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.idx, 10);
            const field = e.target.dataset.field;
            const val = parseFloat(e.target.value);
            if (!isNaN(val) && currentPolygonPoints[idx]) {
                currentPolygonPoints[idx][field] = val;
                redrawActivePolygon();
            }
        });
    });

    updateVertexCountBadge();
}

window.removeGeofencePoint = function(index) {
    removePoint(index);
};

function removePoint(index) {
    if (index >= 0 && index < currentPolygonPoints.length) {
        currentPolygonPoints.splice(index, 1);
        redrawActivePolygon();
        renderVertexList();
        showNotification(`Point ${index + 1} removed.`);
    }
}

function clearDrawing() {
    currentPolygonPoints = [];
    redrawActivePolygon();
    renderVertexList();
}

function resetEditorState() {
    editingZoneId = null;
    currentPolygonPoints = [];
    
    const idEl = document.getElementById('editing-zone-id');
    if (idEl) idEl.value = '';

    const nameEl = document.getElementById('zone-name');
    if (nameEl) nameEl.value = '';

    const titleEl = document.getElementById('zone-editor-title');
    if (titleEl) titleEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-indigo-600"></span><span>Polygon Points Editor</span>';

    const subtitleEl = document.getElementById('zone-editor-subtitle');
    if (subtitleEl) subtitleEl.textContent = 'Click on the map or edit coordinates below.';

    const saveBtn = document.getElementById('save-zone-btn');
    if (saveBtn) saveBtn.innerHTML = '<span>💾 Save Zone</span>';

    const delBtn = document.getElementById('delete-zone-btn');
    if (delBtn) delBtn.classList.add('hidden');

    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.classList.add('hidden');

    clearDrawing();
    renderAllWorkZonesOnMap();
    renderSavedZonesList();
}

function editWorkZone(zoneId) {
    const zone = workZones.find(z => String(z.id) === String(zoneId));
    if (!zone) return;

    editingZoneId = zone.id;
    currentPolygonPoints = (zone.coordinates || []).map(p => ({ lat: parseFloat(p.lat), lng: parseFloat(p.lng) }));

    const idEl = document.getElementById('editing-zone-id');
    if (idEl) idEl.value = zone.id;

    const nameEl = document.getElementById('zone-name');
    if (nameEl) nameEl.value = zone.zone_name;

    const titleEl = document.getElementById('zone-editor-title');
    if (titleEl) titleEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>Editing: ${zone.zone_name}</span>`;

    const subtitleEl = document.getElementById('zone-editor-subtitle');
    if (subtitleEl) subtitleEl.textContent = 'Modify vertex coordinates below or click points on map.';

    const saveBtn = document.getElementById('save-zone-btn');
    if (saveBtn) saveBtn.innerHTML = '<span>💾 Update Zone Coordinates</span>';

    const delBtn = document.getElementById('delete-zone-btn');
    if (delBtn) delBtn.classList.remove('hidden');

    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    renderAllWorkZonesOnMap();
    renderVertexList();

    // Zoom map to the edited zone
    if (map && currentPolygonPoints.length > 0) {
        const bounds = L.latLngBounds(currentPolygonPoints.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [40, 40] });
    }
}

async function saveWorkZone() {
    const nameInput = document.getElementById('zone-name');
    const name = nameInput ? nameInput.value.trim() : '';

    if (!name) {
        showNotification('Please enter a Zone Name first.', true);
        return;
    }
    if (currentPolygonPoints.length < 3) {
        showNotification('A valid polygon requires at least 3 coordinate vertices.', true);
        return;
    }

    const btn = document.getElementById('save-zone-btn');
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Saving...</span>';

    try {
        const referenceLat = currentPolygonPoints[0].lat;
        const referenceLng = currentPolygonPoints[0].lng;

        const payload = {
            zone_name: name,
            coordinates: currentPolygonPoints,
            latitude: referenceLat,
            longitude: referenceLng,
            radius_meters: 0
        };

        if (editingZoneId) {
            // Update existing zone
            const { error } = await supabase
                .from('work_zones')
                .update(payload)
                .eq('id', editingZoneId);

            if (error) throw error;
            showNotification(`✅ Zone '${name}' coordinates updated!`);
        } else {
            // Insert new zone
            const { error } = await supabase
                .from('work_zones')
                .insert([payload]);

            if (error) throw error;
            showNotification(`✅ New Zone '${name}' created successfully!`);
        }

        await loadWorkZones();
        resetEditorState();
        fitMapToAllZones();
    } catch (e) {
        showNotification('Error saving zone: ' + (e.message || e), true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

/**
 * Universal Work Zone Deletion Handler
 */
export async function deleteWorkZoneById(zoneId) {
    if (!zoneId) return;
    const zone = workZones.find(z => String(z.id) === String(zoneId));
    const zoneName = zone ? zone.zone_name : 'this zone';

    let confirmed = true;
    try {
        confirmed = window.confirm(`Are you sure you want to delete '${zoneName}'? Staff checking in at this location will no longer match this polygon.`);
    } catch (e) {
        confirmed = true;
    }

    if (!confirmed) return;

    try {
        // Disassociate any attendance logs referencing this zone to avoid FK constraint errors
        try {
            await supabase.from('attendance_logs').update({ zone_id: null }).eq('zone_id', zoneId);
        } catch (ignored) {}

        const { error } = await supabase.from('work_zones').delete().eq('id', zoneId);
        if (error) throw error;

        showNotification(`🗑️ Zone '${zoneName}' deleted successfully.`);
        if (editingZoneId && String(editingZoneId) === String(zoneId)) {
            resetEditorState();
        }
        await loadWorkZones();
        if (map) {
            renderAllWorkZonesOnMap();
        }
    } catch (e) {
        console.error("Delete work zone error:", e);
        showNotification('Error deleting zone: ' + (e.message || 'Unknown error'), true);
    }
}

window.deleteWorkZoneDirect = function(zoneId) {
    deleteWorkZoneById(zoneId);
};

function renderSavedZonesList() {
    const container = document.getElementById('saved-zones-list');
    const badge = document.getElementById('zones-total-badge');
    if (badge) badge.textContent = workZones.length;

    if (!container) return;

    if (workZones.length === 0) {
        container.innerHTML = '<div class="text-center text-xs text-slate-400 py-6 italic">No work zones saved in database yet. Create your first polygon above!</div>';
        return;
    }

    container.innerHTML = workZones.map(zone => {
        const pointCount = Array.isArray(zone.coordinates) ? zone.coordinates.length : 0;
        const isEditing = String(zone.id) === String(editingZoneId);
        const lat = zone.latitude ? parseFloat(zone.latitude).toFixed(4) : '—';
        const lng = zone.longitude ? parseFloat(zone.longitude).toFixed(4) : '—';

        return `
            <div class="flex items-center justify-between p-3 rounded-lg border transition ${isEditing ? 'bg-indigo-50/80 border-indigo-300 ring-2 ring-indigo-200' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'}">
                <div class="cursor-pointer flex-grow pr-2" onclick="window.selectZoneForEdit('${zone.id}')">
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full ${isEditing ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
                        <span class="text-xs font-bold text-slate-800">${zone.zone_name}</span>
                    </div>
                    <div class="text-[10px] text-slate-500 mt-0.5 font-medium">
                        📍 Center: ${lat}, ${lng} • <span class="font-bold text-indigo-600">${pointCount} vertices</span>
                    </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                    <button onclick="window.selectZoneForEdit('${zone.id}')" class="text-xs bg-white hover:bg-indigo-50 text-indigo-700 font-bold px-2.5 py-1 rounded border border-slate-200 shadow-xs transition" title="Edit Polygon Points">
                        ✏️ Edit
                    </button>
                    <button onclick="window.focusZoneOnMap('${zone.id}')" class="text-xs bg-white hover:bg-slate-200 text-slate-700 font-bold px-2 py-1 rounded border border-slate-200 transition" title="Focus Map">
                        📍
                    </button>
                    <button onclick="window.deleteWorkZoneDirect('${zone.id}')" class="text-xs bg-white hover:bg-rose-50 text-rose-600 font-bold px-2 py-1 rounded border border-slate-200 hover:border-rose-300 transition" title="Delete Zone">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

window.selectZoneForEdit = function(zoneId) {
    editWorkZone(zoneId);
};

window.focusZoneOnMap = function(zoneId) {
    const zone = workZones.find(z => String(z.id) === String(zoneId));
    if (!zone || !map || !zone.coordinates || zone.coordinates.length === 0) return;
    const bounds = L.latLngBounds(zone.coordinates.map(p => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [50, 50] });
};

function fitMapToAllZones() {
    if (!map || workZones.length === 0) return;
    const allPts = [];
    workZones.forEach(z => {
        if (Array.isArray(z.coordinates)) {
            z.coordinates.forEach(p => allPts.push([p.lat, p.lng]));
        }
    });
    if (allPts.length > 0) {
        map.fitBounds(L.latLngBounds(allPts), { padding: [40, 40] });
    }
}

// ── POINT-IN-POLYGON (RAY-CASTING ALGORITHM) ──
function isPointInPolygon(lat, lng, polygon) {
    if (!polygon || polygon.length < 3) return false;
    
    let x = lng, y = lat;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i].lng, yi = polygon[i].lat;
        let xj = polygon[j].lng, yj = polygon[j].lat;

        let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function getDistanceToCentroid(lat, lng, polygon) {
    if (!polygon || polygon.length === 0) return null;
    let centerLat = 0, centerLng = 0;
    polygon.forEach(p => { centerLat += p.lat; centerLng += p.lng; });
    centerLat /= polygon.length; centerLng /= polygon.length;
    
    const R = 6371e3; 
    const f1 = lat * Math.PI/180;
    const f2 = centerLat * Math.PI/180;
    const df = (centerLat-lat) * Math.PI/180;
    const dl = (centerLng-lng) * Math.PI/180;
    const a = Math.sin(df/2) * Math.sin(df/2) + Math.cos(f1) * Math.cos(f2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}

function updateLiveStatus() {
    const statusText = document.getElementById('geofence-status-text');
    const statusIcon = document.getElementById('geofence-status-icon');
    
    if (!statusText || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let inZone = false;
        let activeZone = null;

        workZones.forEach(zone => {
            if (isPointInPolygon(lat, lng, zone.coordinates)) {
                inZone = true;
                activeZone = zone;
            }
        });

        if (inZone) {
            statusText.textContent = `Inside ${activeZone.zone_name}`;
            statusText.className = 'text-[10px] font-bold text-emerald-600 uppercase tracking-wider';
            statusIcon.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
        } else {
            statusText.textContent = 'Outside Work Zone';
            statusText.className = 'text-[10px] font-bold text-rose-500 uppercase tracking-wider';
            statusIcon.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
        }
    }, () => {
        statusText.textContent = 'GPS Disabled';
        statusIcon.className = 'w-2.5 h-2.5 rounded-full bg-slate-400';
    });
}

async function handleAttendance(type) {
    const btn = document.getElementById(`btn-check-${type.toLowerCase()}`);
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></span> <span class="text-sm">Locating...</span>`;

    try {
        const pos = await getCurrentPosition();
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        
        let nearestZone = null;
        let minDistance = Infinity;
        let isValid = false;

        workZones.forEach(zone => {
            if (isPointInPolygon(lat, lng, zone.coordinates)) {
                isValid = true;
                nearestZone = zone;
                minDistance = 0; 
            } else if (!isValid) {
                let dist = getDistanceToCentroid(lat, lng, zone.coordinates);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestZone = zone;
                }
            }
        });

        const log = {
            email: currentUser.email,
            date: new Date().toISOString().split('T')[0],
            timestamp: new Date().toISOString(),
            type: type,
            lat: lat,
            lng: lng,
            zone_id: nearestZone ? nearestZone.id : null,
            zone_name: nearestZone ? nearestZone.zone_name : 'Unknown',
            is_valid: isValid,
            distance: minDistance === Infinity ? null : Math.round(minDistance)
        };

        if (navigator.onLine) {
            const { error } = await supabase.from('attendance_logs').insert([log]);
            if (error) throw error;
            showNotification(`✅ ${type === 'IN' ? 'Checked In' : 'Checked Out'} at ${log.zone_name}`);
        } else {
            const queue = JSON.parse(localStorage.getItem('makarigad_sync_queue')) || [];
            queue.push({ table: 'attendance_logs', data: log });
            localStorage.setItem('makarigad_sync_queue', JSON.stringify(queue));
            showNotification(`Saved offline. Will sync when online.`);
        }

        await loadTodayLogs();
    } catch (e) {
        showNotification("Attendance failed: " + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

function getCurrentPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("Geolocation not supported."));
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });
    });
}

// ── DATA LOADING & UI RENDER ──
async function fetchUserProfile() {
    try {
        const { data } = await supabase.from('user_roles').select('*').eq('email', currentUser.email).maybeSingle();
        userProfile = data;
        const nameEl = document.getElementById('staff-name-display');
        if (nameEl && data) nameEl.textContent = data.full_name || currentUser.email;
    } catch (e) { console.warn("Profile fetch failed"); }
}

async function loadWorkZones() {
    try {
        if (navigator.onLine) {
            const { data } = await supabase.from('work_zones').select('*').order('zone_name');
            if (data) {
                workZones = data;
                localStorage.setItem(GEOFENCE_STORAGE_KEY, JSON.stringify(data));
            }
        } else {
            workZones = JSON.parse(localStorage.getItem(GEOFENCE_STORAGE_KEY)) || [];
        }
    } catch (e) {
        workZones = JSON.parse(localStorage.getItem(GEOFENCE_STORAGE_KEY)) || [];
    }
    renderSavedZonesList();
}

async function loadTodayLogs() {
    const today = new Date().toISOString().split('T')[0];
    try {
        if (navigator.onLine) {
            const { data } = await supabase.from('attendance_logs')
                .select('*')
                .eq('email', currentUser.email)
                .eq('date', today)
                .order('timestamp', { ascending: true });
            if (data) {
                todayLogs = data;
                localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(data));
                renderLogs();
                return;
            }
        }
    } catch (e) { console.warn("Logs fetch failed"); }
    
    todayLogs = JSON.parse(localStorage.getItem(LOGS_STORAGE_KEY)) || [];
    renderLogs();
}

function renderLogs() {
    const list = document.getElementById('log-history-list');
    if (!list) return;

    if (todayLogs.length === 0) {
        list.innerHTML = '<p class="text-slate-400 text-center py-4 text-xs italic">No activity recorded today.</p>';
        return;
    }

    list.innerHTML = todayLogs.map(log => `
        <div class="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
            <div>
                <span class="text-[10px] font-bold uppercase tracking-wider ${log.type === 'IN' ? 'text-emerald-600' : 'text-amber-600'}">${log.type === 'IN' ? 'Check In' : 'Check Out'}</span>
                <div class="text-xs font-bold text-slate-700">${new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <div class="text-right">
                <div class="text-[10px] text-slate-500 font-semibold">${log.zone_name || 'Unknown Location'}</div>
                <div class="text-[9px] flex items-center justify-end gap-1 ${log.is_valid ? 'text-emerald-500' : 'text-rose-500'} font-bold">
                    <span>${log.is_valid ? '●' : '⚠'}</span>
                    ${log.is_valid ? 'Verified Location' : 'Outside Geofence'}
                </div>
            </div>
        </div>
    `).join('');

    calculateShiftDuration();
}

function calculateShiftDuration() {
    const durationEl = document.getElementById('shift-duration');
    const statusEl = document.getElementById('shift-status-badge');
    if (!durationEl || todayLogs.length === 0) return;

    let totalMs = 0;
    let lastIn = null;

    todayLogs.forEach(log => {
        if (log.type === 'IN') {
            lastIn = new Date(log.timestamp).getTime();
        } else if (log.type === 'OUT' && lastIn) {
            totalMs += (new Date(log.timestamp).getTime() - lastIn);
            lastIn = null;
        }
    });

    if (lastIn) totalMs += (new Date().getTime() - lastIn);

    const totalHours = totalMs / (1000 * 60 * 60);
    durationEl.textContent = `${totalHours.toFixed(2)} hrs`;

    const progressPercent = Math.min(100, (totalHours / 8) * 100);
    const progressBar = document.getElementById('shift-progress-bar');
    if (progressBar) progressBar.style.width = `${progressPercent}%`;

    if (totalHours >= 8) {
        statusEl.textContent = 'Shift Completed';
        statusEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 z-10';
        if (progressBar) progressBar.className = 'bg-emerald-500 h-full transition-all duration-500';
    } else {
        statusEl.textContent = `${(8 - totalHours).toFixed(1)} hrs left`;
        statusEl.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 text-amber-700 z-10';
        if (progressBar) progressBar.className = 'bg-indigo-600 h-full transition-all duration-500';
    }
}

// ============================================================
// STAFF DROPDOWNS & PERMISSIONS
// ============================================================
async function populateAllStaffDropdowns() {
    const monthlySelect = document.getElementById('monthly-staff-select');
    const adminSelect = document.getElementById('admin-emp-select');
    const kpiTotalStaff = document.getElementById('admin-kpi-total-staff');

    try {
        const staffMap = new Map();

        // 1. Fetch from user_roles
        const { data: rolesData } = await supabase
            .from('user_roles')
            .select('email, full_name, role')
            .order('full_name', { ascending: true });

        if (rolesData) {
            rolesData.forEach(u => {
                if (u.email) {
                    staffMap.set(u.email.toLowerCase(), {
                        email: u.email,
                        fullName: u.full_name || u.email.split('@')[0],
                        role: u.role || 'operator'
                    });
                }
            });
        }

        // 2. Fetch distinct emails from attendance_logs
        const { data: logsUsers } = await supabase
            .from('attendance_logs')
            .select('email')
            .limit(1000);

        if (logsUsers) {
            logsUsers.forEach(l => {
                if (l.email && !staffMap.has(l.email.toLowerCase())) {
                    staffMap.set(l.email.toLowerCase(), {
                        email: l.email,
                        fullName: l.email.split('@')[0],
                        role: 'operator'
                    });
                }
            });
        }

        allStaffList = Array.from(staffMap.values());
        if (kpiTotalStaff) kpiTotalStaff.textContent = allStaffList.length;

        // Populate Monthly View Dropdown
        if (monthlySelect) {
            monthlySelect.innerHTML = '';
            
            if (isStaffOrAdmin) {
                const optMy = document.createElement('option');
                optMy.value = 'current';
                optMy.textContent = '👤 My Records (' + (currentUser.email.split('@')[0]) + ')';
                monthlySelect.appendChild(optMy);

                const optAll = document.createElement('option');
                optAll.value = 'all';
                optAll.textContent = '👥 -- All Staff Members --';
                monthlySelect.appendChild(optAll);

                allStaffList.forEach(s => {
                    const opt = document.createElement('option');
                    opt.value = s.email;
                    opt.textContent = `${s.fullName} (${s.email})`;
                    monthlySelect.appendChild(opt);
                });
            } else {
                const optMy = document.createElement('option');
                optMy.value = 'current';
                optMy.textContent = '👤 My Records';
                monthlySelect.appendChild(optMy);
            }
        }

        // Populate Admin Control Dropdown
        if (adminSelect) {
            adminSelect.innerHTML = '<option value="">-- All Staff Members --</option>';
            allStaffList.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.email;
                opt.textContent = `${s.fullName} (${s.email})`;
                adminSelect.appendChild(opt);
            });
        }

    } catch (err) {
        console.warn("Could not load staff list for dropdowns:", err);
    }
}

// ── GET DATE RANGE FOR NEPALI MONTH ──
async function getDateRangeForNepaliMonth(year, monthName) {
    try {
        const { data: calData } = await supabase
            .from('calendar_mappings')
            .select('eng_date')
            .eq('nep_year', year)
            .eq('nep_month', monthName)
            .order('eng_date', { ascending: true });

        if (calData && calData.length > 0) {
            return {
                startDate: calData[0].eng_date,
                endDate: calData[calData.length - 1].eng_date
            };
        }
    } catch (e) {
        console.warn("Calendar mapping lookup failed, using calculated fallback:", e);
    }

    // Fallback date calculation
    const fallback = NEPALI_MONTH_FALLBACKS[monthName] || { startM: 2, startD: 13, endM: 3, endD: 14 };
    const gregorianYear = parseInt(year, 10) - 57; // 2083 BS ≈ 2026 AD
    
    const pad = (n) => String(n).padStart(2, '0');
    const startY = gregorianYear;
    const endY = fallback.crossYear ? gregorianYear + 1 : gregorianYear;

    return {
        startDate: `${startY}-${pad(fallback.startM)}-${pad(fallback.startD)}`,
        endDate: `${endY}-${pad(fallback.endM)}-${pad(fallback.endD)}`
    };
}

// ============================================================
// MONTHLY VIEW LOGIC
// ============================================================
async function loadMonthlyAttendance() {
    const tbody = document.getElementById('att-table-body');
    const year = document.getElementById('att-nep-year')?.value;
    const monthName = document.getElementById('att-nep-month')?.value;
    const selectedStaff = document.getElementById('monthly-staff-select')?.value || 'current';
    
    if (!tbody || !year || !monthName) return;

    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-indigo-600 py-8 font-bold animate-pulse">Loading records...</td></tr>';

    try {
        const { startDate, endDate } = await getDateRangeForNepaliMonth(year, monthName);

        let query = supabase
            .from('attendance_logs')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('timestamp', { ascending: true });

        if (selectedStaff === 'current') {
            query = query.eq('email', currentUser.email);
        } else if (selectedStaff && selectedStaff !== 'all') {
            query = query.eq('email', selectedStaff);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-slate-400 py-8 italic text-sm">No attendance records found for ${monthName} ${year}.</td></tr>`;
            return;
        }

        // Group by Date + Email
        const grouped = {};
        data.forEach(log => {
            const key = `${log.date}_${log.email}`;
            if (!grouped[key]) {
                grouped[key] = {
                    date: log.date,
                    email: log.email,
                    logs: []
                };
            }
            grouped[key].logs.push(log);
        });

        tbody.innerHTML = '';
        
        // Render rows
        Object.values(grouped).sort((a, b) => {
            if (a.date !== b.date) return new Date(b.date) - new Date(a.date);
            return a.email.localeCompare(b.email);
        }).forEach(item => {
            const staffObj = allStaffList.find(s => s.email.toLowerCase() === item.email.toLowerCase());
            const displayName = staffObj ? staffObj.fullName : item.email.split('@')[0];
            
            const ins = item.logs.filter(l => l.type === 'IN');
            const outs = item.logs.filter(l => l.type === 'OUT');
            const firstIn = ins.length > 0 ? new Date(ins[0].timestamp) : null;
            const lastOut = outs.length > 0 ? new Date(outs[outs.length - 1].timestamp) : null;

            let hours = 0;
            if (firstIn && lastOut) hours = (lastOut - firstIn) / (1000 * 60 * 60);

            const formatTime = (d) => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
            const primaryZone = item.logs[0].zone_name || 'Unknown';
            const allValid = item.logs.every(l => l.is_valid);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold text-slate-700">${item.date}</td>
                <td>
                    <div class="font-bold text-slate-800 text-xs">${displayName}</div>
                    <div class="text-[10px] text-slate-400 font-mono">${item.email}</div>
                </td>
                <td class="text-emerald-600 font-semibold">${formatTime(firstIn)}</td>
                <td class="text-amber-600 font-semibold">${formatTime(lastOut)}</td>
                <td class="font-bold ${hours >= 8 ? 'text-indigo-600' : 'text-slate-600'}">${hours > 0 ? hours.toFixed(2) + 'h' : '—'}</td>
                <td>
                    <div class="flex items-center gap-1.5 text-xs font-semibold">
                        <span class="${allValid ? 'text-emerald-500' : 'text-rose-500'}">●</span> 
                        <span class="text-slate-600">${primaryZone}</span>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("Monthly load error:", err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-rose-500 py-8 font-bold">Error loading records. Check connection.</td></tr>';
    }
}

// ============================================================
// ADMIN CONTROL PANEL & ALL STAFF AUDIT LOGS
// ============================================================
function initAdminFeatures() {
    // Polygon Geofencing Buttons
    const saveZoneBtn = document.getElementById('save-zone-btn');
    if (saveZoneBtn) saveZoneBtn.addEventListener('click', saveWorkZone);
    
    const clearShapeBtn = document.getElementById('clear-shape-btn');
    if (clearShapeBtn) clearShapeBtn.addEventListener('click', clearDrawing);

    const newZoneBtn = document.getElementById('new-zone-btn');
    if (newZoneBtn) newZoneBtn.addEventListener('click', resetEditorState);

    const delZoneBtn = document.getElementById('delete-zone-btn');
    if (delZoneBtn) {
        delZoneBtn.addEventListener('click', () => {
            if (editingZoneId) {
                deleteWorkZoneById(editingZoneId);
            } else {
                showNotification('No zone selected for deletion.', true);
            }
        });
    }

    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', resetEditorState);

    const addManualPtBtn = document.getElementById('add-manual-point-btn');
    if (addManualPtBtn) {
        addManualPtBtn.addEventListener('click', () => {
            const lat = prompt("Enter Latitude (e.g. 29.74050):");
            if (!lat) return;
            const lng = prompt("Enter Longitude (e.g. 80.65020):");
            if (!lng) return;
            const pLat = parseFloat(lat);
            const pLng = parseFloat(lng);
            if (!isNaN(pLat) && !isNaN(pLng)) {
                currentPolygonPoints.push({ lat: pLat, lng: pLng });
                redrawActivePolygon();
                renderVertexList();
            }
        });
    }

    // Admin View Mode Switcher
    const summaryBtn = document.getElementById('admin-view-summary-btn');
    const logsBtn = document.getElementById('admin-view-logs-btn');

    if (summaryBtn && logsBtn) {
        summaryBtn.addEventListener('click', () => {
            adminViewMode = 'summary';
            summaryBtn.classList.add('bg-white', 'text-indigo-700', 'shadow-sm');
            logsBtn.classList.remove('bg-white', 'text-indigo-700', 'shadow-sm');
            renderAdminData();
        });

        logsBtn.addEventListener('click', () => {
            adminViewMode = 'logs';
            logsBtn.classList.add('bg-white', 'text-indigo-700', 'shadow-sm');
            summaryBtn.classList.remove('bg-white', 'text-indigo-700', 'shadow-sm');
            renderAdminData();
        });
    }

    // Admin Control Buttons
    const adminLoadBtn = document.getElementById('admin-load-btn');
    if (adminLoadBtn) adminLoadBtn.addEventListener('click', loadAdminAttendance);
    
    const adminExportBtn = document.getElementById('admin-export-btn');
    if (adminExportBtn) adminExportBtn.addEventListener('click', exportAdminCSV);
}

async function loadAdminAttendance() {
    const tbody = document.getElementById('admin-table-body');
    const year = document.getElementById('admin-nep-year')?.value;
    const monthName = document.getElementById('admin-nep-month')?.value;
    const selectedEmail = document.getElementById('admin-emp-select')?.value;

    if (!tbody || !year || !monthName) return;

    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-indigo-600 py-8 font-bold animate-pulse">Loading all staff records...</td></tr>';

    try {
        const { startDate, endDate } = await getDateRangeForNepaliMonth(year, monthName);

        let query = supabase
            .from('attendance_logs')
            .select('*')
            .gte('date', startDate)
            .lte('date', endDate)
            .order('timestamp', { ascending: false });

        if (selectedEmail) {
            query = query.eq('email', selectedEmail);
        }

        const { data, error } = await query;
        if (error) throw error;

        currentAdminData = data || [];
        updateAdminKPIs(currentAdminData);
        renderAdminData();

    } catch (err) {
        console.error("Admin load error:", err);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-rose-500 py-8 font-bold">Error loading staff records.</td></tr>';
    }
}

function updateAdminKPIs(logs) {
    const today = new Date().toISOString().split('T')[0];
    const todayInCount = new Set(logs.filter(l => l.date === today && l.type === 'IN').map(l => l.email)).size;
    
    const kpiTodayIn = document.getElementById('admin-kpi-today-in');
    if (kpiTodayIn) kpiTodayIn.textContent = todayInCount;

    // Total Hours
    let totalMs = 0;
    const staffDates = {};
    logs.forEach(l => {
        const k = `${l.date}_${l.email}`;
        if (!staffDates[k]) staffDates[k] = [];
        staffDates[k].push(l);
    });

    Object.values(staffDates).forEach(dayLogs => {
        const ins = dayLogs.filter(l => l.type === 'IN').sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
        const outs = dayLogs.filter(l => l.type === 'OUT').sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
        if (ins.length > 0 && outs.length > 0) {
            const diff = new Date(outs[outs.length - 1].timestamp) - new Date(ins[0].timestamp);
            if (diff > 0) totalMs += diff;
        }
    });

    const totalHours = totalMs / (1000 * 60 * 60);
    const kpiHours = document.getElementById('admin-kpi-month-hours');
    if (kpiHours) kpiHours.textContent = `${totalHours.toFixed(1)} hrs`;

    // Compliance Rate
    const validCount = logs.filter(l => l.is_valid).length;
    const compRate = logs.length > 0 ? Math.round((validCount / logs.length) * 100) : 100;
    const kpiComp = document.getElementById('admin-kpi-compliance');
    if (kpiComp) kpiComp.textContent = `${compRate}%`;
}

function renderAdminData() {
    const thead = document.getElementById('admin-table-head');
    const tbody = document.getElementById('admin-table-body');
    if (!tbody || !thead) return;

    if (currentAdminData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-slate-400 py-8 italic text-sm">No records found for the selected criteria.</td></tr>';
        return;
    }

    if (adminViewMode === 'summary') {
        // --- STAFF MONTHLY SUMMARY VIEW ---
        thead.innerHTML = `
            <tr>
                <th>Staff Employee</th>
                <th>Email</th>
                <th>Days Present</th>
                <th>Total Shifts</th>
                <th>Total Worked</th>
                <th>Geofence Compliance</th>
                <th>Actions</th>
            </tr>
        `;

        const staffSummary = {};
        currentAdminData.forEach(log => {
            const em = log.email.toLowerCase();
            if (!staffSummary[em]) {
                staffSummary[em] = {
                    email: log.email,
                    days: new Set(),
                    totalLogs: 0,
                    validLogs: 0,
                    dayGroups: {}
                };
            }
            staffSummary[em].days.add(log.date);
            staffSummary[em].totalLogs += 1;
            if (log.is_valid) staffSummary[em].validLogs += 1;

            if (!staffSummary[em].dayGroups[log.date]) staffSummary[em].dayGroups[log.date] = [];
            staffSummary[em].dayGroups[log.date].push(log);
        });

        tbody.innerHTML = Object.values(staffSummary).map(s => {
            const staffObj = allStaffList.find(st => st.email.toLowerCase() === s.email.toLowerCase());
            const fullName = staffObj ? staffObj.fullName : s.email.split('@')[0];
            
            let totalMs = 0;
            Object.values(s.dayGroups).forEach(dayLogs => {
                const ins = dayLogs.filter(l => l.type === 'IN').sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
                const outs = dayLogs.filter(l => l.type === 'OUT').sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
                if (ins.length > 0 && outs.length > 0) {
                    const diff = new Date(outs[outs.length - 1].timestamp) - new Date(ins[0].timestamp);
                    if (diff > 0) totalMs += diff;
                }
            });

            const totalHours = totalMs / (1000 * 60 * 60);
            const comp = s.totalLogs > 0 ? Math.round((s.validLogs / s.totalLogs) * 100) : 100;

            return `
                <tr>
                    <td>
                        <div class="font-bold text-slate-800 text-xs">${fullName}</div>
                        <div class="text-[10px] text-indigo-600 font-semibold">${staffObj?.role?.toUpperCase() || 'OPERATOR'}</div>
                    </td>
                    <td class="font-mono text-xs text-slate-600">${s.email}</td>
                    <td class="font-bold text-slate-700">${s.days.size} days</td>
                    <td class="font-semibold text-slate-600">${s.totalLogs} logs</td>
                    <td class="font-bold text-indigo-700">${totalHours.toFixed(1)} hrs</td>
                    <td>
                        <div class="flex items-center gap-1 text-xs font-bold ${comp >= 90 ? 'text-emerald-600' : 'text-amber-600'}">
                            <span>${comp}%</span>
                            <span class="text-[10px] text-slate-400">(${s.validLogs}/${s.totalLogs})</span>
                        </div>
                    </td>
                    <td>
                        <button onclick="window.filterByStaffEmail('${s.email}')" class="text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold px-2.5 py-1 rounded transition">
                            View Logs
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

    } else {
        // --- DETAILED LOG EVENTS VIEW ---
        thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Staff Employee</th>
                <th>Action</th>
                <th>Work Zone</th>
                <th>GPS Status</th>
                <th>Coordinates</th>
            </tr>
        `;

        tbody.innerHTML = currentAdminData.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const typeClass = log.type === 'IN' ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-amber-700 bg-amber-50 border border-amber-200';
            const validClass = log.is_valid ? 'text-emerald-600' : 'text-rose-600';
            const staffObj = allStaffList.find(st => st.email.toLowerCase() === log.email.toLowerCase());
            const fullName = staffObj ? staffObj.fullName : log.email.split('@')[0];
            const coords = (log.lat && log.lng) ? `${parseFloat(log.lat).toFixed(4)}, ${parseFloat(log.lng).toFixed(4)}` : '—';

            return `
                <tr>
                    <td class="font-bold text-slate-700 text-xs">${log.date}</td>
                    <td class="font-semibold text-slate-700 text-xs">${timeStr}</td>
                    <td>
                        <div class="font-bold text-slate-800 text-xs">${fullName}</div>
                        <div class="text-[10px] text-slate-400 font-mono">${log.email}</div>
                    </td>
                    <td>
                        <span class="font-bold text-[10px] uppercase px-2 py-0.5 rounded ${typeClass}">
                            ${log.type === 'IN' ? 'Check In' : 'Check Out'}
                        </span>
                    </td>
                    <td class="text-slate-700 text-xs font-semibold">${log.zone_name || 'Unknown'}</td>
                    <td class="font-bold text-xs ${validClass}">
                        <span>${log.is_valid ? '● Verified On-Site' : '⚠ Out of Bounds'}</span>
                    </td>
                    <td class="font-mono text-[11px] text-slate-400">${coords}</td>
                </tr>
            `;
        }).join('');
    }
}

window.filterByStaffEmail = function(email) {
    const select = document.getElementById('admin-emp-select');
    if (select) select.value = email;
    
    const logsBtn = document.getElementById('admin-view-logs-btn');
    if (logsBtn) logsBtn.click();
    
    loadAdminAttendance();
};

function exportAdminCSV() {
    if (!currentAdminData || currentAdminData.length === 0) {
        showNotification('No data to export. Please load data first.', true);
        return;
    }

    const headers = ['Date', 'Timestamp', 'Email', 'Staff Name', 'Type', 'Work Zone', 'Is Valid', 'Latitude', 'Longitude'];
    const csvRows = [headers.join(',')];

    currentAdminData.forEach(log => {
        const staffObj = allStaffList.find(s => s.email.toLowerCase() === log.email.toLowerCase());
        const fullName = staffObj ? staffObj.fullName : log.email.split('@')[0];
        
        const row = [
            log.date,
            `"${log.timestamp}"`,
            `"${log.email}"`,
            `"${fullName}"`,
            log.type,
            `"${log.zone_name || ''}"`,
            log.is_valid ? 'TRUE' : 'FALSE',
            log.lat || '',
            log.lng || ''
        ];
        csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    const nepYear = document.getElementById('admin-nep-year')?.value || '2083';
    const nepMonth = document.getElementById('admin-nep-month')?.value || 'Bhadra';
    
    link.setAttribute('download', `makari_attendance_audit_${nepYear}_${nepMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('📊 Audit CSV report generated successfully!');
}

if (window.location.pathname.includes('attendance.html')) {
    initAttendance();
}
