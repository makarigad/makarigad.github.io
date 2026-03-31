import { initializeApplication, showNotification, supabase } from './core-app.js';

// Removed the old localStorage key since we are fully on Supabase now!
const FUEL_LOCATIONS = ['powerhouse_main_tank', 'dam_fuel', 'ropeway_fuel'];

const STORE_LABELS = {
    civil_store: 'Civil Store',
    electrical_store: 'Electrical Store',
    mechanical_store_s1: 'Mechanical Store S1',
    mechanical_store_s2: 'Mechanical Store S2',
    consumable_store: 'Consumable Store',
    outside_store: 'Outside Store',
    powerhouse_store: 'Powerhouse Store',
    dam_store: 'Dam Store',
    headworks: 'Headworks',
    ropeway_store: 'Ropeway Store',
    transmission_line_store: 'Transmission Line Store',
    outside_transmission_line_store: 'Transmission Line Store Outside',
    wkv_materials_store: 'WKV Materials Store',
    plant_inventory: 'Plant Inventory',
    powerhouse_main_tank: 'Powerhouse Main Tank',
    dam_fuel: 'Dam Fuel',
    ropeway_fuel: 'Ropeway Fuel'
};

function todayISO() {
    return new Date().toISOString().split('T')[0];
}

async function getNepDate(engDate) {
    if (!engDate) return '';
    try {
        const { data } = await supabase
            .from('calendar_mappings')
            .select('nep_date_str')
            .eq('eng_date', engDate)
            .maybeSingle();
        return data && data.nep_date_str ? data.nep_date_str : engDate;
    } catch {
        return engDate;
    }
}

async function syncNepDate(engInputId, nepInputId) {
    const engEl = document.getElementById(engInputId);
    const nepEl = document.getElementById(nepInputId);
    if (!engEl || !nepEl) return;
    nepEl.value = await getNepDate(engEl.value);
}

function setupTabs() {
    const map = {
        in: { btn: 'tab-in-btn', pane: 'tab-in' },
        out: { btn: 'tab-out-btn', pane: 'tab-out' },
        report: { btn: 'tab-report-btn', pane: 'tab-report' }
    };
    const activate = (name) => {
        Object.entries(map).forEach(([k, v]) => {
            document.getElementById(v.btn).classList.toggle('active', k === name);
            document.getElementById(v.pane).classList.toggle('active', k === name);
        });
        if (name === 'report') renderReports(); // Fetch fresh data from DB when clicked
    };
    document.getElementById(map.in.btn).addEventListener('click', () => activate('in'));
    document.getElementById(map.out.btn).addEventListener('click', () => activate('out'));
    document.getElementById(map.report.btn).addEventListener('click', () => activate('report'));
}

// --- SUPABASE: WRITE 'IN' TRANSACTIONS ---
function bindInForm() {
    const form = document.getElementById('in-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('in-date').value;
        const nepDate = document.getElementById('in-nep-date').value || await getNepDate(date);
        const qty = Number(document.getElementById('in-qty').value || 0);
        
        if (qty <= 0) {
            showNotification('Quantity must be greater than zero.', true);
            return;
        }

        // Combine inputs to fit your SQL table structure
        const gatePass = document.getElementById('in-gate-pass').value.trim();
        const baseRemark = document.getElementById('in-remark').value.trim();
        const fullRemark = gatePass ? `Gate Pass: ${gatePass} | ${baseRemark}` : baseRemark;

        try {
            const { error } = await supabase.from('makarigad_inventory_transactions_v2').insert([{
                date: date,
                nep_date: nepDate,
                movement: 'IN', // Must be uppercase to match SQL constraint
                store: document.getElementById('in-store').value,
                item: document.getElementById('in-item').value.trim(),
                qty: qty,
                unit: document.getElementById('in-unit').value.trim(),
                remarks: fullRemark,
                requested_by: document.getElementById('in-party').value.trim()
            }]);

            if (error) throw error;

            showNotification('In entry saved to Database successfully!');
            form.reset();
            document.getElementById('in-date').value = todayISO();
            await syncNepDate('in-date', 'in-nep-date');
            
        } catch (err) {
            console.error('Insert Error:', err);
            showNotification('Failed to save to database.', true);
        }
    });
}

// --- SUPABASE: WRITE 'OUT' TRANSACTIONS ---
function bindOutForm() {
    const form = document.getElementById('out-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const date = document.getElementById('out-date').value;
        const nepDate = document.getElementById('out-nep-date').value || await getNepDate(date);
        const qty = Number(document.getElementById('out-qty').value || 0);
        
        if (qty <= 0) {
            showNotification('Quantity must be greater than zero.', true);
            return;
        }

        const purpose = document.getElementById('out-purpose').value.trim();
        const baseRemark = document.getElementById('out-remark').value.trim();
        const fullRemark = purpose ? `Purpose: ${purpose} | ${baseRemark}` : baseRemark;

        try {
            const { error } = await supabase.from('makarigad_inventory_transactions_v2').insert([{
                date: date,
                nep_date: nepDate,
                movement: 'OUT', // Must be uppercase to match SQL constraint
                store: document.getElementById('out-store').value,
                item: document.getElementById('out-item').value.trim(),
                qty: qty,
                unit: document.getElementById('out-unit').value.trim(),
                remarks: fullRemark,
                requested_by: document.getElementById('out-receiver').value.trim()
            }]);

            if (error) throw error;

            showNotification('Out entry saved to Database successfully!');
            form.reset();
            document.getElementById('out-date').value = todayISO();
            await syncNepDate('out-date', 'out-nep-date');

        } catch (err) {
            console.error('Insert Error:', err);
            showNotification('Failed to save to database.', true);
        }
    });
}

