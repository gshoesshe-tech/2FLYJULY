(() => {
  'use strict';

  const TF = window.TwoFly;

  const STATUS_ORDER = [
    'draft',
    'payment_review',
    'confirmed',
    'waiting_stock',
    'ready_to_pack',
    'packing',
    'shipped',
    'delivered',
    'cancelled',
    'refunded'
  ];

  const STATUS_LABELS = {
    draft: 'Draft',
    payment_review: 'Payment Review',
    confirmed: 'Paid / Confirmed',
    waiting_stock: 'Waiting for Stock',
    ready_to_pack: 'Ready to Pack',
    packing: 'Packing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    refunded: 'Refunded'
  };

  function formatDate(dateString) {
    if (!dateString) return 'No date';
    const [year, month, day] = String(dateString).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : String(dateString);
  }

  async function fetchMonthOrders(month) {
    const start = `${month}-01`;
    const end = TF.monthEndExclusive(month);
    const pageSize = 1000;
    let from = 0;
    const all = [];

    while (true) {
      const { data, error } = await TF.state.supa
        .from('v_order_list')
        .select('id,order_date,status,verified_product_paid')
        .gte('order_date', start)
        .lt('order_date', end)
        .order('order_date', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const batch = Array.isArray(data) ? data : [];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return all;
  }

  function renderSalesByDay(orders) {
    const daily = new Map();

    orders.forEach(order => {
      const date = order.order_date || 'No date';
      const row = daily.get(date) || { date, orders: 0, sales: 0 };
      row.orders += 1;

      if (!['cancelled', 'refunded'].includes(order.status)) {
        row.sales += TF.num(order.verified_product_paid);
      }

      daily.set(date, row);
    });

    const rows = Array.from(daily.values()).sort((a, b) => {
      if (a.date === 'No date') return 1;
      if (b.date === 'No date') return -1;
      return String(b.date).localeCompare(String(a.date));
    });

    TF.$('salesByDay').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Orders</th>
            <th>Verified product sales</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td><strong>${TF.esc(formatDate(row.date))}</strong></td>
              <td>${row.orders.toLocaleString('en-PH')}</td>
              <td>${TF.money(row.sales)}</td>
            </tr>
          `).join('') || '<tr><td colspan="3" class="empty">No orders for this month.</td></tr>'}
        </tbody>
      </table>`;
  }

  function renderStatusBreakdown(orders) {
    const counts = new Map();
    orders.forEach(order => counts.set(order.status, (counts.get(order.status) || 0) + 1));

    const total = orders.length;
    const statuses = [
      ...STATUS_ORDER,
      ...Array.from(counts.keys()).filter(status => !STATUS_ORDER.includes(status))
    ];

    TF.$('statusBreakdown').innerHTML = statuses
      .filter(status => (counts.get(status) || 0) > 0)
      .map(status => {
        const count = counts.get(status) || 0;
        const width = total > 0 ? Math.max((count / total) * 100, 2) : 0;
        return `
          <div class="list-item" style="display:block">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px">
              <strong>${TF.esc(STATUS_LABELS[status] || status.replaceAll('_', ' '))}</strong>
              <span class="pill">${count.toLocaleString('en-PH')}</span>
            </div>
            <div class="progress"><span style="width:${width}%"></span></div>
          </div>`;
      }).join('') || '<div class="empty">No orders for this month.</div>';
  }

  async function load() {
    try {
      const month = TF.$('dashboardMonth')?.value || TF.monthKey();
      const orders = await fetchMonthOrders(month);

      TF.$('kpiTotalOrders').textContent = orders.length.toLocaleString('en-PH');
      renderSalesByDay(orders);
      renderStatusBreakdown(orders);
    } catch (error) {
      TF.fail(error, 'Dashboard failed');
    }
  }

  TF.ready.then(() => {
    const monthInput = TF.$('dashboardMonth');
    monthInput.value = TF.monthKey();
    monthInput.addEventListener('change', load);
    window.addEventListener('twofly:refresh', load);
    load();
  }).catch(error => TF.fail(error, 'Dashboard failed'));
})();
