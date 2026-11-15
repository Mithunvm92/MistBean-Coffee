const $=id=>document.getElementById(id);let currentFilter='ALL';let allOrders=[];const paymentCards=new Map();
async function api(path,options={}){const r=await fetch(path,{...options,credentials:'same-origin',headers:{'content-type':'application/json',...(options.headers||{})}});const data=r.headers.get('content-type')?.includes('application/json')?await r.json():r;if(!r.ok)throw new Error(data.error||`Request failed (\${r.status})`);return data;}
$('logout').addEventListener('click',()=>{window.location.assign('/cdn-cgi/access/logout');});
$('refresh').addEventListener('click',loadOrders);$('refreshStock').addEventListener('click',loadProducts);
document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{currentFilter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderOrders();}));
function money(n){return '₹'+Number(n||0).toLocaleString('en-IN');}function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function loadProducts(){try{$('stockError').textContent='';const d=await api('/api/admin/products');renderProducts(d.products||[]);}catch(e){$('stockError').textContent=e.message;}}
function renderProducts(products){const root=$('productsStock');root.replaceChildren();if(!products.length){root.textContent='No products configured.';return;}for(const p of products){const row=document.createElement('div');row.className='stock-row';const info=document.createElement('div');const name=document.createElement('strong');name.textContent=p.name;const state=document.createElement('span');state.className=p.in_stock?'stock-pill available':'stock-pill unavailable';state.textContent=p.in_stock?'Available':'Out of stock';info.append(name,state);const button=document.createElement('button');button.type='button';button.className=p.in_stock?'secondary stock-toggle':'good stock-toggle';button.textContent=p.in_stock?'Mark out of stock':'Make available';button.addEventListener('click',async()=>{button.disabled=true;try{await api('/api/admin/products/'+encodeURIComponent(p.id)+'/stock',{method:'PATCH',body:JSON.stringify({inStock:!p.in_stock})});await loadProducts();}catch(e){$('stockError').textContent=e.message;}finally{button.disabled=false;}});row.append(info,button);root.append(row);}}
async function loadOrders(){try{$('appError').textContent='';const d=await api('/api/admin/orders');allOrders=d.orders||[];renderOrders();}catch(e){$('appError').textContent=e.message;}}
function renderOrders(){const root=$('orders');root.replaceChildren();const rows=allOrders.filter(o=>currentFilter==='ALL'||o.status===currentFilter);if(!rows.length){root.innerHTML='<div class="empty">No orders in this view.</div>';return;}for(const o of rows){const card=document.createElement('article');card.className='order';const product=`${o.product_name} · ${o.pack_grams}g × ${o.quantity}${o.blend_ratio?` · ${o.blend_ratio.replace('/','% / ')}%`:''}`;card.innerHTML=`<div class="order-head"><div><h3>${esc(o.order_ref)}</h3><div class="small">${new Date(o.created_at).toLocaleString('en-IN')}</div></div><span class="status">${esc(o.status)} · ${esc(o.payment_status)}</span></div><div class="details"><div><b>Customer</b>${esc(o.customer_name)} · ${esc(o.customer_phone)}<br><span class="small">Account: ${esc(o.customer_account_ref||'Legacy order — account linked after migration')}</span></div><div><b>Product</b>${esc(product)}<br>${esc(o.grind_preference)}</div><div><b>Delivery</b>${esc(o.delivery_address)}, ${esc(o.pin_code)}</div><div><b>Payment breakdown</b><span class="amount">${money(o.subtotal)}</span><br><span class="small">Product subtotal</span><br><span class="small">Delivery fee: ${money(o.delivery_charge)}</span><br><b>Final payable: ${money(o.payable_paise?o.payable_paise/100:o.total_amount)}</b></div><div><b>WhatsApp opt-in</b>${o.customer_whatsapp_opt_in?'Yes':'No'}</div><div><b>Customer-submitted UTR</b>${esc(o.payment_submitted_reference||'Not submitted')}${o.payment_submitted_at?`<br><span class="small">Submitted ${new Date(o.payment_submitted_at).toLocaleString('en-IN')} · Claimed amount ${money(o.payment_submitted_amount)}</span>`:''}</div><div><b>Verified UTR</b>${esc(o.payment_reference||'Not verified')}</div><div><b>Invoice</b>${esc(o.invoice_number||'Not generated')}</div><div><b>Dispatch</b>${esc([o.courier_name,o.tracking_id].filter(Boolean).join(' · ')||'Not dispatched')}</div></div><div class="workflow-note">${o.status==='PENDING'?'Review the order and set delivery charges.':o.payment_status!=='PAID'?(o.payment_submitted_reference?'Customer submitted a UPI reference. Check the HDFC bank credit before marking paid.':'Customer has the QR payment link. Verify the actual HDFC bank credit before marking paid.'):!o.invoice_number?'Payment verified. Invoice generation may need a retry if seller/R2 configuration is incomplete.':o.status==='CONFIRMED'?'Invoice ready and linked to the customer phone account. Send it on WhatsApp, then dispatch.':o.status==='DISPATCHED'?'Order dispatched.':'Order workflow updated.'}</div><div class="actions" data-actions></div>`;const actions=card.querySelector('[data-actions]');
const add=(label,cls,fn)=>{const b=document.createElement('button');b.textContent=label;if(cls)b.className=cls;b.addEventListener('click',fn);actions.append(b);};
if(o.status==='PENDING'){add('Confirm order + delivery fee','good',()=>confirmOrder(o));add('Reject order','danger',()=>rejectOrder(o));}
if(o.status==='CONFIRMED'&&o.payment_status!=='PAID'){add('Generate payment card + WhatsApp','good',()=>openWhatsAppAction(o,'payment-request'));if(paymentCards.has(o.id)){add('Copy QR card','',()=>copyPaymentCard(o));add('Share QR on WhatsApp','good',()=>sharePaymentCard(o));}add(o.payment_submitted_reference?'Verify submitted UPI payment':'Verify UPI payment','',()=>verifyPayment(o));}
if(o.payment_status==='PAID'&&!o.invoice_number)add('Generate invoice + send on WhatsApp','good',()=>generateInvoiceAndSend(o));
if(o.invoice_number){add('Download invoice PDF','',()=>downloadInvoice(o));if(o.status==='CONFIRMED'&&!o.invoice_sent_at){add('Open invoice message on WhatsApp','',()=>openWhatsAppAction(o,'invoice-send'));add('Mark invoice sent','good',()=>{if(confirm('Have you sent the invoice PDF to the customer on WhatsApp?'))action(o,'invoice-sent');});}else if(o.invoice_sent_at){const sent=document.createElement('span');sent.className='sent-label';sent.textContent='Invoice sent';actions.append(sent);}}
if(o.status==='CONFIRMED'&&o.payment_status==='PAID'&&o.invoice_number)add('Mark dispatched + WhatsApp update','good',()=>dispatchOrder(o));
if(o.status==='DISPATCHED')add('Mark delivered','',()=>action(o,'deliver'));
root.append(card);}}
async function action(o,actionName,body={}){try{await api(`/api/admin/orders/${o.id}/${actionName}`,{method:'POST',body:JSON.stringify(body)});await loadOrders();}catch(e){$('appError').textContent=e.message;}}
async function generateInvoiceAndSend(o){const popup=window.open('about:blank','_blank');try{const d=await api(`/api/admin/orders/${o.id}/invoice`,{method:'POST',body:'{}'});if(d.message){await navigator.clipboard.writeText(d.message);}if(d.whatsappUrl){if(popup)popup.location=d.whatsappUrl;else window.location.href=d.whatsappUrl;alert('Invoice generated. Message copied. In WhatsApp, attach the downloaded invoice PDF and press Send yourself.');}else{if(popup)popup.close();alert('Invoice generated.');}await loadOrders();}catch(e){if(popup)popup.close();$('appError').textContent=e.message;}}
function canvasRoundRect(ctx,x,y,w,h,r,fill){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill();}}
function canvasText(ctx,text,x,y,size,color,weight='400',align='left'){ctx.font=`${weight} ${size}px Arial, sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(String(text??''),x,y);}
function canvasWrap(ctx,text,x,y,maxWidth,lineHeight,size,color,weight='400',maxLines=2){ctx.font=`${weight} ${size}px Arial, sans-serif`;ctx.fillStyle=color;ctx.textAlign='left';const words=String(text??'').split(/\s+/);let line='',lines=[];for(const word of words){const test=line?line+' '+word:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;}if(line)lines.push(line);lines.slice(0,maxLines).forEach((value,i)=>ctx.fillText(value,x,y+i*lineHeight));return Math.min(lines.length,maxLines);}
async function downloadPaymentCardPng(o,qrPath){
  const response=await fetch(qrPath,{credentials:'same-origin'});
  if(!response.ok){let message='Payment QR could not be generated.';try{const data=await response.json();message=data.error||message;}catch{}throw new Error(message);}
  const qrSvg=await response.text();
  {
    const qrImage=new Image();qrImage.decoding='async';qrImage.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qrSvg);await qrImage.decode();
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1350;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Your browser could not create the payment card image.');
    ctx.fillStyle='#f4eee4';ctx.fillRect(0,0,1080,1350);
    ctx.fillStyle='#302016';ctx.fillRect(0,0,1080,260);
    ctx.fillStyle='#b8874d';ctx.fillRect(0,250,1080,10);
    canvasText(ctx,'MISTBEAN',72,105,64,'#fff','700');
    canvasText(ctx,'COFFEE  |  FROM THE COORG HILLS',76,148,22,'#e2c69e','600');
    canvasText(ctx,'PAYMENT REQUEST',1008,95,24,'#f3dfbf','700','right');
    canvasText(ctx,'SCAN TO PAY',1008,135,20,'#fff','400','right');
    canvasRoundRect(ctx,54,205,972,1125,30,'#fff');
    canvasText(ctx,'YOUR ORDER IS CONFIRMED',100,290,25,'#8a6745','700');
    canvasText(ctx,String(o.order_ref||''),100,350,38,'#302016','700');
    ctx.strokeStyle='#e8dfd3';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(100,382);ctx.lineTo(980,382);ctx.stroke();
    canvasText(ctx,'HELLO '+String(o.customer_name||'CUSTOMER').toUpperCase(),100,430,22,'#75685d','600');
    canvasText(ctx,'ORDER DETAILS',100,490,18,'#9a7956','700');
    const productName=String(o.product_name||'Coffee');
    canvasWrap(ctx,productName,100,535,820,44,34,'#302016','700',2);
    canvasText(ctx,`${Number(o.pack_grams||0)} g  ×  ${Number(o.quantity||1)} pack(s)`,100,592,22,'#75685d','400');
    const payable=Number(o.payable_paise||Math.round(Number(o.total_amount||0)*100))/100;
    canvasText(ctx,'Product subtotal',110,665,24,'#75685d');
    canvasText(ctx,money(o.subtotal),970,665,24,'#302016','600','right');
    canvasText(ctx,'Delivery charge',110,715,24,'#75685d');
    canvasText(ctx,money(o.delivery_charge),970,715,24,'#302016','600','right');
    canvasRoundRect(ctx,90,755,900,135,18,'#f4eee4');
    canvasText(ctx,'TOTAL TO PAY',125,810,22,'#75685d','700');
    canvasText(ctx,money(payable),955,845,54,'#302016','700','right');
    canvasRoundRect(ctx,365,920,350,350,18,'#fff');
    ctx.imageSmoothingEnabled=false;ctx.drawImage(qrImage,385,940,310,310);ctx.imageSmoothingEnabled=true;
    canvasText(ctx,'SCAN WITH ANY UPI APP',540,1295,20,'#302016','700','center');
    canvasText(ctx,'Pay the exact amount shown above. Share your UPI UTR after payment.',540,1325,15,'#75685d','400','center');
    const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!png)throw new Error('The payment card PNG could not be created.');
    const pngUrl=URL.createObjectURL(png),anchor=document.createElement('a');
    anchor.href=pngUrl;anchor.download=`MistBean-${o.order_ref}-payment-card.png`;
    document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(pngUrl),5000);return png;
  }
}
function paymentShareMessage(o){return 'MistBean Coffee payment request\nOrder: '+o.order_ref+'\nAmount: '+money(o.payable_paise?o.payable_paise/100:o.total_amount)+'\nPlease scan the attached QR and verify the payee and amount before paying.';}
async function sharePaymentCardFile(o,blob){const file=new File([blob],'MistBean-'+o.order_ref+'-payment-card.png',{type:'image/png'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({files:[file],title:'MistBean payment QR',text:paymentShareMessage(o)});return true;}return false;}
function openWhatsAppWithQrFallback(o){const url='https://wa.me/91'+String(o.customer_phone||'').replace(/\D/g,'')+'?text='+encodeURIComponent(paymentShareMessage(o));window.open(url,'_blank');alert('WhatsApp opened. Attach the downloaded MistBean payment QR PNG, review the order and amount, then press Send.');}
async function copyPaymentCard(o){const blob=paymentCards.get(o.id);if(!blob){alert('Generate the payment card again before copying or sharing it.');return;}const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);if(mobile){try{if(await sharePaymentCardFile(o,blob))return;}catch(e){if(e.name==='AbortError')return;}openWhatsAppWithQrFallback(o);return;}try{if(navigator.clipboard&&window.ClipboardItem){await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);alert('Payment QR card copied. Open WhatsApp and paste it into the customer chat.');}else{alert('Image clipboard is not supported here. The QR card was downloaded; attach it in WhatsApp.');}}catch(e){openWhatsAppWithQrFallback(o);}}
async function sharePaymentCard(o){const blob=paymentCards.get(o.id);if(!blob){alert('Generate the payment card again before sharing it.');return;}try{if(await sharePaymentCardFile(o,blob))return;}catch(e){if(e.name==='AbortError')return;}openWhatsAppWithQrFallback(o);}
async function openWhatsAppAction(o,actionName){
  if(actionName==='payment-request'){
    const payable=Number(o.payable_paise||Math.round(Number(o.total_amount)*100))/100;
    const preview=`PAYMENT REQUEST PREVIEW\n\nOrder: ${o.order_ref}\nCustomer: ${o.customer_name}\nProduct: ${o.product_name} · ${o.pack_grams}g × ${o.quantity}\n\nProduct subtotal: ${money(o.subtotal)}\nDelivery fee: ${money(o.delivery_charge)}\nFinal UPI amount: ${money(payable)}\n\nGenerate the branded payment card and open WhatsApp?`;
    if(!confirm(preview))return;
  }
  const popup=window.open('about:blank','_blank');
  try{
    const d=await api(`/api/admin/orders/${o.id}/${actionName}`,{method:'POST',body:'{}'});
    if(d.message){try{await navigator.clipboard.writeText(d.message);}catch{console.info('Clipboard unavailable; WhatsApp draft contains the prepared message.');}}
    if(actionName==='payment-request'&&d.qrUrl){const cardBlob=await downloadPaymentCardPng({...o,payable_paise:Math.round(Number(d.totalAmount)*100)},d.qrUrl);paymentCards.set(o.id,cardBlob);}
    if(d.whatsappUrl){if(popup)popup.location=d.whatsappUrl;else window.location.href=d.whatsappUrl;}else if(popup)popup.close();
    await loadOrders();
    if(actionName==='payment-request')alert('Your MistBean payment card PNG has been downloaded and the customer WhatsApp chat is open. Attach the PNG, review the message, and press Send.');
    else if(actionName==='invoice-send')alert('Invoice message prepared. Attach the PDF and press Send yourself.');
  }catch(e){if(popup)popup.close();$('appError').textContent=e.message;}
}
async function confirmOrder(o){const raw=prompt('Delivery charge in INR (default ₹1; enter 0 if free):','1');if(raw===null)return;const amount=Number(raw);if(!Number.isFinite(amount)||amount<0||amount>100000){alert('Enter a valid delivery charge.');return;}await action(o,'confirm',{deliveryCharge:amount});}
async function rejectOrder(o){const reason=prompt('Reason for rejecting this order:');if(reason)await action(o,'reject',{reason});}
async function verifyPayment(o){const reference=prompt('Check the actual HDFC bank credit, then confirm the UPI transaction reference / UTR:',o.payment_submitted_reference||'');if(reference===null)return;if(reference.trim().length<6){alert('Enter a valid transaction reference.');return;}if(!confirm(`Have you independently confirmed that ₹${(o.payable_paise?o.payable_paise/100:o.total_amount).toFixed(2)} was credited to the MistBean bank account? A UTR alone is not proof of payment.`))return;await action(o,'payment',{status:'PAID',reference:reference.trim()});}
async function dispatchOrder(o){const courier=prompt('Courier / delivery partner (optional):','');if(courier===null)return;const tracking=prompt('Tracking ID (optional):','');if(tracking===null)return;const popup=window.open('about:blank','_blank');try{const d=await api(`/api/admin/orders/${o.id}/dispatch`,{method:'POST',body:JSON.stringify({courierName:courier,trackingId:tracking})});if(d.message){try{await navigator.clipboard.writeText(d.message);}catch{}}await loadOrders();if(d.whatsappUrl){if(popup)popup.location=d.whatsappUrl;else window.location.href=d.whatsappUrl;alert('Shipping update copied. Review WhatsApp and press Send yourself.');}else if(popup)popup.close();}catch(e){if(popup)popup.close();$('appError').textContent=e.message;}}
async function downloadInvoice(o){try{const r=await fetch(`/api/admin/invoices/${o.id}`,{credentials:'same-origin'});if(!r.ok){const d=await r.json();throw new Error(d.error||'Download failed');}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${o.invoice_number.replaceAll('/','-')}.pdf`;a.click();URL.revokeObjectURL(url);}catch(e){$('appError').textContent=e.message;}}
api('/api/admin/orders').then(d=>{
  allOrders=d.orders||[];
  $('appPanel').hidden=false;
  $('logout').hidden=false;
  renderOrders();
  loadProducts();
}).catch(e=>{
  $('authError').textContent=e.message==='Authentication required.'
    ? 'Cloudflare Access authentication was not accepted. Reload this page and sign in again.'
    : e.message;
});
