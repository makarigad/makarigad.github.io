import { supabase, fetchWithTimeout, initHeaderUI, initializeApplication, safeUpsert } from './core-app.js';

// --- DOM Helpers ---
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// --- Security Helpers ---
const escapeHTML = str => 
    String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

// --- State ---
let allItems = [];
let stores = [];
let pumps = [];
let equipment = [];
let currentItem = null;
let selectedStoreId = null;
let currentUser = null;
let userRole = 'operator';
let v2TablesOk = true;
let activeCategory = 'All';

let fuelWorkbookSheets = [];
let currentSheetIdx = 0;
let fuelMasterIds = {};
let materialsWorkbookData = [];

window.userOpeningOverrides = {}; 
window.toastTimer = null;

const todayNPT = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });

// --- UI Utilities ---
function showToast(message, type = 'success') {
    let modal = $('notification-modal');
    let msgEl = $('notification-message');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'notification-modal';
        modal.className = 'fixed top-4 right-4 z-[400] transition-all duration-300 pointer-events-none max-w-xs w-full bg-white rounded-xl shadow-2xl border-l-4 px-4 py-3 opacity-0 -translate-y-4';
        msgEl = document.createElement('p');
        msgEl.id = 'notification-message';
        msgEl.className = 'text-xs font-bold text-slate-700';
        modal.appendChild(msgEl);
        document.body.appendChild(modal);
    }
    
    modal.classList.remove('border-emerald-500', 'border-rose-500', 'border-amber-500');
    if (type === 'error') modal.classList.add('border-rose-500');
    else if (type === 'warning') modal.classList.add('border-amber-500');
    else modal.classList.add('border-emerald-500');
    
    msgEl.textContent = message;
    modal.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
    modal.classList.add('opacity-100', 'translate-y-0');
    
    if (window.toastTimer) clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
        modal.classList.remove('opacity-100', 'translate-y-0');
        modal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
    }, 3200);
}

window.closeModal = (id) => {
    const m = $(id);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

window.openModal = (id) => {
    const m = $(id);
    if (m) { 
        m.classList.remove('hidden'); 
        m.classList.add('flex'); 
        m.scrollTo(0,0);
        m.querySelectorAll('.custom-scroll, .overflow-y-auto').forEach(s => s.scrollTo(0,0));
    }
};

// --- Auth & Geo ---
function isAdmin() { return userRole === 'admin'; }
function displayName() {
    return currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'User';
}

function canEditLog(log) {
    if (!log) return false;
    if (isAdmin()) return true;
    const email = currentUser?.email?.toLowerCase();
    if (!email) return false;
    return (log.created_by_email || '').toLowerCase() === email || log.operator_uid === currentUser?.id;
}

async function captureGeo() {
    return new Promise((resolve) => {
        if (!navigator.geolocation) return resolve({ latitude: null, longitude: null, geo_label: null });
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                geo_label: `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`
            }),
            () => resolve({ latitude: null, longitude: null, geo_label: 'Location not shared' }),
            { enableHighAccuracy: true, timeout: 3000, maximumAge: 300000 }
        );
    });
}

// --- DB Writes ---
async function writeAudit(entityType, entityId, action, summary, payload = null, geo = null) {
    if (!v2TablesOk) return;
    try {
        await safeUpsert('inventory_audit', {
            id: crypto.randomUUID(),
            entity_type: entityType,
            entity_id: entityId,
            action,
            summary,
            payload,
            user_email: currentUser?.email,
            user_name: displayName(),
            user_role: userRole,
            latitude: geo?.latitude ?? null,
            longitude: geo?.longitude ?? null,
            geo_label: geo?.geo_label ?? null
        });
    } catch (e) { console.warn('[audit]', e.message); }
}

function storeName(storeId) {
    const s = stores.find(x => x.id === storeId);
    return s?.name || '—';
}

function getFuelTankItem(storeId, fuelType) {
    const sn = storeName(storeId);
    return allItems.find(i =>
        i.category === 'Fuel' &&
        (i.item_name.toLowerCase().includes(fuelType)) && 
        (i.store_id === storeId || (i.store_location && i.store_location.toLowerCase() === sn.toLowerCase()))
    );
}

async function ensureFuelTank(storeId, fuelType) {
    let item = getFuelTankItem(storeId, fuelType);
    if (item) return item;
    
    const sn = storeName(storeId);
    const name = `${fuelType === 'petrol' ? 'Petrol' : 'Diesel'} – ${sn}`;
    const row = {
        id: crypto.randomUUID(),
        item_name: name,
        category: 'Fuel',
        unit: 'Ltr',
        current_stock: 0,
        store_id: storeId,
        fuel_type: fuelType,
        store_location: sn
    };
    
    await safeUpsert('inventory_items', row);
    
    await writeAudit('item', row.id, 'create', `Auto-created fuel tank: ${name}`);
    allItems.push(row);
    return row;
}

async function insertLog(payload, geo) {
    const base = {
        ...payload,
        id: crypto.randomUUID(),
        created_by_email: currentUser?.email,
        created_by_name: displayName(),
        latitude: geo?.latitude,
        longitude: geo?.longitude,
        geo_label: geo?.geo_label,
        operator_uid: currentUser?.id
    };
    await safeUpsert('inventory_logs', base);
    await writeAudit('log', base.id, 'create', `${payload.txn_type} ${payload.quantity} – ${payload.purpose || payload.txn_subtype || ''}`, base, geo);
    return base;
}

// --- Data Fetching ---
async function loadAllData() {
    try {
        const { data: st, error: stErr } = await fetchWithTimeout(
            supabase.from('inventory_stores').select('*').eq('is_active', true).order('sort_order'),
            6000
        );
        if (stErr) { v2TablesOk = false; stores = []; }
        else stores = st || [];
    } catch { v2TablesOk = false; stores = []; }

    if (v2TablesOk) {
        try {
            const [{ data: pm }, { data: eq }] = await Promise.all([
                fetchWithTimeout(supabase.from('inventory_fuel_pumps').select('*').eq('is_active', true).order('name'), 5000),
                fetchWithTimeout(supabase.from('inventory_equipment').select('*, inventory_stores(name)').eq('is_active', true).order('name'), 5000)
            ]);
            pumps = pm || [];
            equipment = eq || [];
        } catch { pumps = []; equipment = []; }
    }

    let allItemsTemp = [];
    let offset = 0;
    while(true) {
        const { data, error } = await fetchWithTimeout(
            supabase.from('inventory_items').select('*').order('item_name', { ascending: true }).range(offset, offset + 999),
            8000
        );
        if (error) throw error;
        if (!data || data.length === 0) break;
        allItemsTemp = allItemsTemp.concat(data);
        if (data.length < 1000) break;
        offset += 1000;
    }
    allItems = allItemsTemp;
}

async function refreshInventory() {
    await loadAllData();
    renderStoreChips();
    renderStats();
    updateFilterCounts();
    filterAndSearch();
    populateSelects();
}

const loadInventoryItems = refreshInventory;

// --- Rendering ---
function renderStats() {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('stat-total', allItems.length);
    set('stat-stores', stores.length || '—');
    set('stat-zero', allItems.filter(i => Number(i.current_stock) <= 0).length);
    
    const fuelItems = allItems.filter(i => i.category === 'Fuel');
    const totalFuelLiters = fuelItems.reduce((sum, i) => sum + Number(i.current_stock || 0), 0);
    set('stat-fuel', `${totalFuelLiters.toLocaleString()} L`);
}

function getBaseFilteredItems() {
    let list = allItems;
    if (selectedStoreId) list = list.filter(i => i.store_id === selectedStoreId);
    
    const q = ($('search-inventory')?.value || '').toLowerCase();
    if (q) {
        list = list.filter(i =>
            (i.item_name || '').toLowerCase().includes(q) ||
            (i.store_location || '').toLowerCase().includes(q) ||
            (i.unit || '').toLowerCase().includes(q) ||
            (i.description || '').toLowerCase().includes(q) ||
            (i.category || '').toLowerCase().includes(q) ||
            storeName(i.store_id).toLowerCase().includes(q)
        );
    }
    return list;
}

function updateFilterCounts() {
    const list = getBaseFilteredItems();
    const counts = { 'All': list.length, 'Fuel': 0, 'Consumable': 0, 'Asset': 0, 'WKV': 0 };
    
    list.forEach(i => {
        if (counts[i.category] !== undefined) counts[i.category]++;
    });
    
    $$('.filter-btn').forEach(btn => {
        const cat = btn.getAttribute('data-cat');
        const badge = btn.querySelector('.count-badge');
        if (badge) badge.textContent = counts[cat] || 0;
    });
}

function resetCategoryFilter() {
    activeCategory = 'All'; 
    $$('.filter-btn').forEach(b => {
        const isAll = b.getAttribute('data-cat') === 'All';
        b.className = `filter-btn px-3 py-2 rounded-lg text-xs font-bold border transition ${isAll ? 'bg-slate-800 text-white shadow-sm border-slate-800 active' : 'bg-white text-slate-600 border-slate-200'}`;
        const badge = b.querySelector('.count-badge');
        if (badge) {
            badge.className = `count-badge ml-1 px-1.5 py-0.5 rounded text-[9px] ${isAll ? 'bg-white/20' : 'bg-slate-100'}`;
        }
    });
}

function renderStoreChips() {
    const wrap = $('store-chips');
    if (!wrap) return;
    const chips = [{ id: '', name: 'All stores' }, ...stores.map(s => ({ id: s.id, name: s.short_code || s.name }))];
    
    if (wrap.children.length === chips.length) {
        Array.from(wrap.children).forEach((btn, i) => {
            const c = chips[i];
            btn.setAttribute('data-store', c.id);
            btn.textContent = c.name;
            const active = (selectedStoreId || '') === c.id;
            btn.className = `store-chip shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`;
        });
        return;
    }

    wrap.innerHTML = chips.map(c => {
        const active = (selectedStoreId || '') === c.id;
        return `<button type="button" data-store="${c.id}" class="store-chip shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}">${c.name}</button>`;
    }).join('');
    
    if (!wrap.dataset.listener) {
        wrap.addEventListener('click', (e) => {
            const btn = e.target.closest('.store-chip');
            if (!btn) return;
            selectedStoreId = btn.getAttribute('data-store') || null;
            resetCategoryFilter();
            renderStoreChips();
            filterAndSearch();
        });
        wrap.dataset.listener = 'true';
    }
}

function getActiveCategory() { return activeCategory; }

function getFilteredItems() {
    let list = getBaseFilteredItems();
    const cat = getActiveCategory();
    if (cat !== 'All') list = list.filter(i => i.category === cat);
    return list;
}

function catBadge(cat) {
    const map = { Fuel: 'bg-amber-100 text-amber-800', WKV: 'bg-purple-100 text-purple-800', Consumable: 'bg-emerald-100 text-emerald-800', Asset: 'bg-blue-100 text-blue-800' };
    return map[cat] || 'bg-slate-100 text-slate-700';
}

