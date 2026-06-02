import { supabase, fetchWithTimeout, initHeaderUI, initializeApplication } from './core-app.js';

let allItems = [];
let stores = [];
let pumps = [];
let equipment = [];
let currentItem = null;
let selectedStoreId = null;
let currentUser = null;
let userRole = 'operator';
let v2TablesOk = true;

let fuelWorkbookSheets = [];
let currentSheetIdx = 0;
let fuelMasterIds = {};

const todayNPT = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });

function showToast(message, type = 'success') {
    let modal = document.getElementById('notification-modal');
    let msgEl = document.getElementById('notification-message');
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
    setTimeout(() => {
        modal.classList.remove('opacity-100', 'translate-y-0');
        modal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
    }, 3200);
}

window.closeModal = (id) => {
    const m = document.getElementById(id);
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

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
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
    });
}

async function writeAudit(entityType, entityId, action, summary, payload = null, geo = null) {
    if (!v2TablesOk) return;
    try {
        await supabase.from('inventory_audit').insert([{
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
        }]);
    } catch (e) { console.warn('[audit]', e.message); }
}

function storeName(storeId) {
    const s = stores.find(x => x.id === storeId);
    return s?.name || '—';
}

function getFuelTankItem(storeId, fuelType) {
    const label = fuelType === 'petrol' ? 'Petrol' : 'Diesel';
    const sn = storeName(storeId);
    return allItems.find(i =>
        i.category === 'Fuel' &&
        (i.store_id === storeId || (i.store_location && i.store_location.includes(sn))) &&
        (i.fuel_type === fuelType || i.item_name.toLowerCase().includes(fuelType))
    );
}

async function ensureFuelTank(storeId, fuelType) {
    let item = getFuelTankItem(storeId, fuelType);
    if (item) return item;
    const sn = storeName(storeId);
    const name = `${fuelType === 'petrol' ? 'Petrol' : 'Diesel'} – ${sn}`;
    const row = {
        item_name: name,
        category: 'Fuel',
        unit: 'Ltr',
        current_stock: 0,
        store_id: storeId,
        fuel_type: fuelType,
        store_location: sn
    };
    const { data, error } = await supabase.from('inventory_items').insert([row]).select().single();
    if (error) throw error;
    await writeAudit('item', data.id, 'create', `Auto-created fuel tank: ${name}`);
    allItems.push(data);
    return data;
}

async function insertLog(payload, geo) {
    const base = {
        ...payload,
        created_by_email: currentUser?.email,
        created_by_name: displayName(),
        latitude: geo?.latitude,
        longitude: geo?.longitude,
        geo_label: geo?.geo_label,
        operator_uid: currentUser?.id
    };
    const { data, error } = await supabase.from('inventory_logs').insert([base]).select().single();
    if (error) throw error;
    await writeAudit('log', data.id, 'create', `${payload.txn_type} ${payload.quantity} – ${payload.purpose || payload.txn_subtype || ''}`, base, geo);
    return data;
}

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

    const { data, error } = await fetchWithTimeout(
        supabase.from('inventory_items').select('*').order('item_name', { ascending: true }),
        8000
    );
    if (error) throw error;
    allItems = data || [];
}

async function refreshInventory() {
    await loadAllData();
    renderStoreChips();
    renderStats();
    filterAndSearch(getActiveCategory(), document.getElementById('search-inventory')?.value || '');
    populateSelects();
}

const loadInventoryItems = refreshInventory;

function renderStats() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-total', allItems.length);
    set('stat-stores', stores.length || '—');
    set('stat-zero', allItems.filter(i => Number(i.current_stock) <= 0).length);
    set('stat-fuel', allItems.filter(i => i.category === 'Fuel').length);
}

function renderStoreChips() {
    const wrap = document.getElementById('store-chips');
    if (!wrap) return;
    const chips = [{ id: '', name: 'All stores' }, ...stores.map(s => ({ id: s.id, name: s.short_code || s.name }))];
    wrap.innerHTML = chips.map(c => {
        const active = selectedStoreId === c.id;
        return `<button type="button" data-store="${c.id}" class="store-chip shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}">${c.name}</button>`;
    }).join('');
    wrap.querySelectorAll('.store-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedStoreId = btn.getAttribute('data-store') || null;
            renderStoreChips();
            filterAndSearch(getActiveCategory(), document.getElementById('search-inventory')?.value || '');
        });
    });
}

function getActiveCategory() {
    return document.querySelector('.filter-btn.bg-slate-800')?.getAttribute('data-cat') || 'All';
}

function getFilteredItems() {
    let list = allItems;
    if (selectedStoreId) list = list.filter(i => i.store_id === selectedStoreId);
    const cat = getActiveCategory();
    if (cat !== 'All') list = list.filter(i => i.category === cat);
    const q = (document.getElementById('search-inventory')?.value || '').toLowerCase();
    if (q) {
        list = list.filter(i =>
            i.item_name.toLowerCase().includes(q) ||
            (i.store_location || '').toLowerCase().includes(q) ||
            storeName(i.store_id).toLowerCase().includes(q)
        );
    }
    return list;
}

function catBadge(cat) {
    const map = { Fuel: 'bg-amber-100 text-amber-800', WKV: 'bg-purple-100 text-purple-800', Consumable: 'bg-emerald-100 text-emerald-800', Asset: 'bg-blue-100 text-blue-800' };
    return map[cat] || 'bg-slate-100 text-slate-700';
}

function renderItemCards(items) {
    const grid = document.getElementById('item-cards');
    if (!grid) return;
    if (!items.length) {
        grid.innerHTML = '<p class="col-span-full text-center text-slate-400 py-12 font-semibold">No items in this view. Try another store or add a new item.</p>';
        return;
    }
    grid.innerHTML = items.map(item => {
        const stock = Number(item.current_stock);
        const low = stock <= 0;
        const loc = item.store_id ? storeName(item.store_id) : (item.store_location || '—');
        return `<button type="button" data-item-id="${item.id}" class="item-card text-left glass-panel rounded-2xl p-4 border ${low ? 'border-rose-200' : 'border-slate-100'} hover:border-indigo-300 transition active:scale-[0.98]">
          ${item.photo_url ? `<img src="${item.photo_url}" alt="" class="w-full h-24 object-cover rounded-xl mb-2 bg-slate-100" onerror="this.classList.add('hidden')">` : ''}
          <div class="text-[10px] font-bold uppercase ${catBadge(item.category)} inline-block px-2 py-0.5 rounded mb-1">${item.category}</div>
          <div class="font-black text-slate-800 leading-snug">${item.item_name}</div>
          <div class="text-xs text-slate-500 mt-1 truncate">📍 ${loc}</div>
          <div class="mt-3 flex justify-between items-end">
            <span class="text-[10px] text-slate-400 font-semibold">${item.unit}</span>
            <span class="text-lg font-black ${low ? 'text-rose-600' : 'text-indigo-600'} tabular-nums">${stock.toLocaleString()}</span>
          </div>
          ${low ? '<div class="text-[10px] font-bold text-rose-500 mt-1">Out of stock</div>' : ''}
        </button>`;
    }).join('');
    grid.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => openItemDetail(card.getAttribute('data-item-id')));
    });

    const tbody = document.getElementById('inventory-list');
    if (tbody) {
        tbody.innerHTML = items.map(item => `<tr class="cursor-pointer hover:bg-indigo-50" data-item-id="${item.id}">
          <td class="px-3 py-2 font-bold">${item.item_name}</td>
          <td class="px-2 py-2"><span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${catBadge(item.category)}">${item.category}</span></td>
          <td class="px-2 py-2 text-slate-500">${item.store_id ? storeName(item.store_id) : item.store_location || '—'}</td>
          <td class="px-2 py-2 text-right font-black">${Number(item.current_stock).toLocaleString()}</td>
        </tr>`).join('');
        tbody.querySelectorAll('tr').forEach(tr => tr.addEventListener('click', () => openItemDetail(tr.getAttribute('data-item-id'))));
    }
}

