/* app.js - Dashboard Inventario & Ventas (completo) 
   Compatible con el HTML que me pasaste.
   Requiere Chart.js, html2canvas y jspdf (ya los tienes en el HTML).
*/

const LS_PRODUCTS = 'inventory_products';
const LS_SALES = 'inventory_sales';

/* ---------- Util ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from((root || document).querySelectorAll(sel));

const formatCurrency = n => '$ ' + (Number(n) || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 });
const nowISO = () => new Date().toISOString();
const dateReadable = iso => iso ? new Date(iso).toLocaleString() : '';
const cryptoId = () => 'id_' + Math.random().toString(36).slice(2, 9);
const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"':'&quot;', "'":'&#39;' })[c]);

/* ---------- Seed (sample data si vacío) ---------- */
function seedIfEmpty() {
  if (!localStorage.getItem(LS_PRODUCTS)) {
    localStorage.setItem(LS_PRODUCTS, "[]");
  }
  if (!localStorage.getItem(LS_SALES)) {
    localStorage.setItem(LS_SALES, "[]");
  }
}


/* ---------- Storage helpers ---------- */
const loadProducts = () => JSON.parse(localStorage.getItem(LS_PRODUCTS) || '[]');
const saveProducts = (arr) => localStorage.setItem(LS_PRODUCTS, JSON.stringify(arr));
const loadSales = () => JSON.parse(localStorage.getItem(LS_SALES) || '[]');
const saveSales = (arr) => localStorage.setItem(LS_SALES, JSON.stringify(arr));





/* ---------- Ensure modals & analysis-table exist ---------- */
function ensureUiExtras() {
  // Product modal (create if missing)
  if (!$('#modalOverlay')) {
    const html = `
      <div id="modalOverlay" class="modal-overlay hidden" style="display:none;">
        <div class="modal card" id="productModal" style="max-width:420px;">
          <button id="closeModal" class="modal-close">✕</button>
          <h2 id="modalTitle">Nuevo Producto</h2>
          <form id="productForm" class="form-grid">
            <input id="p_id" type="hidden">
            <label>Nombre*<input id="p_name" required /></label>
            <label>Marca*<input id="p_brand" required /></label>
            <label>Categoría<input id="p_category" /></label>
            <label>Subcategoría<input id="p_subcategory" /></label>
            <label>Costo por Unidad*<input id="p_cost" type="number" min="0" step="0.01" required /></label>
            <label>% Margen*<input id="p_margin" type="number" min="0" step="0.01" value="100" required /></label>
            <label>Cantidad*<input id="p_qty" type="number" min="0" step="1" value="1" required /></label>
            <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
              <button type="button" id="cancelModal" class="btn ghost">Cancelar</button>
              <button type="submit" class="btn primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
    $('#modalOverlay').style.display = ''; // take out display:none placeholder

    // <<-- FIX: attach submit listener right after creating the modal so the listener is not lost
    const productForm = $('#productForm');
    if (productForm && !productForm.__productSubmitAttached) {
      productForm.addEventListener('submit', e => {
        e.preventDefault();

        // grab current products
        const products = loadProducts();
        const id = editingId || cryptoId();

        const product = {
          id,
          name: $('#p_name').value.trim(),
          brand: $('#p_brand').value.trim(),
          category: $('#p_category').value.trim(),
          subcategory: $('#p_subcategory').value.trim(),
          cost: parseFloat($('#p_cost').value.replace(/[^\d]/g, '')) || 0,
          marginPercent: parseFloat($('#p_margin').value) || 0,
          qty: parseInt($('#p_qty').value) || 0,
          sold: editingId ? products.find(p => p.id === editingId)?.sold || 0 : 0,
          createdAt: nowISO()
        };

        if (editingId) {
          const idx = products.findIndex(p => p.id === editingId);
          if (idx !== -1) products[idx] = product;
        } else {
          products.push(product);
        }

        saveProducts(products);
        hide('#modalOverlay');
        renderAll();
      });
      // mark so we don't attach twice
      productForm.__productSubmitAttached = true;
    }

    // Formatear automáticamente el campo de costo en pesos colombianos
   const costInput = $('#p_cost');
   if (costInput && !costInput.__formatListener) {
   costInput.addEventListener('input', () => {
   const val = costInput.value.replace(/[^\d]/g, '');
   if (!val) return;
   const num = Number(val);
   if (num >= 1000) {
      costInput.value = num.toLocaleString('es-CO');
    } else {
      costInput.value = val;
    }
  });
  costInput.addEventListener('blur', () => {
    const val = costInput.value.replace(/[^\d]/g, '');
    if (val) costInput.value = Number(val).toLocaleString('es-CO');
  });
  costInput.__formatListener = true;
}

    // end FIX
  }

  // Sell modal
  if (!$('#sellOverlay')) {
    const sellHtml = `
      <div id="sellOverlay" class="modal-overlay hidden" style="display:none;">
        <div class="modal card" id="sellModal" style="max-width:420px;">
          <button id="closeSellModal" class="modal-close">✕</button>
          <h2>Vender Producto</h2>
          <form id="sellForm" class="form-grid">
            <div id="sellProductInfo" style="font-weight:600;margin-bottom:6px;"></div>
            <label>Cantidad*<input id="sell_qty" type="number" min="1" value="1" required /></label>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <div style="flex:1;">
                <label>Método de Pago 1
                  <select id="paymentMethod1">
                    <option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Datafono">Datafono</option>
                    <option value="Sistecredito">Sistecredito</option><option value="Addi">Addi</option>
                  </select>
                </label>
                <label>Monto 1<input id="amount1" type="number" min="0" value="0" /></label>
              </div>
              <div style="flex:1;">
                <label>Método de Pago 2
                  <select id="paymentMethod2">
                    <option value="">Ninguno</option><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Datafono">Datafono</option><option value="Sistecredito">Sistecredito</option><option value="Addi">Addi</option>
                  </select>
                </label>
                <label>Monto 2<input id="amount2" type="number" min="0" value="0" /></label>
              </div>
            </div>
            <div class="totalDisplay" style="margin-top:6px;">Total Venta: $0</div>
            <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
              <button type="button" id="cancelSell" class="btn ghost">Cancelar</button>
              <button type="submit" class="btn primary">Confirmar Venta</button>
            </div>
          </form>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', sellHtml);
    $('#sellOverlay').style.display = '';

    // Añadir listeners del formulario de venta una vez creado
const sellForm = $('#sellForm');
if (sellForm && !sellForm.__listenersAttached) {
  sellForm.addEventListener('input', updateSellTotals);

  sellForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sellingProductId) return alert('Producto no seleccionado');
    const qty = Math.max(0, Number($('#sell_qty').value) || 0);
    if (qty <= 0) return alert('Cantidad inválida');
    const products = loadProducts();
    const idx = products.findIndex(p => p.id === sellingProductId);
    if (idx === -1) return alert('Producto no encontrado');
    const prod = products[idx];
    if (qty > prod.qty) return alert('Stock insuficiente');

    const unit = computeUnitPrice(prod);
    const total = unit * qty;
    const profit = (unit - (prod.cost || 0)) * qty;

    let amount1 = Number($('#amount1').value) || 0;
    let amount2 = Number($('#amount2').value) || 0;
    if (amount1 > total) amount1 = total;
    if (amount1 + amount2 > total) amount2 = total - amount1;

    // Actualizar inventario
    prod.qty = Math.max(0, prod.qty - qty);
    prod.sold = (prod.sold || 0) + qty;
    products[idx] = prod;
    saveProducts(products);

    // Registrar venta
    const sales = loadSales();
    sales.unshift({
      id: cryptoId(),
      productId: prod.id,
      name: prod.name,
      brand: prod.brand || '',
      qty,
      total,
      profit,
      method1: $('#paymentMethod1').value || 'Efectivo',
      amount1,
      method2: $('#paymentMethod2').value || '',
      amount2,
      timestamp: nowISO()
    });
    saveSales(sales);

    hide('#sellOverlay');
    renderAll();
  });

  sellForm.__listenersAttached = true;
}

  }

 // Ensure brandAnalysisTable exists inside analysis; if not, create a card with it