function renderItemCards(items) {
    const grid = $('item-cards');
    if (!grid) return;
    if (!items.length) {
        grid.innerHTML = '<p class="col-span-full text-center text-slate-400 py-12 font-semibold">No items in this view. Try another store or add a new item.</p>';
        return;
    }
    
    grid.innerHTML = items.map(item => {
        const stock = Number(item.current_stock);
        const minStock = Number(item.min_stock || 20);
        const isZero = stock <= 0;
        const isLow = stock > 0 && stock <= minStock; 

        let statusColors = 'text-emerald-600 bg-emerald-50 border-emerald-100';
        let statusDot = '🟢';
        if (isZero) {
            statusColors = 'text-rose-600 bg-rose-50 border-rose-200 alert-pulse';
            statusDot = '🔴';
        } else if (isLow) {
            statusColors = 'text-amber-600 bg-amber-50 border-amber-200';
            statusDot = '🟡';
        }

        const loc = item.store_id ? storeName(item.store_id) : (item.store_location || '—');
        
        return `<button type="button" data-item-id="${item.id}" class="item-card text-left glass-panel rounded-2xl p-4 border transition active:scale-[0.98] ${isZero ? 'border-rose-400 shadow-[0_0_15px_rgba(225,29,72,0.15)]' : 'border-slate-100 hover:border-indigo-300'}">
          ${item.photo_url ? `<img src="${item.photo_url}" alt="" class="w-full h-24 object-cover rounded-xl mb-2 bg-slate-100" onerror="this.classList.add('hidden')">` : ''}
          
          <div class="flex justify-between items-start mb-1">
            <div class="text-[10px] font-bold uppercase ${catBadge(item.category)} inline-block px-2 py-0.5 rounded">${item.category}</div>
            <div class="text-[10px] font-black px-1.5 py-0.5 rounded border ${statusColors}">${statusDot} ${isZero ? 'OUT OF STOCK' : (isLow ? 'LOW STOCK' : 'IN STOCK')}</div>
          </div>
          
          <div class="font-black text-slate-800 leading-snug text-lg">${escapeHTML(item.item_name)}</div>
          <div class="text-xs text-slate-500 mt-1 truncate">📍 ${escapeHTML(loc)}</div>
          
          <div class="mt-4 flex justify-between items-end">
            <span class="text-xs text-slate-400 font-bold uppercase tracking-wider">${item.unit}</span>
            <span class="text-2xl font-black ${isZero ? 'text-rose-600' : 'text-slate-800'} tabular-nums leading-none">${stock.toLocaleString()}</span>
          </div>
        </button>`;
    }).join('');
    
    $$('.item-card').forEach(card => card.addEventListener('click', () => openItemDetail(card.getAttribute('data-item-id'))));

    const tbody = $('inventory-list');
    if (tbody) {
        tbody.innerHTML = items.map(item => `<tr class="cursor-pointer hover:bg-indigo-50" data-item-id="${item.id}">
          <td class="px-3 py-2 font-bold">${escapeHTML(item.item_name)}</td>
          <td class="px-2 py-2"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${catBadge(item.category)}">${item.category}</span></td>
          <td class="px-2 py-2 text-slate-500">${escapeHTML(item.store_id ? storeName(item.store_id) : item.store_location || '—')}</td>
          <td class="px-2 py-2 text-right font-black">${Number(item.current_stock).toLocaleString()}</td>
        </tr>`).join('');
        $$('#inventory-list tr').forEach(tr => tr.addEventListener('click', () => openItemDetail(tr.getAttribute('data-item-id'))));
    }
}

function filterAndSearch() { 
    updateFilterCounts();
    renderItemCards(getFilteredItems()); 
}

function setupFilters() {
    $$('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clicked = e.currentTarget;
            activeCategory = clicked.getAttribute('data-cat') || 'All';
            $$('.filter-btn').forEach(b => {
                b.classList.remove('bg-slate-800', 'text-white', 'shadow-sm', 'border-slate-800');
                b.classList.add('bg-white', 'text-slate-600', 'border-slate-200');
                const badge = b.querySelector('.count-badge');
                if (badge) { badge.classList.remove('bg-white/20'); badge.classList.add('bg-slate-100'); }
            });
            clicked.classList.remove('bg-white', 'text-slate-600', 'border-slate-200');
            clicked.classList.add('bg-slate-800', 'text-white', 'shadow-sm', 'border-slate-800');
            const clickedBadge = clicked.querySelector('.count-badge');
            if (clickedBadge) { clickedBadge.classList.add('bg-white/20'); clickedBadge.classList.remove('bg-slate-100'); }
            
            filterAndSearch();
        });
    });
}

function setupSearch() { $('search-inventory')?.addEventListener('input', filterAndSearch); }

function populateSelects() {
    const storeOpts = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    ['ni-store', 'ff-to-store', 'ff-from-store', 'ff-to-store-t', 'ff-store-consume', 'new-eq-store', 'mi-global-store', 'txn-to-store', 'qt-to-store'].forEach(id => {
        const el = $(id);
        if (el) {
            if(id === 'mi-global-store') el.innerHTML = `<option value="">-- No specific store --</option>` + storeOpts;
            else if(id === 'txn-to-store' || id === 'qt-to-store') el.innerHTML = `<option value="">-- Select Destination Store --</option>` + storeOpts;
            else el.innerHTML = storeOpts || '<option value="">No stores — run SQL migration</option>';
        }
    });
    
    const pumpEl = $('ff-pump');
    if (pumpEl) pumpEl.innerHTML = pumps.map(p => `<option value="${p.id}">${p.name}</option>`).join('') || '<option value="">Add pumps in setup</option>';
    
    const qt = $('qt-item');
    if (qt) qt.innerHTML = allItems.map(i => `<option value="${i.id}">${escapeHTML(i.item_name)} (${Number(i.current_stock)} ${escapeHTML(i.unit)}) - ${escapeHTML(i.store_location || 'No Store')}</option>`).join('');
    
    refreshEquipmentSelect();
}

function refreshEquipmentSelect(fuelType) {
    const el = $('ff-equipment');
    if (!el) return;
    let list = equipment;
    if (fuelType) list = list.filter(e => e.fuel_type === fuelType);
    el.innerHTML = list.map(e => `<option value="${e.id}">${e.name} (${e.fuel_type})</option>`).join('') || '<option value="">Add equipment in setup</option>';
}