function filterAndSearch(category, searchTerm) {
    if (category) { /* category from getActiveCategory */ }
    renderItemCards(getFilteredItems());
}

function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clicked = e.currentTarget;
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('bg-slate-800', 'text-white', 'shadow-sm');
                b.classList.add('bg-white', 'text-slate-600', 'border', 'border-slate-200');
            });
            clicked.classList.remove('bg-white', 'text-slate-600', 'border', 'border-slate-200');
            clicked.classList.add('bg-slate-800', 'text-white', 'shadow-sm');
            filterAndSearch(clicked.getAttribute('data-cat'), document.getElementById('search-inventory')?.value || '');
        });
    });
}

function setupSearch() {
    document.getElementById('search-inventory')?.addEventListener('input', (e) => {
        filterAndSearch(getActiveCategory(), e.target.value);
    });
}

function populateSelects() {
    const storeOpts = stores.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    ['ni-store', 'ff-to-store', 'ff-from-store', 'ff-to-store-t', 'ff-store-consume', 'new-eq-store'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = storeOpts || '<option value="">No stores — run SQL migration</option>';
    });
    const pumpEl = document.getElementById('ff-pump');
    if (pumpEl) pumpEl.innerHTML = pumps.map(p => `<option value="${p.id}">${p.name}</option>`).join('') || '<option value="">Add pumps in setup</option>';
    const qt = document.getElementById('qt-item');
    if (qt) qt.innerHTML = allItems.map(i => `<option value="${i.id}">${i.item_name} (${Number(i.current_stock)} ${i.unit})</option>`).join('');
    refreshEquipmentSelect();
}

function refreshEquipmentSelect(fuelType) {
    const el = document.getElementById('ff-equipment');
    if (!el) return;
    let list = equipment;
    if (fuelType) list = list.filter(e => e.fuel_type === fuelType);
    el.innerHTML = list.map(e => `<option value="${e.id}">${e.name} (${e.fuel_type})</option>`).join('') || '<option value="">Add equipment in setup</option>';
}

async function openItemDetail(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    currentItem = item;
    const modal = document.getElementById('detail-modal');
    document.getElementById('detail-title').textContent = item.item_name;
    const body = document.getElementById('detail-body');
    body.innerHTML = '<p class="text-slate-400 text-center py-8">Loading history…</p>';
    modal.classList.remove('hidden');
    modal.classList.add('flex');

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
      <div class="flex flex-wrap gap-2 staff-only role-hidden">
        <button type="button" id="detail-in" class="flex-1 min-w-[120px] py-2.5 bg-emerald-500 text-white rounded-xl text-xs font-black">Receive IN</button>
        <button type="button" id="detail-out" class="flex-1 min-w-[120px] py-2.5 bg-rose-500 text-white rounded-xl text-xs font-black">Issue OUT</button>
      </div>
      ${isAdmin() ? `<div class="admin-only role-hidden border-t pt-3">
        <label class="text-[10px] font-bold text-slate-500 uppercase">Photo URL</label>
        <div class="flex gap-2 mt-1"><input id="detail-photo-url" type="url" value="${item.photo_url || ''}" class="flex-grow p-2 border rounded-lg text-xs">
        <button type="button" id="detail-save-photo" class="px-3 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black">Save</button></div></div>` : ''}
      <h4 class="font-black text-slate-700 text-sm mt-2">Transaction history</h4>
      <div class="space-y-2 max-h-64 overflow-y-auto custom-scroll">`;

    (logs || []).forEach(log => {
        const pump = pumps.find(p => p.id === log.pump_id);
        const eq = equipment.find(e => e.id === log.equipment_id);
        const who = log.created_by_name || log.created_by_email || '—';
        const when = log.created_at ? new Date(log.created_at).toLocaleString('en-NP', { timeZone: 'Asia/Kathmandu' }) : log.log_date;
        const canEdit = canEditLog(log);
        html += `<div class="border rounded-xl p-3 text-xs ${log.txn_type === 'IN' ? 'border-emerald-100 bg-emerald-50/50' : 'border-rose-100 bg-rose-50/50'}">
          <div class="flex justify-between gap-2">
            <span class="font-black ${log.txn_type === 'IN' ? 'text-emerald-700' : 'text-rose-700'}">${log.txn_type} ${Number(log.quantity).toLocaleString()}</span>
            <span class="text-slate-500">${log.log_date}</span>
          </div>
          <p class="text-slate-600 mt-1">${log.purpose || log.notes || log.txn_subtype || '—'}</p>
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
    document.getElementById('detail-in')?.addEventListener('click', () => { closeModal('detail-modal'); openTxnModal('IN'); });
    document.getElementById('detail-out')?.addEventListener('click', () => { closeModal('detail-modal'); openTxnModal('OUT'); });
    body.querySelectorAll('.edit-log-btn').forEach(b => b.addEventListener('click', () => { closeModal('detail-modal'); editTxn(b.getAttribute('data-log-id')); }));
    document.getElementById('detail-save-photo')?.addEventListener('click', async () => {
        const url = document.getElementById('detail-photo-url').value.trim();
        const geo = await captureGeo();
        const { error } = await supabase.from('inventory_items').update({ photo_url: url || null, updated_at: new Date().toISOString(), updated_by_email: currentUser.email }).eq('id', item.id);
        if (error) return showToast(error.message, 'error');
        await writeAudit('item', item.id, 'update', 'Photo URL updated', { photo_url: url }, geo);
        showToast('Photo saved');
        await refreshInventory();
        openItemDetail(item.id);
    });
}

