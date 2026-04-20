import { supabase, fetchWithTimeout } from './core-app.js';

let allItems = [];
let currentItem = null;

// Temporary Fuel Importer State
let fuelWorkbookSheets = [];
let currentSheetIdx = 0;
let fuelMasterIds = {}; 

function showToast(message, type = 'success') {
    let modal = document.getElementById('notification-modal');
    let msgEl = document.getElementById('notification-message');
    if (!modal) {
        modal = document.createElement('div'); modal.id = 'notification-modal';
        modal.className = 'fixed top-4 right-4 z-[400] transition-all duration-300 pointer-events-none max-w-xs w-full bg-white rounded-xl shadow-2xl border-l-4 px-4 py-3 opacity-0 -translate-y-4';
        msgEl = document.createElement('p'); msgEl.id = 'notification-message'; msgEl.className = 'text-xs font-bold text-slate-700';
        modal.appendChild(msgEl); document.body.appendChild(modal);
    }
    if (type === 'error') modal.classList.replace('border-emerald-500', 'border-rose-500');
    else if (type === 'warning') { modal.classList.replace('border-emerald-500', 'border-amber-500'); modal.classList.replace('border-rose-500', 'border-amber-500'); }
    else { modal.classList.replace('border-rose-500', 'border-emerald-500'); modal.classList.replace('border-amber-500', 'border-emerald-500'); }
    
    msgEl.textContent = message;
    modal.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
    modal.classList.add('opacity-100', 'translate-y-0');
    setTimeout(() => {
        modal.classList.remove('opacity-100', 'translate-y-0');
        modal.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
    }, 3000);
}

window.closeModal = (id) => {
    const m = document.getElementById(id); 
    if(m) { m.classList.add('hidden'); m.classList.remove('flex'); }
};