// --- Shared Utility ---
function parseDateFlexible(dStr) {
    if(!dStr) return null;
    let s = String(dStr).trim().split(' ')[0];
    
    if (/^\d{4,5}$/.test(s)) {
        let serial = parseInt(s);
        let offset = serial >= 60 ? 25569 : 25568; 
        const jsDate = new Date(Math.round((serial - offset) * 86400 * 1000));
        return jsDate.toISOString().split('T')[0];
    }
    
    let p = s.replace(/\//g, '.').replace(/-/g, '.').split('.');
    if (p.length === 3) {
        let y = p[2], m = p[1], d = p[0];
        if(p[0].length === 4) { y = p[0]; m = p[1]; d = p[2]; }
        if(y.length === 2) y = '20' + y;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
}

// --- Item Details ---
async function openItemDetail(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    currentItem = item;
    
    $('detail-title').textContent = item.item_name;
    
    let body = $('detail-body');
    const newBody = body.cloneNode(false);
    body.parentNode.replaceChild(newBody, body);
    body = newBody;
    
    body.innerHTML = '<p class="text-slate-400 text-center py-8">Loading history…</p>';
    openModal('detail-modal');

    const [{ data: logs }, { data: audits }] = await Promise.all([
        supabase.from('inventory_logs').select('*').eq('item_id', itemId).order('log_date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
        v2TablesOk ? supabase.from('inventory_audit').select('*').eq('entity_id', itemId).order('created_at', { ascending: false }).limit(20) : Promise.resolve({ data: [] })
    ]);

    const loc = item.store_id ? storeName(item.store_id) : (item.store_location || '—');
    let html = `
      <div class="grid grid-cols-2 gap-3">
        <div class="bg-slate-50 rounded-xl p-3"><div class="text-[10px] font-bold text-slate-400 uppercase">In stock</div><div class="text-2xl font-black text-indigo-600">${Number(item.current_stock).toLocaleString()} ${item.unit}</div></div>
        <div class="bg-slate-50 rounded-xl p-3"><div class="text-[10px] font-bold text-slate-400 uppercase">Store</div><div class="text-sm font-bold text-slate-800">${loc}</div></div>
      </div>
      ${item.photo_url ? `<img src="${item.photo_url}" class="w-full max-h-48 object-contain rounded-xl border bg-slate-50" alt="">` : ''}
      ${item.description ? `<p class="text-sm text-slate-600">${item.description}</p>` : ''}
      
      <div class="flex flex-wrap gap-2 staff-only role-hidden hidden">
        <button type="button" id="detail-in" class="flex-1 min-w-[120px] py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black">Receive IN</button>
        <button type="button" id="detail-out" class="flex-1 min-w-[120px] py-2.5 bg-rose-500 text-white rounded-xl text-xs font-black">Issue OUT</button>
        <button type="button" id="detail-transfer" class="flex-1 min-w-[120px] py-2.5 bg-amber-500 text-white rounded-xl text-xs font-black">Transfer</button>
      </div>
      
      ${isAdmin() ? `<div class="admin-only role-hidden hidden border-t pt-3 mt-3">
        <div class="mb-3">
            <label class="text-[10px] font-bold text-slate-500 uppercase">Change Store Location</label>
            <div class="flex gap-2 mt-1">
                <select id="detail-store-select" class="flex-grow p-2 border rounded-lg text-xs font-bold text-slate-700 bg-slate-50">
                    <option value="">-- No specific store --</option>
                    ${stores.map(s => `<option value="${s.id}" ${item.store_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
                </select>
                <button type="button" id="detail-save-store" class="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black">Update</button>
            </div>
        </div>
        <div>
            <label class="text-[10px] font-bold text-slate-500 uppercase">Photo URL</label>
            <div class="flex gap-2 mt-1">
                <input id="detail-photo-url" type="url" value="${item.photo_url || ''}" class="flex-grow p-2 border rounded-lg text-xs">
                <button type="button" id="detail-save-photo" class="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black">Save</button>
            </div>
        </div>
        <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
            <button type="button" id="detail-delete-item" class="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-black transition shadow-sm">
                🗑️ Delete Entire Item
            </button>
        </div>
      </div>` : ''}
      
      <h4 class="font-black text-slate-700 text-sm mt-4">Transaction history</h4>
      <div class="space-y-2 max-h-64 overflow-y-auto custom-scroll">`;

    (logs || []).forEach(log => {
        const pump = pumps.find(p => p.id === log.pump_id);
        const eq = equipment.find(e => e.id === log.equipment_id);
        const who = log.created_by_name || log.created_by_email || '—';
        const when = log.created_at ? new Date(log.created_at).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' }) : log.log_date;
        const canEdit = canEditLog(log);
        
        let descHtml = log.purpose ? log.purpose : '';
        if (log.notes) descHtml += ` <span class="text-slate-400 italic">(${log.notes})</span>`;
        if (!descHtml) descHtml = log.txn_subtype || '—';

        html += `<div class="border rounded-xl p-3 text-xs ${log.txn_type === 'IN' ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/50'}">
          <div class="flex justify-between gap-2">
            <span class="font-black ${log.txn_type === 'IN' ? 'text-emerald-700' : 'text-rose-700'}">${log.txn_type} ${Number(log.quantity).toLocaleString()}</span>
            <span class="text-slate-500">${log.log_date}</span>
          </div>
          <p class="text-slate-600 mt-1">${descHtml}</p>
          ${pump ? `<p>⛽ Pump: <b>${pump.name}</b></p>` : ''}
          ${eq ? `<p>🔧 Equipment: <b>${eq.name}</b></p>` : ''}
          ${log.from_store_id || log.to_store_id ? `<p>↔ ${log.from_store_id ? 'From ' + storeName(log.from_store_id) : ''} ${log.to_store_id ? '→ ' + storeName(log.to_store_id) : ''}</p>` : ''}
          <p class="text-slate-400 mt-1">By ${who} · ${when}${log.geo_label ? ' · 📍 ' + log.geo_label : ''}</p>
          ${log.modified_by_email ? `<p class="text-amber-700">Edited by ${log.modified_by_name || log.modified_by_email}</p>` : ''}
          ${canEdit ? `<button type="button" class="edit-log-btn mt-2 text-indigo-600 font-bold" data-log-id="${log.id}">Edit</button>` : ''}
        </div>`;
    });
    
    if (!logs?.length) html += '<p class="text-slate-400 italic">No transactions yet.</p>';
    html += '</div>';

    if (audits?.length) {
        html += '<h4 class="font-black text-slate-700 text-sm mt-4">Change log</h4><ul class="text-xs space-y-1 text-slate-500">';
        audits.forEach(a => {
            html += `<li>${new Date(a.created_at).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' })} — <b>${a.user_name || a.user_email}</b>: ${a.summary}</li>`;
        });
        html += '</ul>';
    }

    body.innerHTML = html;
    
    body.addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        if (btn.id === 'detail-in') { closeModal('detail-modal'); openTxnModal('IN'); }
        if (btn.id === 'detail-out') { closeModal('detail-modal'); openTxnModal('OUT'); }
        if (btn.id === 'detail-transfer') { closeModal('detail-modal'); openTxnModal('TRANSFER'); }
        if (btn.classList.contains('edit-log-btn')) { closeModal('detail-modal'); editTxn(btn.getAttribute('data-log-id')); }
        
        if (btn.id === 'detail-save-store') {
            const newStoreId = $('detail-store-select').value || null;
            const newStoreLoc = newStoreId ? storeName(newStoreId) : null;
            const geo = await captureGeo();
            
            const updatePayload = {
                id: item.id,
                store_id: newStoreId, 
                store_location: newStoreLoc,
                updated_at: new Date().toISOString(), 
                updated_by_email: currentUser.email 
            };
            await safeUpsert('inventory_items', updatePayload);
            
            await writeAudit('item', item.id, 'update', `Store updated to ${newStoreLoc || 'None'}`, { store_id: newStoreId }, geo);
            showToast('Store updated!');
            await refreshInventory();
            openItemDetail(item.id);
        }

        if (btn.id === 'detail-save-photo') {
            const url = $('detail-photo-url').value.trim();
            const geo = await captureGeo();
            
            const updatePayload = {
                id: item.id,
                photo_url: url || null,
                updated_at: new Date().toISOString(), 
                updated_by_email: currentUser.email 
            };
            await safeUpsert('inventory_items', updatePayload);
            
            await writeAudit('item', item.id, 'update', 'Photo URL updated', { photo_url: url }, geo);
            showToast('Photo saved');
            await refreshInventory();
            openItemDetail(item.id);
        }
        
        if (btn.id === 'detail-delete-item') {
            if (!navigator.onLine) return showToast('❌ Cannot delete items while offline', 'error');
            if (!confirm(`⚠️ DANGER: Are you sure you want to permanently delete "${item.item_name}"? \n\nThis will also delete ALL transaction history for this item. This cannot be undone.`)) return;
            btn.textContent = "Deleting...";
            btn.disabled = true;
            try {
                const geo = await captureGeo();
                const { error } = await supabase.from('inventory_items').delete().eq('id', item.id);
                if (error) throw error;
                await writeAudit('item', item.id, 'delete', `Deleted item: ${item.item_name}`, item, geo);
                showToast(`${item.item_name} has been deleted.`);
                closeModal('detail-modal');
                await refreshInventory(); 
            } catch (err) {
                showToast(err.message, 'error');
                btn.textContent = "🗑️ Delete Entire Item";
                btn.disabled = false;
            }
        }
    });
    
    if (userRole === 'admin') body.querySelectorAll('.admin-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
    if (['admin', 'staff'].includes(userRole)) body.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
}

// --- Modals & Transactions ---
window.openTxnModal = function (type) {
    if (!currentItem) return showToast('Select an item first', 'warning');
    openModal('txn-modal');
    $('txn-item-id').value = currentItem.id;
    $('txn-type').value = type;
    $('txn-log-id').value = '';
    $('txn-unit').textContent = currentItem.unit;
    $('txn-date').value = todayNPT();
    
    ['txn-qty', 'txn-purpose', 'txn-notes', 'txn-req', 'txn-app', 'txn-ref', 'txn-location', 'txn-to-store'].forEach(id => {
        const el = $(id); if (el) el.value = '';
    });
    
    const banner = $('txn-stock-banner');
    const stockEl = $('txn-current-stock');
    if (banner && stockEl) {
        stockEl.textContent = `${Number(currentItem.current_stock).toLocaleString()} ${currentItem.unit}`;
        banner.classList.remove('hidden');
    }
    
    $('txn-delete-btn')?.classList.add('hidden');
    const t = $('txn-title'), h = $('txn-header'), b = $('txn-submit');
    const inF = $('in-fields'), outF = $('out-fields'), transF = $('transfer-fields'), locCont = $('txn-location-container');
    
    t.textContent = `${type === 'IN' ? 'Receive' : type === 'OUT' ? 'Issue' : 'Transfer'}: ${currentItem.item_name}`;
    
    if (type === 'IN') {
        h.className = 'px-5 py-3 border-b bg-emerald-50 flex justify-between items-center';
        b.className = 'flex-[2] py-3 bg-emerald-600 text-white font-black rounded-xl';
        b.textContent = 'Save – Add stock';
        inF?.classList.remove('hidden'); outF?.classList.add('hidden'); transF?.classList.add('hidden');
    } else if (type === 'OUT') {
        h.className = 'px-5 py-3 border-b bg-rose-50 flex justify-between items-center';
        b.className = 'flex-[2] py-3 bg-rose-600 text-white font-black rounded-xl';
        b.textContent = 'Save – Remove stock';
        inF?.classList.add('hidden'); outF?.classList.remove('hidden'); transF?.classList.add('hidden');
        locCont?.classList.remove('hidden');
    } else if (type === 'TRANSFER') {
        h.className = 'px-5 py-3 border-b bg-amber-50 flex justify-between items-center';
        b.className = 'flex-[2] py-3 bg-amber-600 text-white font-black rounded-xl';
        b.textContent = 'Save – Transfer stock';
        inF?.classList.add('hidden'); outF?.classList.remove('hidden'); transF?.classList.remove('hidden');
        locCont?.classList.add('hidden');
    }
};

window.openFuelTxnModal = async function (type, itemName) {
    await refreshInventory();
    const item = allItems.find(i => i.item_name.toLowerCase() === itemName.toLowerCase());
    if (!item) return showToast('Item not found', 'warning');
    currentItem = item;
    openTxnModal(type);
};

window.editTxn = async function (logId) {
    try {
        const { data: log, error } = await supabase.from('inventory_logs').select('*, inventory_items(item_name, unit, current_stock)').eq('id', logId).single();
        if (error) throw error;
        if (!canEditLog(log)) return showToast('You can only edit your own entries', 'error');
        
        currentItem = { id: log.item_id, item_name: log.inventory_items.item_name, current_stock: log.inventory_items.current_stock, unit: log.inventory_items.unit };
        openModal('txn-modal');
        
        $('txn-item-id').value = log.item_id;
        $('txn-type').value = log.txn_type;
        $('txn-log-id').value = log.id;
        $('txn-date').value = log.log_date;
        $('txn-qty').value = log.quantity;
        if ($('txn-location')) $('txn-location').value = log.used_location || '';
        if ($('txn-purpose')) $('txn-purpose').value = log.purpose || '';
        if ($('txn-notes')) $('txn-notes').value = log.notes || '';
        if ($('txn-ref')) $('txn-ref').value = log.reference_no || '';
        if ($('txn-req')) $('txn-req').value = log.requested_by || '';
        if ($('txn-app')) $('txn-app').value = log.approved_by || '';
        
        $('txn-delete-btn')?.classList.remove('hidden');
        $('txn-title').textContent = `Edit: ${currentItem.item_name}`;
    } catch (e) { showToast(e.message, 'error'); }
};

window.deleteTxn = async function (logId) {
    if (!navigator.onLine) return showToast('❌ Cannot delete logs while offline', 'error');
    if (!confirm('Delete this transaction? Stock will adjust automatically.')) return;
    const { data: log } = await supabase.from('inventory_logs').select('*').eq('id', logId).single();
    if (!canEditLog(log)) return showToast('You can only delete your own entries', 'error');
    try {
        const geo = await captureGeo();
        const { error } = await supabase.from('inventory_logs').delete().eq('id', logId);
        if (error) throw error;
        await writeAudit('log', logId, 'delete', `Deleted ${log.txn_type} ${log.quantity}`, log, geo);
        showToast('Deleted');
        closeModal('txn-modal');
        await refreshInventory();
        if (currentItem) openItemDetail(currentItem.id);
        if (!$('report-modal')?.classList.contains('hidden')) {
            $('fr-generate-btn')?.click();
        }
    } catch (e) { showToast(e.message, 'error'); }
};

// Global Toggles
window.openNewItemModal = () => openModal('item-modal');
window.openFuelImportModal = () => {
    openModal('fuel-import-modal');
    $('fi-setup-section')?.classList.remove('hidden');
    $('fi-review-section')?.classList.add('hidden');
    $('fi-review-section')?.classList.remove('flex');
};
window.openMaterialsImportModal = () => {
    openModal('materials-import-modal');
    $('mi-setup-section')?.classList.remove('hidden');
    $('mi-review-section')?.classList.add('hidden');
    $('mi-review-section')?.classList.remove('flex');
};

window.openReportModal = (category = 'Fuel') => {
    $('report-category').value = category;
    openModal('report-modal');
};

window.openQuickTxn = async () => {
    if (!currentUser) return showToast('Please sign in first', 'warning');
    await refreshInventory();
    populateSelects();
    $('qt-date').value = todayNPT();
    openModal('quick-txn-modal');
};

// --- Setup Form Events ---
function setupFuelFlowModal() {
    $('btn-fuel-flow')?.addEventListener('click', () => {
        $('ff-date').value = todayNPT();
        populateSelects();
        openModal('fuel-flow-modal');
    });
    
    const subtype = $('ff-subtype');
    const toggle = () => {
        const v = subtype?.value;
        $('ff-purchase-fields')?.classList.toggle('hidden', v !== 'purchase');
        $('ff-transfer-fields')?.classList.toggle('hidden', v !== 'transfer');
        $('ff-consume-fields')?.classList.toggle('hidden', v !== 'consumption');
    };
    
    subtype?.addEventListener('change', toggle);
    $('ff-fuel-type')?.addEventListener('change', (e) => refreshEquipmentSelect(e.target.value));
    toggle();

    $('fuel-flow-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = e.target.querySelector('button[type="submit"]');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving...';
        
        const geo = await captureGeo();
        const subtypeVal = $('ff-subtype').value;
        const fuelType = $('ff-fuel-type').value;
        const date = $('ff-date').value;
        const qty = parseFloat($('ff-qty').value);
        const notes = $('ff-notes').value;
        
        try {
            if (subtypeVal === 'purchase') {
                const storeId = $('ff-to-store').value;
                const pumpId = $('ff-pump').value;
                const tank = await ensureFuelTank(storeId, fuelType);
                const pump = pumps.find(p => p.id === pumpId);
                await insertLog({
                    item_id: tank.id, log_date: date, txn_type: 'IN', quantity: qty,
                    txn_subtype: 'purchase', pump_id: pumpId || null, to_store_id: storeId,
                    purpose: `Purchase${pump ? ' at ' + pump.name : ''}${notes ? ' – ' + notes : ''}`,
                    reference_no: notes || null,
                    notes: notes || null
                }, geo);
            } else if (subtypeVal === 'transfer') {
                const fromId = $('ff-from-store').value;
                const toId = $('ff-to-store-t').value;
                const fromTank = await ensureFuelTank(fromId, fuelType);
                
                if (Number(fromTank.current_stock) < qty) {
                    if (!confirm(`Transfer exceeds available stock in ${fromTank.item_name}. Continue anyway?`)) {
                        btn.disabled = false; btn.textContent = origText; return;
                    }
                }
                
                const toTank = await ensureFuelTank(toId, fuelType);
                await insertLog({
                    item_id: fromTank.id, log_date: date, txn_type: 'OUT', quantity: qty,
                    txn_subtype: 'transfer', from_store_id: fromId, to_store_id: toId,
                    purpose: `Transfer to ${storeName(toId)}${notes ? ' – ' + notes : ''}`
                }, geo);
                await insertLog({
                    item_id: toTank.id, log_date: date, txn_type: 'IN', quantity: qty,
                    txn_subtype: 'transfer', from_store_id: fromId, to_store_id: toId,
                    purpose: `Transfer from ${storeName(fromId)}${notes ? ' – ' + notes : ''}`
                }, geo);
            } else {
                const storeId = $('ff-store-consume').value;
                const eqId = $('ff-equipment').value;
                const tank = await ensureFuelTank(storeId, fuelType);
                
                if (Number(tank.current_stock) < qty) {
                    if (!confirm(`Consumption exceeds available stock in ${tank.item_name}. Continue anyway?`)) {
                        btn.disabled = false; btn.textContent = origText; return;
                    }
                }
                
                const eq = equipment.find(x => x.id === eqId);
                await insertLog({
                    item_id: tank.id, log_date: date, txn_type: 'OUT', quantity: qty,
                    txn_subtype: 'consumption', equipment_id: eqId || null, used_location: storeName(storeId),
                    purpose: eq ? `Used on ${eq.name}` : (notes || 'Consumption'),
                    notes: notes || null
                }, geo);
            }
            showToast('Fuel entry saved');
            closeModal('fuel-flow-modal');
            await refreshInventory();
            e.target.reset();
        } catch (err) { 
            showToast(err.message, 'error'); 
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
        }
    });
}