window.openTxnModal = function (type) {
    if (!currentItem) return showToast('Select an item first', 'warning');
    document.getElementById('txn-modal').classList.remove('hidden');
    document.getElementById('txn-modal').classList.add('flex');
    document.getElementById('txn-item-id').value = currentItem.id;
    document.getElementById('txn-type').value = type;
    document.getElementById('txn-log-id').value = '';
    document.getElementById('txn-unit').textContent = currentItem.unit;
    document.getElementById('txn-date').value = todayNPT();
    ['txn-qty', 'txn-purpose', 'txn-req', 'txn-app', 'txn-ref', 'txn-location'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const banner = document.getElementById('txn-stock-banner');
    const stockEl = document.getElementById('txn-current-stock');
    if (banner && stockEl) {
        stockEl.textContent = `${Number(currentItem.current_stock).toLocaleString()} ${currentItem.unit}`;
        banner.classList.remove('hidden');
    }
    document.getElementById('txn-delete-btn')?.classList.add('hidden');
    const t = document.getElementById('txn-title'), h = document.getElementById('txn-header'), b = document.getElementById('txn-submit');
    const inF = document.getElementById('in-fields'), outF = document.getElementById('out-fields');
    t.textContent = `${type === 'IN' ? 'Receive' : 'Issue'}: ${currentItem.item_name}`;
    if (type === 'IN') {
        h.className = 'px-5 py-3 border-b bg-emerald-50 flex justify-between items-center';
        b.className = 'flex-[2] py-3 bg-emerald-600 text-white font-black rounded-xl';
        b.textContent = 'Save – Add stock';
        inF.classList.remove('hidden'); outF.classList.add('hidden');
    } else {
        h.className = 'px-5 py-3 border-b bg-rose-50 flex justify-between items-center';
        b.className = 'flex-[2] py-3 bg-rose-600 text-white font-black rounded-xl';
        b.textContent = 'Save – Remove stock';
        inF.classList.add('hidden'); outF.classList.remove('hidden');
    }
};

window.openFuelTxnModal = async function (type, itemName) {
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
        document.getElementById('txn-modal').classList.remove('hidden');
        document.getElementById('txn-modal').classList.add('flex');
        document.getElementById('txn-item-id').value = log.item_id;
        document.getElementById('txn-type').value = log.txn_type;
        document.getElementById('txn-log-id').value = log.id;
        document.getElementById('txn-date').value = log.log_date;
        document.getElementById('txn-qty').value = log.quantity;
        if (document.getElementById('txn-location')) document.getElementById('txn-location').value = log.used_location || '';
        if (document.getElementById('txn-purpose')) document.getElementById('txn-purpose').value = log.purpose || '';
        if (document.getElementById('txn-ref')) document.getElementById('txn-ref').value = log.reference_no || '';
        if (document.getElementById('txn-req')) document.getElementById('txn-req').value = log.requested_by || '';
        if (document.getElementById('txn-app')) document.getElementById('txn-app').value = log.approved_by || '';
        document.getElementById('txn-delete-btn')?.classList.remove('hidden');
        document.getElementById('txn-title').textContent = `Edit: ${currentItem.item_name}`;
    } catch (e) { showToast(e.message, 'error'); }
};

window.deleteTxn = async function (logId) {
    const { data: log } = await supabase.from('inventory_logs').select('*').eq('id', logId).single();
    if (!canEditLog(log)) return showToast('You can only delete your own entries', 'error');
    if (!confirm('Delete this transaction? Stock will adjust automatically.')) return;
    try {
        const geo = await captureGeo();
        const { error } = await supabase.from('inventory_logs').delete().eq('id', logId);
        if (error) throw error;
        await writeAudit('log', logId, 'delete', `Deleted ${log.txn_type} ${log.quantity}`, log, geo);
        showToast('Deleted');
        closeModal('txn-modal');
        await refreshInventory();
        if (currentItem) openItemDetail(currentItem.id);
        if (!document.getElementById('fuel-report-modal')?.classList.contains('hidden')) {
            document.getElementById('fr-generate-btn')?.click();
        }
    } catch (e) { showToast(e.message, 'error'); }
};

window.openNewItemModal = () => {
    document.getElementById('item-modal').classList.remove('hidden');
    document.getElementById('item-modal').classList.add('flex');
};
window.openImportModal = () => {
    document.getElementById('import-modal').classList.remove('hidden');
    document.getElementById('import-modal').classList.add('flex');
};
window.openFuelImportModal = () => {
    document.getElementById('fuel-import-modal').classList.remove('hidden');
    document.getElementById('fuel-import-modal').classList.add('flex');
    document.getElementById('fi-setup-section')?.classList.remove('hidden');
    document.getElementById('fi-review-section')?.classList.add('hidden');
};
window.openFuelReportModal = () => {
    document.getElementById('fuel-report-modal').classList.remove('hidden');
    document.getElementById('fuel-report-modal').classList.add('flex');
};
window.openQuickTxn = () => {
    populateSelects();
    document.getElementById('qt-date').value = todayNPT();
    document.getElementById('quick-txn-modal').classList.remove('hidden');
    document.getElementById('quick-txn-modal').classList.add('flex');
};

function setupFuelFlowModal() {
    document.getElementById('btn-fuel-flow')?.addEventListener('click', () => {
        document.getElementById('ff-date').value = todayNPT();
        populateSelects();
        document.getElementById('fuel-flow-modal').classList.remove('hidden');
        document.getElementById('fuel-flow-modal').classList.add('flex');
    });
    const subtype = document.getElementById('ff-subtype');
    const toggle = () => {
        const v = subtype?.value;
        document.getElementById('ff-purchase-fields')?.classList.toggle('hidden', v !== 'purchase');
        document.getElementById('ff-transfer-fields')?.classList.toggle('hidden', v !== 'transfer');
        document.getElementById('ff-consume-fields')?.classList.toggle('hidden', v !== 'consumption');
    };
    subtype?.addEventListener('change', toggle);
    document.getElementById('ff-fuel-type')?.addEventListener('change', (e) => refreshEquipmentSelect(e.target.value));
    toggle();

    document.getElementById('fuel-flow-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const geo = await captureGeo();
        const subtypeVal = document.getElementById('ff-subtype').value;
        const fuelType = document.getElementById('ff-fuel-type').value;
        const date = document.getElementById('ff-date').value;
        const qty = parseFloat(document.getElementById('ff-qty').value);
        const notes = document.getElementById('ff-notes').value;
        try {
            if (subtypeVal === 'purchase') {
                const storeId = document.getElementById('ff-to-store').value;
                const pumpId = document.getElementById('ff-pump').value;
                const tank = await ensureFuelTank(storeId, fuelType);
                const pump = pumps.find(p => p.id === pumpId);
                await insertLog({
                    item_id: tank.id, log_date: date, txn_type: 'IN', quantity: qty,
                    txn_subtype: 'purchase', pump_id: pumpId || null, to_store_id: storeId,
                    purpose: `Purchase${pump ? ' at ' + pump.name : ''}${notes ? ' – ' + notes : ''}`,
                    reference_no: notes || null
                }, geo);
            } else if (subtypeVal === 'transfer') {
                const fromId = document.getElementById('ff-from-store').value;
                const toId = document.getElementById('ff-to-store-t').value;
                const fromTank = await ensureFuelTank(fromId, fuelType);
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
                const storeId = document.getElementById('ff-store-consume').value;
                const eqId = document.getElementById('ff-equipment').value;
                const tank = await ensureFuelTank(storeId, fuelType);
                const eq = equipment.find(x => x.id === eqId);
                await insertLog({
                    item_id: tank.id, log_date: date, txn_type: 'OUT', quantity: qty,
                    txn_subtype: 'consumption', equipment_id: eqId || null, used_location: storeName(storeId),
                    purpose: eq ? `Used on ${eq.name}` : (notes || 'Consumption')
                }, geo);
            }
            showToast('Fuel entry saved');
            closeModal('fuel-flow-modal');
            await refreshInventory();
        } catch (err) { showToast(err.message, 'error'); }
    });
}