document.addEventListener('DOMContentLoaded', async () => {
    try {
        try {
            const [hRes, fRes] = await Promise.all([ fetch('./components/header.html'), fetch('./components/footer.html') ]);
            if (hRes.ok) document.getElementById('global-header-container').innerHTML = await hRes.text();
            if (fRes.ok) document.getElementById('global-footer-container').innerHTML = await fRes.text();
        } catch(e) {}

        const { data: { session }, error: authError } = await supabase.auth.getSession();
        if (!authError && session) {
            const loginBtn = document.getElementById('login-btn'), logoutBtn = document.getElementById('logout-btn');
            const headerEmail = document.getElementById('header-email'), mainNav = document.getElementById('main-nav');
            if(loginBtn) loginBtn.classList.add('hidden');
            if(logoutBtn) logoutBtn.classList.remove('hidden');
            if(mainNav) { mainNav.classList.remove('hidden'); mainNav.classList.add('flex'); }
            if(headerEmail) {
                headerEmail.classList.remove('hidden'); headerEmail.classList.add('flex');
                const nameSpan = headerEmail.querySelector('span');
                if(nameSpan) nameSpan.textContent = session.user.user_metadata?.full_name || session.user.email.split('@')[0];
            }
            document.querySelectorAll('.nav-link').forEach(l => {
                if (l.getAttribute('data-page') === 'inventory.html') l.classList.add('bg-indigo-50', 'text-indigo-700', '!text-indigo-700', 'border', 'border-indigo-100');
            });
            const { data: roleData } = await supabase.from('user_roles').select('role').eq('email', session.user.email).single();
            if (roleData) {
                if (roleData.role === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
                if (roleData.role === 'admin' || roleData.role === 'staff') document.querySelectorAll('.staff-only').forEach(el => el.classList.remove('role-hidden', 'hidden'));
            }
        }

        await loadInventoryItems();
        setupFilters(); setupSearch(); setupForms(); setupFuelImporter(); setupFuelReport();
        
        const dateInput = document.getElementById('txn-date');
        if (dateInput) dateInput.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
        
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        document.getElementById('fr-start').value = firstDay.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
        document.getElementById('fr-end').value = today.toLocaleDateString('sv-SE', { timeZone: 'Asia/Kathmandu' });
    } catch (error) { console.error(error); }
});

async function loadInventoryItems() {
    try {
        const { data, error } = await fetchWithTimeout(supabase.from('inventory_items').select('*').order('item_name', { ascending: true }));
        if (error) throw error;
        allItems = data || [];
        renderItems(allItems);
        renderSummaryStats(allItems);   // ← update stats cards after every reload
    } catch (err) { showToast(err.message, 'error'); }
}

// ─── RENDER SUMMARY STATS STRIP ───
function renderSummaryStats(items) {
    const total       = items.length;
    const assets      = items.filter(i => i.category === 'Asset').length;
    const consumables = items.filter(i => i.category === 'Consumable').length;
    const fuelCount   = items.filter(i => i.category === 'Fuel').length;
    const wkvCount    = items.filter(i => i.category === 'WKV').length;
    const zeroStock   = items.filter(i => Number(i.current_stock) <= 0).length;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('stat-total',       total);
    set('stat-assets',      assets);
    set('stat-consumables', consumables);
    set('stat-zero',        zeroStock);

    // Filter button counts
    set('count-all',        total);
    set('count-fuel',       fuelCount);
    set('count-consumable', consumables);
    set('count-asset',      assets);
    set('count-wkv',        wkvCount);

    // Alert card: pulse if anything is at zero
    const alertCard = document.getElementById('alert-card');
    const alertIcon = document.getElementById('alert-icon');
    const alertLabel = document.getElementById('alert-label');
    if (alertCard) {
        if (zeroStock > 0) {
            alertCard.classList.add('ring-2', 'ring-rose-200');
            if (alertIcon) alertIcon.classList.add('alert-pulse');
            if (alertLabel) alertLabel.textContent = zeroStock === 1 ? 'item needs restock' : 'items need restock';
        } else {
            alertCard.classList.remove('ring-2', 'ring-rose-200');
            if (alertIcon) { alertIcon.classList.remove('alert-pulse'); alertIcon.textContent = '✅'; }
            if (alertLabel) alertLabel.textContent = 'all items stocked';
        }
    }
}

function renderItems(itemsToRender) {
    const tbody = document.getElementById('inventory-list');
    tbody.innerHTML = '';

    // Update the filtered-count badge
    const countBadge = document.getElementById('list-count-badge');
    if (countBadge) {
        if (itemsToRender.length < allItems.length) {
            countBadge.textContent = `${itemsToRender.length} result${itemsToRender.length !== 1 ? 's' : ''}`;
            countBadge.classList.remove('hidden');
        } else {
            countBadge.classList.add('hidden');
        }
    }

    if (itemsToRender.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 font-bold text-xs">
            <div class="text-3xl mb-2">🔍</div>
            No items found. Try a different search term.
        </td></tr>`;
        return;
    }

    itemsToRender.forEach(item => {
        const stock = Number(item.current_stock);
        const tr = document.createElement('tr');

        // Row background: highlight zero-stock rows
        const zeroClass = stock <= 0 ? 'stock-zero' : '';
        tr.className = `cursor-pointer hover:bg-indigo-50/60 transition group ${currentItem?.id === item.id ? 'row-selected' : ''} ${zeroClass}`;
        tr.onclick = () => selectItem(item, tr);

        // Category badge colours
        let catColor = 'bg-slate-100 text-slate-600';
        if (item.category === 'Fuel')       catColor = 'bg-amber-100 text-amber-700';
        if (item.category === 'WKV')        catColor = 'bg-purple-100 text-purple-700';
        if (item.category === 'Consumable') catColor = 'bg-emerald-100 text-emerald-700';
        if (item.category === 'Asset')      catColor = 'bg-blue-100 text-blue-700';

        // Stock number colour
        const stockColor = stock <= 0 ? 'text-rose-600 font-black' : 'text-indigo-600 font-black';

        // Red dot indicator for zero stock
        const zeroDot = stock <= 0
            ? '<span class="inline-block w-1.5 h-1.5 bg-rose-500 rounded-full mr-1 mb-0.5 align-middle"></span>'
            : '';

        tr.innerHTML = `
            <td class="px-3 py-2 border-b border-slate-100">
                <div class="font-black text-slate-800 group-hover:text-indigo-600 transition truncate" title="${item.item_name}">
                    ${zeroDot}${item.item_name}
                </div>
            </td>
            <td class="px-2 py-2 border-b border-slate-100">
                <span class="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${catColor}">${item.category}</span>
            </td>
            <td class="px-2 py-2 border-b border-slate-100 text-[10px] text-slate-500 hidden md:table-cell truncate max-w-[100px]"
                title="${item.store_location || '-'}">${item.store_location || '-'}</td>
            <td class="px-2 py-2 border-b border-slate-100 text-center hidden sm:table-cell">
                <span class="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide">${item.unit}</span>
            </td>
            <td class="px-3 py-2 border-b border-slate-100 text-right ${stockColor} text-xs">
                ${Number(item.current_stock).toLocaleString()}
                ${stock <= 0 ? '<span class="text-[8px] text-rose-400 font-bold block leading-none">OUT OF STOCK</span>' : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function setupFilters() {
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const clicked = e.currentTarget;
            document.querySelectorAll('.filter-btn').forEach(b => {
                b.classList.remove('bg-slate-800', 'text-white', 'shadow-sm');
                b.classList.add('bg-white', 'text-slate-600');
                // Reset count span colour back to neutral for active button
                const countSpan = b.querySelector('span');
                if (countSpan) countSpan.classList.remove('bg-white/25', 'text-white');
            });
            clicked.classList.remove('bg-white', 'text-slate-600');
            clicked.classList.add('bg-slate-800', 'text-white', 'shadow-sm');
            // Make count span white on active button
            const activeCount = clicked.querySelector('span');
            if (activeCount) activeCount.classList.add('bg-white/25', 'text-white');
            filterAndSearch(clicked.getAttribute('data-cat'), document.getElementById('search-inventory').value);
        });
    });
}