function setupAdminSetup() {
    $('btn-admin-setup')?.addEventListener('click', () => {
        renderSetupLists();
        openModal('admin-setup-modal');
    });
    
    $$('.setup-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const t = tab.getAttribute('data-tab');
            $$('.setup-tab').forEach(x => x.classList.remove('bg-slate-100', 'text-indigo-700'));
            tab.classList.add('bg-slate-100', 'text-indigo-700');
            ['stores', 'pumps', 'equipment'].forEach(p => {
                $(`setup-panel-${p}`)?.classList.toggle('hidden', p !== t);
            });
        });
    });
    
    $('form-add-store')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isAdmin()) return;
        const name = $('new-store-name').value.trim();
        const geo = await captureGeo();
        const row = { id: crypto.randomUUID(), name, created_by_email: currentUser.email, is_temporary: true };
        await safeUpsert('inventory_stores', row);
        await writeAudit('store', row.id, 'create', `Store added: ${name}`, null, geo);
        $('new-store-name').value = '';
        await refreshInventory();
        renderSetupLists();
    });
    
    $('form-add-pump')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isAdmin()) return;
        const name = $('new-pump-name').value.trim();
        const row = { id: crypto.randomUUID(), name };
        await safeUpsert('inventory_fuel_pumps', row);
        await writeAudit('pump', row.id, 'create', `Pump added: ${name}`);
        $('new-pump-name').value = '';
        await loadAllData();
        populateSelects();
        renderSetupLists();
    });
    
    $('form-add-equipment')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isAdmin()) return;
        const name = $('new-eq-name').value.trim();
        const fuel_type = $('new-eq-fuel').value;
        const store_id = $('new-eq-store').value || null;
        const row = { id: crypto.randomUUID(), name, fuel_type, store_id };
        await safeUpsert('inventory_equipment', row);
        await writeAudit('equipment', row.id, 'create', `Equipment: ${name}`);
        $('new-eq-name').value = '';
        await loadAllData();
        populateSelects();
        renderSetupLists();
    });
}

function renderSetupLists() {
    const sl = $('setup-store-list');
    if (sl) sl.innerHTML = stores.map(s => `<li class="flex justify-between border-b py-2"><span>${s.name}${s.is_temporary ? ' <span class="text-amber-600 text-[10px]">(temp)</span>' : ''}</span>${isAdmin() ? `<button type="button" class="text-rose-600 text-[10px] font-bold del-store" data-id="${s.id}">Remove</button>` : ''}</li>`).join('');
    
    sl?.querySelectorAll('.del-store').forEach(btn => btn.addEventListener('click', async () => {
        if (!navigator.onLine) return showToast('❌ Cannot deactivate store while offline', 'error');
        if (!confirm('Deactivate this store?')) return;
        await supabase.from('inventory_stores').update({ is_active: false }).eq('id', btn.getAttribute('data-id'));
        await refreshInventory();
        renderSetupLists();
    }));
    
    const pumpList = $('setup-pump-list');
    if (pumpList) pumpList.innerHTML = pumps.map(p => `<li class="border-b py-2">${p.name}</li>`).join('');
    
    const eqList = $('setup-equipment-list');
    if (eqList) eqList.innerHTML = equipment.map(e => `<li class="border-b py-2">${e.name} <span class="text-slate-400">(${e.fuel_type})</span></li>`).join('');
}

function setupForms() {
    $('header-quick-entry')?.addEventListener('click', () => openQuickTxn().catch(e => showToast(e.message, 'error')));
    $('mobile-quick-entry')?.addEventListener('click', () => openQuickTxn().catch(e => showToast(e.message, 'error')));

    $('txn-delete-btn')?.addEventListener('click', () => {
        const logId = $('txn-log-id').value;
        if (logId) deleteTxn(logId);
    });

    $('txn-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('txn-submit');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            const logIdToEdit = $('txn-log-id').value;
            let oldLog = null;
            if (logIdToEdit) {
                if (!navigator.onLine) throw new Error('Cannot edit existing transactions while offline.');
                const { data } = await supabase.from('inventory_logs').select('*').eq('id', logIdToEdit).single();
                oldLog = data;
                if (!canEditLog(oldLog)) throw new Error('You can only edit your own entries');
            }
            const type = $('txn-type').value;
            const qty = parseFloat($('txn-qty').value);
            
            let checkStock = Number(currentItem.current_stock);
            if (oldLog && oldLog.txn_type === 'OUT') checkStock += Number(oldLog.quantity);
            if (oldLog && oldLog.txn_type === 'IN') checkStock -= Number(oldLog.quantity);
            
            if ((type === 'OUT' || type === 'TRANSFER') && qty > checkStock && !confirm('Issue more than adjusted stock?')) {
                return;
            }

            const geo = await captureGeo();
            if (logIdToEdit && oldLog) {
                await supabase.from('inventory_logs').delete().eq('id', logIdToEdit);
                await writeAudit('log', logIdToEdit, 'delete', 'Replaced during edit', oldLog, geo);
            }
            
            if (type === 'TRANSFER') {
                const toStoreId = $('txn-to-store').value;
                if (!toStoreId) throw new Error("Please select a destination store.");
                if (toStoreId === currentItem.store_id) throw new Error("Cannot transfer to the same store.");
                
                let destItem = allItems.find(i => i.item_name.toLowerCase() === currentItem.item_name.toLowerCase() && i.store_id === toStoreId);
                
                if (!destItem) {
                    const newRow = {
                        id: crypto.randomUUID(),
                        item_name: currentItem.item_name, category: currentItem.category, unit: currentItem.unit,
                        current_stock: 0, store_id: toStoreId, store_location: storeName(toStoreId)
                    };
                    await safeUpsert('inventory_items', newRow);
                    destItem = newRow;
                    allItems.push(newRow);
                }

                await insertLog({
                    item_id: currentItem.id, log_date: $('txn-date').value, txn_type: 'OUT', txn_subtype: 'transfer', quantity: qty, to_store_id: toStoreId,
                    purpose: $('txn-purpose')?.value || `Transfer to ${storeName(toStoreId)}`, notes: $('txn-notes')?.value || null, requested_by: $('txn-req')?.value || null, approved_by: $('txn-app')?.value || null
                }, geo);

                await insertLog({
                    item_id: destItem.id, log_date: $('txn-date').value, txn_type: 'IN', txn_subtype: 'transfer', quantity: qty, from_store_id: currentItem.store_id,
                    purpose: $('txn-purpose')?.value || `Transfer from ${storeName(currentItem.store_id)}`, notes: $('txn-notes')?.value || null, requested_by: $('txn-req')?.value || null, approved_by: $('txn-app')?.value || null
                }, geo);
            } else {
                await insertLog({
                    item_id: $('txn-item-id').value, log_date: $('txn-date').value, txn_type: type, quantity: qty, used_location: $('txn-location')?.value || null,
                    purpose: $('txn-purpose')?.value || null, notes: $('txn-notes')?.value || null, reference_no: $('txn-ref')?.value || null, requested_by: $('txn-req')?.value || null, approved_by: $('txn-app')?.value || null
                }, geo);
            }
            
            showToast('Saved');
            closeModal('txn-modal');
            await refreshInventory();
            if (currentItem) openItemDetail(currentItem.id);
        } catch (err) { showToast(err.message, 'error'); }
        finally { btn.textContent = orig; btn.disabled = false; }
    });
    
    $('ni-cat')?.addEventListener('change', (e) => {
        $('ni-fuel-type-container')?.classList.toggle('hidden', e.target.value !== 'Fuel');
    });

    $('new-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = e.target.querySelector('button[type="submit"]');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving... Please wait';
        btn.classList.add('opacity-70', 'cursor-not-allowed');

        try {
            const storeId = $('ni-store')?.value || null;
            const sn = storeId ? storeName(storeId) : null;
            const category = $('ni-cat').value;
            const row = {
                id: crypto.randomUUID(),
                item_name: $('ni-name').value,
                category: category,
                unit: $('ni-unit').value,
                current_stock: 0,
                store_id: storeId || null,
                store_location: sn,
                photo_url: $('ni-photo')?.value || null,
                fuel_type: category === 'Fuel' ? $('ni-fuel-type').value : null
            };
            await safeUpsert('inventory_items', row);
            const geo = await captureGeo();
            await writeAudit('item', row.id, 'create', `Item created: ${row.item_name}`, row, geo);
            showToast('Item created successfully');
            closeModal('item-modal');
            await refreshInventory();
            e.target.reset();
            $('ni-fuel-type-container')?.classList.add('hidden');
        } catch (err) { 
            showToast(err.message, 'error'); 
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
            btn.classList.remove('opacity-70', 'cursor-not-allowed');
        }
    });

    $$('.qt-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.qt-type-btn').forEach(b => {
                b.classList.remove('bg-emerald-500', 'bg-rose-500', 'text-white');
                b.classList.add('bg-slate-200', 'text-slate-600');
            });
            const t = btn.getAttribute('data-qt');
            $('qt-type').value = t;
            btn.classList.remove('bg-slate-200', 'text-slate-600');
            btn.classList.add(t === 'IN' ? 'bg-emerald-500' : 'bg-rose-500', 'text-white');
        });
    });
    
    $('quick-txn-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const btn = e.target.querySelector('button[type="submit"]');
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving...';
        
        const itemId = $('qt-item').value;
        currentItem = allItems.find(i => i.id === itemId);
        try {
            const geo = await captureGeo();
            await insertLog({
                item_id: itemId,
                log_date: $('qt-date').value,
                txn_type: $('qt-type').value,
                quantity: parseFloat($('qt-qty').value),
                purpose: $('qt-purpose').value || null
            }, geo);
            showToast('Entry saved');
            closeModal('quick-txn-modal');
            await refreshInventory();
            e.target.reset();
        } catch (err) { showToast(err.message, 'error'); }
        finally { btn.disabled = false; btn.textContent = origText; }
    });
}