function setupAdminSetup() {
    document.getElementById('btn-admin-setup')?.addEventListener('click', () => {
        renderSetupLists();
        document.getElementById('admin-setup-modal').classList.remove('hidden');
        document.getElementById('admin-setup-modal').classList.add('flex');
    });
    document.querySelectorAll('.setup-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const t = tab.getAttribute('data-tab');
            document.querySelectorAll('.setup-tab').forEach(x => x.classList.remove('bg-slate-100', 'text-indigo-700'));
            tab.classList.add('bg-slate-100', 'text-indigo-700');
            ['stores', 'pumps', 'equipment'].forEach(p => {
                document.getElementById(`setup-panel-${p}`)?.classList.toggle('hidden', p !== t);
            });
        });
    });
    document.getElementById('form-add-store')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isAdmin()) return;
        const name = document.getElementById('new-store-name').value.trim();
        const geo = await captureGeo();
        const { data, error } = await supabase.from('inventory_stores').insert([{ name, created_by_email: currentUser.email, is_temporary: true }]).select().single();
        if (error) return showToast(error.message, 'error');
        await writeAudit('store', data.id, 'create', `Store added: ${name}`, null, geo);
        document.getElementById('new-store-name').value = '';
        await refreshInventory();
        renderSetupLists();
    });
    document.getElementById('form-add-pump')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isAdmin()) return;
        const name = document.getElementById('new-pump-name').value.trim();
        const { data, error } = await supabase.from('inventory_fuel_pumps').insert([{ name }]).select().single();
        if (error) return showToast(error.message, 'error');
        await writeAudit('pump', data.id, 'create', `Pump added: ${name}`);
        document.getElementById('new-pump-name').value = '';
        await loadAllData();
        populateSelects();
        renderSetupLists();
    });
    document.getElementById('form-add-equipment')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!isAdmin()) return;
        const name = document.getElementById('new-eq-name').value.trim();
        const fuel_type = document.getElementById('new-eq-fuel').value;
        const store_id = document.getElementById('new-eq-store').value || null;
        const { data, error } = await supabase.from('inventory_equipment').insert([{ name, fuel_type, store_id }]).select().single();
        if (error) return showToast(error.message, 'error');
        await writeAudit('equipment', data.id, 'create', `Equipment: ${name}`);
        document.getElementById('new-eq-name').value = '';
        await loadAllData();
        populateSelects();
        renderSetupLists();
    });
}

function renderSetupLists() {
    const sl = document.getElementById('setup-store-list');
    if (sl) sl.innerHTML = stores.map(s => `<li class="flex justify-between border-b py-2"><span>${s.name}${s.is_temporary ? ' <span class="text-amber-600 text-[10px]">(temp)</span>' : ''}</span>${isAdmin() ? `<button type="button" class="text-rose-600 text-[10px] font-bold del-store" data-id="${s.id}">Remove</button>` : ''}</li>`).join('');
    sl?.querySelectorAll('.del-store').forEach(btn => btn.addEventListener('click', async () => {
        if (!confirm('Deactivate this store?')) return;
        await supabase.from('inventory_stores').update({ is_active: false }).eq('id', btn.getAttribute('data-id'));
        await refreshInventory();
        renderSetupLists();
    }));
    document.getElementById('setup-pump-list').innerHTML = pumps.map(p => `<li class="border-b py-2">${p.name}</li>`).join('');
    document.getElementById('setup-equipment-list').innerHTML = equipment.map(e => `<li class="border-b py-2">${e.name} <span class="text-slate-400">(${e.fuel_type})</span></li>`).join('');
}