if (!$('#brandAnalysisTable')) {
  const analysis = $('#analysis');
  if (analysis) {
    const node = document.createElement('div');
    node.className = 'card table-card';
    node.style.marginTop = '10px';
    node.innerHTML = `
      <h3>Análisis por Marca</h3>
      <input id="searchBrandAnalysis" placeholder="Buscar marca..." 
             style="padding:8px; border-radius:6px; width:100%; margin:10px 0;">
      <div style="overflow:auto;">
        <table id="brandAnalysisTable" style="width:100%;">
          <thead>
            <tr><th>Marca</th><th>Productos</th><th>Vendidos</th>
                <th>Inversión</th><th>Ventas</th><th>Ganancia</th></tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    const chartCard = $('#analysis .card.chart-row');
    if (chartCard) analysis.insertBefore(node, chartCard);
    else analysis.appendChild(node);
  }
}

}

/* ---------- Modal helpers ---------- */
function show(selector) { const el = document.querySelector(selector); if (el) el.classList.remove('hidden'); }
function hide(selector) { const el = document.querySelector(selector); if (el) el.classList.add('hidden'); }

/* ---------- Inventory rendering ---------- */
function renderInventoryTable(filter = '') {
  const tbody = $('#inventoryTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const q = (filter || '').trim().toLowerCase();
  const products = loadProducts();

  // Only show products with qty > 0 in inventory
  products
    .filter(p => (p.qty || 0) > 0)
    .filter(p => {
      if (!q) return true;
      return (p.name || '').toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
    })
    .forEach(p => {
      const price = Math.round((p.cost || 0) * (1 + (p.marginPercent || 0)/100));
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input class="row-select" data-id="${p.id}" type="checkbox"></td>
        <td>${esc(p.name)}</td>
        <td>${esc(p.brand||'')}</td>
        <td>${formatCurrency(price)}</td>
        <td>${p.qty}</td>
        <td style="color:#45d37a">${p.sold||0}</td>
        <td>
          <button class="btn ghost sell-btn" data-id="${p.id}">Vender</button>
          <button class="btn ghost edit-btn" data-id="${p.id}">Editar</button>
          <button class="btn ghost delete-btn" data-id="${p.id}">Eliminar</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  updateSelectedCount();
}

/* ---------- Sales rendering ---------- */
function renderSalesTable(filter = '') {
  const tbody = $('#salesTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const kpiBox = $('#salesKpiBox');
  if (!kpiBox) return;

  const q = (filter || '').trim().toLowerCase();
  const sales = loadSales();

  // === FILTRAR ===
  const filtered = sales.filter(s => {
    if (!q) return true;
    return (
      (s.name || '').toLowerCase().includes(q) ||
      (s.brand || '').toLowerCase().includes(q) ||
      (s.method1 || '').toLowerCase().includes(q) ||
      (s.method2 || '').toLowerCase().includes(q)
    );
  });

  // === CALCULAR KPI GENERAL ===
  const totalGeneral = filtered.reduce((sum, s) => sum + (s.total || 0), 0);

  // === MÉTODOS DE PAGO A CONTROLAR ===
  const metodos = ["Efectivo", "Transferencia", "Datafono", "Sistecredito", "Addi"];

  // === CALCULAR TOTAL POR MÉTODO ===
  const totales = {};
  metodos.forEach(m => totales[m] = 0);

  filtered.forEach(s => {
    if (metodos.includes(s.method1)) totales[s.method1] += (s.amount1 || 0);
    if (metodos.includes(s.method2)) totales[s.method2] += (s.amount2 || 0);
  });

  // === MOSTRAR KPI ===
  kpiBox.innerHTML = `
    <div><strong>Total ventas ${q ? '(filtradas)' : '(del día)'}:</strong> ${formatCurrency(totalGeneral)}</div>

    <div style="margin-top:6px; font-size:0.92em; opacity:0.85; line-height:1.6;">
      Efectivo: ${formatCurrency(totales.Efectivo)} &nbsp;|&nbsp;
      Transferencia: ${formatCurrency(totales.Transferencia)} &nbsp;|&nbsp;
      Datafono: ${formatCurrency(totales.Datafono)} &nbsp;|&nbsp;
      Sistecredito: ${formatCurrency(totales.Sistecredito)} &nbsp;|&nbsp;
      Addi: ${formatCurrency(totales.Addi)}
    </div>
  `;

  // === PINTAR TABLA ===
  filtered.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="sale-select" data-id="${s.id}"></td>
      <td>${esc(s.name)}</td>
      <td>${esc(s.brand||'')}</td>
      <td>${s.qty}</td>
      <td>${formatCurrency(s.total)}</td>
      
      <td>
        ${esc(s.method1 || '')}
        ${s.amount1 ? `<div style="font-size:0.8em;color:#45d37a;">${formatCurrency(s.amount1)}</div>` : ''}
      </td>
      <td>
        ${esc(s.method2 || '')}
        ${s.amount2 ? `<div style="font-size:0.8em;color:#45d37a;">${formatCurrency(s.amount2)}</div>` : ''}
      </td>
      <td>${dateReadable(s.timestamp)}</td>
    `;
    tbody.appendChild(tr);
  });
}