// --- SUPABASE: READ LIVE REPORTS & STOCK ---
async function renderReports() {
    try {
        // 1. Fetch Live Stock Balances from SQL View
        const { data: stockData, error: stockError } = await supabase
            .from('makarigad_current_stock')
            .select('*');

        if (stockError) throw stockError;
        renderStockBalances(stockData || []);

        // 2. Fetch Recent 60 Transactions from Main Table
        const { data: txnData, error: txnError } = await supabase
            .from('makarigad_inventory_transactions_v2')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(60);

        if (txnError) throw txnError;
        
        const reportBody = document.getElementById('report-transactions-body');
        reportBody.innerHTML = (txnData && txnData.length > 0) ? txnData.map((r) => `
            <tr class="border-t border-slate-100">
                <td class="px-2 py-2">${r.nep_date || r.date || '-'}</td>
                <td class="px-2 py-2 font-bold ${r.movement === 'IN' ? 'text-green-600' : 'text-orange-500'}">${r.movement || '-'}</td>
                <td class="px-2 py-2">${STORE_LABELS[r.store] || r.store}</td>
                <td class="px-2 py-2">${r.item || '-'}</td>
                <td class="px-2 py-2 font-bold">${Number(r.qty || 0).toFixed(2)}</td>
                <td class="px-2 py-2 text-slate-500">${r.unit || '-'}</td>
            </tr>
        `).join('') : `<tr><td colspan="6" class="px-2 py-3 text-slate-500">No transactions yet.</td></tr>`;

    } catch (err) {
        console.error('Failed to load reports:', err);
        showNotification('Failed to load live data.', true);
    }
}

// Updates both the top Diesel Cards and the Main Stock Table
function renderStockBalances(stock) {
    // 1. Update the top Fuel summary cards
    let phFuel = 0, damFuel = 0, rwFuel = 0;
    
    stock.forEach(s => {
        if (s.item.toLowerCase().includes('diesel')) {
            if (s.store === 'powerhouse_main_tank') phFuel = Number(s.balance);
            if (s.store === 'dam_fuel') damFuel = Number(s.balance);
            if (s.store === 'ropeway_fuel') rwFuel = Number(s.balance);
        }
    });

    const totalDiesel = phFuel + damFuel + rwFuel;
    document.getElementById('diesel-powerhouse-main').textContent = `${phFuel.toFixed(2)} L`;
    document.getElementById('diesel-dam').textContent = `${damFuel.toFixed(2)} L`;
    document.getElementById('diesel-ropeway').textContent = `${rwFuel.toFixed(2)} L`;
    document.getElementById('diesel-total').textContent = `${totalDiesel.toFixed(2)} L`;

    // 2. Render Main Table
    const tbody = document.getElementById('stock-balance-body');
    const sorted = stock.sort((a, b) => a.balance - b.balance); 

    tbody.innerHTML = sorted.map(item => {
        let status = 'text-green-600';
        let warning = '';
        if (item.balance <= 2 && !item.store.includes('Plant')) {
             status = 'text-red-600 font-bold bg-red-50';
             warning = ' ⚠ CRITICAL';
        } else if (item.balance <= 5 && !item.store.includes('Plant')) {
             status = 'text-orange-500 font-semibold';
        }
        
        return `
        <tr class="border-t border-slate-100 ${status}">
            <td class="px-2 py-2 font-medium">${STORE_LABELS[item.store] || item.store}</td>
            <td class="px-2 py-2">${item.item} <span class="text-[10px] text-slate-400 block">${item.specification || ''}</span></td>
            <td class="px-2 py-2 font-bold">${Number(item.balance).toFixed(2)}${warning}</td>
            <td class="px-2 py-2 text-slate-500">${item.unit || ''}</td>
        </tr>
    `}).join('');
}

async function initDates() {
    document.getElementById('in-date').value = todayISO();
    document.getElementById('out-date').value = todayISO();
    await syncNepDate('in-date', 'in-nep-date');
    await syncNepDate('out-date', 'out-nep-date');

    document.getElementById('in-date').addEventListener('change', () => syncNepDate('in-date', 'in-nep-date'));
    document.getElementById('out-date').addEventListener('change', () => syncNepDate('out-date', 'out-nep-date'));
}

async function init() {
    await initializeApplication(true);
    setupTabs();
    bindInForm();
    bindOutForm();
    await initDates();
    renderReports(); // Load live data immediately on startup
}

init();