function setupForms() {
    document.getElementById('txn-delete-btn')?.addEventListener('click', () => {
        const logId = document.getElementById('txn-log-id').value;
        if (logId) deleteTxn(logId);
    });

    document.getElementById('txn-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('txn-submit');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
            const logIdToEdit = document.getElementById('txn-log-id').value;
            if (logIdToEdit) {
                const { data: oldLog } = await supabase.from('inventory_logs').select('*').eq('id', logIdToEdit).single();
                if (!canEditLog(oldLog)) throw new Error('You can only edit your own entries');
            }
            const type = document.getElementById('txn-type').value;
            const qty = parseFloat(document.getElementById('txn-qty').value);
            if (!logIdToEdit && type === 'OUT' && qty > currentItem.current_stock && !confirm('Issue more than current stock?')) return;

            const geo = await captureGeo();
            if (logIdToEdit) {
                const { data: oldLog } = await supabase.from('inventory_logs').select('*').eq('id', logIdToEdit).single();
                await supabase.from('inventory_logs').delete().eq('id', logIdToEdit);
                await writeAudit('log', logIdToEdit, 'delete', 'Replaced during edit', oldLog, geo);
            }
            await insertLog({
                item_id: document.getElementById('txn-item-id').value,
                log_date: document.getElementById('txn-date').value,
                txn_type: type,
                quantity: qty,
                used_location: document.getElementById('txn-location')?.value || null,
                purpose: document.getElementById('txn-purpose')?.value || null,
                reference_no: document.getElementById('txn-ref')?.value || null,
                requested_by: document.getElementById('txn-req')?.value || null,
                approved_by: document.getElementById('txn-app')?.value || null
            }, geo);
            showToast('Saved');
            closeModal('txn-modal');
            await refreshInventory();
            if (currentItem) openItemDetail(currentItem.id);
        } catch (err) { showToast(err.message, 'error'); }
        finally { btn.textContent = orig; btn.disabled = false; }
    });

    document.getElementById('new-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const storeId = document.getElementById('ni-store')?.value || null;
            const sn = storeId ? storeName(storeId) : null;
            const row = {
                item_name: document.getElementById('ni-name').value,
                category: document.getElementById('ni-cat').value,
                unit: document.getElementById('ni-unit').value,
                current_stock: 0,
                store_id: storeId || null,
                store_location: sn,
                photo_url: document.getElementById('ni-photo')?.value || null,
                fuel_type: document.getElementById('ni-cat').value === 'Fuel' ? 'diesel' : null
            };
            const { data, error } = await supabase.from('inventory_items').insert([row]).select().single();
            if (error) throw error;
            const geo = await captureGeo();
            await writeAudit('item', data.id, 'create', `Item created: ${row.item_name}`, row, geo);
            showToast('Item created');
            closeModal('item-modal');
            await refreshInventory();
        } catch (err) { showToast(err.message, 'error'); }
    });

    document.querySelectorAll('.qt-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.qt-type-btn').forEach(b => {
                b.classList.remove('bg-emerald-500', 'bg-rose-500', 'text-white');
                b.classList.add('bg-slate-200', 'text-slate-600');
            });
            const t = btn.getAttribute('data-qt');
            document.getElementById('qt-type').value = t;
            btn.classList.remove('bg-slate-200', 'text-slate-600');
            btn.classList.add(t === 'IN' ? 'bg-emerald-500' : 'bg-rose-500', 'text-white');
        });
    });
    document.getElementById('quick-txn-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const itemId = document.getElementById('qt-item').value;
        currentItem = allItems.find(i => i.id === itemId);
        const geo = await captureGeo();
        await insertLog({
            item_id: itemId,
            log_date: document.getElementById('qt-date').value,
            txn_type: document.getElementById('qt-type').value,
            quantity: parseFloat(document.getElementById('qt-qty').value),
            purpose: document.getElementById('qt-purpose').value || null
        }, geo);
        showToast('Entry saved');
        closeModal('quick-txn-modal');
        await refreshInventory();
    });
    document.getElementById('fab-quick')?.addEventListener('click', openQuickTxn);
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await initializeApplication(true);
        if (!session?.user) {
            showToast('Please sign in to use inventory', 'warning');
            window.location.href = 'signin.html';
            return;
        }
        currentUser = session.user;
        userRole = session.role || 'operator';

        const [hRes, fRes] = await Promise.all([
            fetch('./components/header.html'),
            fetch('./components/footer.html')
        ]);
        if (hRes.ok) document.getElementById('global-header-container').innerHTML = await hRes.text();
        if (fRes.ok) document.getElementById('global-footer-container').innerHTML = await fRes.text();
        initHeaderUI();

        if (userRole === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
        if (['admin', 'staff', 'operator'].includes(userRole)) {
            document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
        }

        await refreshInventory();
        setupFilters();
        setupSearch();
        setupForms();
        setupFuelFlowModal();
        setupAdminSetup();
        setupFuelImporter();
        setupFuelReport();

        document.getElementById('fr-start').value = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
        document.getElementById('fr-end').value = todayNPT();
        if (!v2TablesOk) showToast('Run supabase/inventory-v2-schema.sql for stores & audit', 'warning');
    } catch (error) {
        console.error(error);
        showToast(error.message, 'error');
    }
});

