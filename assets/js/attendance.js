import { supabase, initializeApplication, showNotification } from './core-app.js';

/**
 * ATTENDANCE MODULE - MAKARI GAD
 * Handles Geofencing, 8-hour shift tracking, and offline sync.
 */

let currentUser = null;
let userRole = 'normal';
let userProfile = null;
let workZones = [];
let todayLogs = [];

const GEOFENCE_STORAGE_KEY = 'makarigad_work_zones';
const LOGS_STORAGE_KEY = 'makarigad_attendance_logs';

export async function initAttendance() {
    const sd = await initializeApplication(true);
    if (!sd) return;
    
    currentUser = sd.user;
    userRole = sd.role;

    // Load static data
    await loadWorkZones();
    await fetchUserProfile();
    await loadTodayLogs();

    // Bind UI events
    bindAttendanceUI();
    
    // Start live status update
    updateLiveStatus();
    setInterval(updateLiveStatus, 30000); // Update every 30s

    // Admin/Staff specific initializations
    if (userRole === 'admin' || userRole === 'staff') {
        initAdminFeatures();
    }
}

function initAdminFeatures() {
    // Tab switching for admin
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
            btn.classList.add('active');
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.classList.remove('hidden');
            
            if (btn.dataset.tab === 'tab-zones') {
                setTimeout(initMap, 100);
            }
        });
    });

    const saveZoneBtn = document.getElementById('save-zone-btn');
    if (saveZoneBtn) saveZoneBtn.addEventListener('click', saveWorkZone);
}

// Map variables
let map, currentMarker, currentCircle;
let selectedLat = null, selectedLng = null;

function initMap() {
    if (map) {
        map.invalidateSize();
        return;
    }
    
    // Default coordinate: Baitadi / Makari Gad general area
    map = L.map('geofence-map').setView([29.74, 80.65], 13); 
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);

    map.on('click', function(e) {
        selectedLat = e.latlng.lat;
        selectedLng = e.latlng.lng;
        const radius = parseInt(document.getElementById('zone-radius').value) || 500;

        if (currentMarker) map.removeLayer(currentMarker);
        if (currentCircle) map.removeLayer(currentCircle);

        currentMarker = L.marker([selectedLat, selectedLng]).addTo(map);
        currentCircle = L.circle([selectedLat, selectedLng], {
            color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.2, radius: radius
        }).addTo(map);
    });

    // Load existing zones onto map
    workZones.forEach(zone => {
        L.circle([zone.latitude, zone.longitude], {
            color: '#10b981', fillColor: '#10b981', fillOpacity: 0.1, radius: zone.radius_meters
        }).addTo(map).bindPopup(`<b>${zone.zone_name}</b><br>Radius: ${zone.radius_meters}m`);
    });
}

async function saveWorkZone() {
    const name = document.getElementById('zone-name').value.trim();
    const radius = parseInt(document.getElementById('zone-radius').value);
    
    if (!name || !selectedLat || !selectedLng) {
        showNotification('Please enter a name and click map to set location', true);
        return;
    }
    
    const btn = document.getElementById('save-zone-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Saving...'; btn.disabled = true;

    try {
        const { error } = await supabase.from('work_zones').insert({
            zone_name: name, latitude: selectedLat, longitude: selectedLng, radius_meters: radius || 500
        });
        if (error) throw error;
        showNotification(`✅ Zone '${name}' saved successfully!`);
        document.getElementById('zone-name').value = '';
        await loadWorkZones();
        initMap(); // Refresh map
    } catch (e) { showNotification('Error saving zone: ' + e.message, true); }
    finally {
        btn.textContent = originalText; btn.disabled = false;
    }
}

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
        <div class="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
            <div>
                <span class="text-[10px] font-black uppercase tracking-widest ${log.type === 'IN' ? 'text-emerald-600' : 'text-amber-600'}">${log.type === 'IN' ? 'Check In' : 'Check Out'}</span>
                <div class="text-xs font-bold text-slate-700">${new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <div class="text-right">
                <div class="text-[10px] text-slate-400 font-medium">${log.zone_name || 'Unknown Location'}</div>
                <div class="text-[9px] ${log.is_valid ? 'text-emerald-500' : 'text-rose-500'} font-bold">${log.is_valid ? '✓ Verified Location' : '⚠ Outside Geofence'}</div>
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

    // If still checked in, calculate up to now
    if (lastIn) {
        totalMs += (new Date().getTime() - lastIn);
    }

    const totalHours = totalMs / (1000 * 60 * 60);
    durationEl.textContent = `${totalHours.toFixed(2)} hrs`;

    const progressPercent = Math.min(100, (totalHours / 8) * 100);
    const progressBar = document.getElementById('shift-progress-bar');
    if (progressBar) progressBar.style.width = `${progressPercent}%`;

    if (totalHours >= 8) {
        statusEl.textContent = 'Shift Completed';
        statusEl.className = 'badge bg-emerald-100 text-emerald-700 border border-emerald-200';
        if (progressBar) progressBar.className = 'bg-emerald-500 h-full transition-all duration-500';
    } else {
        statusEl.textContent = `${(8 - totalHours).toFixed(1)} hrs left`;
        statusEl.className = 'badge bg-amber-100 text-amber-700 border border-amber-200';
        if (progressBar) progressBar.className = 'bg-indigo-600 h-full transition-all duration-500';
    }
}

function bindAttendanceUI() {
    const inBtn = document.getElementById('btn-check-in');
    const outBtn = document.getElementById('btn-check-out');

    if (inBtn) inBtn.addEventListener('click', () => handleAttendance('IN'));
    if (outBtn) outBtn.addEventListener('click', () => handleAttendance('OUT'));
}

async function handleAttendance(type) {
    const btn = document.getElementById(`btn-check-${type.toLowerCase()}`);
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></span> Locating...`;

    try {
        const pos = await getCurrentPosition();
        const { lat, lng } = pos.coords;
        
        // Find if user is in any work zone
        let nearestZone = null;
        let minDistance = Infinity;
        let isValid = false;

        workZones.forEach(zone => {
            const dist = getDistance(lat, lng, zone.latitude, zone.longitude);
            if (dist < minDistance) {
                minDistance = dist;
                nearestZone = zone;
            }
            if (dist <= zone.radius_meters) {
                isValid = true;
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
            // Store locally for sync
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
        if (!navigator.geolocation) return reject(new Error("Geolocation not supported"));
        navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
    });
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // in metres
}

function updateLiveStatus() {
    const statusText = document.getElementById('geofence-status-text');
    const statusIcon = document.getElementById('geofence-status-icon');
    
    if (!statusText || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(pos => {
        const { lat, lng } = pos.coords;
        let inZone = false;
        let activeZone = null;

        workZones.forEach(zone => {
            if (getDistance(lat, lng, zone.latitude, zone.longitude) <= zone.radius_meters) {
                inZone = true;
                activeZone = zone;
            }
        });

        if (inZone) {
            statusText.textContent = `Inside ${activeZone.zone_name}`;
            statusText.className = 'text-[10px] font-black text-emerald-600 uppercase tracking-widest';
            statusIcon.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
        } else {
            statusText.textContent = 'Outside Work Zone';
            statusText.className = 'text-[10px] font-black text-rose-500 uppercase tracking-widest';
            statusIcon.className = 'w-2 h-2 rounded-full bg-rose-500';
        }
    }, () => {
        statusText.textContent = 'GPS Disabled';
        statusIcon.className = 'w-2 h-2 rounded-full bg-slate-400';
    });
}

// Auto-init if on attendance page
if (window.location.pathname.includes('attendance.html')) {
    initAttendance();
}