// --- EXCEL EXPORT ---
window.exportReportToExcel = function() {
    const container = document.getElementById('fr-generated-tables');
    if (!container || container.classList.contains('hidden') || container.innerHTML === '') {
        return showToast('Generate a report first before exporting.', 'warning');
    }

    try {
        showToast('Preparing Excel file...', 'success');
        const wb = XLSX.utils.book_new();
        const cat = document.getElementById('report-category').value;
        const start = document.getElementById('fr-start').value;
        const end = document.getElementById('fr-end').value;
        
        const tables = container.querySelectorAll('.report-table');
        
        tables.forEach((table, index) => {
            let sheetName = index === tables.length - 1 ? "Overall Summary" : `Ledger ${index + 1}`;
            const header = table.closest('.bg-white').querySelector('h4');
            let title = header ? header.textContent : `${cat} Ledger`;
            if (header && index !== tables.length - 1) {
                sheetName = title.replace('Consumption Ledger: ', '').substring(0, 31);
            }
            
            const wsData = [
                [ `Makari Gad 10MW - ${title}` ],
                [ `Period: ${start} to ${end}` ],
                [ `Generated on: ${new Date().toLocaleString()}` ],
                []
            ];
            
            const tempSheet = XLSX.utils.table_to_sheet(table);
            const sheetData = XLSX.utils.sheet_to_json(tempSheet, { header: 1 });
            wsData.push(...sheetData);
            
            const finalWs = XLSX.utils.aoa_to_sheet(wsData);
            XLSX.utils.book_append_sheet(wb, finalWs, sheetName);
        });

        const fileName = `MakariGad_${cat}_Report_${start}_to_${end}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
    } catch (err) {
        showToast('Error exporting to Excel: ' + err.message, 'error');
    }
};

window.downloadReportPDF = function() {
    const container = document.getElementById('fr-generated-tables');
    if (!container || container.classList.contains('hidden') || container.innerHTML === '') {
        return showToast('Generate a report first before exporting.', 'warning');
    }

    try {
        showToast('Preparing PDF file...', 'success');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape', 'pt', 'a4');
        const cat = document.getElementById('report-category').value;
        const start = document.getElementById('fr-start').value;
        const end = document.getElementById('fr-end').value;

        const tables = container.querySelectorAll('.report-table');
        
        tables.forEach((table, index) => {
            if (index > 0) doc.addPage();
            
            const headerEl = table.closest('.bg-white').querySelector('h4');
            let title = headerEl ? headerEl.textContent : `${cat} Ledger`;
            
            doc.setFont("helvetica", "bold");
            doc.setFontSize(14);
            doc.text(`Makari Gad 10MW - ${title}`, 40, 40);
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text(`Period: ${start} to ${end}`, 40, 55);
            doc.text(`Generated on: ${new Date().toLocaleString()}`, 40, 70);

            doc.autoTable({
                html: table,
                startY: 85,
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 3 },
                headStyles: { fillColor: [79, 70, 229], textColor: [255, 255, 255] },
                footStyles: { fillColor: [226, 232, 240], textColor: [15, 23, 42], fontStyle: 'bold' },
                margin: { top: 85, right: 40, bottom: 40, left: 40 }
            });
        });

        doc.save(`MakariGad_${cat}_Report_${start}_to_${end}.pdf`);
    } catch (err) {
        showToast('Error exporting to PDF: ' + err.message, 'error');
    }
}

// --- FUEL IMPORTER ---
function setupFuelImporter() {
    $('fi-wipe-btn')?.addEventListener('click', async () => {
        if(!confirm("DANGER: This will delete ALL Fuel Items and Logs from the database. Are you absolutely sure?")) return;
        try {
            const { data: fItems } = await supabase.from('inventory_items').select('id').eq('category', 'Fuel');
            if(fItems && fItems.length > 0) {
                const ids = fItems.map(i=>i.id);
                await supabase.from('inventory_logs').delete().in('item_id', ids);
                await supabase.from('inventory_items').delete().in('id', ids);
            }
            await supabase.from('inventory_items').insert([
                {item_name: 'Diesel - PH', category: 'Fuel', unit: 'Ltr', current_stock: 0, fuel_type: 'diesel', store_location: 'Powerhouse (PH)'},
                {item_name: 'Diesel - Ropeway', category: 'Fuel', unit: 'Ltr', current_stock: 0, fuel_type: 'diesel', store_location: 'Ropeway'},
                {item_name: 'Diesel - Dam', category: 'Fuel', unit: 'Ltr', current_stock: 0, fuel_type: 'diesel', store_location: 'Dam / Headworks'},
                {item_name: 'Petrol - PH', category: 'Fuel', unit: 'Ltr', current_stock: 0, fuel_type: 'petrol', store_location: 'Powerhouse (PH)'}
            ]);
            showToast('Fuel Data Wiped and Initialized!', 'success');
            await loadInventoryItems();
        } catch(e) { showToast(e.message, 'error'); }
    });

    $('fi-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const files = $('fi-file').files;
        if (!files.length) return showToast('Select file.', 'error');
        
        const btn = $('fi-submit-btn');
        btn.textContent = 'Reading Data...'; btn.disabled = true;
        fuelWorkbookSheets = [];

        const finishLoadingSheets = () => {
            if(fuelWorkbookSheets.length === 0) {
                btn.textContent = 'Read Fuel Data'; btn.disabled = false;
                return showToast('No fuel tables found in the uploaded file.', 'error');
            }
            supabase.from('inventory_items').select('id, item_name').eq('category', 'Fuel').then(({data}) => {
                fuelMasterIds = {};
                if(data) data.forEach(d => fuelMasterIds[d.item_name] = d.id);
                currentSheetIdx = 0;
                renderFuelSheet();
                btn.textContent = 'Read Fuel Data'; btn.disabled = false;
            });
        };

        const file0 = files[0];
        if (file0.name.endsWith('.xlsx') || file0.name.endsWith('.xls')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                    workbook.SheetNames.forEach(name => {
                        if (name.toLowerCase().includes('stock report') || name.toLowerCase().includes('summary')) return;
                        const data2D = XLSX.utils.sheet_to_json(workbook.Sheets[name], {header: 1, raw: false});
                        const parsed = parseFuelTables(data2D, name);
                        if (parsed.ph.length > 0 || parsed.ropeway.length > 0 || parsed.dam.length > 0 || parsed.petrol.length > 0 || parsed.generic.length > 0) {
                            fuelWorkbookSheets.push({ name: name, data: parsed });
                        }
                    });
                    finishLoadingSheets();
                } catch(err) { 
                    btn.textContent = 'Read Fuel Data'; btn.disabled = false;
                    showToast(`Excel Error: ${err.message}`, 'error'); 
                }
            };
            reader.readAsArrayBuffer(file0);
        }
    });

    function parseFuelTables(data2D, sheetName) {
        let result = { ph: [], ropeway: [], dam: [], petrol: [], generic: [] };
        let activeTable = null;
        let dateIdx=-1, descIdx=-1, recIdx=-1, issIdx=-1, reqIdx=-1, appIdx=-1, remIdx=-1;

        for (let r = 0; r < data2D.length; r++) {
            if (!data2D[r] || data2D[r].length === 0) continue;
            let rawRow = Array.from(data2D[r] || []).slice(0, 10).map(c => String(c||'').trim());
            let rowLower = rawRow.map(c => c.toLowerCase());
            let rowStr = rowLower.join(' ');

            if (rowStr.includes('diesel consumption details at ph')) { activeTable = 'ph'; dateIdx=-1; continue; }
            if (rowStr.includes('petrol consumption details at ph')) { activeTable = 'petrol'; dateIdx=-1; continue; }
            if (rowStr.includes('diesel consumption details at ropeway')) { activeTable = 'ropeway'; dateIdx=-1; continue; }
            if (rowStr.includes('diesel consumption details at dam')) { activeTable = 'dam'; dateIdx=-1; continue; }

            if (rowLower.includes('date') || rowLower.includes('date ')) {
                if (rowLower.includes('received') || rowLower.includes('issued')) {
                    if (!activeTable) activeTable = 'ph';

                    dateIdx = rowLower.findIndex(c => c === 'date' || c.startsWith('date'));
                    descIdx = rowLower.findIndex(c => c.includes('description') || c.includes('particulars'));
                    recIdx = rowLower.findIndex(c => c.includes('received') || c.includes('purchased'));
                    issIdx = rowLower.findIndex(c => c.includes('issued') || c.includes('consumed'));
                    reqIdx = rowLower.findIndex(c => c.includes('requested'));
                    appIdx = rowLower.findIndex(c => c.includes('approved'));
                    remIdx = rowLower.findIndex(c => c.includes('remak') || c.includes('remark'));
                    continue;
                }
            }

            if (activeTable && dateIdx > -1) {
                let dateStr = rawRow[dateIdx] || '';
                let desc = descIdx > -1 ? (rawRow[descIdx] || '') : '';
                let remarks = remIdx > -1 ? (rawRow[remIdx] || '') : '';
                
                if (dateStr.toLowerCase().includes('total') || desc.toLowerCase().includes('total') || rowStr.includes('total shifted diesel')) {
                    continue; 
                }

                if (dateStr.match(/\d{1,4}[\.\-\/]\d{1,2}[\.\-\/]\d{1,4}/) || (!isNaN(Date.parse(dateStr)) && dateStr.length > 5) || /^\d{4,5}$/.test(dateStr.trim())) {
                    let recStr = recIdx > -1 && rawRow[recIdx] ? rawRow[recIdx].toString() : '';
                    let issStr = issIdx > -1 && rawRow[issIdx] ? rawRow[issIdx].toString() : '';
                    let rec = parseFloat(recStr.replace(/,/g,'')) || 0;
                    let iss = parseFloat(issStr.replace(/,/g,'')) || 0;
                    
                    let req = reqIdx > -1 ? rawRow[reqIdx] : '';
                    let app = appIdx > -1 ? rawRow[appIdx] : '';
                    let isOpening = desc.toLowerCase().includes('opening stock');
                    
                    if (rec > 0 || iss > 0) {
                        const fType = activeTable === 'petrol' ? 'Petrol - PH' : (activeTable === 'ropeway' ? 'Diesel - Ropeway' : (activeTable === 'dam' ? 'Diesel - Dam' : 'Diesel - PH'));
                        
                        let parsedDate;
                        if (!isNaN(Date.parse(dateStr)) && dateStr.length > 10 && dateStr.includes(':00:00')) {
                            let dObj = new Date(dateStr);
                            parsedDate = dObj.toISOString().split('T')[0];
                        } else {
                            parsedDate = parseDateFlexible(dateStr);
                        }
                        
                        if (!parsedDate) continue;

                        result[activeTable].push({
                            id: Math.random().toString(36).substring(2, 11),
                            date: parsedDate, rawDate: dateStr, desc: desc,
                            rec: rec, iss: iss, req: req, app: app, rem: remarks, isOpening: isOpening,
                            item_name: fType
                        });
                    }
                }
            }
        }
        return result;
    }

    async function renderFuelSheet() {
        if(currentSheetIdx >= fuelWorkbookSheets.length) {
            showToast('All sheets processed successfully!'); window.closeModal('fuel-import-modal'); loadInventoryItems(); return;
        }
        $('fi-setup-section').classList.add('hidden');
        $('fi-review-section').classList.remove('hidden');
        $('fi-review-section').classList.add('flex');
        
        const sheet = fuelWorkbookSheets[currentSheetIdx];
        $('fi-sheet-title').textContent = `Sheet: ${sheet.name}`;
        $('fi-sheet-progress').textContent = `File ${currentSheetIdx + 1} of ${fuelWorkbookSheets.length}`;
        $('fi-is-opening').checked = false; 

        let existingSigCounts = new Map();
        let allSheetLogs = [...sheet.data.ph, ...sheet.data.ropeway, ...sheet.data.dam, ...sheet.data.petrol, ...sheet.data.generic];
        let validDates = allSheetLogs.map(l => l.date).filter(Boolean).sort();
        
        if (validDates.length > 0) {
            const minD = validDates[0], maxD = validDates[validDates.length - 1];
            try {
                let offset = 0;
                while(true) {
                    const { data: exLogs, error } = await supabase.from('inventory_logs')
                        .select('log_date, txn_type, quantity, purpose')
                        .gte('log_date', minD).lte('log_date', maxD)
                        .range(offset, offset + 999);
                        
                    if (error || !exLogs || exLogs.length === 0) break;
                    
                    exLogs.forEach((l) => {
                        let descPart = l.purpose ? String(l.purpose).toLowerCase().trim() : '';
                        let sig = `${l.log_date}_${l.txn_type}_${Number(l.quantity)}_${descPart}`;
                        existingSigCounts.set(sig, (existingSigCounts.get(sig) || 0) + 1);
                    });
                    
                    if (exLogs.length < 1000) break;
                    offset += 1000;
                }
            } catch(e) { console.error(e); }
        }

        const checkDupe = (r) => {
            const type = r.rec > 0 ? 'IN' : 'OUT';
            const qty = r.rec || r.iss;
            const descPart = r.desc ? String(r.desc).toLowerCase().trim() : '';
            const strictSig = `${r.date}_${type}_${qty}_${descPart}`;
            
            let availableInDb = existingSigCounts.get(strictSig) || 0;
            
            if (availableInDb > 0) { 
                r.isDupe = true; 
                existingSigCounts.set(strictSig, availableInDb - 1); 
            } else { 
                r.isDupe = false; 
            }
        };
        sheet.data.ph.forEach(checkDupe); sheet.data.ropeway.forEach(checkDupe); sheet.data.dam.forEach(checkDupe); sheet.data.petrol.forEach(checkDupe); sheet.data.generic.forEach(checkDupe);

        const container = $('fi-tables-container');
        const fuelItems = allItems.filter(i => i.category === 'Fuel');

        const buildTableHTML = (defaultTitle, data, internalKey) => {
            if(data.length === 0) return '';
            const fuelOptions = fuelItems.map(i => `<option value="${i.id}" ${i.item_name === defaultTitle ? 'selected' : ''}>${i.item_name}</option>`).join('');
            const storeOptions = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');

            let html = `
            <div class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col min-h-[250px] mb-4">
                <div class="bg-slate-100 px-3 py-3 font-black text-xs text-indigo-900 border-b border-slate-200 flex flex-col gap-3">
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-2 w-full">
                            <span class="w-16">Tank:</span>
                            <select class="import-tank-select flex-grow text-xs font-bold border border-slate-300 rounded px-2 py-1.5 bg-white text-indigo-700" data-key="${internalKey}">
                                ${fuelOptions}
                                <option value="CREATE_NEW" class="text-indigo-600">+ Create New Tank</option>
                            </select>
                        </div>
                    </div>
                    <div class="flex justify-between items-center">
                        <div class="flex items-center gap-2 w-full pr-4">
                            <span class="w-16">Store:</span>
                            <select class="import-store-select flex-grow text-xs font-bold border border-slate-300 rounded px-2 py-1.5 bg-white text-slate-700" data-key="${internalKey}">
                                <option value="">-- No specific store --</option>
                                ${storeOptions}
                            </select>
                        </div>
                        <label class="cursor-pointer font-bold text-[9px] text-slate-500 flex items-center gap-1 shrink-0"><input type="checkbox" class="toggle-all" checked> Check All</label>
                    </div>
                </div>
                <div class="overflow-y-auto flex-grow custom-scroll">
                <table class="w-full text-left text-[10px] whitespace-nowrap">
                    <thead class="bg-slate-50 sticky top-0 shadow-sm text-slate-500 uppercase font-bold text-[9px]">
                        <tr><th class="px-2 py-1">Inc</th><th class="px-2 py-1">Date</th><th class="px-2 py-1 w-full">Description</th><th class="px-2 py-1 text-right text-emerald-600">IN</th><th class="px-2 py-1 text-right text-rose-600">OUT</th></tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">`;
            
            data.forEach(r => {
                const isOp = r.isOpening ? "is-opening opacity-60 italic " : "";
                const isDup = r.isDupe ? "bg-amber-50" : "";
                const badge = r.isDupe ? `<span class="ml-1 text-[7px] bg-amber-200 text-amber-800 px-1 rounded">Skip (Exists)</span>` : '';
                const checkedStr = r.isDupe ? '' : 'checked';
                
                html += `<tr class="${isOp} ${isDup} hover:bg-slate-50 transition"><td class="px-2 py-1 border-r border-slate-100"><input type="checkbox" class="row-cb accent-indigo-600" data-id="${r.id}" ${checkedStr}></td><td class="px-2 py-1">${r.rawDate}</td><td class="px-2 py-1 truncate max-w-[120px]" title="${r.desc}">${r.desc} ${badge}</td><td class="px-2 py-1 text-right font-bold">${r.rec || ''}</td><td class="px-2 py-1 text-right font-bold">${r.iss || ''}</td></tr>`;
            });
            html += `</tbody></table></div></div>`;
            return html;
        };

        container.innerHTML = [
            buildTableHTML('Diesel - PH', sheet.data.ph, 'ph'),
            buildTableHTML('Petrol - PH', sheet.data.petrol, 'petrol'),
            buildTableHTML('Diesel - Ropeway', sheet.data.ropeway, 'ropeway'),
            buildTableHTML('Diesel - Dam', sheet.data.dam, 'dam'),
            buildTableHTML('Diesel - PH', sheet.data.generic, 'generic')
        ].join('');

        container.querySelectorAll('.import-tank-select').forEach(sel => {
            sel.addEventListener('change', async (e) => {
                if (e.target.value === 'CREATE_NEW') {
                    const newName = prompt("Enter name for the new Fuel Tank (e.g., 'Diesel - Camp'):");
                    if (newName) {
                        try {
                            const newRow = {
                                id: crypto.randomUUID(),
                                item_name: newName,
                                category: 'Fuel',
                                unit: 'Ltr',
                                current_stock: 0,
                                fuel_type: newName.toLowerCase().includes('petrol') ? 'petrol' : 'diesel'
                            };
                            await safeUpsert('inventory_items', newRow);
                            allItems.push(newRow);
                            showToast(`New tank "${newName}" created!`);
                            const newOptions = allItems.filter(i => i.category === 'Fuel').map(i => `<option value="${i.id}" ${i.id === newRow.id ? 'selected' : ''}>${i.item_name}</option>`).join('');
                            e.target.innerHTML = newOptions + `<option value="CREATE_NEW" class="text-indigo-600">+ Create New Tank</option>`;
                        } catch(err) {
                            showToast("Error creating tank: " + err.message, 'error');
                            e.target.value = e.target.options[0].value;
                        }
                    } else {
                        e.target.value = e.target.options[0].value;
                    }
                }
            });
        });

        const checkBtn = $('fi-is-opening');
        checkBtn.replaceWith(checkBtn.cloneNode(true)); 
        $('fi-is-opening').addEventListener('change', (e) => {
            $$('.is-opening').forEach(row => {
                if(e.target.checked) row.classList.remove('opacity-60', 'italic');
                else row.classList.add('opacity-60', 'italic');
            });
        });

        $$('.toggle-all').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const table = e.target.closest('.bg-white').querySelector('table');
                table.querySelectorAll('.row-cb').forEach(rcb => {
                    const isOp = rcb.closest('tr').classList.contains('is-opening');
                    const showOp = $('fi-is-opening').checked;
                    if(!isOp || showOp) rcb.checked = e.target.checked;
                });
            });
        });
    }

    $('fi-skip-btn')?.addEventListener('click', () => { currentSheetIdx++; renderFuelSheet(); });
    
    $('fi-save-btn')?.addEventListener('click', async (e) => {
        const btn = e.target; btn.disabled = true; btn.textContent = 'Saving...';
        try {
            const { data: u } = await supabase.auth.getUser();
            const sheet = fuelWorkbookSheets[currentSheetIdx];
            const includeOpening = $('fi-is-opening').checked;
            
            const selectedIds = new Set();
            $$('.row-cb:checked').forEach(cb => selectedIds.add(cb.getAttribute('data-id')));

            let payloads = [];
            const processGroup = (dataArray, internalKey) => {
                if(dataArray.length === 0) return;
                const selectTankEl = document.querySelector(`.import-tank-select[data-key="${internalKey}"]`);
                const selectStoreEl = document.querySelector(`.import-store-select[data-key="${internalKey}"]`);
                
                if (!selectTankEl) return;
                const itemId = selectTankEl.value;
                const storeId = selectStoreEl ? selectStoreEl.value : null;
                const storeLoc = storeId ? storeName(storeId) : null;
                
                if (!itemId && dataArray.some(row => selectedIds.has(row.id))) {
                    throw new Error(`Please select a destination tank for all imported tables.`);
                }
                if(!itemId) return;

                dataArray.forEach(row => {
                    if(!selectedIds.has(row.id)) return; 
                    if(row.isOpening && !includeOpening) return;
                    
                    if(row.rec > 0) payloads.push({ item_id: itemId, to_store_id: storeId || null, log_date: row.date, txn_type: 'IN', quantity: row.rec, purpose: row.desc, requested_by: row.req, approved_by: row.app, notes: row.rem, operator_uid: u.user.id });
                    if(row.iss > 0) payloads.push({ item_id: itemId, used_location: storeLoc || null, log_date: row.date, txn_type: 'OUT', quantity: row.iss, purpose: row.desc, requested_by: row.req, approved_by: row.app, notes: row.rem, operator_uid: u.user.id });
                });
            };

            processGroup(sheet.data.ph, 'ph');
            processGroup(sheet.data.petrol, 'petrol');
            processGroup(sheet.data.ropeway, 'ropeway');
            processGroup(sheet.data.dam, 'dam');
            processGroup(sheet.data.generic, 'generic');

            if(payloads.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < payloads.length; i += chunkSize) {
                    const chunk = payloads.slice(i, i + chunkSize);
                    await safeUpsert('inventory_logs', chunk);
                }
            }
            showToast(`${sheet.name} Saved!`);
            currentSheetIdx++; renderFuelSheet();
        } catch(err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = 'Save Checked & Next'; }
    });
}