// ─── DEDICATED FUEL IMPORTER WITH DEDUPLICATION ───
function setupFuelImporter() {
    document.getElementById('fi-wipe-btn')?.addEventListener('click', async () => {
        if(!confirm("DANGER: This will delete ALL Fuel Items and Logs from the database. Are you absolutely sure?")) return;
        try {
            const { data: fItems } = await supabase.from('inventory_items').select('id').eq('category', 'Fuel');
            if(fItems && fItems.length > 0) {
                const ids = fItems.map(i=>i.id);
                await supabase.from('inventory_logs').delete().in('item_id', ids);
                await supabase.from('inventory_items').delete().in('id', ids);
            }
            await supabase.from('inventory_items').insert([
                {item_name: 'Diesel - PH', category: 'Fuel', unit: 'Ltr', current_stock: 0},
                {item_name: 'Diesel - Ropeway', category: 'Fuel', unit: 'Ltr', current_stock: 0},
                {item_name: 'Diesel - Dam', category: 'Fuel', unit: 'Ltr', current_stock: 0},
                {item_name: 'Petrol - PH', category: 'Fuel', unit: 'Ltr', current_stock: 0}
            ]);
            showToast('Fuel Data Wiped and Initialized!', 'success');
            await loadInventoryItems();
        } catch(e) { showToast(e.message, 'error'); }
    });

    document.getElementById('fi-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const files = document.getElementById('fi-file').files;
        if (!files.length) return showToast('Select file(s).', 'error');
        
        const btn = document.getElementById('fi-submit-btn');
        btn.textContent = 'Reading Data...'; btn.disabled = true;

        fuelWorkbookSheets = [];

        const finishLoadingSheets = () => {
            if(fuelWorkbookSheets.length === 0) {
                btn.textContent = 'Read Data Files'; btn.disabled = false;
                return showToast('No fuel tables found in the uploaded files.', 'error');
            }
            supabase.from('inventory_items').select('id, item_name').eq('category', 'Fuel').then(({data}) => {
                fuelMasterIds = {};
                if(data) data.forEach(d => fuelMasterIds[d.item_name] = d.id);
                currentSheetIdx = 0;
                renderFuelSheet();
                btn.textContent = 'Read Data Files'; btn.disabled = false;
            });
        };

        const file0 = files[0];
        if (files.length === 1 && (file0.name.endsWith('.xlsx') || file0.name.endsWith('.xls'))) {
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const workbook = XLSX.read(new Uint8Array(e.target.result), {type: 'array'});
                    workbook.SheetNames.forEach(name => {
                        const data2D = XLSX.utils.sheet_to_json(workbook.Sheets[name], {header: 1, raw: false});
                        const parsed = parseFuelTables(data2D, name);
                        if (parsed.ph.length > 0 || parsed.ropeway.length > 0 || parsed.dam.length > 0 || parsed.petrol.length > 0) {
                            fuelWorkbookSheets.push({ name: name, data: parsed });
                        }
                    });
                    finishLoadingSheets();
                } catch(err) { 
                    btn.textContent = 'Read Data Files'; btn.disabled = false;
                    showToast(`Excel Error: ${err.message}. Try selecting your CSV files instead!`, 'error'); 
                }
            };
            reader.readAsArrayBuffer(file0);
        } else {
            let filesProcessed = 0;
            Array.from(files).forEach(file => {
                Papa.parse(file, {
                    header: false, skipEmptyLines: false,
                    complete: function(results) {
                        let sheetName = file.name.replace('.csv', '').split(' - ').pop();
                        const parsed = parseFuelTables(results.data, sheetName);
                        if (parsed.ph.length > 0 || parsed.ropeway.length > 0 || parsed.dam.length > 0 || parsed.petrol.length > 0) {
                            fuelWorkbookSheets.push({ name: sheetName, data: parsed });
                        }
                        filesProcessed++;
                        if(filesProcessed === files.length) finishLoadingSheets();
                    },
                    error: function() {
                        filesProcessed++;
                        if(filesProcessed === files.length) finishLoadingSheets();
                    }
                });
            });
        }
    });

    function parseDateFlexible(dStr) {
        if(!dStr) return null;
        let p = dStr.replace(/\//g, '.').replace(/-/g, '.').split('.');
        if (p.length === 3) {
            let y = p[2], m = p[1], d = p[0];
            if(p[0].length === 4) { y = p[0]; d = p[2]; }
            if(y.length === 2) y = '20' + y;
            return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
        return null;
    }

    function parseFuelTables(data2D, sheetName) {
        let result = { ph: [], ropeway: [], dam: [], petrol: [] };
        let activeTable = null;
        let dateIdx=-1, descIdx=-1, recIdx=-1, issIdx=-1, reqIdx=-1, appIdx=-1;

        for (let r = 0; r < data2D.length; r++) {
            if (!data2D[r] || data2D[r].length === 0) continue;
            let rawRow = data2D[r].map(c => (c || '').toString().trim());
            let rowLower = rawRow.map(c => c.toLowerCase());
            let rowStr = rowLower.join(' ');

            if (rowStr.includes('diesel consumption') && rowStr.includes('at ph')) { activeTable = 'ph'; continue; }
            if (rowStr.includes('diesel consumption') && rowStr.includes('at ropeway')) { activeTable = 'ropeway'; continue; }
            if (rowStr.includes('diesel consumption') && rowStr.includes('at dam')) { activeTable = 'dam'; continue; }
            if (rowStr.includes('petrol consumption') && rowStr.includes('at ph')) { activeTable = 'petrol'; continue; }

            if (activeTable && rowLower.includes('date') && (rowLower.includes('received') || rowLower.includes('issued'))) {
                dateIdx = rowLower.findIndex(c => c === 'date' || c === 'date ');
                descIdx = rowLower.findIndex(c => c === 'description');
                recIdx = rowLower.findIndex(c => c === 'received' || c.includes('purchased'));
                issIdx = rowLower.findIndex(c => c === 'issued' || c.includes('consumed'));
                reqIdx = rowLower.findIndex(c => c.includes('requested'));
                appIdx = rowLower.findIndex(c => c.includes('approved'));
                continue;
            }

            if (activeTable && dateIdx > -1) {
                let dateStr = rawRow[dateIdx] || '';
                let desc = rawRow[descIdx] || '';
                
                if (dateStr.toLowerCase() === 'total' || desc.toLowerCase() === 'total') {
                    activeTable = null; continue;
                }

                if (dateStr.match(/\d{2}[\.\-\/]\d{2}[\.\-\/]\d{2,4}/)) {
                    let recStr = recIdx > -1 && rawRow[recIdx] ? rawRow[recIdx].toString() : '';
                    let issStr = issIdx > -1 && rawRow[issIdx] ? rawRow[issIdx].toString() : '';
                    let rec = parseFloat(recStr.replace(/,/g,'')) || 0;
                    let iss = parseFloat(issStr.replace(/,/g,'')) || 0;
                    
                    let req = reqIdx > -1 ? rawRow[reqIdx] : '';
                    let app = appIdx > -1 ? rawRow[appIdx] : '';
                    let isOpening = desc.toLowerCase().includes('opening stock');
                    
                    if (rec > 0 || iss > 0) {
                        const fType = activeTable === 'petrol' ? 'Petrol - PH' : (activeTable === 'ropeway' ? 'Diesel - Ropeway' : (activeTable === 'dam' ? 'Diesel - Dam' : 'Diesel - PH'));
                        const parsedDate = parseDateFlexible(dateStr);
                        if (!parsedDate) continue;

                        const signature = `${parsedDate}_${fType}_${rec>0?'IN':'OUT'}_${rec||iss}_${desc.toLowerCase()}`;
                        
                        result[activeTable].push({
                            id: Math.random().toString(36).substr(2, 9),
                            date: parsedDate, rawDate: dateStr, desc: desc,
                            rec: rec, iss: iss, req: req, app: app, isOpening: isOpening,
                            sig: signature, item_name: fType
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
        document.getElementById('fi-setup-section').classList.add('hidden');
        document.getElementById('fi-review-section').classList.remove('hidden'); document.getElementById('fi-review-section').classList.add('flex');
        
        const sheet = fuelWorkbookSheets[currentSheetIdx];
        document.getElementById('fi-sheet-title').textContent = `Sheet: ${sheet.name}`;
        document.getElementById('fi-sheet-progress').textContent = `File ${currentSheetIdx + 1} of ${fuelWorkbookSheets.length}`;
        document.getElementById('fi-is-opening').checked = false; 

        let existingSigs = new Set();
        let allSheetLogs = [...sheet.data.ph, ...sheet.data.ropeway, ...sheet.data.dam, ...sheet.data.petrol];
        let validDates = allSheetLogs.map(l => l.date).filter(Boolean).sort();
        
        if (validDates.length > 0) {
            const minD = validDates[0], maxD = validDates[validDates.length - 1];
            try {
                const { data: exLogs } = await supabase.from('inventory_logs').select('log_date, txn_type, quantity, purpose, inventory_items(item_name)').gte('log_date', minD).lte('log_date', maxD);
                if(exLogs) {
                    exLogs.forEach(l => {
                        const iname = l.inventory_items?.item_name || '';
                        existingSigs.add(`${l.log_date}_${iname}_${l.txn_type}_${l.quantity}_${(l.purpose||'').toLowerCase()}`);
                    });
                }
            } catch(e) {}
        }

        let internalSigs = new Set();
        const checkDupe = (r) => {
            if (existingSigs.has(r.sig) || internalSigs.has(r.sig)) { r.isDupe = true; }
            else { r.isDupe = false; internalSigs.add(r.sig); }
        };
        sheet.data.ph.forEach(checkDupe); sheet.data.ropeway.forEach(checkDupe); sheet.data.dam.forEach(checkDupe); sheet.data.petrol.forEach(checkDupe);

        const container = document.getElementById('fi-tables-container');
        container.innerHTML = '';

        const buildTableHTML = (title, data) => {
            if(data.length === 0) return '';
            let html = `<div class="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col min-h-[250px]"><div class="bg-slate-100 px-3 py-2 font-black text-xs text-indigo-900 border-b border-slate-200 flex justify-between"><span>${title}</span> <label class="cursor-pointer font-bold text-[9px] text-slate-500"><input type="checkbox" class="toggle-all" checked> All</label></div><div class="overflow-y-auto flex-grow custom-scroll"><table class="w-full text-left text-[10px] whitespace-nowrap"><thead class="bg-slate-50 sticky top-0 shadow-sm text-slate-500 uppercase font-bold text-[9px]"><tr><th class="px-2 py-1">Inc</th><th class="px-2 py-1">Date</th><th class="px-2 py-1 w-full">Description</th><th class="px-2 py-1">Req By</th><th class="px-2 py-1">App By</th><th class="px-2 py-1 text-right text-emerald-600">IN</th><th class="px-2 py-1 text-right text-rose-600">OUT</th></tr></thead><tbody class="divide-y divide-slate-100">`;
            
            data.forEach(r => {
                const isOp = r.isOpening ? "is-opening opacity-60 italic " : "";
                const isDup = r.isDupe ? "bg-amber-50" : "";
                const badge = r.isDupe ? `<span class="ml-1 text-[7px] bg-amber-200 text-amber-800 px-1 rounded">Dup</span>` : '';
                const checkedStr = r.isDupe ? '' : 'checked';
                
                html += `<tr class="${isOp} ${isDup} hover:bg-slate-50 transition"><td class="px-2 py-1 border-r border-slate-100"><input type="checkbox" class="row-cb accent-indigo-600" data-id="${r.id}" ${checkedStr}></td><td class="px-2 py-1">${r.rawDate}</td><td class="px-2 py-1 truncate max-w-[100px]" title="${r.desc}">${r.desc} ${badge}</td><td class="px-2 py-1 truncate max-w-[60px] text-slate-500">${r.req}</td><td class="px-2 py-1 truncate max-w-[60px] text-slate-500">${r.app}</td><td class="px-2 py-1 text-right font-bold">${r.rec || ''}</td><td class="px-2 py-1 text-right font-bold">${r.iss || ''}</td></tr>`;
            });
            html += `</tbody></table></div></div>`;
            return html;
        };

        container.innerHTML += buildTableHTML('Diesel - PH', sheet.data.ph);
        container.innerHTML += buildTableHTML('Diesel - Ropeway', sheet.data.ropeway);
        container.innerHTML += buildTableHTML('Diesel - Dam', sheet.data.dam);
        container.innerHTML += buildTableHTML('Petrol - PH', sheet.data.petrol);

        const checkBtn = document.getElementById('fi-is-opening');
        checkBtn.replaceWith(checkBtn.cloneNode(true)); 
        document.getElementById('fi-is-opening').addEventListener('change', (e) => {
            document.querySelectorAll('.is-opening').forEach(row => {
                if(e.target.checked) row.classList.remove('opacity-60', 'italic');
                else row.classList.add('opacity-60', 'italic');
            });
        });

        document.querySelectorAll('.toggle-all').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const table = e.target.closest('div').nextSibling.querySelector('table');
                table.querySelectorAll('.row-cb').forEach(rcb => {
                    const isOp = rcb.closest('tr').classList.contains('is-opening');
                    const showOp = document.getElementById('fi-is-opening').checked;
                    if(!isOp || showOp) rcb.checked = e.target.checked;
                });
            });
        });
    }

    const skipBtn = document.getElementById('fi-skip-btn');
    skipBtn.replaceWith(skipBtn.cloneNode(true));
    document.getElementById('fi-skip-btn')?.addEventListener('click', () => { currentSheetIdx++; renderFuelSheet(); });
    
    const saveBtn = document.getElementById('fi-save-btn');
    saveBtn.replaceWith(saveBtn.cloneNode(true));
    document.getElementById('fi-save-btn')?.addEventListener('click', async (e) => {
        const btn = e.target; btn.disabled = true; btn.textContent = 'Saving...';
        try {
            const { data: u } = await supabase.auth.getUser();
            const sheet = fuelWorkbookSheets[currentSheetIdx];
            const includeOpening = document.getElementById('fi-is-opening').checked;
            
            const selectedIds = new Set();
            document.querySelectorAll('.row-cb:checked').forEach(cb => selectedIds.add(cb.getAttribute('data-id')));

            let payloads = [];
            const processGroup = (dataArray, itemName) => {
                const itemId = fuelMasterIds[itemName];
                if(!itemId) return;
                dataArray.forEach(row => {
                    if(!selectedIds.has(row.id)) return; 
                    if(row.isOpening && !includeOpening) return;
                    if(row.rec > 0) payloads.push({ item_id: itemId, log_date: row.date, txn_type: 'IN', quantity: row.rec, purpose: row.desc, requested_by: row.req, approved_by: row.app, operator_uid: u.user.id });
                    if(row.iss > 0) payloads.push({ item_id: itemId, log_date: row.date, txn_type: 'OUT', quantity: row.iss, purpose: row.desc, requested_by: row.req, approved_by: row.app, operator_uid: u.user.id });
                });
            };

            processGroup(sheet.data.ph, 'Diesel - PH');
            processGroup(sheet.data.ropeway, 'Diesel - Ropeway');
            processGroup(sheet.data.dam, 'Diesel - Dam');
            processGroup(sheet.data.petrol, 'Petrol - PH');

            if(payloads.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < payloads.length; i += chunkSize) {
                    const chunk = payloads.slice(i, i + chunkSize);
                    const { error } = await supabase.from('inventory_logs').insert(chunk);
                    if (error) throw error;
                }
            }
            showToast(`${sheet.name} Saved!`);
            currentSheetIdx++; renderFuelSheet();
        } catch(err) { alert(err.message); } finally { btn.disabled = false; btn.textContent = 'Save Checked & Next'; }
    });
}

// ─── EXACT EXCEL-STYLE FUEL REPORT ───
function setupFuelReport() {
    document.getElementById('fuel-report-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('fr-generate-btn');
        const start = document.getElementById('fr-start').value;
        const end = document.getElementById('fr-end').value;
        const container = document.getElementById('fr-generated-tables');
        const emptyState = document.getElementById('fr-empty-state');

        btn.innerHTML = '...'; btn.disabled = true;

        try {
            const { data: itemData } = await supabase.from('inventory_items').select('id, item_name').in('item_name', ['Diesel - PH', 'Diesel - Ropeway', 'Diesel - Dam', 'Petrol - PH']);
            if(!itemData || itemData.length === 0) throw new Error("Fuel master items not found.");
            const idsMap = {}; itemData.forEach(i => idsMap[i.item_name] = i.id);

            const { data: logs, error } = await supabase.from('inventory_logs').select('id, item_id, log_date, txn_type, quantity, purpose, requested_by, approved_by').in('item_id', Object.values(idsMap)).order('log_date', { ascending: true }).order('created_at', { ascending: true });
            if (error) throw error;

            const processFuelData = (itemName) => {
                const itemLogs = logs.filter(l => l.item_id === idsMap[itemName]);
                let openBal = 0, currentBal = 0, tableRows = [], totRec = 0, totIss = 0;
                
                itemLogs.forEach(log => {
                    if (log.log_date < start) {
                        if(log.txn_type === 'IN') openBal += log.quantity;
                        else openBal -= log.quantity;
                        currentBal = openBal;
                    } else if (log.log_date <= end) {
                        if(log.txn_type === 'IN') { currentBal += log.quantity; totRec += log.quantity; }
                        else { currentBal -= log.quantity; totIss += log.quantity; }
                        tableRows.push({ id: log.id, date: log.log_date, desc: log.purpose, rec: log.txn_type==='IN'?log.quantity:null, iss: log.txn_type==='OUT'?log.quantity:null, bal: currentBal, req: log.requested_by, app: log.approved_by });
                    }
                });
                return { tableRows, openBal, currentBal, totRec, totIss };
            };

            const ph = processFuelData('Diesel - PH'), ropeway = processFuelData('Diesel - Ropeway'), dam = processFuelData('Diesel - Dam'), petrol = processFuelData('Petrol - PH');
            const formatNum = (num) => num ? Number(num).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:2}) : '';
            
            const buildHTML = (title, itemName, data) => {
                let html = `
                <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div class="flex justify-between items-center mb-3">
                        <h4 class="text-sm font-black text-indigo-900">${title}</h4>
                        <div class="flex gap-2">
                            <button type="button" onclick="openFuelTxnModal('IN', '${itemName}')" class="px-2.5 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-[9px] font-bold shadow-sm transition">+ IN</button>
                            <button type="button" onclick="openFuelTxnModal('OUT', '${itemName}')" class="px-2.5 py-1 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded text-[9px] font-bold shadow-sm transition">+ OUT</button>
                        </div>
                    </div>
                    <div class="overflow-x-auto pb-2">
                        <table class="w-full text-left report-table">
                            <thead>
                                <tr><th class="w-14 text-center">Act</th><th>No</th><th>Date</th><th class="w-full">Description</th><th class="text-right">Received</th><th class="text-right">Issued</th><th class="text-right">Balance</th><th>Requested by</th><th>Approved by</th></tr>
                            </thead>
                            <tbody>
                                <tr><td></td><td></td><td>${start}</td><td class="font-bold">Opening Stock</td><td class="text-right font-bold text-indigo-600">${formatNum(data.openBal)}</td><td></td><td class="text-right font-black">${formatNum(data.openBal)}</td><td></td><td></td></tr>`;
                
                data.tableRows.forEach((r, i) => {
                    html += `<tr class="hover:bg-slate-50 transition group">
                        <td class="text-center w-14">
                            <div class="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                <button type="button" onclick="editTxn('${r.id}')" class="p-1 bg-slate-100 hover:bg-indigo-100 text-slate-400 hover:text-indigo-600 rounded transition" title="Edit Entry"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>
                                <button type="button" onclick="deleteTxn('${r.id}')" class="p-1 bg-slate-100 hover:bg-rose-100 text-slate-400 hover:text-rose-600 rounded transition" title="Delete Entry"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
                            </div>
                        </td>
                        <td>${i+1}</td><td>${r.date}</td><td>${r.desc}</td><td class="text-right text-emerald-600 font-bold">${formatNum(r.rec)}</td><td class="text-right text-rose-600 font-bold">${formatNum(r.iss)}</td><td class="text-right font-black">${formatNum(r.bal)}</td><td class="text-slate-500">${r.req || ''}</td><td class="text-slate-500">${r.app || ''}</td>
                    </tr>`;
                });
                
                html += `<tr class="total-row"><td colspan="4" class="text-center uppercase">Total</td><td class="text-right text-emerald-700">${formatNum(data.openBal + data.totRec)}</td><td class="text-right text-rose-700">${formatNum(data.totIss)}</td><td class="text-right text-indigo-900">${formatNum(data.openBal + data.totRec - data.totIss)}</td><td></td><td></td></tr></tbody></table></div></div>`;
                return html;
            };

            let leftHtml = `<div class="w-full lg:w-2/3 space-y-6">`;
            leftHtml += buildHTML(`Diesel Consumption Details at PH`, 'Diesel - PH', ph);
            leftHtml += buildHTML(`Diesel Consumption Details at Ropeway`, 'Diesel - Ropeway', ropeway);
            leftHtml += buildHTML(`Diesel Consumption Details at Dam`, 'Diesel - Dam', dam);
            leftHtml += buildHTML(`Petrol Consumption Details at PH`, 'Petrol - PH', petrol);
            leftHtml += `</div>`;

            let rightHtml = `<div class="w-full lg:w-1/3 space-y-6 sticky top-0">`;
            const dOpen = ph.openBal + ropeway.openBal + dam.openBal, dCons = ph.totIss + ropeway.totIss + dam.totIss, dClose = ph.currentBal + ropeway.currentBal + dam.currentBal;
            rightHtml += `<div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200"><h4 class="text-sm font-black text-indigo-900 mb-3">Diesel Summary</h4><div class="overflow-x-auto"><table class="w-full text-left report-table"><thead><tr><th>Description</th><th class="text-right">Opening stock</th><th class="text-right">Consumed</th><th class="text-right">Closing stock</th></tr></thead><tbody><tr><td class="font-bold">Opening Stock</td><td class="text-right font-bold text-indigo-600">${formatNum(dOpen)}</td><td></td><td></td></tr><tr><td>Consumed at PH</td><td></td><td class="text-right text-rose-600">${formatNum(ph.totIss)}</td><td></td></tr><tr><td>Consumed at Ropeway</td><td></td><td class="text-right text-rose-600">${formatNum(ropeway.totIss)}</td><td></td></tr><tr><td>Consumed at Dam</td><td></td><td class="text-right text-rose-600">${formatNum(dam.totIss)}</td><td></td></tr><tr><td class="font-bold">Fuel Received (PH)</td><td class="text-right text-emerald-600 font-bold">${formatNum(ph.totRec)}</td><td></td><td></td></tr><tr class="total-row"><td>Closing Stock</td><td class="text-right">${formatNum(dOpen + ph.totRec)}</td><td class="text-right">${formatNum(dCons)}</td><td class="text-right text-indigo-900">${formatNum(dClose)}</td></tr></tbody></table></div></div>`;
            rightHtml += `<div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200"><h4 class="text-sm font-black text-indigo-900 mb-3">Petrol Summary</h4><div class="overflow-x-auto"><table class="w-full text-left report-table"><thead><tr><th>Description</th><th class="text-right">Opening stock</th><th class="text-right">Consumed</th><th class="text-right">Closing stock</th></tr></thead><tbody><tr><td class="font-bold">Opening Stock</td><td class="text-right font-bold text-indigo-600">${formatNum(petrol.openBal)}</td><td></td><td></td></tr><tr><td>Consumed at PH</td><td></td><td class="text-right text-rose-600">${formatNum(petrol.totIss)}</td><td></td></tr><tr><td class="font-bold">Fuel Received</td><td class="text-right text-emerald-600 font-bold">${formatNum(petrol.totRec)}</td><td></td><td></td></tr><tr class="total-row"><td>Closing Stock</td><td class="text-right">${formatNum(petrol.openBal + petrol.totRec)}</td><td class="text-right">${formatNum(petrol.totIss)}</td><td class="text-right text-indigo-900">${formatNum(petrol.currentBal)}</td></tr></tbody></table></div></div></div>`;

            emptyState.classList.add('hidden');
            container.innerHTML = `<div class="flex flex-col lg:flex-row items-start gap-6 w-full">` + leftHtml + rightHtml + `</div>`;
            container.classList.remove('hidden');

        } catch (err) { alert(`Report Error: ${err.message}`); } finally { btn.innerHTML = 'Generate'; btn.disabled = false; }
    });
}