function setupSearch() {
    document.getElementById('search-inventory').addEventListener('input', (e) => {
        filterAndSearch(document.querySelector('.filter-btn.bg-slate-800').getAttribute('data-cat'), e.target.value);
    });
}

function filterAndSearch(category, searchTerm) {
    let filtered = allItems;
    if (category !== 'All') filtered = filtered.filter(i => i.category === category);
    if (searchTerm) {
        const lower = searchTerm.toLowerCase();
        filtered = filtered.filter(i =>
            i.item_name.toLowerCase().includes(lower) ||
            (i.store_location && i.store_location.toLowerCase().includes(lower)) ||
            (i.asset_code && i.asset_code.toLowerCase().includes(lower))
        );
    }
    renderItems(filtered);
}

async function selectItem(item, rowElement) {
    currentItem = item;
    document.querySelectorAll('#inventory-list tr').forEach(tr => tr.classList.remove('row-selected'));
    if(rowElement) rowElement.classList.add('row-selected');
    document.getElementById('empty-state').classList.add('hidden');
    
    document.getElementById('sc-title').textContent = item.item_name;
    document.getElementById('sc-asset').textContent = item.asset_code || 'N/A';
    document.getElementById('sc-unit').textContent  = item.unit;
    document.getElementById('sc-stock').textContent = `${Number(item.current_stock).toLocaleString()} ${item.unit}`;

    // Colour the sc-stock based on zero stock
    const scStockEl = document.getElementById('sc-stock');
    if (Number(item.current_stock) <= 0) {
        scStockEl.classList.remove('text-indigo-600');
        scStockEl.classList.add('text-rose-600');
    } else {
        scStockEl.classList.remove('text-rose-600');
        scStockEl.classList.add('text-indigo-600');
    }

    const tbody = document.getElementById('stock-card-logs');
    tbody.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-400 text-[10px]">Fetching ledger...</td></tr>`;

    try {
        const { data: logs, error } = await supabase.from('inventory_logs').select('*').eq('item_id', item.id).order('log_date', { ascending: false }).order('created_at', { ascending: false }).limit(200);
        if (error) throw error;
        tbody.innerHTML = '';
        if (!logs || logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 italic text-[10px]">No transactions recorded yet.</td></tr>`;
            return;
        }
        
        logs.forEach(log => {
            const isOut = log.txn_type === 'OUT';
            const typeColor = isOut
                ? 'text-rose-600 bg-rose-50 border-rose-100'
                : 'text-emerald-600 bg-emerald-50 border-emerald-100';
            const typeLabel = isOut ? 'OUT ↓' : 'IN ↑';
            
            let details = [];
            if (log.purpose) details.push(log.purpose);
            if (log.used_location) details.push(`@${log.used_location}`);
            if (log.requested_by) details.push(`Req: ${log.requested_by}`);
            const detailText = details.length > 0 ? details.join(' | ') : '-';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-2 py-1.5 border-b border-slate-100 font-bold text-[9px] text-slate-500">${log.log_date}</td>
                <td class="px-2 py-1.5 border-b border-slate-100">
                    <span class="px-1 py-0.5 rounded text-[8px] font-black border ${typeColor}">${typeLabel}</span>
                </td>
                <td class="px-2 py-1.5 border-b border-slate-100 text-slate-500 truncate max-w-[150px] lg:max-w-[280px]" title="${detailText}">${detailText}</td>
                <td class="px-2 py-1.5 border-b border-slate-100 text-right font-black ${isOut ? 'text-rose-600' : 'text-emerald-600'} text-[11px]">
                    ${isOut ? '−' : '+'} ${Number(log.quantity).toLocaleString()}
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-rose-500 text-[10px]">Error: ${err.message}</td></tr>`;
    }
}

// ─── MODALS & FORMS ───
window.openTxnModal = function(type) {
    if (!currentItem) return showToast('Please select an item first!', 'error');
    document.getElementById('txn-modal').classList.remove('hidden');
    document.getElementById('txn-modal').classList.add('flex');
    document.getElementById('txn-item-id').value = currentItem.id; 
    document.getElementById('txn-type').value = type;
    document.getElementById('txn-log-id').value = '';
    document.getElementById('txn-unit').textContent = currentItem.unit;
    
    ['txn-qty','txn-purpose','txn-req','txn-app','txn-ref','txn-location'].forEach(id => {
        const el = document.getElementById(id); if(el) el.value = '';
    });

    // Show current stock in banner
    const banner = document.getElementById('txn-stock-banner');
    const stockEl = document.getElementById('txn-current-stock');
    if (banner && stockEl) {
        stockEl.textContent = `${Number(currentItem.current_stock).toLocaleString()} ${currentItem.unit}`;
        banner.classList.remove('hidden');
    }

    const delBtn = document.getElementById('txn-delete-btn');
    if(delBtn) delBtn.classList.add('hidden');

    const t = document.getElementById('txn-title'), h = document.getElementById('txn-header'), b = document.getElementById('txn-submit');
    const inF = document.getElementById('in-fields'), outF = document.getElementById('out-fields');

    const actionWord = type === 'IN' ? '✅ RECEIVE STOCK' : '📤 ISSUE / USE STOCK';
    t.textContent = `${actionWord}: ${currentItem.item_name}`;

    if (type === 'IN') {
        h.className = 'px-5 py-3 border-b border-emerald-100 flex justify-between items-center bg-emerald-50';
        b.className = 'flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition text-[11px] uppercase tracking-widest';
        b.textContent = '💾 Save – Add to Stock';
        inF.classList.remove('hidden'); outF.classList.add('hidden');
    } else {
        h.className = 'px-5 py-3 border-b border-rose-100 flex justify-between items-center bg-rose-50';
        b.className = 'flex-[2] py-3 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl shadow-md transition text-[11px] uppercase tracking-widest';
        b.textContent = '💾 Save – Remove from Stock';
        inF.classList.add('hidden'); outF.classList.remove('hidden');
    }
}

window.openFuelTxnModal = async function(type, itemName) {
    const item = allItems.find(i => i.item_name.toLowerCase() === itemName.toLowerCase());
    if(!item) return showToast("Item not found. Syncing...", "warning");
    currentItem = item;
    window.openTxnModal(type);
}

// Open existing log for editing
window.editTxn = async function(logId) {
    try {
        const { data: log, error } = await supabase.from('inventory_logs').select('*, inventory_items(item_name, unit, current_stock)').eq('id', logId).single();
        if(error) throw error;

        currentItem = { id: log.item_id, item_name: log.inventory_items.item_name, current_stock: log.inventory_items.current_stock, unit: log.inventory_items.unit };
        
        document.getElementById('txn-modal').classList.remove('hidden');
        document.getElementById('txn-modal').classList.add('flex');
        document.getElementById('txn-item-id').value = log.item_id; 
        document.getElementById('txn-type').value = log.txn_type;
        document.getElementById('txn-log-id').value = log.id; 
        document.getElementById('txn-unit').textContent = currentItem.unit;

        // Show current stock in banner
        const banner = document.getElementById('txn-stock-banner');
        const stockEl = document.getElementById('txn-current-stock');
        if (banner && stockEl) {
            stockEl.textContent = `${Number(currentItem.current_stock).toLocaleString()} ${currentItem.unit}`;
            banner.classList.remove('hidden');
        }
        
        document.getElementById('txn-date').value = log.log_date;
        document.getElementById('txn-qty').value = log.quantity;
        if(document.getElementById('txn-location')) document.getElementById('txn-location').value = log.used_location || '';
        if(document.getElementById('txn-purpose')) document.getElementById('txn-purpose').value = log.purpose || '';
        if(document.getElementById('txn-ref')) document.getElementById('txn-ref').value = log.reference_no || '';
        if(document.getElementById('txn-req')) document.getElementById('txn-req').value = log.requested_by || '';
        if(document.getElementById('txn-app')) document.getElementById('txn-app').value = log.approved_by || '';

        const delBtn = document.getElementById('txn-delete-btn');
        if(delBtn) delBtn.classList.remove('hidden');

        const t = document.getElementById('txn-title'), h = document.getElementById('txn-header'), b = document.getElementById('txn-submit');
        const inF = document.getElementById('in-fields'), outF = document.getElementById('out-fields');

        t.textContent = `✏️ EDIT: ${currentItem.item_name}`;

        if (log.txn_type === 'IN') {
            h.className = 'px-5 py-3 border-b border-emerald-100 flex justify-between items-center bg-emerald-50';
            b.className = 'flex-[2] py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-xl shadow-md transition text-[11px] uppercase tracking-widest';
            b.textContent = '💾 Update Entry';
            inF.classList.remove('hidden'); outF.classList.add('hidden');
        } else {
            h.className = 'px-5 py-3 border-b border-rose-100 flex justify-between items-center bg-rose-50';
            b.className = 'flex-[2] py-3 bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl shadow-md transition text-[11px] uppercase tracking-widest';
            b.textContent = '💾 Update Entry';
            inF.classList.add('hidden'); outF.classList.remove('hidden');
        }
    } catch(e) { showToast("Error loading transaction: " + e.message, "error"); }
}

// Delete a log directly from the table or modal
window.deleteTxn = async function(logId) {
    if(!confirm("Are you sure you want to permanently delete this transaction? The inventory stock will automatically adjust.")) return;
    
    try {
        const { error } = await supabase.from('inventory_logs').delete().eq('id', logId);
        if(error) throw error;
        
        showToast('Transaction deleted successfully!');
        window.closeModal('txn-modal');
        
        await loadInventoryItems();
        
        if(!document.getElementById('fuel-report-modal').classList.contains('hidden')) {
            document.getElementById('fr-generate-btn').click();
        }
    } catch(e) { showToast(e.message, 'error'); }
}

window.openNewItemModal   = () => { document.getElementById('item-modal').classList.remove('hidden'); document.getElementById('item-modal').classList.add('flex'); }
window.openImportModal    = () => { document.getElementById('import-modal').classList.remove('hidden'); document.getElementById('import-modal').classList.add('flex'); }
window.openFuelImportModal = () => {
    document.getElementById('fuel-import-modal').classList.remove('hidden');
    document.getElementById('fuel-import-modal').classList.add('flex');
    document.getElementById('fi-setup-section').classList.remove('hidden');
    document.getElementById('fi-review-section').classList.add('hidden');
}
window.openFuelReportModal = () => {
    document.getElementById('fuel-report-modal').classList.remove('hidden');
    document.getElementById('fuel-report-modal').classList.add('flex');
}

window.closeModals = () => {
    ['txn-modal', 'item-modal', 'import-modal', 'fuel-import-modal', 'fuel-report-modal'].forEach(id => {
        const m = document.getElementById(id); if(m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    });
}

function setupForms() {
    document.getElementById('txn-delete-btn')?.addEventListener('click', async () => {
        const logId = document.getElementById('txn-log-id').value;
        if(!logId) return;
        window.deleteTxn(logId);
    });

    document.getElementById('txn-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('txn-submit'); const origText = btn.textContent;
        btn.textContent = 'Saving...'; btn.disabled = true;
        try {
            const { data: u } = await supabase.auth.getUser(); if(!u.user) throw new Error("Must log in.");
            
            const logIdToEdit = document.getElementById('txn-log-id').value;
            const type = document.getElementById('txn-type').value;
            const qty = parseFloat(document.getElementById('txn-qty').value);
            
            if (!logIdToEdit && type === 'OUT' && qty > currentItem.current_stock && !confirm(`⚠️ You are issuing more than the current stock (${currentItem.current_stock} ${currentItem.unit}). Do you want to continue?`)) return; 
            
            const payload = {
                item_id: document.getElementById('txn-item-id').value, 
                log_date: document.getElementById('txn-date').value,
                txn_type: type, 
                quantity: qty, 
                used_location: document.getElementById('txn-location') ? document.getElementById('txn-location').value : null,
                purpose: document.getElementById('txn-purpose') ? document.getElementById('txn-purpose').value : null, 
                reference_no: document.getElementById('txn-ref') ? document.getElementById('txn-ref').value : null,
                requested_by: document.getElementById('txn-req') ? document.getElementById('txn-req').value : null, 
                approved_by: document.getElementById('txn-app') ? document.getElementById('txn-app').value : null, 
                operator_uid: u.user.id
            };

            if (logIdToEdit) {
                const { error: delErr } = await supabase.from('inventory_logs').delete().eq('id', logIdToEdit);
                if (delErr) throw delErr;
            }

            const { error } = await supabase.from('inventory_logs').insert([payload]);
            if (error) throw error;
            
            showToast('✅ Saved Successfully!'); 
            window.closeModal('txn-modal');
            
            await loadInventoryItems();
            const up = allItems.find(i => i.id === currentItem.id);
            if(up) selectItem(up, Array.from(document.querySelectorAll('#inventory-list tr')).find(r => r.innerText.includes(up.item_name)));

            if(!document.getElementById('fuel-report-modal').classList.contains('hidden')) {
                document.getElementById('fr-generate-btn').click();
            }

        } catch(err) { showToast(err.message, 'error'); } finally { btn.textContent = origText; btn.disabled = false; }
    });

    document.getElementById('new-item-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            const { error } = await supabase.from('inventory_items').insert([{
                item_name: document.getElementById('ni-name').value,
                category: document.getElementById('ni-cat').value,
                unit: document.getElementById('ni-unit').value,
                current_stock: 0
            }]);
            if (error) throw error;
            showToast('✅ Item created successfully!');
            window.closeModal('item-modal');
            await loadInventoryItems();
        } catch(err) { showToast(err.message, 'error'); } 
    });
}

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