// --- MATERIALS IMPORTER ---
function setupMaterialsImporter() {
    $('mi-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const files = $('mi-file').files;
        if (!files.length) return showToast('Select file.', 'error');
        
        const btn = $('mi-submit-btn');
        btn.textContent = 'Reading Data...'; btn.disabled = true;
        materialsWorkbookData = [];

        const file0 = files[0];
        if (file0.name.endsWith('.xlsx') || file0.name.endsWith('.xls')) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                    
                    let sumSheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('list') || n.toLowerCase().includes('summary'));
                    if(!sumSheetName) sumSheetName = workbook.SheetNames[0]; 
                    
                    let summaryData = XLSX.utils.sheet_to_json(workbook.Sheets[sumSheetName], {header: 1});
                    let items = [];
                    
                    let headerIdx = summaryData.findIndex(row => row && row.some(c => c && String(c).toLowerCase().includes('description')));
                    if (headerIdx === -1) headerIdx = 0;

                    for (let i = headerIdx + 1; i < summaryData.length; i++) {
                        let row = summaryData[i];
                        if(!row || !row.length) continue;
                        let sn = parseInt(row[0]);
                        let name = row[1];
                        let unit = row[2];
                        
                        if (!isNaN(sn) && name) {
                            items.push({ sn, name: String(name).trim(), unit: String(unit || 'nos').trim(), txns: [] });
                        }
                    }

                    workbook.SheetNames.forEach(sheetName => {
                        let sn = parseInt(sheetName.trim());
                        if (isNaN(sn)) return;
                        let item = items.find(x => x.sn === sn);
                        if (!item) return;

                        let sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {header: 1, raw: false});
                        item.txns = extractMaterialsTxns(sheetData);
                    });

                    materialsWorkbookData = items.filter(i => i.txns.length > 0);
                    
                    if(materialsWorkbookData.length === 0) {
                        throw new Error('No valid transactions found for any listed items.');
                    }
                    
                    renderMaterialsReviewTable();
                } catch(err) { 
                    showToast(`Excel Error: ${err.message}`, 'error'); 
                } finally {
                    btn.textContent = 'Read Materials Data'; btn.disabled = false;
                }
            };
            reader.readAsArrayBuffer(file0);
        } else {
             showToast('Please upload the Excel workbook.', 'error');
             btn.textContent = 'Read Materials Data'; btn.disabled = false;
        }
    });

    function extractMaterialsTxns(data2D) {
        let txns = [];
        let headerFound = false;
        let cols = {};

        for (let i=0; i<data2D.length; i++) {
            if(!data2D[i]) continue;
            let row = Array.from(data2D[i] || []).map(c => String(c||'').trim().toLowerCase());
            
            if (!headerFound && row.some(c => c && c.includes('date')) && (row.some(c => c && c.includes('received')) || row.some(c => c && c.includes('issued')))) {
                headerFound = true;
                cols.date = row.findIndex(c => c && (c === 'date' || c.includes('date ')));
                cols.desc = row.findIndex(c => c && c.includes('description'));
                cols.rec = row.findIndex(c => c && c.includes('received'));
                cols.iss = row.findIndex(c => c && c.includes('issued'));
                cols.ret = row.findIndex(c => c && c.includes('return'));
                cols.bill = row.findIndex(c => c && (c.includes('gate pass') || c.includes('bill')));
                continue;
            }
            if (headerFound && cols.date > -1) {
                let dStr = data2D[i][cols.date];
                if (!dStr) continue;
                let date = parseDateFlexible(dStr);
                if (!date) continue;

                let desc = cols.desc > -1 ? String(data2D[i][cols.desc] || '').trim() : '';
                if(desc.toLowerCase().includes('total') || desc.toLowerCase().includes('balance')) continue;

                let recStr = cols.rec > -1 ? String(data2D[i][cols.rec] || '') : '';
                let issStr = cols.iss > -1 ? String(data2D[i][cols.iss] || '') : '';
                let retStr = cols.ret > -1 ? String(data2D[i][cols.ret] || '') : '';

                let rec = parseFloat(recStr.replace(/,/g,'')) || 0;
                let iss = parseFloat(issStr.replace(/,/g,'')) || 0;
                let ret = parseFloat(retStr.replace(/,/g,'')) || 0;

                let bill = cols.bill > -1 ? String(data2D[i][cols.bill] || '') : '';

                if (rec > 0 || iss > 0 || ret > 0) {
                    txns.push({ date, rawDate: dStr, desc, rec, iss, ret, bill });
                }
            }
        }
        return txns;
    }

    function renderMaterialsReviewTable() {
        $('mi-setup-section').classList.add('hidden');
        $('mi-review-section').classList.remove('hidden');
        $('mi-review-section').classList.add('flex');
        
        $('mi-progress').textContent = `Found ${materialsWorkbookData.length} items with data`;
        
        let html = '';
        materialsWorkbookData.forEach(item => {
            html += `<tr class="hover:bg-slate-50 transition border-b border-slate-100">
                <td class="px-3 py-2"><input type="checkbox" class="mat-row-cb accent-indigo-600 w-3.5 h-3.5" data-sn="${item.sn}" checked></td>
                <td class="px-3 py-2 font-bold text-slate-500">${item.sn}</td>
                <td class="px-3 py-2 truncate max-w-[200px] font-bold" title="${item.name.replace(/"/g, '&quot;')}">${item.name}</td>
                <td class="px-3 py-2 text-slate-500">${item.unit}</td>
                <td class="px-3 py-2 font-black text-indigo-600 text-center">${item.txns.length}</td>
                <td class="px-3 py-2">
                    <select class="mat-store-select border border-slate-300 rounded p-1 text-[10px] w-full" data-sn="${item.sn}">
                        <option value="">-- No specific store --</option>
                        ${stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
                    </select>
                </td>
                <td class="px-3 py-2">
                    <select class="mat-cat-select border border-slate-300 rounded p-1 text-[10px] w-full" data-sn="${item.sn}">
                        <option value="Consumable" selected>Consumable</option>
                        <option value="Asset">Asset</option>
                        <option value="WKV">WKV</option>
                    </select>
                </td>
            </tr>`;
        });
        
        $('mi-tbody').innerHTML = html;

        $('mi-toggle-all').addEventListener('change', (e) => {
            document.querySelectorAll('.mat-row-cb').forEach(cb => cb.checked = e.target.checked);
        });

        $('mi-apply-global').addEventListener('click', () => {
            const gStore = $('mi-global-store').value;
            const gCat = $('mi-global-cat').value;
            document.querySelectorAll('.mat-store-select').forEach(s => s.value = gStore);
            document.querySelectorAll('.mat-cat-select').forEach(s => s.value = gCat);
        });
    }

    $('mi-save-btn')?.addEventListener('click', async (e) => {
        const btn = e.target; btn.disabled = true; btn.textContent = 'Saving...';
        try {
            const { data: u } = await supabase.auth.getUser();
            
            const selectedRows = Array.from(document.querySelectorAll('.mat-row-cb:checked'));
            if(selectedRows.length === 0) throw new Error("No items selected.");

            let payloads = [];

            const { data: existingItems } = await supabase.from('inventory_items').select('id, item_name, category');
            const itemsMap = new Map(existingItems.map(i => [i.item_name.toLowerCase(), i]));

            const dbItemIdsToFetch = Array.from(new Set(selectedRows.map(row => {
                const sn = parseInt(row.dataset.sn);
                const itemData = materialsWorkbookData.find(i => i.sn === sn);
                return itemsMap.get(itemData.name.toLowerCase())?.id;
            }).filter(Boolean)));

            const existingSigCounts = new Map();
            if (dbItemIdsToFetch.length > 0) {
                for (let i = 0; i < dbItemIdsToFetch.length; i += 50) {
                    const chunkIds = dbItemIdsToFetch.slice(i, i + 50);
                    let offset = 0;
                    while(true) {
                        const { data: exLogs, error } = await supabase.from('inventory_logs')
                            .select('item_id, log_date, txn_type, quantity, purpose')
                            .in('item_id', chunkIds)
                            .range(offset, offset + 999);

                        if (error || !exLogs || exLogs.length === 0) break;
                        exLogs.forEach(l => {
                            const descPart = l.purpose ? String(l.purpose).toLowerCase().trim() : '';
                            const sig = `${l.item_id}_${l.log_date}_${l.txn_type}_${Number(l.quantity)}_${descPart}`;
                            existingSigCounts.set(sig, (existingSigCounts.get(sig) || 0) + 1);
                        });
                        if (exLogs.length < 1000) break;
                        offset += 1000;
                    }
                }
            }

            for (const row of selectedRows) {
                const sn = parseInt(row.dataset.sn);
                const itemData = materialsWorkbookData.find(i => i.sn === sn);
                if(!itemData) continue;

                const storeSelect = document.querySelector(`.mat-store-select[data-sn="${sn}"]`);
                const storeId = storeSelect ? storeSelect.value : null;
                const storeLoc = storeId ? storeName(storeId) : null;
                const catSelect = document.querySelector(`.mat-cat-select[data-sn="${sn}"]`);
                const category = catSelect ? catSelect.value : 'Consumable';

                let dbItem = itemsMap.get(itemData.name.toLowerCase());
                
                if (!dbItem) {
                    const newItemObj = {
                        id: crypto.randomUUID(),
                        item_name: itemData.name,
                        category: category,
                        unit: itemData.unit,
                        current_stock: 0,
                        store_id: storeId || null,
                        store_location: storeLoc
                    };
                    await safeUpsert('inventory_items', newItemObj);
                    dbItem = newItemObj;
                    itemsMap.set(dbItem.item_name.toLowerCase(), dbItem);
                }

                itemData.txns.forEach(t => {
                    const descPart = t.desc ? String(t.desc).toLowerCase().trim() : '';
                    
                    if (t.rec > 0) {
                        const sig = `${dbItem.id}_${t.date}_IN_${t.rec}_${descPart}`;
                        const available = existingSigCounts.get(sig) || 0;
                        if(available > 0) {
                            existingSigCounts.set(sig, available - 1);
                        } else {
                            payloads.push({ item_id: dbItem.id, to_store_id: storeId || null, log_date: t.date, txn_type: 'IN', quantity: t.rec, purpose: t.desc, reference_no: t.bill, operator_uid: u.user.id });
                        }
                    }
                    if (t.ret > 0) {
                        const sig = `${dbItem.id}_${t.date}_IN_${t.ret}_${descPart}`;
                        const available = existingSigCounts.get(sig) || 0;
                        if(available > 0) {
                            existingSigCounts.set(sig, available - 1);
                        } else {
                            payloads.push({ item_id: dbItem.id, to_store_id: storeId || null, log_date: t.date, txn_type: 'IN', quantity: t.ret, purpose: `Return: ${t.desc}`, reference_no: t.bill, operator_uid: u.user.id });
                        }
                    }
                    if (t.iss > 0) {
                        const sig = `${dbItem.id}_${t.date}_OUT_${t.iss}_${descPart}`;
                        const available = existingSigCounts.get(sig) || 0;
                        if(available > 0) {
                            existingSigCounts.set(sig, available - 1);
                        } else {
                            payloads.push({ item_id: dbItem.id, used_location: storeLoc || null, log_date: t.date, txn_type: 'OUT', quantity: t.iss, purpose: t.desc, reference_no: t.bill, operator_uid: u.user.id });
                        }
                    }
                });
            }

            if(payloads.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < payloads.length; i += chunkSize) {
                    const chunk = payloads.slice(i, i + chunkSize);
                    await safeUpsert('inventory_logs', chunk);
                }
            }
            
            showToast(`Imported materials successfully!`);
            closeModal('materials-import-modal');
            await loadInventoryItems();
        } catch(err) {
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = '💾 Save Selected Materials';
        }
    });
}