/* ---------- Sold table: only products fully sold (qty === 0 && sold > 0) ---------- */
function renderSoldTable() {
  const tbody = $('#soldTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const products = loadProducts();
  products
    .filter(p => (p.qty === 0) && (p.sold || 0) > 0)
    .forEach(p => {
      const price = Math.round((p.cost || 0) * (1 + (p.marginPercent || 0)/100));
      const totalCost = (p.cost || 0) * (p.sold || 0);
      const totalSales = price * (p.sold || 0);
      const profit = (price - (p.cost || 0)) * (p.sold || 0);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${esc(p.name)}</td><td>${esc(p.brand||'')}</td>
        <td>${formatCurrency(price)}</td>
        <td>${p.sold||0}</td>
      `;
      tbody.appendChild(tr);
    });

      // Escuchar clicks en los botones eliminar
  $$('#soldTable .btn-delete-sold').forEach(btn => {
    btn.addEventListener('click', e => {
      const index = e.target.dataset.index;
      deleteSoldProduct(index);
    });
  });
}


// ---------- Eliminar todos los productos vendidos ----------
$('#deleteAllSoldBtn')?.addEventListener('click', () => {
  if (!confirm('¿Eliminar todos los productos vendidos (agotados)?')) return;
  const products = loadProducts();
  const remaining = products.filter(p => !(p.qty === 0 && (p.sold || 0) > 0));
  saveProducts(remaining);
  renderAll();
});


/* ---------- Brand analysis table ---------- */
// ---------- Render Análisis por Marca (con filtro por marca o producto) ----------
function renderBrandAnalysis(filter = '') {
  const tbody = $('#brandAnalysisTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const products = loadProducts();
  const sales = loadSales();

  const brands = {};
  const search = filter.trim().toLowerCase();

  // Crear estructura base
  products.forEach(p => {
    const brand = p.brand || 'Sin marca';
    const prodName = p.name || 'Desconocido';
    if (!brands[brand]) brands[brand] = {
      brand,
      productCount: 0,
      sold: 0,
      costTotal: 0,
      salesTotal: 0,
      profit: 0,
      products: []
    };
    brands[brand].productCount++;
    brands[brand].products.push(p);
  });

  // Agregar datos de ventas
  sales.forEach(s => {
    const brand = s.brand || 'Sin marca';
    if (!brands[brand]) brands[brand] = {
      brand,
      productCount: 0,
      sold: 0,
      costTotal: 0,
      salesTotal: 0,
      profit: 0,
      products: []
    };
    brands[brand].sold += s.qty || 0;
    brands[brand].salesTotal += s.total || 0;
    brands[brand].profit += s.profit || 0;

    const prod = products.find(p => p.id === s.productId);
    if (prod) brands[brand].costTotal += (prod.cost || 0) * (s.qty || 0);
  });

  // Aplicar filtro
  const filtered = Object.values(brands).filter(b => {
    if (!search) return true;
    const matchBrand = b.brand.toLowerCase().includes(search);
    const matchProduct = b.products.some(p => p.name.toLowerCase().includes(search));
    return matchBrand || matchProduct;
  });

  // Renderizar tabla principal
  filtered.forEach(b => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="clickable-brand" style="color:#7f5af0;cursor:pointer;">${esc(b.brand)}</td>
      <td>${b.productCount}</td>
      <td>${b.sold}</td>
      <td>${formatCurrency(b.costTotal)}</td>
      <td>${formatCurrency(b.salesTotal)}</td>
      <td style="color:#45d37a;">${formatCurrency(b.profit)}</td>
    `;
    tr.querySelector('.clickable-brand').addEventListener('click', () => showBrandDetail(b.brand));
    tbody.appendChild(tr);
  });

  if (!filtered.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;opacity:.6;">Sin resultados</td>`;
    tbody.appendChild(tr);
  }
}

function showBrandDetail(brandName) {
  const modal = $('#brandDetailModal');
  const title = $('#brandDetailTitle');
  const tbody = $('#brandDetailBody');
  const products = loadProducts().filter(p => (p.brand || 'Sin marca') === brandName);

  title.textContent = `Productos de ${brandName}`;
  tbody.innerHTML = '';

  products.forEach(p => {
    const qty = Number(p.qty || 0);
    const cost = Number(p.cost || 0);
    const total = qty * cost;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(p.name)}</td>
      <td>${qty}</td>
      <td>${formatCurrency(cost)}</td>
      <td>${formatCurrency(total)}</td>
    `;
    tbody.appendChild(tr);
  });

  if (!products.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="4" style="text-align:center;opacity:.6;">Sin productos</td>`;
    tbody.appendChild(tr);
  }

  modal.classList.remove('hidden');
}

// Cerrar modal
$('#closeBrandDetail').addEventListener('click', () => {
  $('#brandDetailModal').classList.add('hidden');
});
$('#brandDetailModal').addEventListener('click', e => {
  if (e.target.id === 'brandDetailModal') $('#brandDetailModal').classList.add('hidden');
});



// ---------- Buscador para tabla de Análisis por Marca ----------
document.addEventListener('input', e => {
  if (e.target.id === 'searchBrandAnalysis') {
    const filter = e.target.value.trim().toLowerCase();
    renderBrandAnalysis(filter);
  }
});


/* ---------- Stats & Charts ---------- */
let salesByMonthChart = null, topProductsChart = null;

function renderStatsAndCharts() {
  console.log("📊 Iniciando renderStatsAndCharts()...");

  const sales = loadSales();
  const products = loadProducts();

  // === Totales ===
  const totalRevenue = sales.reduce((acc, s) => acc + (s.total || 0), 0);
  const totalProfit = sales.reduce((acc, s) => acc + (s.profit || 0), 0);
  const totalItems = sales.reduce((acc, s) => acc + (s.qty || 0), 0);

  const stTotalSales = $('#statTotalSales');
  const stTotalProfit = $('#statTotalProfit');
  const stTotalItems = $('#statTotalItems');
  const stMargin = $('#statMargin');
  const stToday = $('#statTodaySales');
  const stMonth = $('#statMonthSales');

  // === Plantilla de KPI ===
  function makeKPI(id, label, value, fontSize = '1.6rem', showLabel = false) {
    return `
      <div class="kpi-wrapper" data-id="${id}">
        ${showLabel ? `<span class="kpi-label">${label}:</span>` : ''}
        <div class="kpi-content">
          <span class="kpi-value" data-visible="false" style="font-size:${fontSize};font-weight:700;">***</span>
          <button class="toggle-visibility" title="Mostrar valor">
            <i class="fas fa-eye"></i>
          </button>
        </div>
        <span class="kpi-real-value" style="display:none;">${value}</span>
      </div>
    `;
  }

  // === Insertar KPI Totales ===
  if (stTotalSales)
    stTotalSales.innerHTML = makeKPI('totalSales', 'Ventas totales', formatCurrency(totalRevenue), '1.6rem', false);
  if (stTotalProfit)
    stTotalProfit.innerHTML = makeKPI('totalProfit', 'Ganancia total', formatCurrency(totalProfit), '1.6rem', false);
  if (stTotalItems)
    stTotalItems.innerHTML = makeKPI('totalItems', 'Productos vendidos', `${totalItems} productos`, '1rem', true);
  if (stMargin)
    stMargin.innerHTML = makeKPI('margin', 'Margen', totalRevenue ? Math.round((totalProfit / totalRevenue) * 100) + '%' : '0%', '1.6rem', true);

  // === Ventas de hoy y del mes ===
  const now = new Date();
  const offsetBogota = -5 * 60;
  const nowBogota = new Date(now.getTime() + (offsetBogota + now.getTimezoneOffset()) * 60000);
  const todayKey = nowBogota.toISOString().slice(0, 10);
  const monthKey = nowBogota.toISOString().slice(0, 7);

  const salesToday = sales
    .filter(s => {
      if (!s.timestamp) return false;
      const saleDate = new Date(s.timestamp);
      const saleBogota = new Date(saleDate.getTime() + (offsetBogota + saleDate.getTimezoneOffset()) * 60000);
      return saleBogota.toISOString().slice(0, 10) === todayKey;
    })
    .reduce((a, b) => a + (b.total || 0), 0);

  const salesThisMonth = sales
    .filter(s => (s.timestamp || '').slice(0, 7) === monthKey)
    .reduce((a, b) => a + (b.total || 0), 0);

  // === Aplicar mismo formato KPI a hoy y mes ===
  if (stToday)
    stToday.innerHTML = makeKPI('todaySales', ' ', formatCurrency(salesToday), '1.4rem', true);
  if (stMonth)
    stMonth.innerHTML = makeKPI('monthSales', ' ', formatCurrency(salesThisMonth), '1.4rem', true);

  // === Ventas por mes (últimos 12 meses) ===
  const months = [], labels = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    labels.push(d.toLocaleString('es-ES', { month: 'short', year: 'numeric' }));
    months.push({ key, total: 0 });
  }

  sales.forEach(s => {
    const key = (s.timestamp || '').slice(0, 7);
    const m = months.find(x => x.key === key);
    if (m) m.total += s.total || 0;
  });

  const ctx1 = $('#salesByMonthChart')?.getContext && $('#salesByMonthChart').getContext('2d');
  if (ctx1) {
    if (window.salesByMonthChart instanceof Chart) window.salesByMonthChart.destroy();
    window.salesByMonthChart = new Chart(ctx1, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Ventas',
          data: months.map(m => m.total),
          borderColor: '#7f5af0',
          backgroundColor: 'rgba(127,90,240,0.16)',
          fill: true,
          tension: 0.25
        }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  // === Productos top ===
  const productMap = {};
  sales.forEach(s => {
    const id = s.productId || s.name;
    if (!productMap[id]) productMap[id] = { name: s.name || 'Desconocido', sold: 0 };
    productMap[id].sold += s.qty || 0;
  });
  products.forEach(p => {
    if (!productMap[p.id]) productMap[p.id] = { name: p.name, sold: p.sold || 0 };
  });

  const top = Object.values(productMap).sort((a, b) => b.sold - a.sold).slice(0, 6);
  const ctx2 = $('#topProductsChart')?.getContext && $('#topProductsChart').getContext('2d');
  if (ctx2) {
    if (window.topProductsChart instanceof Chart) window.topProductsChart.destroy();
    window.topProductsChart = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: top.map(t => t.name),
        datasets: [{ label: 'Unidades', data: top.map(t => t.sold), backgroundColor: 'rgba(59,130,246,0.85)' }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  // === Inversión por producto ===
  const investmentMap = {};
  products.forEach(p => {
    const name = (p.name || 'Sin nombre').trim();
    const unitCost = Number(p.cost || p.price || 0);
    const qty = Number(p.qty || 0);
    const invested = unitCost * qty;
    if (invested > 0) investmentMap[name] = invested;
  });

  const productLabels = Object.keys(investmentMap);
  const productInvestments = Object.values(investmentMap);
  const totalInvestment = productInvestments.reduce((a, b) => a + b, 0);

  const ctx3 = document.querySelector('#investmentByBrandChart')?.getContext('2d');
  if (ctx3) {
    if (window.investmentByBrandChart instanceof Chart) window.investmentByBrandChart.destroy();
    window.investmentByBrandChart = new Chart(ctx3, {
      type: 'bar',
      data: {
        labels: productLabels.length ? productLabels : ['Sin datos'],
        datasets: [{
          label: 'Inversión por producto (COP)',
          data: productInvestments.length ? productInvestments : [0],
          backgroundColor: 'rgba(127, 90, 240, 0.85)',
          borderRadius: 6
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          title: { display: true, text: `Total invertido: ${formatCurrency(totalInvestment)}` },
          tooltip: { callbacks: { label: ctx => formatCurrency(ctx.raw) } }
        },
        scales: { y: { beginAtZero: true, ticks: { callback: v => formatCurrency(v) } } }
      }
    });
  }

  console.log("✅ renderStatsAndCharts() completado sin errores.");
}


// === Toggle KPI visibility ===
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-visibility');
  if (!btn) return;

  const wrapper = btn.closest('.kpi-wrapper');
  const valueEl = wrapper.querySelector('.kpi-value');
  const realValueEl = wrapper.querySelector('.kpi-real-value');
  const icon = btn.querySelector('i');
  const isVisible = valueEl.dataset.visible === 'true';

  if (isVisible) {
    valueEl.textContent = '***';
    valueEl.dataset.visible = 'false';
    icon.classList.replace('fa-eye-slash', 'fa-eye');
  } else {
    valueEl.textContent = realValueEl.textContent;
    valueEl.dataset.visible = 'true';
    icon.classList.replace('fa-eye', 'fa-eye-slash');
  }
});





/* ---------- Reiniciar ventas diarias a medianoche (hora Bogotá o UTC) ---------- */
function scheduleDailyReset() {
  console.log("⏰ Iniciando verificación de reinicio diario...");

  const lastReset = localStorage.getItem('lastDailyReset');
  const now = new Date();

  // Convertir hora local de Bogotá (UTC-5) a UTC
  const nowUTC = new Date(now.getTime() + now.getTimezoneOffset() * 60000);

  // Fecha actual en formato YYYY-MM-DD (según UTC o Bogotá)
  const todayKey = nowUTC.toISOString().slice(0, 10);

  // Si nunca se ha reiniciado, guardamos la fecha actual
  if (!lastReset) {
    localStorage.setItem('lastDailyReset', todayKey);
    console.log("📅 Primera inicialización de lastDailyReset:", todayKey);
    return;
  }

  // Si ya cambió el día → reiniciar contador diario
  if (lastReset !== todayKey) {
    console.log(`🔄 Día cambió (${lastReset} → ${todayKey}). Reiniciando ventas diarias...`);

    // Reiniciar el valor visible
    const stToday = document.querySelector('#statTodaySales');
    if (stToday) stToday.textContent = '$ 0';

    // Guardar la nueva fecha de reinicio
    localStorage.setItem('lastDailyReset', todayKey);

    // Recalcular y volver a renderizar todo
    renderStatsAndCharts();
  } else {
    console.log("✅ Día no ha cambiado. Sin reinicio necesario.");
  }
}

// Llamar la función cada cierto tiempo para asegurarse de detectar el cambio
setInterval(scheduleDailyReset, 60 * 1000); // cada minuto
scheduleDailyReset(); // ejecutar inmediatamente al cargar


/* ---------- Create / Wire modals behavior ---------- */
function wireModals() {
  // product modal buttons
  $('#closeModal')?.addEventListener('click', () => hide('#modalOverlay'));
  $('#cancelModal')?.addEventListener('click', () => hide('#modalOverlay'));

  // sell modal buttons
  $('#closeSellModal')?.addEventListener('click', () => hide('#sellOverlay'));
  $('#cancelSell')?.addEventListener('click', () => hide('#sellOverlay'));

  // product editing/creation handled in product form listener further down (attached inside ensureUiExtras)
}

// ---------- Evento botón "Agregar Producto" ----------
$('#addProductBtn')?.addEventListener('click', () => {
  editingId = null; // asegura que no sea una edición
  $('#modalTitle').textContent = 'Nuevo Producto';
  // reset inputs if the modal exists
  const formEl = document.querySelector('#productForm');
  if (formEl) formEl.reset();
  show('#modalOverlay');
});


/* ---------- Product add / edit form ---------- */
let editingId = null;

/* NOTE:
   The original code attempted to query '#productForm' very early in the script
   before ensureUiExtras() created it, which meant the submit listener was never attached.
   That logic has been moved into ensureUiExtras() (see above). We keep editingId here.
*/

/* ---------- Edit / Delete / Sell (delegated) ---------- */
$('#inventoryTable')?.addEventListener('click', (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  if (e.target.classList.contains('edit-btn')) {
    const p = loadProducts().find(x=>x.id===id);
    if (!p) return;
    // open modal with data
    editingId = p.id;
    $('#modalTitle').textContent = 'Editar Producto';
    $('#p_name').value = p.name || '';
    $('#p_brand').value = p.brand || '';
    $('#p_category').value = p.category || '';
    $('#p_subcategory').value = p.subcategory || '';
    $('#p_cost').value = p.cost || 0;
    $('#p_margin').value = p.marginPercent || 0;
    $('#p_qty').value = p.qty || 0;
    show('#modalOverlay');
  } else if (e.target.classList.contains('delete-btn')) {
    if (!confirm('Eliminar producto definitivamente?')) return;
    const remaining = loadProducts().filter(p => p.id !== id);
    saveProducts(remaining);
    renderAll();
  } else if (e.target.classList.contains('sell-btn')) {
    openSellModal(id);
  }
});

/* ---------- Selected count and bulk delete for inventory ---------- */
function updateSelectedCount() {
  const cnt = $$('.row-select:checked').length;
  const btn = $('#deleteSelectedBtn');
  if (btn) btn.textContent = `Eliminar Seleccionados (${cnt})`;
}
$('#selectAllProducts')?.addEventListener('change', function() {
  const checked = this.checked;
  $$('.row-select').forEach(cb => cb.checked = checked);
  updateSelectedCount();
});
document.addEventListener('change', (e) => {
  if (e.target.classList && e.target.classList.contains('row-select')) updateSelectedCount();
});
$('#deleteSelectedBtn')?.addEventListener('click', () => {
  const ids = $$('.row-select:checked').map(n=>n.dataset.id);
  if (!ids.length) return alert('No hay seleccionados');
  if (!confirm('Eliminar seleccionados?')) return;
  const remaining = loadProducts().filter(p => !ids.includes(p.id));
  saveProducts(remaining);
  renderAll();
});

/* ---------- Sell modal logic (inteligente) ---------- */
let sellingProductId = null;
function openSellModal(productId) {
  sellingProductId = productId;
  const product = loadProducts().find(p => p.id === productId);
  if (!product) return alert('Producto no encontrado');

  const price = computeUnitPrice(product);
  const initialTotal = price * 1;

  $('#sellProductInfo').innerHTML = `
  <strong>${esc(product.name)}</strong><br>
  Stock disponible: ${product.qty}<br>
  Precio unitario: <strong style="font-size:12px; color:#45d37a;"> ${formatCurrency(price)} </strong>
`;

  $('#sell_qty').value = 1;
  $('#paymentMethod1').value = 'Efectivo';
  $('#paymentMethod2').value = '';
  $('#amount1').value = initialTotal;
  $('#amount2').value = 0;

  $('.totalDisplay').textContent = `Total Venta: ${formatCurrency(initialTotal)}`;
  updateSellTotals();
  show('#sellOverlay');
}


function computeUnitPrice(product) {
  return Math.round((product.cost || 0) * (1 + (product.marginPercent || 0)/100));
}

function updateSellTotals() {
  if (!sellingProductId) return;

  const product = loadProducts().find(p => p.id === sellingProductId);
  if (!product) return;

  const qty = Math.max(0, Number($('#sell_qty').value) || 0);
  const price = computeUnitPrice(product);
  const total = price * qty;

  const paymentMethod2 = $('#paymentMethod2').value;
  const amount1Input = $('#amount1');
  const amount2Input = $('#amount2');

  let amount1 = Number(amount1Input.value) || 0;
  let amount2 = Number(amount2Input.value) || 0;

  console.log("🧮 Depuración updateSellTotals()");
  console.log("Cantidad:", qty, "Precio unitario:", price, "Total:", total);
  console.log("Método 2:", paymentMethod2);

  // Caso 1: no hay método de pago 2
  if (!paymentMethod2) {
    amount1 = total; // todo el monto en el primer método
    amount2 = 0;
  } 
  // Caso 2: hay método 2 seleccionado
  else {
    // Si el monto1 supera el total, lo ajustamos
    if (amount1 > total) amount1 = total;

    // Calculamos el restante
    amount2 = Math.max(total - amount1, 0);
  }

  // Asignar los valores actualizados
  amount1Input.value = amount1;
  amount2Input.value = amount2;

  // Mostrar total visual
  $('.totalDisplay').textContent = `Total Venta: ${formatCurrency(total)}`;

  console.log("➡ amount1:", amount1, "amount2:", amount2);
}




/* ---------- Sales delete helpers (bulk & all) ---------- */
$('#deleteAllSales')?.addEventListener('click', () => {
  if (!confirm('Eliminar todas las ventas?')) return;
  localStorage.removeItem(LS_SALES);
  renderAll();
});
$('#deleteSelectedSales')?.addEventListener('click', () => {
  const checks = $$('.sale-select:checked');
  if (!checks.length) return alert('Selecciona alguna venta');
  const sales = loadSales();
  // compute remaining by matching rows: we build remaining by excluding selected ids
  const selectedIds = checks.map(ch => ch.dataset.id);
  const remaining = sales.filter(s => !selectedIds.includes(s.id));
  saveSales(remaining);
  renderAll();
});

/* ---------- Export helpers ---------- */
async function exportElementToPdf(elSelector, filename = 'export.pdf') {
  const el = typeof elSelector === 'string' ? document.querySelector(elSelector) : elSelector;
  if (!el) return alert('Elemento no encontrado para exportar');
  const canvas = await html2canvas(el, { scale: 2, useCORS: true });
  const img = canvas.toDataURL('image/png');
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p', 'pt', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const imgW = pageW;
  const imgH = (canvas.height * imgW) / canvas.width;
  let pos = 0;
  pdf.addImage(img, 'PNG', 0, pos, imgW, imgH);
  let hLeft = imgH - pageH;
  while (hLeft > 0) {
    pos = hLeft - imgH;
    pdf.addPage();
    pdf.addImage(img, 'PNG', 0, pos, imgW, imgH);
    hLeft -= pageH;
  }
  pdf.save(filename);
}

function exportSalesCsv() {
  const sales = loadSales();
  if (!sales.length) return alert('No hay ventas para exportar.');
  const rows = [['Producto','Marca','Cantidad','Total Venta','Ganancia','Método1','Monto1','Método2','Monto2','Fecha']];
  sales.forEach(s => rows.push([s.name, s.brand||'', s.qty, s.total, s.profit, s.method1||'', s.amount1||0, s.method2||'', s.amount2||0, s.timestamp]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ventas.csv'; a.click();
}

function exportInventoryCsv() {
  const products = loadProducts();
  if (!products.length) return alert('No hay productos para exportar.');
  const rows = [['Nombre','Marca','Categoria','Costo','Margen %','Stock','Vendidos']];
  products.forEach(p => rows.push([p.name, p.brand||'', p.category||'', p.cost, p.marginPercent||0, p.qty||0, p.sold||0]));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'inventario.csv'; a.click();
}

/* ---------- Wire top-level UI controls ---------- */
function wireUiButtons() {
  $('#addProductBtn')?.addEventListener('click', () => {
    editingId = null;
    $('#modalTitle').textContent = 'Nuevo Producto';
    $('#productForm')?.reset();
    show('#modalOverlay');
  });

  $('#downloadInventoryPdfBtn')?.addEventListener('click', () => exportElementToPdf('#inventoryTableWrapper', 'inventario.pdf'));
  $('#downloadSalesPdfBtn')?.addEventListener('click', () => exportElementToPdf('#salesTableWrapper', 'ventas.pdf'));
  $('#exportSalesExcel')?.addEventListener('click', () => exportSalesCsv());
  $('#exportInventoryExcel')?.addEventListener('click', () => exportInventoryCsv());
  $('#importInventoryExcel')?.addEventListener('click', () => importInventoryFromExcel()); // if you attach a button with that id

  $('#refreshAnalysisBtn')?.addEventListener('click', () => {
    renderAll();
    setTimeout(() => renderStatsAndCharts(), 150);
  });
}

/* ---------- Import Excel function (reuse earlier logic) ---------- */
function importInventoryFromExcel() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.xlsx,.xls';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);
        if (!rows.length) return alert('Archivo vacío o formato no válido');
        const products = loadProducts();
        let added = 0;
        rows.forEach(r => {
          if (!r.name || !r.brand || isNaN(r.cost)) return;
          products.push({
            id: cryptoId(),
            name: String(r.name).trim(),
            brand: String(r.brand||'').trim(),
            category: String(r.category||'').trim(),
            subcategory: String(r.subcategory||'').trim(),
            cost: Number(r.cost) || 0,
            marginPercent: Number(r.marginPercent) || 0,
            qty: Number(r.qty) || 0,
            sold: 0,
            createdAt: nowISO()
          });
          added++;
        });
        saveProducts(products);
        renderAll();
        alert(`Se importaron ${added} productos.`);
      } catch (err) {
        console.error(err);
        alert('Error leyendo Excel');
      }
    };
    reader.readAsArrayBuffer(file);
  };
  input.click();
}

