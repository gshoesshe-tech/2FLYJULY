(() => {
  'use strict';
  const TF=window.TwoFly;
  let payments=[],orders=[];

  function actionButtons(p){
    const out=[];
    if(p.proof_storage_path)out.push(`<button class="btn small" data-proof="${p.id}">Proof</button>`);
    if(!TF.isManagement())return out.join('');
    if(['pending','needs_review','rejected','duplicate'].includes(p.status)){
      if(p.status!=='rejected'&&p.status!=='duplicate')out.push(`<button class="btn small" data-edit-payment="${p.id}">Edit</button>`);
      if(['pending','needs_review'].includes(p.status))out.push(`<button class="btn primary small" data-verify="${p.id}">Verify</button>`);
      if(p.status==='pending')out.push(`<button class="btn small" data-change="${p.id}" data-status="needs_review">Needs review</button>`);
      if(!['rejected','duplicate'].includes(p.status))out.push(`<button class="btn danger small" data-change="${p.id}" data-status="rejected">Reject</button>`,`<button class="btn small" data-change="${p.id}" data-status="duplicate">Duplicate</button>`);
    }
    if(p.status==='verified')out.push(`<button class="btn danger small" data-change="${p.id}" data-status="voided">Void</button>`);
    return out.join('');
  }
  function table(rows,emptyText){
    return `<table><thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Amount</th><th>Method / Account</th><th>Reference</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.map(p=>`<tr><td>${TF.esc(p.payment_date)}</td><td>${TF.esc(p.orders?.order_number||'Unlinked')}</td><td>${TF.esc(p.orders?.customer_name||'')}</td><td><strong>${TF.money(p.amount)}</strong></td><td>${TF.esc(p.payment_method)}<br><small>${TF.esc(p.cash_accounts?.name||'No account')}</small></td><td>${TF.esc(p.reference_number||'—')}</td><td>${TF.statusPill(p.status)}</td><td><div class="row-actions">${actionButtons(p)}</div></td></tr>`).join('')||`<tr><td colspan="8" class="empty">${TF.esc(emptyText)}</td></tr>`}</tbody></table>`;
  }
  async function load(){
    try{
      const [{data,error},{data:os,error:oe}]=await Promise.all([
        TF.state.supa.from('payments').select('*,orders(order_number,customer_name,total_due,status),cash_accounts(name)').order('created_at',{ascending:false}).limit(600),
        TF.state.supa.from('v_order_list').select('id,order_number,customer_name,total_due,payment_status,status').not('status','in','(cancelled,refunded,delivered)').order('created_at',{ascending:false}).limit(1200)
      ]);
      if(error||oe)throw error||oe;
      payments=data||[];orders=os||[];
      const pending=payments.filter(p=>['pending','needs_review'].includes(p.status));
      const verified=payments.filter(p=>p.status==='verified');
      const closed=payments.filter(p=>['rejected','duplicate','voided','refunded'].includes(p.status));
      TF.$('pendingPaymentsTable').innerHTML=table(pending,'No payments waiting for review.');
      TF.$('verifiedPaymentsTable').innerHTML=table(verified.slice(0,250),'No verified payments yet.');
      TF.$('closedPaymentsTable').innerHTML=table(closed.slice(0,250),'No closed or flagged payments.');
      TF.$('editPaymentOrder').innerHTML='<option value="">Select order</option>'+orders.map(o=>`<option value="${o.id}">${TF.esc(o.order_number)} — ${TF.esc(o.customer_name)} — ${TF.money(o.total_due)} (${TF.esc(o.payment_status)})</option>`).join('');
      TF.$('editPaymentAccount').innerHTML=TF.accountOptions(true);
    }catch(e){TF.fail(e,'Payments failed');}
  }
  async function openProof(payment){
    if(!payment.proof_storage_path){TF.toast('No proof uploaded',true);return;}
    const {data,error}=await TF.state.supa.storage.from('payment-proofs').createSignedUrl(payment.proof_storage_path,120);
    if(error)throw error;window.open(data.signedUrl,'_blank','noopener');
  }
  function openEdit(payment){
    TF.$('editPaymentId').value=payment.id;
    TF.$('editPaymentOrder').value=payment.order_id||'';
    TF.$('editPaymentAmount').value=Number(payment.amount).toFixed(2);
    TF.$('editPaymentMethod').value=payment.payment_method;
    TF.$('editPaymentAccount').value=payment.cash_account_id||'';
    TF.$('editPaymentReference').value=payment.reference_number||'';
    TF.$('editPaymentNotes').value=payment.notes||'';
    TF.$('editPaymentDialog').showModal();
  }
  async function saveEdit(e){
    e.preventDefault();const b=e.submitter;TF.setLoading(b,true,'Saving…');
    try{
      const {error}=await TF.state.supa.rpc('edit_pending_payment_with_order_v3',{
        p_payment_id:TF.$('editPaymentId').value,
        p_amount:Number(TF.$('editPaymentAmount').value),
        p_method:TF.$('editPaymentMethod').value,
        p_cash_account_id:TF.$('editPaymentAccount').value||null,
        p_reference_number:TF.$('editPaymentReference').value.trim(),
        p_order_id:TF.$('editPaymentOrder').value,
        p_notes:TF.$('editPaymentNotes').value.trim()
      });
      if(error)throw error;TF.$('editPaymentDialog').close();TF.toast('Payment correction saved');await load();
    }catch(err){TF.fail(err,'Payment correction failed');}finally{TF.setLoading(b,false);}
  }
  async function changeStatus(payment,status){
    const labels={needs_review:'send to needs review',rejected:'reject',duplicate:'mark as duplicate',voided:'void',refunded:'refund'};
    const reason=prompt(`Reason to ${labels[status]||status} this payment:`);
    if(!reason)return;
    if(['voided','refunded'].includes(status)&&!confirm(`${status==='refunded'?'Refund':'Void'} ${TF.money(payment.amount)}? This reverses the recorded cash movement.`))return;
    const {error}=await TF.state.supa.rpc('change_payment_status_v3',{p_payment_id:payment.id,p_new_status:status,p_reason:reason});
    if(error)throw error;TF.toast(`Payment marked ${status.replace('_',' ')}`);await load();
  }
  async function action(e){
    const target=e.target.closest('[data-proof],[data-verify],[data-edit-payment],[data-change]');if(!target)return;
    const id=target.dataset.proof||target.dataset.verify||target.dataset.editPayment||target.dataset.change;
    const p=payments.find(x=>x.id===id);if(!p)return;
    try{
      if(target.dataset.proof){await openProof(p);return;}
      if(target.dataset.editPayment){openEdit(p);return;}
      if(target.dataset.verify){const {error}=await TF.state.supa.rpc('verify_payment',{p_payment_id:id});if(error)throw error;TF.toast('Payment verified and allocated');await load();return;}
      if(target.dataset.change)await changeStatus(p,target.dataset.status);
    }catch(err){TF.fail(err,'Payment action failed');}
  }
  TF.ready.then(()=>{
    ['pendingPaymentsTable','verifiedPaymentsTable','closedPaymentsTable'].forEach(id=>TF.$(id).addEventListener('click',action));
    TF.$('editPaymentForm').addEventListener('submit',saveEdit);
    TF.$('closeEditPaymentBtn').addEventListener('click',()=>TF.$('editPaymentDialog').close());
    TF.$('cancelEditPaymentBtn').addEventListener('click',()=>TF.$('editPaymentDialog').close());
    window.addEventListener('twofly:refresh',load);load();
  }).catch(e=>TF.fail(e,'Payments failed'));
})();