// --- UNIFIED REPORTS ---
function setupReports() {
    const container = $('fr-generated-tables');
    container.addEventListener('click', (e) => {
        const txnBtn = e.target.closest('.report-txn-btn');
        if (txnBtn) openFuelTxnModal(txnBtn.dataset.type, txnBtn.dataset.item);
    });

    $('report-form').addEventListener('submit', async (e) => {
        if (e && e.isTrusted) {
            window.userOpeningOverrides = {};
        }
        if (e) e.preventDefault();
        
        const btn = $('fr-generate-btn');
        const start = $('fr-start').value;
        const end = $('fr-end').value;
        const reportCat = $('report-category').value;
        const emptyState = $('fr-empty-state');

        btn.innerHTML = '...'; btn.disabled = true;

        try {
            let filteredItems = allItems;
            if (reportCat === 'Fuel') {
                filteredItems = allItems.filter(i => i.category === 'Fuel');
            } else {
                filteredItems = allItems.filter(i => ['Consumable', 'Asset', 'WKV'].includes(i.category));
            }

            if(!filteredItems || filteredItems.length === 0) throw new Error(`No ${reportCat} items found in inventory.`);
            
            const idsMap = {}; 
            filteredItems.forEach(i => idsMap[i.item_name] = i.id);

            let allLogs = [];
            let offset = 0;
            while(true) {
                const { data, error } = await supabase.from('inventory_logs')
                    .select('id, item_id, log_date, txn_type, quantity, purpose, requested_by, approved_by, notes')
                    .in('item_id', Object.values(idsMap))
                    .order('log_date', { ascending: true })
                    .order('created_at', { ascending: true })
                    .range(offset, offset + 999);
                
                if (error) throw error;
                if (!data || data.length === 0) break;
                allLogs = allLogs.concat(data);
                if (data.length < 1000) break;
                offset += 1000;
            }

            const processItemData = (itemName) => {
                const itemLogs = allLogs.filter(l => l.item_id === idsMap[itemName]);
                let computedOpenBal = 0;
                let tableRows = [], totRec = 0, totIss = 0;
                
                itemLogs.forEach(log => {
                    if (log.log_date < start) {
                        if(log.txn_type === 'IN') computedOpenBal += Number(log.quantity);
                        else computedOpenBal -= Number(log.quantity);
                    }
                });
                
                let openBal = window.userOpeningOverrides[itemName] !== undefined ? window.userOpeningOverrides[itemName] : computedOpenBal;
                let currentBal = openBal;

                itemLogs.forEach(log => {
                    if (log.log_date >= start && log.log_date <= end) {
                        const q = Number(log.quantity);
                        if(log.txn_type === 'IN') { currentBal += q; totRec += q; }
                        else { currentBal -= q; totIss += q; }
                        tableRows.push({ id: log.id, date: log.log_date, desc: log.purpose, rec: log.txn_type==='IN'?q:null, iss: log.txn_type==='OUT'?q:null, bal: currentBal, req: log.requested_by, app: log.approved_by, rem: log.notes });
                    }
                });
                return { tableRows, openBal, currentBal, totRec, totIss };
            };

            const formatNum = (num) => num !== null && num !== undefined ? Number(num).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2}) : '';
            
            const buildHTML = (title, itemObj, data) => {
                const itemName = itemObj.item_name;
                const safeName = itemName.replace(/"/g, '&quot;');
                const unitStr = `(${itemObj.unit})`;
                
                let html = `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 break-inside-avoid">
                    <div class="flex justify-between items-center mb-3">
                        <h4 class="text-sm font-black text-indigo-900">${title}</h4>
                        <div class="flex gap-2 print-hide">
                            <button type="button" class="report-txn-btn px-2.5 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-[9px] font-bold shadow-sm transition" data-type="IN" data-item="${safeName}">+ IN</button>
                            <button type="button" class="report-txn-btn px-2.5 py-1 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded text-[9px] font-bold shadow-sm transition" data-type="OUT" data-item="${safeName}">+ OUT</button>
                        </div>
                    </div>
                    <div class="overflow-x-auto pb-2">
                        <table class="w-full text-left report-table">
                            <thead>
                                <tr>
                                    ${isAdmin() ? `<th class="w-20 text-center print-hide">Admin</th>` : ''}
                                    <th>No</th><th>Date</th><th class="w-full">Description</th><th class="text-right">Received ${unitStr}</th><th class="text-right">Issued ${unitStr}</th><th class="text-right">Balance ${unitStr}</th><th>Requested by</th><th>Approved by</th><th>Remarks</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    ${isAdmin() ? `<td class="print-hide"></td>` : ''}
                                    <td></td><td>${start}</td><td class="font-bold">Opening Stock</td>
                                    <td class="text-right font-bold text-indigo-600">
                                        <input type="number" step="any" value="${data.openBal}" data-tank="${safeName}" class="opening-override text-right w-20 border-b border-indigo-200 bg-transparent outline-none focus:border-indigo-600 print-hide" title="Edit Opening Stock">
                                        <span class="print-show">${formatNum(data.openBal)}</span>
                                    </td>
                                    <td></td><td class="text-right font-black">${formatNum(data.openBal)}</td><td></td><td></td><td></td>
                                </tr>`;
                
                data.tableRows.forEach((r, i) => {
                    html += `<tr class="hover:bg-slate-50 transition">
                        ${isAdmin() ? `
                        <td class="text-center w-20 print-hide">
                            <div class="flex items-center justify-center gap-1">
                                <button type="button" onclick="editTxn('${r.id}')" class="px-1.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 rounded transition font-bold text-[9px]">Edit</button>
                                <button type="button" onclick="deleteTxn('${r.id}')" class="px-1.5 py-1 bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 rounded transition font-bold text-[9px]">Del</button>
                            </div>
                        </td>` : ''}
                        <td>${i+1}</td><td>${r.date}</td><td>${r.desc}</td><td class="text-right text-emerald-600 font-bold">${formatNum(r.rec)}</td><td class="text-right text-rose-600 font-bold">${formatNum(r.iss)}</td><td class="text-right font-black">${formatNum(r.bal)}</td><td class="text-slate-500">${r.req || ''}</td><td class="text-slate-500">${r.app || ''}</td><td class="text-slate-500">${r.rem || ''}</td>
                    </tr>`;
                });
                
                html += `<tr class="total-row">
                    ${isAdmin() ? `<td class="print-hide"></td>` : ''}
                    <td colspan="3" class="text-center uppercase">Total</td>
                    <td class="text-right text-emerald-700">${formatNum(data.totRec)}</td>
                    <td class="text-right text-rose-700">${formatNum(data.totIss)}</td>
                    <td class="text-right text-indigo-900">${formatNum(data.openBal + data.totRec - data.totIss)}</td><td></td><td></td><td></td>
                </tr></tbody></table></div></div>`;
                return html;
            };

            let leftHtml = `<div class="w-full ${reportCat === 'Fuel' ? 'lg:w-2/3' : ''} space-y-6">`;
            let summaryRows = [];
            let grandOpen = 0, grandRec = 0, grandIss = 0, grandClose = 0;

            filteredItems.forEach(item => {
                const processed = processItemData(item.item_name);
                if (processed.tableRows.length > 0 || processed.openBal !== 0) {
                    leftHtml += buildHTML(`Consumption Ledger: ${item.item_name}`, item, processed);
                }
                summaryRows.push({
                    name: item.item_name,
                    unit: item.unit,
                    opening: processed.openBal,
                    received: processed.totRec,
                    consumed: processed.totIss,
                    closing: processed.currentBal
                });
                grandOpen += processed.openBal;
                grandRec += processed.totRec;
                grandIss += processed.totIss;
                grandClose += processed.currentBal;
            });
            leftHtml += `</div>`;

            let rightHtml = '';
            if (reportCat === 'Fuel') {
                rightHtml = `
                <div class="w-full lg:w-1/3 space-y-6 sticky top-0">
                    <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200 break-inside-avoid">
                        <h4 class="text-sm font-black text-indigo-900 mb-3">Overall Fuel Inventory</h4>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left report-table">
                                <thead>
                                    <tr><th>Tank Location</th><th class="text-right">Opening</th><th class="text-right">Received</th><th class="text-right">Consumed</th><th class="text-right">Closing</th></tr>
                                </thead>
                                <tbody>`;
                
                summaryRows.forEach(row => {
                    rightHtml += `
                        <tr>
                            <td class="font-bold whitespace-nowrap">${row.name}</td>
                            <td class="text-right text-indigo-600">${formatNum(row.opening)}</td>
                            <td class="text-right text-emerald-600">${formatNum(row.received)}</td>
                            <td class="text-right text-rose-600">${formatNum(row.consumed)}</td>
                            <td class="text-right font-black">${formatNum(row.closing)}</td>
                        </tr>`;
                });

                rightHtml += `
                                    <tr class="total-row">
                                        <td>GRAND TOTAL</td>
                                        <td class="text-right">${formatNum(grandOpen)}</td>
                                        <td class="text-right text-emerald-700">${formatNum(grandRec)}</td>
                                        <td class="text-right text-rose-700">${formatNum(grandIss)}</td>
                                        <td class="text-right text-indigo-900">${formatNum(grandClose)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>`;
            }

            emptyState.classList.add('hidden');
            container.innerHTML = `<div class="flex flex-col lg:flex-row items-start gap-6 w-full">` + leftHtml + rightHtml + `</div>`;
            container.classList.remove('hidden');

            container.querySelectorAll('.opening-override').forEach(input => {
                input.addEventListener('change', (evt) => {
                    const val = parseFloat(evt.target.value);
                    if (!isNaN(val)) {
                        window.userOpeningOverrides[evt.target.dataset.tank] = val;
                        $('report-form').dispatchEvent(new Event('submit'));
                    }
                });
            });

        } catch (err) { alert(`Report Error: ${err.message}`); } finally { btn.innerHTML = 'Generate'; btn.disabled = false; }
    });
}

