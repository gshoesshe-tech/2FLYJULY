(() => {
  'use strict';
  const TF=window.TwoFly;
  let parsedItems=[], orders=[], lastExpected=0, activeDetailOrder=null, activeDetailItems=[], editingOrderId=null;

  function fillSelects(){
    const {$,state,accountOptions}=TF;
    $('paymentAccount').innerHTML=accountOptions(true);
    $('skuList').innerHTML=state.products.map(p=>`<option value="${TF.esc(p.code)}">${TF.esc(p.name)}</option>`).join('');
  }
  function parseOrder(){
    const {$,state,normalizeCategoryLabel,money,num,toast}=TF;
    const raw=$('orderPaste').value.trim(); if(!raw){toast('Paste an order form first',true);return;}
    const lines=raw.split(/\r?\n/).map(x=>x.trim()); let current=null; const groups=[],warnings=[];
    const getField=name=>{const re=new RegExp(`^${name}\\s*:\\s*(.*)$`,'i');const line=lines.find(l=>re.test(l));return line?line.match(re)[1].trim():'';};
    $('orderCustomer').value=getField('Name'); $('orderPhone').value=getField('Phone'); $('orderAddress').value=getField('Address');
    for(const line of lines){
      const h=line.match(/^\[([^\]]+)\]$/); if(h){current={label:normalizeCategoryLabel(h[1]),items:[],qty:null,amount:null};groups.push(current);continue;}
      if(!current) continue;
      const im=line.match(/^[•*]\s*(.+?)\s+[–—-]\s*x\s*(\d+)\s*$/i);
      if(im){let itemText=im[1].trim(),size='';const sm=itemText.match(/\(\s*Size\s*:\s*([^)]+)\)/i);if(sm){size=sm[1].trim().toUpperCase();itemText=itemText.replace(sm[0],'').trim();}current.items.push({sku:itemText.toUpperCase(),quantity:Number(im[2]),size});continue;}
      const q=line.match(/^Category Qty\s*:\s*(\d+)/i);if(q){current.qty=Number(q[1]);continue;}
      const a=line.match(/^Category Amount\s*:\s*₱?\s*([\d,]+(?:\.\d+)?)/i);if(a)current.amount=Number(a[1].replace(/,/g,''));
    }
    const parsed=[];
    groups.forEach(g=>{
      const cat=state.aliasToCategory.get(g.label); if(!cat) warnings.push(`Unknown category: ${g.label}`);
      const sumQty=g.items.reduce((a,i)=>a+i.quantity,0); if(g.qty!=null&&sumQty!==g.qty) warnings.push(`${g.label}: item quantities total ${sumQty}, but Category Qty says ${g.qty}.`);
      const groupUnit=g.amount!=null&&sumQty>0?g.amount/sumQty:null;
      g.items.forEach(i=>{
        const p=state.productByCode.get(i.sku); if(!p) warnings.push(`Unknown SKU: ${i.sku}`);
        if(p&&cat&&p.category_id!==cat.id) warnings.push(`${i.sku} belongs to ${p.inventory_categories?.name||'another category'}, not ${g.label}.`);
        if(p?.requires_size&&!i.size) warnings.push(`${i.sku} requires a Pro Club Inspired size.`);
        parsed.push({category:cat?.name||g.label,category_code:cat?.code||'',sku:i.sku,size:i.size,quantity:i.quantity,unit_price:groupUnit??Number(p?.default_sell_price||0),name:p?.name||i.sku});
      });
    });
    const totalLine=lines.find(l=>/^Total Amount\s*:/i.test(l));
    const shownTotal=totalLine?Number((totalLine.match(/₱?\s*([\d,]+(?:\.\d+)?)/)||[])[1]?.replace(/,/g,'')||0):0;
    const calcTotal=parsed.reduce((a,i)=>a+i.quantity*i.unit_price,0); if(shownTotal&&Math.abs(shownTotal-calcTotal)>.02) warnings.push(`Grand total says ${money(shownTotal)}, while parsed category totals equal ${money(calcTotal)}.`);
    parsedItems=parsed; renderItems();
    const expected=calcTotal+($('fulfillmentMethod').value==='jnt'?num($('shippingFee').value):0); $('paymentAmount').value=expected.toFixed(2); lastExpected=expected;
    $('parseWarnings').innerHTML=warnings.length?warnings.map(w=>`• ${TF.esc(w)}`).join('<br>'):'All recognized SKUs and totals passed the parser checks.';
    $('parseWarnings').classList.remove('hidden'); $('parseWarnings').classList.add('warn');
  }
  function renderItems(){
    const {$,state,esc,money}=TF;
    $('parsedItemsBody').innerHTML=parsedItems.map((i,idx)=>{
      const p=state.productByCode.get(String(i.sku).toUpperCase()); const cat=p?state.categoryById.get(p.category_id):null;
      const sizes=p?.requires_size?`<select data-field="size" data-i="${idx}"><option value="">Select</option>${p.allowed_sizes.map(s=>`<option ${s===i.size?'selected':''}>${s}</option>`).join('')}</select>`:`<input data-field="size" data-i="${idx}" value="${esc(i.size||'')}" placeholder="—">`;
      return `<tr><td>${esc(cat?.name||i.category||'Unknown')}</td><td><input data-field="sku" data-i="${idx}" value="${esc(i.sku)}" list="skuList"></td><td>${sizes}</td><td><input data-field="quantity" data-i="${idx}" type="number" min="1" step="1" value="${i.quantity}"></td><td><input data-field="unit_price" data-i="${idx}" type="number" min="0" step="0.01" value="${Number(i.unit_price).toFixed(2)}"></td><td>${money(i.quantity*i.unit_price)}</td><td><button class="btn danger" data-remove="${idx}">Remove</button></td></tr>`;
    }).join('')||'<tr><td colspan="7" class="empty">Paste and read an order form.</td></tr>';
    updateTotals();
  }
  function editItem(e){
    const i=Number(e.target.dataset.i),field=e.target.dataset.field;if(!Number.isInteger(i)||!field)return;
    let value=e.target.value;if(['quantity','unit_price'].includes(field))value=Number(value||0);parsedItems[i][field]=value;
    if(field==='sku'){const p=TF.state.productByCode.get(String(value).toUpperCase());if(p){const cat=TF.state.categoryById.get(p.category_id);Object.assign(parsedItems[i],{sku:p.code,category:cat?.name,category_code:cat?.code,name:p.name});if(!parsedItems[i].unit_price)parsedItems[i].unit_price=Number(p.default_sell_price||0);}}
    renderItems();
  }
  function updateConditions(){
    const {$}=TF,m=$('fulfillmentMethod').value,type=$('orderType').value;
    $('releaseDateWrap').classList.toggle('hidden',type!=='made_to_order');
    const isJnt=m==='jnt';
    $('shippingFee').disabled=!isJnt;
    $('courierCost').disabled=!isJnt;
    $('shippingFeeWrap').classList.toggle('field-disabled',!isJnt);
    $('courierCostWrap').classList.toggle('field-disabled',!isJnt);
    $('shippingHelp').textContent=isJnt
      ? 'J&T selected. Enter the customer shipping fee now and the actual courier cost now or later.'
      : 'Select J&T to enable the shipping fields. Lalamove and Walk-in stay at ₱0.';
    if(!isJnt){$('shippingFee').value='0';$('courierCost').value='0';}
    updateTotals(true);
  }
  function updateTotals(syncPayment=false){
    const {$,money,num}=TF;
    const product=parsedItems.reduce((a,i)=>a+num(i.quantity)*num(i.unit_price),0),shipping=$('fulfillmentMethod').value==='jnt'?num($('shippingFee').value):0,courier=$('fulfillmentMethod').value==='jnt'?num($('courierCost').value):0,total=product+shipping;
    $('orderProductTotal').textContent=money(product);$('orderShippingTotal').textContent=money(shipping);$('orderExpectedTotal').textContent=money(total);$('shippingProfitPreview').textContent=money(shipping-courier);$('parsedSummary').textContent=`${parsedItems.length} lines • ${parsedItems.reduce((a,i)=>a+num(i.quantity),0)} pieces • ${money(product)}`;
    if(syncPayment){const current=num($('paymentAmount').value);if(!current||Math.abs(current-lastExpected)<.02)$('paymentAmount').value=total.toFixed(2);} lastExpected=total;
  }
  async function uploadProof(){
    const {$,state,today}=TF,file=$('paymentProof').files[0];if(!file)return'';
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'-'),path=`${state.session.user.id}/${today()}/${crypto.randomUUID()}-${safe}`;
    const {error}=await state.supa.storage.from('payment-proofs').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(error)throw error;return path;
  }
  async function submitOrder(confirmNow){
    const {$,state,num,today,sha256,setLoading,fail,toast}=TF,button=confirmNow?$('confirmPaidBtn'):$('saveReviewBtn');setLoading(button,true,confirmNow?'Confirming…':'Saving…');
    try{
      if(!parsedItems.length)throw new Error('Read or add at least one product first.');
      const unknown=parsedItems.filter(i=>!state.productByCode.has(String(i.sku).toUpperCase()));if(unknown.length)throw new Error('Fix unknown SKUs before saving: '+unknown.map(i=>i.sku).join(', '));
      for(const i of parsedItems){const p=state.productByCode.get(i.sku.toUpperCase());if(p.requires_size&&!p.allowed_sizes.includes(String(i.size).toUpperCase()))throw new Error(`${i.sku} needs a valid size.`);if(num(i.quantity)<=0)throw new Error(`Invalid quantity for ${i.sku}`);}
      if(!$('orderCustomer').value.trim())throw new Error('Customer name is required.');
      if($('orderType').value==='made_to_order'&&!$('expectedReleaseDate').value)throw new Error('Made-to-order requires an expected release date.');
      const amount=num($('paymentAmount').value);if(confirmNow&&amount<=0)throw new Error('Enter the verified payment amount.');
      const raw=$('orderPaste').value.trim(),fingerprint=raw?await sha256(raw):await sha256(JSON.stringify(parsedItems)+$('orderPhone').value+Date.now()),proof=amount>0?await uploadProof():'';
      const order={raw_order_form:raw,form_fingerprint:fingerprint,customer_name:$('orderCustomer').value.trim(),phone:$('orderPhone').value.trim(),address:$('orderAddress').value.trim(),order_type:$('orderType').value,fulfillment_method:$('fulfillmentMethod').value,expected_release_date:$('expectedReleaseDate').value||null,shipping_fee_due:$('fulfillmentMethod').value==='jnt'?num($('shippingFee').value):0,actual_courier_cost:$('fulfillmentMethod').value==='jnt'?num($('courierCost').value):0,notes:$('orderNotes').value.trim(),order_date:today()};
      const items=parsedItems.map(i=>({sku:i.sku.toUpperCase(),size:String(i.size||'').toUpperCase(),quantity:num(i.quantity),unit_price:num(i.unit_price)}));
      const payment=amount>0?{payment_date:today(),amount,payment_method:$('paymentMethod').value,cash_account_id:$('paymentAccount').value||null,reference_number:$('paymentReference').value.trim(),proof_storage_path:proof}:null;
      const {error}=await state.supa.rpc('create_order',{p_order:order,p_items:items,p_payment:payment,p_verify_and_confirm:confirmNow});if(error)throw error;
      toast(confirmNow?'Paid order confirmed and inventory reserved':'Order saved for payment review');resetForm();await loadOrders();
    }catch(e){fail(e,'Order not saved');}finally{setLoading(button,false);}
  }
  function setEditMode(active,order=null){
    editingOrderId=active&&order?order.id:null;
    TF.$('editOrderBanner').classList.toggle('hidden',!active);
    TF.$('saveReviewBtn').classList.toggle('hidden',active);
    TF.$('confirmPaidBtn').classList.toggle('hidden',active||!TF.isManagement());
    TF.$('saveEditBtn').classList.toggle('hidden',!active);
    ['paymentAmount','paymentMethod','paymentAccount','paymentReference','paymentProof'].forEach(id=>{if(TF.$(id))TF.$(id).disabled=active;});
    if(active&&order)TF.$('editOrderLabel').textContent=`Editing ${order.order_number}. Saved changes will recalculate totals and active reservations.`;
  }
  async function startEditOrder(order){
    try{
      if(['packing','shipped','delivered','cancelled','refunded'].includes(order.status))throw new Error('This order can no longer be edited.');
      const {data,error}=await TF.state.supa.from('order_items').select('*').eq('order_id',order.id).order('line_number');if(error)throw error;
      parsedItems=(data||[]).map(i=>({sku:i.sku_text,size:i.size||'',quantity:Number(i.quantity),unit_price:Number(i.unit_price),name:i.product_name_snapshot||i.sku_text,category:''}));
      TF.$('orderPaste').value=order.raw_order_form||'';TF.$('orderCustomer').value=order.customer_name||'';TF.$('orderPhone').value=order.phone||'';TF.$('orderAddress').value=order.address||'';TF.$('orderType').value=order.order_type||'regular';TF.$('fulfillmentMethod').value=order.fulfillment_method||'unselected';TF.$('expectedReleaseDate').value=order.expected_release_date||'';TF.$('shippingFee').value=Number(order.shipping_fee_due||0).toFixed(2);TF.$('courierCost').value=Number(order.actual_courier_cost||0).toFixed(2);TF.$('orderNotes').value=order.notes||'';TF.$('paymentAmount').value=Number(order.verified_total_paid||0).toFixed(2);
      setEditMode(true,order);renderItems();updateConditions();if(TF.$('orderDetailDialog').open)TF.$('orderDetailDialog').close();window.scrollTo({top:0,behavior:'smooth'});
    }catch(e){TF.fail(e,'Order edit could not start');}
  }
  async function saveEditedOrder(){
    if(!editingOrderId)return;const btn=TF.$('saveEditBtn');TF.setLoading(btn,true,'Saving changes…');
    try{
      if(!parsedItems.length)throw new Error('Add at least one item.');
      const unknown=parsedItems.filter(i=>!TF.state.productByCode.has(String(i.sku).toUpperCase()));if(unknown.length)throw new Error('Fix unknown SKUs: '+unknown.map(i=>i.sku).join(', '));
      for(const i of parsedItems){const p=TF.state.productByCode.get(String(i.sku).toUpperCase());if(p.requires_size&&!p.allowed_sizes.includes(String(i.size).toUpperCase()))throw new Error(`${i.sku} needs a valid size.`);if(TF.num(i.quantity)<=0)throw new Error(`Invalid quantity for ${i.sku}`);}
      if(!TF.$('orderCustomer').value.trim())throw new Error('Customer name is required.');
      if(TF.$('orderType').value==='made_to_order'&&!TF.$('expectedReleaseDate').value)throw new Error('Made-to-order requires an expected release date.');
      const current=orders.find(o=>o.id===editingOrderId);
      const raw=TF.$('orderPaste').value.trim();
      const order={raw_order_form:raw,form_fingerprint:current?.form_fingerprint||null,customer_name:TF.$('orderCustomer').value.trim(),phone:TF.$('orderPhone').value.trim(),address:TF.$('orderAddress').value.trim(),order_type:TF.$('orderType').value,fulfillment_method:TF.$('fulfillmentMethod').value,expected_release_date:TF.$('expectedReleaseDate').value||null,shipping_fee_due:TF.$('fulfillmentMethod').value==='jnt'?TF.num(TF.$('shippingFee').value):0,actual_courier_cost:TF.$('fulfillmentMethod').value==='jnt'?TF.num(TF.$('courierCost').value):0,notes:TF.$('orderNotes').value.trim()};
      const items=parsedItems.map(i=>({sku:String(i.sku).toUpperCase(),size:String(i.size||'').toUpperCase(),quantity:TF.num(i.quantity),unit_price:TF.num(i.unit_price)}));
      const {error}=await TF.state.supa.rpc('update_order_v3',{p_order_id:editingOrderId,p_order:order,p_items:items});if(error)throw error;
      TF.toast('Order changes saved and reservations recalculated');resetForm();await loadOrders();
    }catch(e){TF.fail(e,'Order changes not saved');}finally{TF.setLoading(btn,false);}
  }
  function resetForm(){
    const {$}=TF;setEditMode(false);parsedItems=[];['orderPaste','orderCustomer','orderPhone','orderAddress','orderNotes','paymentAmount','paymentReference'].forEach(id=>$(id).value='');$('paymentProof').value='';$('shippingFee').value='0';$('courierCost').value='0';$('orderType').value='regular';$('fulfillmentMethod').value='unselected';$('expectedReleaseDate').value='';$('parseWarnings').classList.add('hidden');renderItems();updateConditions();
  }
  async function loadOrders(){
    const {state,fail}=TF;try{const {data,error}=await state.supa.from('v_order_list').select('*').order('created_at',{ascending:false}).limit(500);if(error)throw error;orders=data||[];renderOrders();}catch(e){fail(e,'Orders failed');}
  }
  function renderOrders(){
    const {$,esc,money,statusPill,isManagement}=TF,q=$('orderSearch').value.trim().toLowerCase(),rows=orders.filter(o=>!q||[o.order_number,o.customer_name,o.phone,o.tracking_number,o.status].some(v=>String(v||'').toLowerCase().includes(q)));
    $('ordersTable').innerHTML=`<table><thead><tr><th>Order</th><th>Customer</th><th>Type / Method</th><th>Amounts</th><th>Status</th><th>Stock</th><th>Actions</th></tr></thead><tbody>${rows.map(o=>{const actions=[`<button class="btn" data-action="view" data-id="${o.id}">View</button>`];if(isManagement()&&!['packing','shipped','delivered','cancelled','refunded'].includes(o.status))actions.push(`<button class="btn" data-action="edit" data-id="${o.id}">Edit</button>`);if(isManagement()&&['draft','payment_review'].includes(o.status)&&['paid','overpaid'].includes(o.payment_status))actions.push(`<button class="btn primary" data-action="reserve" data-id="${o.id}">Confirm</button>`);if(isManagement()&&o.status==='ready_to_pack')actions.push(`<button class="btn primary" data-action="packing" data-id="${o.id}">Start packing</button>`);if(isManagement()&&o.status==='packing')actions.push(`<button class="btn primary" data-action="ship" data-id="${o.id}">Ship / release</button>`);if(isManagement()&&o.status==='shipped')actions.push(`<button class="btn" data-action="deliver" data-id="${o.id}">Delivered</button>`);if(isManagement()&&!['cancelled','refunded','delivered'].includes(o.status))actions.push(`<button class="btn danger" data-action="cancel" data-id="${o.id}">Cancel</button>`);return `<tr><td><strong>${esc(o.order_number)}</strong><br><small>${esc(o.order_date)}</small></td><td>${esc(o.customer_name)}<br><small>${esc(o.phone||'')}</small></td><td>${esc(o.order_type.replaceAll('_',' '))}<br>${esc(o.fulfillment_method.toUpperCase().replace('_','-'))}</td><td>${money(o.product_total)} products${o.fulfillment_method==='jnt'?`<br><small>${money(o.shipping_fee_due)} shipping / ${money(o.actual_courier_cost)} courier</small>`:''}<br><small>${money(o.verified_total_paid)} verified</small></td><td>${statusPill(o.status)} ${statusPill(o.payment_status)}</td><td>${o.shortage_quantity?`<span class="pill danger">Short ${o.shortage_quantity}</span>`:''}${o.incoming_reserved_quantity?` <span class="pill warn">Incoming ${o.incoming_reserved_quantity}</span>`:''}</td><td><div class="row-actions">${actions.join('')}</div></td></tr>`;}).join('')||'<tr><td colspan="7" class="empty">No orders found.</td></tr>'}</tbody></table>`;
  }

  async function copyText(text,successMessage){
    try{
      await navigator.clipboard.writeText(String(text||''));
      TF.toast(successMessage||'Copied');
    }catch{
      const ta=document.createElement('textarea');ta.value=String(text||'');document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();TF.toast(successMessage||'Copied');
    }
  }
  function packingText(order,items){
    return [
      `${order.order_number} — ${order.customer_name}`,
      `Phone: ${order.phone||'—'}`,
      `Address: ${order.address||'—'}`,
      `Fulfillment: ${String(order.fulfillment_method||'').toUpperCase().replace('_','-')}`,
      '',
      ...items.map(i=>`☐ ${i.sku_text}${i.size?` (Size: ${i.size})`:''} ×${i.quantity}`),
      '',
      `Products: ${TF.money(order.product_total)}`,
      `J&T shipping: ${TF.money(order.shipping_fee_due)}`,
      `Verified payment: ${TF.money(order.verified_total_paid)}`
    ].join('\n');
  }
  async function openOrderDetails(order){
    const {data,error}=await TF.state.supa.from('order_items').select('*').eq('order_id',order.id).order('line_number');
    if(error)throw error;
    activeDetailOrder=order;activeDetailItems=data||[];
    TF.$('detailOrderTitle').textContent=`${order.order_number} — ${order.customer_name}`;
    TF.$('detailOrderStatus').textContent=`${String(order.status||'').replaceAll('_',' ')} • ${String(order.payment_status||'').replaceAll('_',' ')}`;
    TF.$('detailCustomer').textContent=order.customer_name||'—';
    TF.$('detailPhone').textContent=order.phone||'—';
    TF.$('detailAddress').textContent=order.address||'—';
    TF.$('detailOrderType').textContent=String(order.order_type||'').replaceAll('_',' ');
    TF.$('detailFulfillment').textContent=String(order.fulfillment_method||'').toUpperCase().replace('_','-');
    TF.$('detailProductTotal').textContent=TF.money(order.product_total);
    TF.$('detailShippingFee').textContent=TF.money(order.shipping_fee_due);
    TF.$('detailVerified').textContent=TF.money(order.verified_total_paid);
    TF.$('detailCourierCost').textContent=TF.money(order.actual_courier_cost);
    TF.$('detailShippingProfit').textContent=TF.money(Number(order.shipping_fee_due||0)-Number(order.actual_courier_cost||0));
    TF.$('detailFulfillmentInput').value=order.fulfillment_method||'unselected';
    TF.$('detailShippingInput').value=Number(order.shipping_fee_due||0).toFixed(2);
    TF.$('detailCourierInput').value=Number(order.actual_courier_cost||0).toFixed(2);
    const isJnt=order.fulfillment_method==='jnt';TF.$('detailShippingInput').disabled=!isJnt;TF.$('detailCourierInput').disabled=!isJnt;TF.$('detailShippingProfitPreview').textContent=TF.money(Number(order.shipping_fee_due||0)-Number(order.actual_courier_cost||0));
    TF.$('detailPackingList').innerHTML=activeDetailItems.map(i=>`<label class="packing-row"><input type="checkbox"><span><strong>${TF.esc(i.sku_text)}</strong>${i.size?` <small>(Size: ${TF.esc(i.size)})</small>`:''} ×${i.quantity}</span></label>`).join('')||'<div class="empty">No items found.</div>';
    TF.$('detailRawForm').textContent=order.raw_order_form||'No original form was saved for this order.';
    TF.$('editOrderBtn').classList.toggle('hidden',!TF.isManagement()||['packing','shipped','delivered','cancelled','refunded'].includes(order.status));
    if(!TF.$('orderDetailDialog').open)TF.$('orderDetailDialog').showModal();
  }
  async function saveDetailShipping(){
    if(!activeDetailOrder)return;
    const btn=TF.$('saveDetailShippingBtn');TF.setLoading(btn,true,'Saving…');
    try{
      const method=TF.$('detailFulfillmentInput').value;
      const fee=method==='jnt'?TF.num(TF.$('detailShippingInput').value):0;
      const courier=method==='jnt'?TF.num(TF.$('detailCourierInput').value):0;
      const {error}=await TF.state.supa.rpc('update_order_shipping',{p_order_id:activeDetailOrder.id,p_fulfillment_method:method,p_shipping_fee_due:fee,p_actual_courier_cost:courier});
      if(error)throw error;
      TF.toast('Fulfillment and shipping updated');
      await loadOrders();
      const refreshed=orders.find(x=>x.id===activeDetailOrder.id);if(refreshed){TF.$('orderDetailDialog').close();await openOrderDetails(refreshed);}
    }catch(e){TF.fail(e,'Shipping update failed');}finally{TF.setLoading(btn,false);}
  }
  function printPackingSlip(){
    if(!activeDetailOrder)return;
    const body=packingText(activeDetailOrder,activeDetailItems).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const w=window.open('','_blank','width=760,height=900');
    if(!w){TF.toast('Allow pop-ups to print the packing slip',true);return;}
    w.document.write(`<html><head><title>${TF.esc(activeDetailOrder.order_number)}</title><style>body{font-family:Arial,sans-serif;padding:28px;line-height:1.65}h2{margin:0 0 16px}hr{margin:18px 0}</style></head><body><h2>2FLY Packing Slip</h2>${body}</body></html>`);w.document.close();w.focus();w.print();
  }

  async function orderAction(e){
    const b=e.target.closest('[data-action]');if(!b)return;const id=b.dataset.id,o=orders.find(x=>x.id===id);if(!o)return;
    try{
      if(b.dataset.action==='view'){await openOrderDetails(o);return;}
      if(b.dataset.action==='edit'){await startEditOrder(o);return;}
      if(b.dataset.action==='reserve'){const {error}=await TF.state.supa.rpc('reserve_order',{p_order_id:id,p_owner_override:false});if(error)throw error;TF.toast('Order confirmed and stock reserved');}
      if(b.dataset.action==='packing'){const {error}=await TF.state.supa.rpc('commit_order_inventory',{p_order_id:id});if(error)throw error;TF.toast('Inventory deducted; order is packing');}
      if(b.dataset.action==='ship'){const tracking=prompt('Tracking number / release reference:',o.tracking_number||'')||'';let courier=0;if(o.fulfillment_method==='jnt')courier=Number(prompt('Actual J&T courier cost:',String(o.actual_courier_cost||0))||0);const {error}=await TF.state.supa.rpc('update_order_fulfillment',{p_order_id:id,p_status:'shipped',p_tracking_number:tracking,p_actual_courier_cost:courier});if(error)throw error;TF.toast('Order marked shipped/released');}
      if(b.dataset.action==='deliver'){const {error}=await TF.state.supa.rpc('update_order_fulfillment',{p_order_id:id,p_status:'delivered',p_tracking_number:o.tracking_number,p_actual_courier_cost:o.actual_courier_cost});if(error)throw error;TF.toast('Order delivered');}
      if(b.dataset.action==='cancel'){const reason=prompt('Cancellation reason:');if(!reason)return;const {error}=await TF.state.supa.rpc('cancel_order',{p_order_id:id,p_reason:reason});if(error)throw error;TF.toast('Order cancelled and stock released/returned');}
      await loadOrders();
    }catch(err){TF.fail(err,'Order action failed');}
  }
  TF.ready.then(()=>{
    fillSelects(); renderItems(); updateConditions();
    TF.$('parseOrderBtn').addEventListener('click',parseOrder);
    TF.$('addItemBtn').addEventListener('click',()=>{parsedItems.push({category:'',sku:'',size:'',quantity:1,unit_price:0,name:''});renderItems();});
    TF.$('parsedItemsBody').addEventListener('input',editItem);
    TF.$('parsedItemsBody').addEventListener('click',e=>{const b=e.target.closest('[data-remove]');if(b){parsedItems.splice(Number(b.dataset.remove),1);renderItems();}});
    TF.$('orderType').addEventListener('change',updateConditions);TF.$('fulfillmentMethod').addEventListener('change',updateConditions);TF.$('shippingFee').addEventListener('input',()=>updateTotals(true));TF.$('courierCost').addEventListener('input',()=>updateTotals(false));
    TF.$('saveReviewBtn').addEventListener('click',()=>submitOrder(false));TF.$('confirmPaidBtn').addEventListener('click',()=>submitOrder(true));TF.$('saveEditBtn').addEventListener('click',saveEditedOrder);TF.$('cancelEditBtn').addEventListener('click',resetForm);TF.$('orderSearch').addEventListener('input',renderOrders);TF.$('ordersTable').addEventListener('click',orderAction);
    TF.$('closeOrderDetailBtn').addEventListener('click',()=>TF.$('orderDetailDialog').close());
    TF.$('copyPackingListBtn').addEventListener('click',()=>activeDetailOrder&&copyText(packingText(activeDetailOrder,activeDetailItems),'Packing list copied'));
    TF.$('copyOriginalFormBtn').addEventListener('click',()=>activeDetailOrder&&copyText(activeDetailOrder.raw_order_form||'','Original form copied'));
    TF.$('printPackingSlipBtn').addEventListener('click',printPackingSlip);
    TF.$('saveDetailShippingBtn').addEventListener('click',saveDetailShipping);
    TF.$('editOrderBtn').addEventListener('click',()=>activeDetailOrder&&startEditOrder(activeDetailOrder));
    const updateDetailShippingPreview=()=>{const j=TF.$('detailFulfillmentInput').value==='jnt';TF.$('detailShippingInput').disabled=!j;TF.$('detailCourierInput').disabled=!j;if(!j){TF.$('detailShippingInput').value='0';TF.$('detailCourierInput').value='0';}TF.$('detailShippingProfitPreview').textContent=TF.money(TF.num(TF.$('detailShippingInput').value)-TF.num(TF.$('detailCourierInput').value));};
    TF.$('detailFulfillmentInput').addEventListener('change',updateDetailShippingPreview);TF.$('detailShippingInput').addEventListener('input',updateDetailShippingPreview);TF.$('detailCourierInput').addEventListener('input',updateDetailShippingPreview);
    window.addEventListener('twofly:refresh',loadOrders);loadOrders();
  }).catch(e=>TF.fail(e,'Orders failed'));
})();
