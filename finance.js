(() => {
  'use strict';
  const TF=window.TwoFly;
  async function load(){
    try{
      const m=TF.$('financeMonth').value||TF.monthKey();
      const start=m+'-01',end=TF.monthEndExclusive(m);
      const [fR,cR,oR,dR]=await Promise.all([
        TF.state.supa.from('v_monthly_finance_v6').select('*').eq('month_start',m+'-01').maybeSingle(),
        TF.state.supa.from('v_cash_account_balances').select('*').order('name'),
        TF.state.supa.from('v_opening_setup_summary_v6').select('*').single(),
        TF.state.supa.from('inbound_deliveries').select('total_fee,paid_before_system,status').gte('delivery_date',start).lt('delivery_date',end).eq('status','active')
      ]);
      if(fR.error||cR.error||oR.error||dR.error)throw fR.error||cR.error||oR.error||dR.error;
      const x=fR.data||{},opening=oR.data||{},deliveries=dR.data||[];
      const inboundCost=deliveries.reduce((s,d)=>s+TF.num(d.total_fee),0);
      const inboundCash=deliveries.filter(d=>!d.paid_before_system).reduce((s,d)=>s+TF.num(d.total_fee),0);
      TF.$('finProductCash').textContent=TF.money(x.verified_product_cash);
      TF.$('finMigratedPayments').textContent=TF.money(x.migrated_product_payments);
      TF.$('finCostedSales').textContent=TF.money(x.recognized_costed_sales);
      TF.$('finLegacy').textContent=TF.money(x.legacy_recovery);
      TF.$('finCogs').textContent=TF.money(x.cogs);
      TF.$('finShipping').textContent=TF.money(x.shipping_profit);
      TF.$('finExpenses').textContent=TF.money(TF.num(x.operating_expenses)+TF.num(x.refunds_losses));
      TF.$('finProfit').textContent=TF.money(x.owner_pay_eligible_profit);
      TF.$('finOwnerTarget').textContent=TF.money(x.owner_pay_target);
      TF.$('finOwnerDraws').textContent=TF.money(x.owner_draws);
      TF.$('finOwnerRemaining').textContent=TF.money(Math.max(TF.num(x.owner_pay_target)-TF.num(x.owner_draws),0));
      TF.$('finAssets').textContent=TF.money(x.equipment_assets);
      TF.$('finInboundCost').textContent=TF.money(inboundCost);
      TF.$('finInboundCash').textContent=TF.money(inboundCash);
      TF.$('finOpenProduction').textContent=TF.money(opening.open_transition_production_value);
      TF.$('finOpenPayables').textContent=TF.money(opening.open_payables);
      const hasOpen=TF.num(opening.open_transition_production_value)>0;
      TF.$('finProductionNotice').classList.toggle('hidden',!hasOpen);
      TF.$('finProductionNotice').innerHTML=hasOpen?'<strong>Provisional production cost:</strong> ongoing batches are still open, so product cost can change slightly when final output, rejects, and inbound delivery allocations are confirmed.':'';
      TF.$('financeCashAccounts').innerHTML=(cR.data||[]).map(a=>`<div class="list-item"><span>${TF.esc(a.name)}</span><strong>${TF.money(a.current_balance)}</strong></div>`).join('')||'<div class="empty">No cash accounts.</div>';
    }catch(e){TF.fail(e,'Finance failed');}
  }
  TF.ready.then(()=>{TF.$('financeMonth').value=TF.monthKey();TF.$('financeMonth').addEventListener('change',load);window.addEventListener('twofly:refresh',load);load();}).catch(e=>TF.fail(e,'Finance failed'));
})();