// --- Initialization ---
async function startInventoryApp() {
    try {
        const session = await initializeApplication(true);
        if (!session?.user) {
            showToast('Please sign in to use inventory', 'warning');
            return;
        }

        currentUser = session.user;
        userRole = session.role || 'operator';

        const authContainer = document.getElementById('auth-user-info');
        if (authContainer && currentUser) {
            authContainer.classList.remove('hidden');
            authContainer.classList.add('flex');
            const name = currentUser?.user_metadata?.full_name || currentUser?.email?.split('@')[0] || 'User';
            document.getElementById('auth-name').textContent = name;
            document.getElementById('auth-role').textContent = userRole;
            document.getElementById('auth-avatar').textContent = name.charAt(0).toUpperCase();
            
            document.getElementById('btn-signout-static').addEventListener('click', async () => {
                await supabase.auth.signOut();
                window.location.reload();
            });
        }

        const [hRes, fRes] = await Promise.all([
            fetch('./components/header.html').catch(() => ({ok: false})),
            fetch('./components/footer.html').catch(() => ({ok: false}))
        ]);
        if (hRes.ok) { const hCont = document.getElementById('global-header-container'); if(hCont) hCont.innerHTML = await hRes.text(); }
        if (fRes.ok) { const fCont = document.getElementById('global-footer-container'); if(fCont) fCont.innerHTML = await fRes.text(); }
        initHeaderUI();

        if (userRole === 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
            document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
        } else if (userRole === 'staff') {
            document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
        }

        await refreshInventory();
        setupFilters();
        setupSearch();
        setupForms();
        setupFuelFlowModal();
        setupAdminSetup();
        setupFuelImporter();
        setupMaterialsImporter();
        setupReports();

        const frStart = document.getElementById('fr-start');
        if (frStart) frStart.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
        
        const frEnd = document.getElementById('fr-end');
        if (frEnd) frEnd.value = todayNPT();
        
    } catch (error) {
        console.error(error);
        showToast(error.message, 'error');
    }
}

startInventoryApp();