/* ---------- Search wiring ---------- */
$('#searchInventory')?.addEventListener('input', (e)=> renderInventoryTable(e.target.value));
$('#searchSales')?.addEventListener('input', (e)=> renderSalesTable(e.target.value));

/* ---------- Tabs ---------- */
$$('.tab-btn').forEach(btn => btn.addEventListener('click', (e) => {
  e.stopPropagation(); // 🚫 Evita que otros clics disparen cosas
  $$('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const tab = btn.dataset.tab;
  $$('.tab-content').forEach(t => t.classList.add('hidden'));
  const section = document.getElementById(tab);
  if (section) section.classList.remove('hidden');
  if (tab === 'clients') renderClientsTable(); // ✅ Render clientes al abrir
  if (tab === 'analysis') setTimeout(() => {
    renderStatsAndCharts();
    renderBrandAnalysis();
  }, 120);
}));


/* ---------- Render all ---------- */
function renderAll() {
  // show main if hidden
  const main = document.querySelector('main.container');
  if (main) main.classList.remove('hidden');

  renderInventoryTable($('#searchInventory')?.value || '');
  renderSalesTable($('#searchSales')?.value || '');
  renderSoldTable();
  renderBrandAnalysis();
  renderStatsAndCharts();
}

/* ---------- Init ---------- */
(function init() {
  seedIfEmpty();
  ensureUiExtras();
  wireModals();
  wireUiButtons();
  // extra listeners created after modals
  // wire cancel close for sell/product modals
  $('#cancelModal')?.addEventListener('click', () => hide('#modalOverlay'));
  $('#closeModal')?.addEventListener('click', () => hide('#modalOverlay'));
  $('#cancelSell')?.addEventListener('click', () => hide('#sellOverlay'));
  $('#closeSellModal')?.addEventListener('click', () => hide('#sellOverlay'));

  // Sell amount inputs auto-update
  $('#amount1')?.addEventListener('input', updateSellTotals);
  $('#amount2')?.addEventListener('input', updateSellTotals);
  $('#paymentMethod1')?.addEventListener('change', updateSellTotals);
  $('#paymentMethod2')?.addEventListener('change', updateSellTotals);
  $('#sell_qty')?.addEventListener('input', updateSellTotals);

  // delete selected / all sales buttons (alternate ids present in HTML)
  $('#deleteAllSales')?.addEventListener('click', () => {
    if (!confirm('Eliminar todas las ventas?')) return;
    localStorage.removeItem(LS_SALES);
    renderAll();
  });
  $('#deleteSelectedSales')?.addEventListener('click', () => {
    const checked = $$('.sale-select:checked');
    if (!checked.length) return alert('Selecciona ventas');
    const ids = checked.map(c=>c.dataset.id);
    saveSales(loadSales().filter(s => !ids.includes(s.id)));
    renderAll();
  });

  // Ensure "deleteSelectedBtn" exists; if not, create small fallback (some templates use different ids)
  if (!$('#deleteSelectedBtn')) {
    const btn = document.createElement('button');
    btn.id = 'deleteSelectedBtn';
    btn.className = 'btn ghost';
    btn.style.display = 'none'; // hidden fallback
    document.body.appendChild(btn);
  }

  // ... resto de funciones ...
function renderAll() {
  renderInventoryTable();
  renderSalesTable();
  renderSoldTable();
  renderBrandAnalysis();
  renderStatsAndCharts();
}


renderAll();

function init() {
  seedIfEmpty();        // crea claves vacías
  ensureUiExtras();     // crea el modal y otros elementos
  wireModals();         // conecta los botones del modal
  wireUiButtons();      // conecta el botón “Agregar producto”
  renderAll();          // muestra tablas vacías (sin error)
}




/* ---------- Ejecutar cuando el DOM esté listo ---------- */
window.addEventListener('DOMContentLoaded', init);


// refresh on storage change (multitab)
  window.addEventListener('storage', () => renderAll());
})();


// ===========================================================
// 🔒 LOGIN PROFESIONAL PARA ANÁLISIS (con botón Cancelar)
// ===========================================================
document.addEventListener("DOMContentLoaded", () => {
  const PASSWORD = "admin123"; // 🔒 Cambia esta clave
  let isAuthenticated = false;

  // Escucha clics en las pestañas
  document.querySelectorAll(".tab-btn").forEach(btn => {
    if (btn.dataset.tab === "analysis") {
      btn.addEventListener("click", e => {
        if (!isAuthenticated) {
          e.preventDefault();
          showLoginModal();
        }
      });
    }
  });

  // --- 💡 Modal login ---
  function showLoginModal() {
    if (document.querySelector(".login-overlay")) return;

    const html = `
      <div class="login-overlay">
        <div class="login-modal animate-in">
          <h2 class="login-title">🔒 Acceso restringido</h2>
          <p class="login-desc">Introduce la contraseña para continuar:</p>
          <input type="password" id="loginPassword" placeholder="Contraseña" class="login-input" autofocus />
          <div class="login-actions">
            <button id="loginConfirm" class="login-btn">Ingresar</button>
            <button id="loginCancel" class="login-btn cancel">Cancelar</button>
          </div>
          <p id="loginError" class="login-error"></p>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML("beforeend", html);

    const overlay = document.querySelector(".login-overlay");
    const input = document.getElementById("loginPassword");
    const confirm = document.getElementById("loginConfirm");
    const cancel = document.getElementById("loginCancel");
    const error = document.getElementById("loginError");

    confirm.addEventListener("click", checkPassword);
    cancel.addEventListener("click", goBackToInventory);
    input.addEventListener("keypress", e => {
      if (e.key === "Enter") checkPassword();
    });

    function checkPassword() {
      if (input.value === PASSWORD) {
        isAuthenticated = true;
        overlay.classList.add("fade-out");
        setTimeout(() => overlay.remove(), 300);
        document.querySelector('.tab-btn[data-tab="analysis"]').click();
      } else {
        error.textContent = "Contraseña incorrecta ❌";
        input.value = "";
        input.focus();
      }
    }

    function goBackToInventory() {
      overlay.classList.add("fade-out");
      setTimeout(() => overlay.remove(), 300);
      document.querySelector('.tab-btn[data-tab="inventory"]').click();
    }
  }
});



/* ---------- Botón Refrescar Análisis ---------- */
$('#refreshAnalysisBtn')?.addEventListener('click', () => {
  try {
    console.log("🔄 Refrescando análisis...");
    renderBrandAnalysis();
    renderStatsAndCharts();
    console.log("✅ Análisis actualizado correctamente");
  } catch (err) {
    console.error("❌ Error al refrescar análisis:", err);
    alert("Error al refrescar el análisis. Revisa la consola para más detalles.");
  }
});


/* ===========================
   MÓDULO CLIENTES (MEJORADO CON BUSCADOR Y ACCIONES)
   =========================== */
const LS_CLIENTS = 'clientsData';

// Funciones de carga y guardado
const loadClients = () => JSON.parse(localStorage.getItem(LS_CLIENTS) || '[]');
const saveClients = (arr) => localStorage.setItem(LS_CLIENTS, JSON.stringify(arr));

/* === Render tabla === */
function renderClientsTable(filter = '') {
  const tbody = document.querySelector('#clientsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const q = (filter || '').trim().toLowerCase();
  const clients = loadClients();

  if (!clients.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" style="text-align:center;opacity:.6;">Sin clientes registrados</td>`;
    tbody.appendChild(tr);
    return;
  }

  clients
    .filter(c => {
      if (!q) return true;
      return (
        (c.nombre || '').toLowerCase().includes(q) ||
        (c.telefono || '').toLowerCase().includes(q) ||
        (c.correo || '').toLowerCase().includes(q)
      );
    })
    .forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="client-check" data-id="${c.id}" /></td>
        <td>${esc(c.nombre)}</td>
        <td>${esc(c.telefono || '')}</td>
        <td>${esc(c.correo || '')}</td>
        <td>${c.fechaCumple || '-'}</td>
        <td>${c.fechaRegistro ? new Date(c.fechaRegistro).toLocaleDateString() : '-'}</td>
        <td>
          <button class="btn ghost" data-id="${c.id}" data-action="edit-client">Editar</button>
          <button class="btn ghost" data-id="${c.id}" data-action="delete-client">Eliminar</button>
          <button class="btn ghost email-client" data-id="${c.id}">📧 Enviar correo</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
}

/* === Listener para botón "Enviar correo" === */
document.addEventListener('click', e => {
  if (e.target.classList.contains('email-client')) {
    const id = e.target.dataset.id;
    const clientes = loadClients(); // ✅ ahora sí existe
    const cliente = clientes.find(c => c.id === id);
    if (!cliente) return alert('Cliente no encontrado');
    sendClientEmailForm(cliente);
  }
});

/* === Envío de correo con EmailJS === */
function sendClientEmailForm(cliente) {
  if (!cliente || !cliente.correo) {
    return alert("⚠️ No se encontró un correo válido para este cliente.");
  }

  // ❌ Eliminamos el confirm interno (lo haremos fuera)
  // if (!confirm(`¿Enviar correo a ${cliente.nombre}?`)) return;

  // Crear formulario invisible
  const form = document.createElement("form");
  form.style.display = "none";

  const data = {
    to_name: cliente.nombre,
    to_email: cliente.correo,
    telefono: cliente.telefono || "No registrado",
    fecha: new Date().toLocaleDateString("es-CO"),
    year: new Date().getFullYear(),
  };

  for (const key in data) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = data[key];
    form.appendChild(input);
  }

  document.body.appendChild(form);

  emailjs
    .sendForm("service_klqo261", "template_rt5dymj", form)
    .then(() =>
      Swal.fire({
        icon: "success",
        title: "¡Correo enviado!",
        text: `El mensaje fue enviado correctamente a ${cliente.nombre}.`,
        showConfirmButton: false,
        timer: 2500,
        background: "#111",
        color: "#fff",
      })
    )
    .catch((err) => {
      console.error("Error al enviar EmailJS:", err);
      Swal.fire({
        icon: "error",
        title: "¡Error al enviar el correo!",
        text: `No se pudo enviar el correo a ${cliente.nombre}.`,
        showConfirmButton: false,
        timer: 2500,
        background: "#111",
        color: "#fff",
      });
    })
    .finally(() => form.remove());
}






/* === Modal === */
(function createClientModalOnce() {
  if (document.getElementById('clientModalOverlay')) return;

  const html = `
  <div id="clientModalOverlay" class="modal-overlay hidden" style="display:none;">
    <div class="modal card" id="clientModal" style="max-width:420px;">
      <button id="closeClientModal" class="modal-close">✕</button>
      <h2 id="clientModalTitle">Nuevo Cliente</h2>
      <form id="clientForm" class="form-grid">
        <input id="c_id" type="hidden" />
        <label>Nombre*<input id="c_nombre" required /></label>
        <label>Teléfono<input id="c_telefono" /></label>
        <label>Correo<input id="c_correo" type="email" /></label>
        <label>Fecha de Cumpleaños<input id="c_fechaCumple" type="date" /></label>
        <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">
          <button type="button" id="cancelClientModal" class="btn ghost">Cancelar</button>
          <button type="submit" class="btn primary">Guardar</button>
        </div>
      </form>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('clientModalOverlay').style.display = '';

  const clientForm = document.getElementById('clientForm');
  if (!clientForm.__attached) {
    clientForm.addEventListener('submit', e => {
      e.preventDefault();
      const editingId = document.getElementById('c_id').value || null;
      const clients = loadClients();
      const payload = {
        id: editingId || cryptoId(),
        nombre: document.getElementById('c_nombre').value.trim(),
        telefono: document.getElementById('c_telefono').value.trim(),
        correo: document.getElementById('c_correo').value.trim(),
        fechaCumple: document.getElementById('c_fechaCumple').value || '',
        fechaRegistro: editingId
          ? clients.find(c => c.id === editingId)?.fechaRegistro || nowISO()
          : nowISO()
      };
      if (editingId) {
        const idx = clients.findIndex(c => c.id === editingId);
        if (idx !== -1) clients[idx] = payload;
      } else clients.push(payload);

      saveClients(clients);
      hide('#clientModalOverlay');
      renderClientsTable(document.querySelector('#clientSearch')?.value || '');
    });
    clientForm.__attached = true;
  }

  document.getElementById('closeClientModal').onclick = () => hide('#clientModalOverlay');
  document.getElementById('cancelClientModal').onclick = () => hide('#clientModalOverlay');
  document.getElementById('clientModalOverlay').onclick = ev => {
    if (ev.target.id === 'clientModalOverlay') hide('#clientModalOverlay');
  };
})();

/* === Eventos Globales === */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  const id = btn.dataset.id;
  const action = btn.dataset.action;

  // Agregar
  if (btn.id === 'addClientBtn') {
    document.getElementById('clientForm').reset();
    document.getElementById('c_id').value = '';
    document.getElementById('clientModalTitle').textContent = 'Nuevo Cliente';
    show('#clientModalOverlay');
  }

  // Editar
  if (action === 'edit-client') {
    const c = loadClients().find(x => x.id === id);
    if (!c) return;
    document.getElementById('clientModalTitle').textContent = 'Editar Cliente';
    document.getElementById('c_id').value = c.id;
    document.getElementById('c_nombre').value = c.nombre;
    document.getElementById('c_telefono').value = c.telefono || '';
    document.getElementById('c_correo').value = c.correo || '';
    document.getElementById('c_fechaCumple').value = c.fechaCumple || '';
    show('#clientModalOverlay');
  }

  // Eliminar individual
  if (action === 'delete-client') {
    if (!confirm('¿Eliminar cliente?')) return;
    saveClients(loadClients().filter(x => x.id !== id));
    renderClientsTable();
  }

  // Enviar correo
  if (action === 'email-client') {
    const c = loadClients().find(x => x.id === id);
    if (c?.correo) {
      window.location.href = `mailto:${c.correo}?subject=Hola ${encodeURIComponent(c.nombre)}`;
    } else {
      alert('Este cliente no tiene correo registrado.');
    }
  }

  // Eliminar seleccionados
  if (btn.id === 'deleteSelectedClients') {
    const checks = [...document.querySelectorAll('.client-check:checked')];
    if (!checks.length) return alert('Selecciona al menos un cliente.');
    if (!confirm(`¿Eliminar ${checks.length} cliente(s)?`)) return;
    const ids = checks.map(ch => ch.dataset.id);
    saveClients(loadClients().filter(c => !ids.includes(c.id)));
    renderClientsTable();
  }

  // Eliminar todos
  if (btn.id === 'deleteAllClients') {
    if (confirm('¿Eliminar TODOS los clientes?')) {
      localStorage.removeItem(LS_CLIENTS);
      renderClientsTable();
    }
  }
});

/* === Buscador === */
document.addEventListener('input', e => {
  if (e.target.id === 'clientSearch') renderClientsTable(e.target.value);
});

/* === Render al abrir pestaña === */
$$('.tab-btn').forEach(btn =>
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'clients') setTimeout(() => renderClientsTable(), 50);
  })
);



/* ===========================
   KPIs de Clientes (Live Auto Update) — Preciso con fecha bonita
   =========================== */

/* ===========================
   KPIs de Clientes (flechas + fecha exacta sin desfase)
   =========================== */

let currentCumpleIndex = 0; // Persistencia entre renderizados

function renderClientKPIs() {
  const container = document.getElementById('clientStats');
  if (!container) return;

  const clients = loadClients();
  const total = clients.length;

  // 📅 Hoy a medianoche (hora local, sin desfases)
  const hoy = new Date();
  const hoyLocal = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());

  // Función robusta para parsear fechas en local
  const parseFechaLocal = (str) => {
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(str)) {
      const [d, m, y] = str.split('/').map(Number);
      return new Date(y, m - 1, d);
    }
    const parsed = new Date(str);
    if (!isNaN(parsed)) return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    return null;
  };

  // 📅 Construir lista de próximos cumpleaños
  const proximos = clients
    .map(c => {
      const cumple = parseFechaLocal(c.fechaCumple);
      if (!cumple) return null;

      let cumpleEsteAño = new Date(hoyLocal.getFullYear(), cumple.getMonth(), cumple.getDate());
      let diffDias = Math.floor((cumpleEsteAño - hoyLocal) / 86400000);

      // Si ya pasó este año, mover al siguiente
      if (diffDias < 0) {
        cumpleEsteAño = new Date(hoyLocal.getFullYear() + 1, cumple.getMonth(), cumple.getDate());
        diffDias = Math.floor((cumpleEsteAño - hoyLocal) / 86400000);
      }

      return {
        id: c.id,
        nombre: c.nombre,
        correo: c.correo,
        telefono: c.telefono,
        fecha: cumpleEsteAño,
        dias: diffDias
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dias - b.dias);

  if (currentCumpleIndex >= proximos.length) currentCumpleIndex = 0;

  // 💬 Mostrar cumpleaños actual
  let proximoHTML = '—';
  if (proximos.length) {
    const cliente = proximos[currentCumpleIndex];
    const fechaBonita = cliente.fecha.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    let texto;
    if (cliente.dias === 0) texto = `🎉 ${cliente.nombre} (${fechaBonita} — ¡Hoy!)`;
    else if (cliente.dias === 1) texto = `${cliente.nombre} (${fechaBonita} — en 1 día)`;
    else texto = `${cliente.nombre} (${fechaBonita} — en ${cliente.dias} días)`;

    // 📨 Agregamos botón de enviar correo aquí 👇
    const botonCorreo = cliente.correo
      ? `<button class="btn ghost email-client" data-id="${cliente.id}" style="margin-top:6px;">📧 Enviar correo</button>`
      : `<p style="opacity:.6;margin-top:6px;">(Sin correo registrado)</p>`;

    proximoHTML = `
      <div class="cumple-navegador" style="flex-direction:column;gap:6px;">
        <div style="display:flex;align-items:center;justify-content:center;gap:0.5em;">
          <button class="nav-btn" id="prevCumple" ${currentCumpleIndex === 0 ? 'disabled' : ''}>⬅️</button>
          <span>${texto}</span>
          <button class="nav-btn" id="nextCumple" ${currentCumpleIndex === proximos.length - 1 ? 'disabled' : ''}>➡️</button>
        </div>
        ${botonCorreo}
      </div>
    `;
  }

  // 🎂 Cumpleaños este mes
  const mesActual = hoyLocal.getMonth();
  const cumpleMes = clients.filter(c => {
    const f = parseFechaLocal(c.fechaCumple);
    return f && f.getMonth() === mesActual;
  }).length;

  // 🧩 Renderizar KPIs
  container.innerHTML = `
    <div class="kpi-card">
      <h3>Total de clientes</h3>
      <p>${total}</p>
    </div>
    <div class="kpi-card">
      <h3>Próximo cumpleaños</h3>
      <div id="proximoCumpleContainer">${proximoHTML}</div>
    </div>
    <div class="kpi-card">
      <h3>Cumpleaños este mes</h3>
      <p>${cumpleMes}</p>
    </div>
  `;

  // 🧭 Conectar botones navegación
  const prevBtn = document.getElementById('prevCumple');
  const nextBtn = document.getElementById('nextCumple');

  if (prevBtn) prevBtn.onclick = () => {
    if (currentCumpleIndex > 0) {
      currentCumpleIndex--;
      renderClientKPIs();
    }
  };

  if (nextBtn) nextBtn.onclick = () => {
    if (currentCumpleIndex < proximos.length - 1) {
      currentCumpleIndex++;
      renderClientKPIs();
    }
  };

  // ✉️ Conectar botón de enviar correo (reutiliza tu función existente)
  const emailBtn = container.querySelector('.email-client');
  if (emailBtn) {
  emailBtn.addEventListener(
    "click",
    (e) => {
      e.stopPropagation();
      const id = emailBtn.dataset.id;
      const cliente = clients.find((c) => c.id === id);

      if (!cliente) {
        return alert("Cliente no encontrado");
      }

      // ✅ Solo una confirmación aquí
      if (confirm(`¿Enviar correo a ${cliente.nombre}?`)) {
        sendClientEmailForm(cliente);
      }
    },
    { once: true } // previene listeners duplicados al re-renderizar
  );
}


}





/* ===========================
   Refresco unificado
   =========================== */
function refreshClientsUI() {
  renderClientsTable();
  renderClientKPIs();
}

/* ===========================
   Hook universal (garantiza reactividad)
   =========================== */

// Guarda referencia original
const __originalSaveClients = window.saveClients;

// Sobrescribe saveClients para refrescar automáticamente
window.saveClients = function (arr) {
  __originalSaveClients(arr);
  refreshClientsUI(); // 🔁 actualiza inmediatamente sin evento
};

// Cada vez que el modal guarda, edita o borra, también refresca
document.addEventListener('click', (e) => {
  if (e.target.matches('#addClientBtn, [data-action="edit-client"], [data-action="delete-client"]')) {
    // Damos un pequeño retardo por si el modal aún no cierra
    setTimeout(() => refreshClientsUI(), 120);
  }
});

// También al cambiar de pestaña "Clientes"
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'clients') {
      setTimeout(() => refreshClientsUI(), 100);
    }
  });
});

// Render inicial
if (document.querySelector('#clients') && !document.querySelector('#clients').classList.contains('hidden')) {
  refreshClientsUI();
}
