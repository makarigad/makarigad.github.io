import { supabase, initializeApplication, showNotification } from './core-app.js';

/**
 * ATTENDANCE MODULE - MAKARI GAD
 * Handles POLYGON Geofencing, shift tracking, Monthly Views, and Admin Controls.
 */

let currentUser = null;
let userRole = 'normal';
let userProfile = null;
let workZones = [];
let todayLogs = [];

const GEOFENCE_STORAGE_KEY = 'makarigad_polygon_zones';
const LOGS_STORAGE_KEY = 'makarigad_attendance_logs';

export async function initAttendance() {
    const sd = await initializeApplication(true);
    if (!sd) return;
    
    currentUser = sd.user;
    userRole = sd.role;

    await loadWorkZones();
    await fetchUserProfile();
    await loadTodayLogs();

    bindDatabaseUI();
        
    updateLiveStatus();
    setInterval(updateLiveStatus, 30000);

    if (userRole === 'admin' || userRole === 'staff') {
        initAdminFeatures();
    }
}

function initAdminFeatures() {
    // Zone Map Buttons
    const saveZoneBtn = document.getElementById('save-zone-btn');
    if (saveZoneBtn) saveZoneBtn.addEventListener('click', saveWorkZone);
    
    const clearShapeBtn = document.getElementById('clear-shape-btn');
    if (clearShapeBtn) clearShapeBtn.addEventListener('click', clearDrawing);

    // Admin Control Buttons
    const adminLoadBtn = document.getElementById('admin-load-btn');
    if (adminLoadBtn) adminLoadBtn.addEventListener('click', loadAdminAttendance);
    
    const adminExportBtn = document.getElementById('admin-export-btn');
    if (adminExportBtn) adminExportBtn.addEventListener('click', exportAdminCSV);

    // Populate the Employee Dropdown
    populateEmployeeDropdown();
}

// ── INSTANT UI BINDINGS (Tabs) ──
document.addEventListener('DOMContentLoaded', () => {
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
            
            if (targetId === 'tab-zones') setTimeout(initMap, 100);
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

// ── POLYGON GEOFENCING MAP LOGIC ──
let map;
let currentPolygonPoints = [];
let currentPolygonLayer = null;
let currentPointMarkers = [];

function initMap() {
    if (map) { map.invalidateSize(); return; }
    
    // Default to Makari Gad Area
    map = L.map('geofence-map').setView([29.74, 80.65], 14); 
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);

    // Click to add points to the custom polygon
    map.on('click', function(e) {
        currentPolygonPoints.push({ lat: e.latlng.lat, lng: e.latlng.lng });
        
        let dot = L.circleMarker([e.latlng.lat, e.latlng.lng], {
            radius: 4, color: '#4f46e5', fillColor: '#ffffff', fillOpacity: 1, weight: 2
        }).addTo(map);
        currentPointMarkers.push(dot);
        
        if (currentPolygonLayer) map.removeLayer(currentPolygonLayer);
        
        if (currentPolygonPoints.length > 1) {
            currentPolygonLayer = L.polygon(currentPolygonPoints, {
                color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.3, weight: 2
            }).addTo(map);
        }
    });

    // Render existing polygon zones
    workZones.forEach(zone => {
        if (zone.coordinates && zone.coordinates.length >= 3) {
            const polygon = L.polygon(zone.coordinates, {
                color: '#10b981', fillColor: '#10b981', fillOpacity: 0.2, weight: 2
            }).addTo(map);
            
            polygon.bindTooltip(
                `<span class="font-bold text-xs text-emerald-800 tracking-wider uppercase">${zone.zone_name}</span>`, 
                {
                    permanent: true, 
                    direction: 'center',
                    className: 'bg-white/90 backdrop-blur-sm border border-emerald-200 shadow-sm rounded px-2 py-1'
                }
            ).openTooltip();
        }
    });

        // Drop a pulsing blue dot exactly where your device thinks you are
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(pos => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            L.circleMarker([lat, lng], {
                radius: 8, color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 3
            }).addTo(map).bindTooltip(
                `<span class="font-bold text-blue-700">Your Current GPS Location</span>`, 
                { permanent: true, direction: 'top', className: 'bg-white/90 border border-blue-200' }
            );
            
            // Auto-pan the map to your actual location
            map.setView([lat, lng], 15);
        });
    }

}

