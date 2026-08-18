const supabaseUrl = 'https://eqynqdzlvvijuwidvdnx.supabase.co';
const supabaseKey = 'sb_publishable_hqVBxA1BfkSJqSbacWD00Q_wK74FCQI';
const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

let allData = [];
let tableRows = [];
let currentPage = 1;
let expandedCompanies = new Set();
const rowsPerPage = 50;

const DOM = {
    loading: document.getElementById('loading'),
    filterDateRange: document.getElementById('filter-date-range'),
    btnApplyFilters: document.getElementById('btn-apply-filters'),
    filterBuyer: document.getElementById('filter-buyer'),
    filterTraffic: document.getElementById('filter-traffic'),
    filterSegment: document.getElementById('filter-segment'),
    filterKeyword: document.getElementById('filter-keyword'),
    kpiRevenue: document.getElementById('kpi-revenue'),
    kpiClicks: document.getElementById('kpi-clicks'),
    kpiSearches: document.getElementById('kpi-searches'),
    kpiWidget: document.getElementById('kpi-widget'),
    tableBody: document.getElementById('table-body'),
    pagination: document.getElementById('pagination'),
    
    // Auth DOM
    loginContainer: document.getElementById('login-container'),
    dashboardContainer: document.getElementById('dashboard-container'),
    loginEmail: document.getElementById('login-email'),
    loginPassword: document.getElementById('login-password'),
    btnLogin: document.getElementById('btn-login'),
    btnLogout: document.getElementById('btn-logout'),
    loginError: document.getElementById('login-error')
};

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function getBuyerName(companyName) {
    if (!companyName) return 'Unknown';
    return companyName.split('_')[0];
}

function getTrafficSource(companyName) {
    if (!companyName) return 'Unknown';
    const parts = companyName.split('_');
    return parts.length > 1 ? parts[1] : 'Unknown';
}

async function checkSession() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        DOM.loginContainer.classList.add('hidden');
        DOM.dashboardContainer.classList.remove('hidden');
        initDashboard();
    } else {
        DOM.loginContainer.classList.remove('hidden');
        DOM.dashboardContainer.classList.add('hidden');
    }
}

