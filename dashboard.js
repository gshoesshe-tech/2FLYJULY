(() => {
  'use strict';

  const TF = window.TwoFly;

  function nextMonth(monthKey) {
    const [year, month] = String(monthKey).split('-').map(Number);
    const d = new Date(Date.UTC(year, month, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  async function fetchMonthOrders(monthKey) {
    const start = `${monthKey}-01`;
    const end = `${nextMonth(monthKey)}-01`;
    const pageSize = 1000;
    let from = 0;
    const rows = [];

    while (true) {
      const { data, error } = await TF.state.supa
        .from('v_order_list')
        .select('*')
        .gte('order_date', start)
        .lt('order_date', end)
        .order('order_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      const batch = data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return rows;
  }

  function renderSalesByDay(orders) {
    const grouped = new Map();

    orders.forEach((order) => {
      const date = order.order_date || 'No date';
      if (!grouped.has(date)) grouped.set(date, { orders: 0, sales: 0 });
      const row = grouped.get(date);
      row.orders += 1;

      if (!['cancelled', 'refunded'].includes(order.status)) {
        row.sales += TF.num(order.verified_product_paid);
      }
    });

    const rows = [...grouped.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));

    TF.$('salesByDay').innerHTML = `
      <table>
        <thead><tr><th>Date</th><th>Orders</th><th>Verified product sales</th></tr></thead>
        <tbody>
          ${rows.map(([date, value]) => `
            <tr>
              <td>${TF.esc(date)}</td>
              <td>${value.orders}</td>
              <td><strong>${TF.money(value.sales)}</strong></td>
            </tr>
          `).join('') || '<tr><td colspan="3" class="empty">No orders for this month.</td></tr>'}
        </tbody>
      </table>`;
  }

  function renderStatusBreakdown(orders) {
    const statuses = [
      ['draft', 'Draft'],
      ['payment_review', 'Payment Review'],
      ['confirmed', 'Paid / Confirmed'],
      ['waiting_stock', 'Waiting for Stock'],
      ['ready_to_pack', 'Ready to Pack'],
      ['packing', 'Packing'],
      ['shipped', 'Shipped'],
      ['delivered', 'Delivered'],
      ['cancelled', 'Cancelled'],
      ['refunded', 'Refunded']
    ];

    const counts = new Map(statuses.map(([key]) => [key, 0]));
    orders.forEach((order) => counts.set(order.status, (counts.get(order.status) || 0) + 1));

    const visible = statuses.filter(([key]) => (counts.get(key) || 0) > 0);
    const total = Math.max(orders.length, 1);

    TF.$('statusBreakdown').innerHTML = visible.map(([key, label]) => {
      const count = counts.get(key) || 0;
      const width = Math.max((count / total) * 100, count > 0 ? 3 : 0);
      return `
        <div class="status-row">
          <div class="status-head"><span>${TF.esc(label)}</span><strong>${count}</strong></div>
          <div class="progress"><span style="width:${width.toFixed(2)}%"></span></div>
        </div>`;
    }).join('') || '<div class="empty">No orders for this month.</div>';
  }

  async function load() {
    try {
      const month = TF.$('dashboardMonth')?.value || TF.monthKey();

      const financePromise = TF.isManagement()
        ? TF.state.supa.from('v_monthly_finance').select('*').eq('month_start', `${month}-01`).maybeSingle()
        : Promise.resolve({ data: null, error: null });

      const cashPromise = TF.isManagement()
        ? TF.state.supa.from('v_cash_account_balances').select('*').order('name')
        : Promise.resolve({ data: [], error: null });

      const recentPromise = TF.state.supa
        .from('v_order_list')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      const dailyPromise = TF.isManagement()
        ? TF.state.supa.from('v_daily_operations_v5').select('*').single()
        : Promise.resolve({ data: null, error: null });

      const [financeResult, recentResult, cashResult, monthOrders, dailyResult] = await Promise.all([
        financePromise,
        recentPromise,
        cashPromise,
        fetchMonthOrders(month),
        dailyPromise
      ]);

      const error = financeResult.error || recentResult.error || cashResult.error || dailyResult.error;
      if (error) throw error;

      const fin = financeResult.data || {};
      const recentOrders = recentResult.data || [];
      const cash = cashResult.data || [];
      const daily = dailyResult.data || {};
      const today = TF.today();

      // Added dashboard figures.
      TF.$('kpiTotalOrders').textContent = monthOrders.length.toLocaleString();
      renderSalesByDay(monthOrders);
      renderStatusBreakdown(monthOrders);

      // Existing dashboard figures kept unchanged.
      if (TF.isManagement()) {
        TF.$('kpiProductCash').textContent = TF.money(fin.verified_product_cash);
        TF.$('kpiShippingProfit').textContent = TF.money(fin.shipping_profit);
        TF.$('kpiNetProfit').textContent = TF.money(fin.owner_pay_eligible_profit);
        TF.$('kpiOwnerPay').textContent = TF.money(fin.owner_pay_target);

        TF.$('cashAccountCards').innerHTML = cash.map((account) => `
          <div class="list-item">
            <span>${TF.esc(account.name)}</span>
            <strong>${TF.money(account.current_balance)}</strong>
          </div>`).join('') || '<div class="empty">No cash accounts.</div>';

        TF.$('dailyChecks').innerHTML = [
          ['Verified payments', daily.verified_payments_today || 0],
          ['Verified cash', TF.money(daily.verified_cash_today)],
          ['Orders confirmed', daily.confirmed_orders_today || 0],
          ['Ready to pack', daily.ready_to_pack_now || 0],
          ['Shipped today', daily.shipped_today || 0],
          ['Missing courier cost', daily.missing_courier_cost || 0],
          ['Cash in', TF.money(daily.cash_in_today)],
          ['Cash out', TF.money(daily.cash_out_today)]
        ].map(([label,value]) => `<div class="summary-box"><span>${TF.esc(label)}</span><strong>${value}</strong></div>`).join('');
      }

      const exceptions = [];
      recentOrders.forEach((order) => {
        if (order.status === 'payment_review') {
          exceptions.push({ order, issue: 'Payment proof or payment details need review', page: 'payments.html' });
        }
        if (order.status === 'waiting_stock') {
          exceptions.push({ order, issue: `Waiting for stock: ${order.incoming_reserved_quantity || 0} incoming, ${order.shortage_quantity || 0} short`, page: 'orderpage.html' });
        }
        if (order.status === 'ready_to_pack') {
          exceptions.push({ order, issue: 'Paid and ready to pack', page: 'orderpage.html' });
        }
        if (order.fulfillment_method === 'jnt' && ['shipped', 'delivered'].includes(order.status) && !order.courier_cost_finalized) {
          exceptions.push({ order, issue: 'Actual J&T courier cost is missing', page: 'orderpage.html' });
        }
        if (order.order_type === 'made_to_order' && order.expected_release_date && order.expected_release_date < today && !['shipped', 'delivered', 'cancelled'].includes(order.status)) {
          exceptions.push({ order, issue: 'Made-to-order expected release date has passed', page: 'orderpage.html' });
        }
        if (order.fulfillment_method === 'jnt' && order.status === 'shipped' && !order.tracking_number) {
          exceptions.push({ order, issue: 'Shipped J&T order has no tracking number', page: 'orderpage.html' });
        }
      });

      TF.$('exceptionList').innerHTML = exceptions.slice(0, 30).map((item) => `
        <div class="list-item">
          <div><strong>${TF.esc(item.order.order_number)}</strong><small>${TF.esc(item.issue)}</small></div>
          <a class="btn" href="./${item.page}">Open</a>
        </div>`).join('') || '<div class="empty">No current exceptions.</div>';

      TF.$('dashboardOrders').innerHTML = `
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Total</th><th>Status</th><th>Stock</th></tr></thead>
          <tbody>
            ${recentOrders.slice(0, 15).map((order) => `
              <tr>
                <td><strong>${TF.esc(order.order_number)}</strong><br><small>${TF.esc(order.order_date)}</small></td>
                <td>${TF.esc(order.customer_name)}</td>
                <td>${TF.esc(String(order.fulfillment_method || '').toUpperCase().replace('_', '-'))}</td>
                <td>${TF.money(order.total_due)}</td>
                <td>${TF.statusPill(order.status)}</td>
                <td>
                  ${order.shortage_quantity ? `<span class="pill danger">Short ${order.shortage_quantity}</span>` : ''}
                  ${order.incoming_reserved_quantity ? ` <span class="pill warn">Incoming ${order.incoming_reserved_quantity}</span>` : ''}
                </td>
              </tr>`).join('') || '<tr><td colspan="6" class="empty">No orders yet.</td></tr>'}
          </tbody>
        </table>`;
    } catch (error) {
      TF.fail(error, 'Dashboard failed');
    }
  }

  TF.ready.then(() => {
    if (TF.$('dashboardMonth')) {
      TF.$('dashboardMonth').value = TF.monthKey();
      TF.$('dashboardMonth').addEventListener('change', load);
    }
    window.addEventListener('twofly:refresh', load);
    load();
  }).catch((error) => TF.fail(error, 'Dashboard failed'));
})();