function clearDrawing() {
    currentPolygonPoints = [];
    if (currentPolygonLayer && map) {
        map.removeLayer(currentPolygonLayer);
        currentPolygonLayer = null;
    }
    if (currentPointMarkers.length > 0) {
        currentPointMarkers.forEach(marker => map.removeLayer(marker));
        currentPointMarkers = [];
    }
}

async function saveWorkZone() {
    const name = document.getElementById('zone-name').value.trim();
    
    if (!name) {
        showNotification('Please enter a Zone Name first.', true);
        return;
    }
    if (currentPolygonPoints.length < 3) {
        showNotification('Please click at least 3 points on the map to draw a shape.', true);
        return;
    }
    
    const btn = document.getElementById('save-zone-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...'; btn.disabled = true;

    try {
        const referenceLat = currentPolygonPoints[0].lat;
        const referenceLng = currentPolygonPoints[0].lng;

        const { error } = await supabase.from('work_zones').insert({
            zone_name: name,
            coordinates: currentPolygonPoints,
            latitude: referenceLat,
            longitude: referenceLng,
            radius_meters: 0
        });
        
        if (error) throw error;
        
        showNotification(`✅ Zone '${name}' saved successfully!`);
        document.getElementById('zone-name').value = '';
        clearDrawing();
        await loadWorkZones();
        
        if(map) {
            map.eachLayer((layer) => { 
                if (layer instanceof L.Polygon || layer instanceof L.CircleMarker || layer instanceof L.Tooltip) map.removeLayer(layer); 
            });
            initMap();
        }
    } catch (e) { 
        showNotification('Error saving zone: ' + e.message, true); 
    } finally {
        btn.textContent = originalText; btn.disabled = false;
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
            const { data } = await supabase.from('work_zones').select('*');
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

// ── MONTHLY VIEW LOGIC ──

async function loadMonthlyAttendance() {
    const tbody = document.getElementById('att-table-body');
    const year = document.getElementById('att-nep-year')?.value;
    const monthName = document.getElementById('att-nep-month')?.value;
    
    if (!tbody || !year || !monthName) return;

    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-indigo-600 py-8 font-bold animate-pulse">Loading records...</td></tr>';

    try {
        // 1. Get English dates for this Nepali month from the database
        const { data: calData, error: calErr } = await supabase
            .from('calendar_mappings')
            .select('eng_date')
            .eq('nep_year', year)
            .eq('nep_month', monthName)
            .order('eng_date', { ascending: true });

        if (calErr) throw calErr;
        
        if (!calData || calData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-amber-500 py-8 font-bold">No calendar mapping found for ${monthName} ${year}.</td></tr>`;
            return;
        }

        const startDate = calData[0].eng_date;
        const endDate = calData[calData.length - 1].eng_date;

        // 2. Fetch the user's attendance logs for that date range
        const { data, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('email', currentUser.email) // ONLY fetch the logged-in user's records
            .gte('date', startDate)
            .lte('date', endDate)
            .order('timestamp', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-slate-400 py-8 italic text-sm">No attendance records found for this month.</td></tr>';
            return;
        }

        // 3. Group the records by day
        const groupedByDay = {};
        data.forEach(log => {
            if (!groupedByDay[log.date]) groupedByDay[log.date] = [];
            groupedByDay[log.date].push(log);
        });

        tbody.innerHTML = '';
        
        // 4. Render the table rows
        Object.keys(groupedByDay).sort((a, b) => new Date(b) - new Date(a)).forEach(date => {
            const logs = groupedByDay[date];
            const ins = logs.filter(l => l.type === 'IN');
            const outs = logs.filter(l => l.type === 'OUT');
            const firstIn = ins.length > 0 ? new Date(ins[0].timestamp) : null;
            const lastOut = outs.length > 0 ? new Date(outs[outs.length - 1].timestamp) : null;

            let hours = 0;
            if (firstIn && lastOut) hours = (lastOut - firstIn) / (1000 * 60 * 60);

            const formatTime = (d) => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
            const primaryZone = logs[0].zone_name || 'Unknown';
            const allValid = logs.every(l => l.is_valid);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="font-bold text-slate-700">${date}</td>
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
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-rose-500 py-8 font-bold">Error loading records. Check connection.</td></tr>';
    }
}

// ── ADMIN CONTROL PANEL LOGIC ──
let currentAdminData = [];

async function populateEmployeeDropdown() {
    const select = document.getElementById('admin-emp-select');
    if (!select) return;
    
    try {
        const { data, error } = await supabase
            .from('user_roles')
            .select('email, full_name')
            .order('full_name', { ascending: true });
            
        if (error) throw error;
        
        data.forEach(user => {
            const opt = document.createElement('option');
            opt.value = user.email;
            opt.textContent = user.full_name ? `${user.full_name} (${user.email})` : user.email;
            select.appendChild(opt);
        });
    } catch (err) {
        console.warn("Could not load employees for admin dropdown", err);
    }
}

async function loadAdminAttendance() {
    const tbody = document.getElementById('admin-table-body');
    const year = document.getElementById('admin-nep-year').value;
    
    // 👉 FIX: Get the actual name (e.g., "Falgun") instead of the number ("11")
    const monthSelect = document.getElementById('admin-nep-month');
    const monthName = monthSelect.options[monthSelect.selectedIndex].text; 
    
    const selectedEmail = document.getElementById('admin-emp-select').value;

    if (!tbody || !year || !monthName) return;

    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-indigo-600 py-8 font-bold animate-pulse">Loading records...</td></tr>';

    try {
        // Search using the monthName ("Falgun")
        const { data: calData, error: calErr } = await supabase
            .from('calendar_mappings')
            .select('eng_date')
            .eq('nep_year', year)
            .eq('nep_month', monthName) 
            .order('eng_date', { ascending: true });

        if (calErr) throw calErr;
        
        // If still empty, it means nepali-calendar.html really hasn't been saved yet
        if (!calData || calData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-amber-500 py-8 font-bold">No calendar mapping found for ${monthName} ${year}. Please go to the Calendar Setup page and save this month.</td></tr>`;
            return;
        }

        const startDate = calData[0].eng_date;
        const endDate = calData[calData.length - 1].eng_date;

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

        if (currentAdminData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-8 italic text-sm">No records found for this criteria.</td></tr>';
            return;
        }

        tbody.innerHTML = currentAdminData.map(log => {
            const timeStr = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const typeClass = log.type === 'IN' ? 'text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded' : 'text-amber-600 bg-amber-50 px-2 py-0.5 rounded';
            const validClass = log.is_valid ? 'text-emerald-500' : 'text-rose-500';
            
            return `
                <tr>
                    <td class="font-bold text-slate-700">${log.date}</td>
                    <td class="text-slate-600 font-semibold">${log.email}</td>
                    <td><span class="font-bold text-[10px] uppercase tracking-wider ${typeClass}">${log.type}</span></td>
                    <td class="font-semibold text-slate-700">${timeStr}</td>
                    <td class="text-slate-600 text-xs font-medium">${log.zone_name}</td>
                    <td class="font-bold text-xs ${validClass} flex items-center gap-1">
                        <span>${log.is_valid ? '● Valid' : '⚠ Out of Bounds'}</span>
                    </td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        console.error("Admin load error:", err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-rose-500 py-8 font-bold">Error loading records.</td></tr>';
    }
}

function exportAdminCSV() {
    if (!currentAdminData || currentAdminData.length === 0) {
        showNotification('No data to export. Please load data first.', true);
        return;
    }

    const headers = ['English Date', 'Email', 'Type', 'Timestamp', 'Zone Name', 'Is Valid'];
    const csvRows = [headers.join(',')];

    currentAdminData.forEach(log => {
        const row = [
            log.date,
            log.email,
            log.type,
            log.timestamp,
            `"${log.zone_name}"`, 
            log.is_valid
        ];
        csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    const nepYear = document.getElementById('admin-nep-year').value;
    const nepMonth = document.getElementById('admin-nep-month').value;
    
    link.setAttribute('download', `makari_attendance_${nepYear}_${nepMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

if (window.location.pathname.includes('attendance.html')) initAttendance();