async function handleLogin() {
    const email = DOM.loginEmail.value;
    const password = DOM.loginPassword.value;
    DOM.loginError.classList.add('hidden');
    DOM.btnLogin.textContent = 'Signing In...';
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    DOM.btnLogin.textContent = 'Sign In';
    
    if (error) {
        DOM.loginError.textContent = error.message;
        DOM.loginError.classList.remove('hidden');
    } else {
        checkSession();
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
    checkSession();
}

async function initDashboard() {
    DOM.loading.style.display = 'block';
    
    // Add event listeners
    DOM.btnApplyFilters.addEventListener('click', loadData);
    DOM.filterBuyer.addEventListener('change', applyFilters);
    DOM.filterTraffic.addEventListener('change', applyFilters);
    DOM.filterSegment.addEventListener('change', applyFilters);
    DOM.filterKeyword.addEventListener('input', debounce(applyFilters, 300));
    
    // Fetch filter options
    const { data, error } = await supabase.rpc('get_filter_options').limit(100000);
    if (error) {
        console.error("Filter error:", error);
        DOM.loading.textContent = 'Error loading filters: ' + error.message;
        return;
    }
    if (data && data.length > 0) {
        const opts = data[0];
        const dates = opts.dates || [];
        const sortedDates = [...dates].sort((a,b) => a.localeCompare(b));
        if(sortedDates.length > 0) {
            flatpickr(DOM.filterDateRange, {
                mode: 'range',
                defaultDate: [sortedDates[0], sortedDates[sortedDates.length - 1]],
                dateFormat: 'Y-m-d'
            });
        }
        
        const buyers = opts.buyers || [];
        [...buyers].sort().forEach(b => DOM.filterBuyer.add(new Option(b, b)));
        if (buyers.length <= 1) {
            DOM.filterBuyer.parentElement.style.display = 'none';
        }
        
        const traffic = opts.traffic_sources || [];
        [...traffic].sort().forEach(t => DOM.filterTraffic.add(new Option(t, t)));
        
        const segments = opts.segments || [];
        [...segments].sort().forEach(s => DOM.filterSegment.add(new Option(s, s)));
    }
    
    await loadData();
}

async function loadData() {
    DOM.loading.style.display = 'block';
    let p_start_date = null;
    let p_end_date = null;
    
    if (DOM.filterDateRange.value) {
        const parts = DOM.filterDateRange.value.split(' to ');
        p_start_date = parts[0];
        p_end_date = parts.length > 1 ? parts[1] : parts[0];
    }

    const { data, error } = await supabase.rpc('get_dashboard_summary', { p_start_date, p_end_date }).limit(100000);
    
    if (error) {
        console.error("Error fetching data:", error);
        DOM.loading.textContent = 'Error loading data: ' + error.message;
        return;
    }
    
    allData = data || [];
    DOM.loading.style.display = 'none';
    applyFilters();
}

function applyFilters() {
    const buyerVal = DOM.filterBuyer.value;
    const trafficVal = DOM.filterTraffic.value;
    const segVal = DOM.filterSegment.value;
    const kwVal = DOM.filterKeyword.value.toLowerCase();
    
    let filteredData = allData.filter(row => {
        if (segVal !== 'all' && row.segment !== segVal) return false;
        if (buyerVal !== 'all' && getBuyerName(row.company_name) !== buyerVal) return false;
        if (trafficVal !== 'all' && getTrafficSource(row.company_name) !== trafficVal) return false;
        if (kwVal && (!row.keyword || !row.keyword.toLowerCase().includes(kwVal))) return false;
        return true;
    });
    
    // Aggregate
    let aggregated = {};
    let grandRev = 0, grandClicks = 0, grandSearches = 0, grandWidget = 0;
    
    filteredData.forEach(row => {
        const comp = row.company_name || 'Unknown';
        const kw = row.keyword || 'Unknown';
        
        if (!aggregated[comp]) {
            aggregated[comp] = { totalRev: 0, totalClicks: 0, keywords: {} };
        }
        if (!aggregated[comp].keywords[kw]) {
            aggregated[comp].keywords[kw] = { rev: 0, clicks: 0, searches: 0, widget: 0, segment: row.segment };
        }
        
        const rev = parseFloat(row.total_revenue) || 0;
        const clicks = parseInt(row.total_clicks, 10) || 0;
        const searches = parseInt(row.total_searches, 10) || 0;
        const widget = parseInt(row.widget_searches, 10) || 0;
        
        aggregated[comp].totalRev += rev;
        aggregated[comp].totalClicks += clicks;
        aggregated[comp].keywords[kw].rev += rev;
        aggregated[comp].keywords[kw].clicks += clicks;
        aggregated[comp].keywords[kw].searches += searches;
        aggregated[comp].keywords[kw].widget += widget;
        
        grandRev += rev;
        grandClicks += clicks;
        grandSearches += searches;
        grandWidget += widget;
    });
    
    // Update KPIs
    DOM.kpiRevenue.textContent = `$${grandRev.toFixed(2)}`;
    DOM.kpiClicks.textContent = grandClicks.toLocaleString();
    DOM.kpiSearches.textContent = grandSearches.toLocaleString();
    DOM.kpiWidget.textContent = grandWidget.toLocaleString();
    
    // Flatten for table display
    tableRows = [];
    Object.entries(aggregated).sort((a,b) => b[1].totalRev - a[1].totalRev).forEach(([comp, data]) => {
        tableRows.push({ isHeader: true, company: comp, rev: data.totalRev, clicks: data.totalClicks });
        
        if (expandedCompanies.has(comp)) {
            let kws = Object.entries(data.keywords).sort((a,b) => b[1].rev - a[1].rev);
            kws.forEach(([kw, kwData]) => {
                tableRows.push({
                    isHeader: false,
                    keyword: kw,
                    rev: kwData.rev,
                    clicks: kwData.clicks,
                    searches: kwData.searches,
                    widget: kwData.widget,
                    segment: kwData.segment
                });
            });
        }
    });
    
    currentPage = 1;
    renderTable();
}

function renderTable() {
    DOM.tableBody.innerHTML = '';
    
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const pageData = tableRows.slice(start, end);
    
    pageData.forEach(row => {
        const tr = document.createElement('tr');
        if (row.isHeader) {
            const isExpanded = expandedCompanies.has(row.company);
            tr.className = 'bg-slate-700/40 border-t border-slate-600 hover:bg-slate-700/60 transition-colors cursor-pointer';
            tr.innerHTML = `
                <td class="px-6 py-3 font-semibold text-blue-300 flex items-center gap-2">
                    <span class="text-slate-400 font-bold w-4 text-center">${isExpanded ? '−' : '+'}</span>
                    ${row.company}
                </td>
                <td class="px-6 py-3 text-right font-bold text-white">$${row.rev.toFixed(2)}</td>
                <td class="px-6 py-3 text-right font-semibold text-slate-300">${row.clicks}</td>
                <td class="px-6 py-3 text-right font-semibold text-emerald-300">$${(row.clicks > 0 ? row.rev / row.clicks : 0).toFixed(2)}</td>
                <td class="px-6 py-3" colspan="3"></td>
            `;
            tr.addEventListener('click', () => {
                if (expandedCompanies.has(row.company)) {
                    expandedCompanies.delete(row.company);
                } else {
                    expandedCompanies.add(row.company);
                }
                applyFilters();
            });
        } else {
            tr.className = 'hover:bg-slate-700/30 transition-colors group';
            tr.innerHTML = `
                <td class="px-6 py-3 pl-14 font-medium text-emerald-400 group-hover:text-emerald-300 transition-colors">↳ ${row.keyword}</td>
                <td class="px-6 py-3 text-right text-slate-200">$${row.rev.toFixed(2)}</td>
                <td class="px-6 py-3 text-right text-slate-300">${row.clicks}</td>
                <td class="px-6 py-3 text-right text-emerald-400">$${(row.clicks > 0 ? row.rev / row.clicks : 0).toFixed(2)}</td>
                <td class="px-6 py-3 text-right text-slate-400">${row.searches}</td>
                <td class="px-6 py-3 text-right text-slate-400">${row.widget}</td>
                <td class="px-6 py-3 text-slate-500 text-xs">${(row.segment || '').replace('rsoc.aa.answersfast.', '')}</td>
            `;
        }
        DOM.tableBody.appendChild(tr);
    });
    
    renderPagination();
}

function renderPagination() {
    const totalPages = Math.ceil(tableRows.length / rowsPerPage) || 1;
    DOM.pagination.innerHTML = '';
    
    const btnPrev = document.createElement('button');
    btnPrev.textContent = 'Previous';
    btnPrev.className = `px-3 py-1 rounded-md text-sm ${currentPage === 1 ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-600 text-white hover:bg-slate-500'}`;
    btnPrev.disabled = currentPage === 1;
    btnPrev.onclick = () => { currentPage--; renderTable(); };
    DOM.pagination.appendChild(btnPrev);
    
    const span = document.createElement('span');
    span.textContent = `Page ${currentPage} of ${totalPages}`;
    span.className = 'text-sm text-slate-400';
    DOM.pagination.appendChild(span);
    
    const btnNext = document.createElement('button');
    btnNext.textContent = 'Next';
    btnNext.className = `px-3 py-1 rounded-md text-sm ${currentPage === totalPages ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-slate-600 text-white hover:bg-slate-500'}`;
    btnNext.disabled = currentPage === totalPages;
    btnNext.onclick = () => { currentPage++; renderTable(); };
    DOM.pagination.appendChild(btnNext);
}

// Init
DOM.btnLogin.addEventListener('click', handleLogin);
DOM.btnLogout.addEventListener('click', handleLogout);

checkSession();
