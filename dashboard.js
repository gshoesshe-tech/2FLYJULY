(() => {
  'use strict';
  const TF=window.TwoFly;
  async function load(){
    const {$,state,money,num,today,monthKey,esc,statusPill,isManagement,fail}=TF;
    try{
      const m=$('dashboardMonth').value||monthKey();
      const [{data:fin,error:fe},{data:orders,error:oe},{data:cash,error:ce}]=await Promise.all([
        state.supa.from('v_monthly_finance').select('*').eq('month_start',m+'-01').maybeSingle(),
        state.supa.from('v_order_list').select('*').order('created_at',{ascending:false}).limit(100),
        isManagement()?state.supa.from('v_cash_account_balances').select('*').order('name'):Promise.resolve({data:[],error:null})
      ]);
      if(fe||oe||ce) throw fe||oe||ce;
      const f=fin||{};
      $('kpiProductCash').textContent=money(f.verified_product_cash);
      $('kpiShippingProfit').textContent=money(f.shipping_profit);
      $('kpiNetProfit').textContent=money(f.owner_pay_eligible_profit);
      $('kpiOwnerPay').textContent=money(f.owner_pay_target);
      const all=orders||[], exceptions=[], now=today();
      all.forEach(o=>{
        if(o.status==='payment_review') exceptions.push([o.order_number,'Payment proof waiting for verification']);
        if(o.status==='waiting_stock') exceptions.push([o.order_number,`Waiting for stock: ${o.incoming_reserved_quantity||0} incoming, ${o.shortage_quantity||0} short`]);
        if(o.fulfillment_method==='jnt'&&o.status==='shipped'&&num(o.actual_courier_cost)===0) exceptions.push([o.order_number,'J&T courier cost is still missing']);
        if(o.order_type==='made_to_order'&&o.expected_release_date&&o.expected_release_date<now&&!['shipped','delivered','cancelled'].includes(o.status)) exceptions.push([o.order_number,'Made-to-order release date has passed']);
      });
      $('exceptionList').innerHTML=exceptions.slice(0,20).map(x=>`<div class="list-item"><div><strong>${esc(x[0])}</strong><small>${esc(x[1])}</small></div></div>`).join('')||'<div class="empty">No current exceptions.</div>';
      $('cashAccountCards').innerHTML=(cash||[]).map(a=>`<div class="list-item"><span>${esc(a.name)}</span><strong>${money(a.current_balance)}</strong></div>`).join('')||'<div class="empty">No cash accounts.</div>';
      $('dashboardOrders').innerHTML=`<table><thead><tr><th>Order</th><th>Customer</th><th>Method</th><th>Total</th><th>Status</th></tr></thead><tbody>${all.slice(0,12).map(o=>`<tr><td>${esc(o.order_number)}</td><td>${esc(o.customer_name)}</td><td>${esc(o.fulfillment_method)}</td><td>${money(o.total_due)}</td><td>${statusPill(o.status)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No orders yet.</td></tr>'}</tbody></table>`;
    }catch(e){ fail(e,'Dashboard failed'); }
  }
  TF.ready.then(()=>{ TF.$('dashboardMonth').value=TF.monthKey(); TF.$('dashboardMonth').addEventListener('change',load); window.addEventListener('twofly:refresh',load); load(); }).catch(e=>TF.fail(e,'Dashboard failed'));
})();
