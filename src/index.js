const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
const JSON_HEADERS = { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const DEFAULT_PRODUCTS = [
  { id: 'arabica', name: 'Arabica', prices: { 250: 349, 500: 649, 1000: 1199 } },
  { id: 'robusta', name: 'Robusta', prices: { 250: 299, 500: 549, 1000: 999 } },
  { id: 'blend', name: 'House Blend', prices: { 250: 329, 500: 599, 1000: 1099 } },
];
const now = () => new Date().toISOString();
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
const fail = (message, status = 400) => json({ error: message }, status);
const uuid = () => crypto.randomUUID();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const enc = new TextEncoder();
const dec = new TextDecoder();

async function sha256(value) { return b64(await crypto.subtle.digest('SHA-256', enc.encode(value))); }
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}
async function verifyPassword(password, stored) {
  const [kind, rounds, salt, expected] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !rounds || !salt || !expected) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(salt.match(/../g).map(x => parseInt(x, 16))), iterations: Number(rounds), hash: 'SHA-256' }, key, 256);
  const actual = [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
  return actual.length === expected.length && [...actual].reduce((n, c, i) => n | (c.charCodeAt(0) ^ expected.charCodeAt(i)), 0) === 0;
}
async function createSession(env, email) {
  const payload = b64(enc.encode(JSON.stringify({ sub: email, exp: Date.now() + 8 * 60 * 60 * 1000, nonce: uuid() })));
  const token = `${payload}.${await hmac(payload, env.SESSION_SECRET)}`;
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now()).run();
  await env.DB.prepare('INSERT INTO admin_sessions(id,token_hash,expires_at) VALUES(?,?,?)').bind(uuid(), await sha256(token), new Date(Date.now() + 8 * 3600000).toISOString()).run();
  return token;
}
function sessionToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const entry = cookie.split(';').map(v => v.trim()).find(v => v.startsWith('mb_admin_session='));
  return entry ? decodeURIComponent(entry.slice('mb_admin_session='.length)) : '';
}
function sessionCookie(token, maxAge=28800, secure=true) {
  return `mb_admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Strict; Max-Age=${maxAge}`;
}
async function adminFromRequest(request, env) {
  const token = sessionToken(request);
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || (await hmac(payload, env.SESSION_SECRET)) !== signature) return null;
  let data;
  try { data = JSON.parse(dec.decode(unb64(payload))); } catch { return null; }
  if (!data.sub || data.exp < Date.now()) return null;
  const session = await env.DB.prepare('SELECT id FROM admin_sessions WHERE token_hash=? AND expires_at>?').bind(await sha256(token), now()).first();
  return session ? data.sub : null;
}
async function audit(env, action, orderId, actor, details = {}) {
  await env.DB.prepare('INSERT INTO audit_log(id,action,order_id,actor,details_json) VALUES(?,?,?,?,?)').bind(uuid(), action, orderId || null, actor, JSON.stringify(details)).run();
  if (orderId) await env.DB.prepare('INSERT INTO events(id,order_id,type,detail) VALUES(?,?,?,?)').bind(uuid(), orderId, action, JSON.stringify({ actor, ...details })).run();
}
async function uniquePayablePaise(env, orderId, totalRupees) {
  for (let attempt = 0; attempt < 99; attempt++) {
    const suffix = 1 + Math.floor(Math.random() * 99);
    const payable = totalRupees * 100 + suffix;
    const exists = await env.DB.prepare("SELECT id FROM orders WHERE payable_paise=? AND id<>? AND status NOT IN ('CANCELLED','REJECTED','DELIVERED') AND payment_status<>'PAID'").bind(payable, orderId).first();
    if (!exists) return { payable, suffix };
  }
  throw new Error('Could not allocate a unique payment amount. Please retry.');
}
function orderRef() { return `MB-${new Date().toISOString().slice(2,10).replaceAll('-', '')}-${crypto.randomUUID().slice(0,6).toUpperCase()}`; }
function validPhone(phone) { return /^[6-9]\d{9}$/.test(phone); }
function clean(s, max) { return String(s ?? '').trim().slice(0, max); }
function whatsappChatUrl(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `https://wa.me/91${digits}?text=${encodeURIComponent(message)}`;
}
function publicBaseUrl(env, requestUrl) {
  const configured = clean(env.PUBLIC_BASE_URL, 300);
  const base = new URL(configured || requestUrl.origin);
  const local = ['localhost', '127.0.0.1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !local) throw new Error('PUBLIC_BASE_URL must use HTTPS.');
  if (base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('PUBLIC_BASE_URL must be an origin only, for example https://mistbeancoffee.in.');
  if (!configured && !local) throw new Error('Set PUBLIC_BASE_URL to the public HTTPS storefront URL before sending payment links.');
  return base.origin;
}
function makePaymentUrl(env, requestUrl, order) {
  return `${publicBaseUrl(env, requestUrl)}/pay/${encodeURIComponent(order.order_ref)}`;
}
function makeUpiUri(env, order) {
  const upiId = clean(env.UPI_ID, 120);
  if (!upiId || !upiId.includes('@')) throw new Error('Set a valid UPI_ID in local .dev.vars before preparing payment details.');
  const params = new URLSearchParams({
    pa: upiId,
    pn: clean(env.UPI_PAYEE_NAME || 'MistBean Coffee', 80),
    am: (Number(order.payable_paise || order.total_amount * 100) / 100).toFixed(2),
    cu: 'INR',
    tn: `MistBean ${order.order_ref}`,
    tr: order.order_ref
  });
  return `upi://pay?${params.toString()}`;
}

async function getProducts(env) {
  const rows = await env.DB.prepare('SELECT id,name,description,active,price_250,price_500,price_1000 FROM products WHERE active=1 ORDER BY id').all();
  return (rows.results || []).map(p => ({ id:p.id, name:p.name, description:p.description, prices:{250:p.price_250,500:p.price_500,1000:p.price_1000} }));
}
async function sendTemplate(env, to, templateName, params, languageCode = 'en') {
  if (env.WHATSAPP_MODE !== 'meta') return { skipped: true, reason: 'WhatsApp mock mode' };
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !templateName) throw new Error('WhatsApp Cloud API is not configured.');
  const version = env.WHATSAPP_GRAPH_VERSION || 'v25.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST', headers: { authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product:'whatsapp', to, type:'template', template:{ name:templateName, language:{code:languageCode}, components:[{type:'body',parameters:params.map(text => ({type:'text',text:String(text)}))}] } })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `WhatsApp API error ${response.status}`);
  return data;
}

function whatsappRecipient(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  throw new Error('Customer phone number is not a valid Indian WhatsApp number.');
}
async function notifyCustomer(env, order, templateName, params) {
  if (!order.customer_whatsapp_opt_in) return;
  try { await sendTemplate(env, order.customer_phone, templateName, params); }
  catch (error) { console.error('WhatsApp customer notification failed', error.message); }
}

function pdfEscape(s) { return String(s ?? '').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[^\x20-\x7E]/g,' '); }
function makeInvoicePdf(order, env) {
  const W=595,H=842,M=42;
  const C={ink:'0.18 0.13 0.10',brown:'0.20 0.14 0.10',gold:'0.72 0.52 0.30',cream:'0.96 0.94 0.89',pale:'0.985 0.98 0.96',muted:'0.40 0.37 0.34',white:'1 1 1',green:'0.18 0.38 0.27'};
  const ops=[], y=t=>H-t;
  const rect=(x,t,w,h,c)=>ops.push(c+' rg '+x+' '+y(t+h)+' '+w+' '+h+' re f');
  const line=(x1,t1,x2,t2,c=C.gold,w=0.6)=>ops.push(c+' RG '+w+' w '+x1+' '+y(t1)+' m '+x2+' '+y(t2)+' l S');
  const text=(v,x,t,size=9,font='F1',c=C.ink)=>ops.push(c+' rg BT /'+font+' '+size+' Tf 1 0 0 1 '+x+' '+y(t)+' Tm ('+pdfEscape(v)+') Tj ET');
  const wrap=(v,n)=>{const words=String(v||'').split(/\s+/),out=[];let row='';for(const word of words){if(!word)continue;const next=row?row+' '+word:word;if(next.length>n&&row){out.push(row);row=word;}else row=next;}if(row)out.push(row);return out;};
  const block=(v,x,t,o={})=>{const rows=wrap(v,o.maxChars||60).slice(0,o.maxLines||4);rows.forEach((r,i)=>text(r,x,t+i*(o.leading||12),o.size||8.5,o.font||'F1',o.color||C.ink));return rows.length*(o.leading||12);};
  const money=n=>'INR '+Number(n||0).toLocaleString('en-IN');
  const sellerName=env.SELLER_LEGAL_NAME||'TEST ONLY - MistBean Proprietor';
  const sellerAddress=env.SELLER_ADDRESS||'TEST ONLY - Business address pending';
  const fssai=env.FSSAI_LICENSE_NUMBER||'TEST ONLY - FSSAI details pending';
  const customerAddress=(order.delivery_address||'')+', '+(order.pin_code||'');
  const notes=String(order.notes||'');
  const roast=notes.match(/Roast preference:\s*([^;]+)/i)?.[1]?.trim()||'Not specified';
  const grind=notes.match(/Grind size:\s*([^;]+)/i)?.[1]?.trim()||'Not specified';
  const form=String(order.grind_preference||'Not specified');
  const blend=order.blend_ratio?'Arabica / Robusta ratio '+order.blend_ratio:'Not applicable';
  const invoiceDate=String(order.payment_verified_at||order.updated_at||now()).slice(0,10);
  const paymentDate=order.payment_verified_at?String(order.payment_verified_at).replace('T',' ').slice(0,19)+' UTC':'Not recorded';
  const status=String(order.payment_status||'UNPAID').toUpperCase();

  rect(0,0,W,158,C.brown);rect(0,154,W,4,C.gold);
  text('MISTBEAN',M,49,27,'F2',C.white);text('COFFEE  |  FROM THE COORG HILLS',M,70,8.5,'F2','0.88 0.76 0.56');
  text('SALES INVOICE',370,47,19,'F2',C.white);text(order.invoice_number||'DRAFT',370,67,10,'F1',C.white);
  text('COMMERCIAL INVOICE - UNREGISTERED SUPPLIER',370,84,6.5,'F2','0.88 0.76 0.56');
  text(sellerName,M,111,10,'F2',C.white);block(sellerAddress,M,125,{size:7.5,maxChars:78,leading:10,color:C.white,maxLines:2});
  text('FSSAI: '+fssai,M,148,7,'F1',C.white);

  const top=184;
  text('BILL TO / SHIP TO',M,top,8,'F2',C.gold);text(order.customer_name||'Customer',M,top+19,12,'F2',C.ink);
  let h=block('Phone: '+(order.customer_phone||'Not recorded'),M,top+34,{size:8.5,maxChars:56,leading:12,maxLines:2});
  block('Delivery address: '+customerAddress,M,top+34+h,{size:8.2,maxChars:57,leading:12,maxLines:4});
  rect(365,top-14,188,91,C.cream);text('INVOICE DATE',379,top+4,7,'F2',C.muted);text(invoiceDate,379,top+21,10,'F2',C.ink);
  text('ORDER REFERENCE',379,top+43,7,'F2',C.muted);text(order.order_ref||'-',379,top+60,9,'F2',C.ink);
  text('ORDER DATE',379,top+78,7,'F2',C.muted);text(String(order.created_at||'').slice(0,10)||'-',449,top+78,7.5,'F2',C.ink);

  const tableTop=302,x0=M,x1=345,x2=395,x3=465,x4=553;
  rect(x0,tableTop,511,27,C.brown);text('DESCRIPTION / PRODUCT SPECIFICATIONS',x0+11,tableTop+17,7,'F2',C.white);
  text('QTY',x1+8,tableTop+17,7,'F2',C.white);text('UNIT PRICE',x2+7,tableTop+17,7,'F2',C.white);text('AMOUNT',x3+12,tableTop+17,7,'F2',C.white);
  const desc=[(order.product_name||'Coffee')+' - '+Number(order.pack_grams||0)+' g','Roast: '+roast+'  |  Form: '+form];
  if(form.toLowerCase().includes('ground')||form.toLowerCase().includes('powder'))desc.push('Grind size: '+grind);
  if(order.blend_ratio)desc.push('Blend ratio: '+blend);
  desc.forEach((v,i)=>text(v,x0+11,tableTop+48+i*13,i===0?9:7.4,i===0?'F2':'F1',i===0?C.ink:C.muted));
  text(String(order.quantity||1),x1+17,tableTop+49,8.5,'F1',C.ink);text(money(order.unit_price),x2+5,tableTop+49,8,'F1',C.ink);text(money(order.subtotal),x3+10,tableTop+49,8,'F2',C.ink);
  const rowBottom=tableTop+62+Math.max(0,desc.length-1)*13;line(x0,rowBottom,x4,rowBottom,'0.84 0.80 0.73',0.7);

  const sumTop=rowBottom+31,sx=370,vx=493;
  text('PRICE SUMMARY',M,sumTop,8,'F2',C.gold);text('Product subtotal',sx,sumTop,8.5,'F1',C.muted);text(money(order.subtotal),vx,sumTop,8.5,'F1',C.ink);
  text('Discount',sx,sumTop+19,8.5,'F1',C.muted);text(money(order.discount_amount||0),vx,sumTop+19,8.5,'F1',C.ink);
  text('Delivery charges',sx,sumTop+38,8.5,'F1',C.muted);text(money(order.delivery_charge),vx,sumTop+38,8.5,'F1',C.ink);
  line(sx,sumTop+49,553,sumTop+49,'0.82 0.75 0.65',0.6);rect(354,sumTop+56,199,30,C.cream);
  text('TOTAL AMOUNT',366,sumTop+75,8,'F2',C.brown);text(money(order.total_amount),466,sumTop+75,10,'F2',C.brown);
  text('GST is not charged by this unregistered seller.',354,sumTop+101,7,'F1',C.muted);

  const panelTop=sumTop+126;rect(M,panelTop,511,79,C.pale);text('PAYMENT DETAILS',M+13,panelTop+17,8,'F2',C.gold);
  text('Status: '+status,M+13,panelTop+36,8.5,'F2',status==='PAID'?C.green:C.ink);text('Method: UPI',M+205,panelTop+36,8.5,'F1',C.ink);
  text('Amount received: '+money(status==='PAID'?order.total_amount:0),M+13,panelTop+54,8,'F1',C.ink);
  text('Verified: '+paymentDate,M+205,panelTop+54,7.5,'F1',C.ink);text('UTR / reference: '+(order.payment_reference||'Not recorded'),M+13,panelTop+70,7.5,'F1',C.muted);

  const fulfilTop=panelTop+96;text('ORDER FULFILMENT',M,fulfilTop,8,'F2',C.gold);
  text('Order status: '+(order.status||'PENDING'),M,fulfilTop+18,8,'F1',C.ink);text('Courier: '+(order.courier_name||'Not assigned'),M+190,fulfilTop+18,8,'F1',C.ink);
  text('Tracking ID: '+(order.tracking_id||'Not assigned'),M,fulfilTop+35,8,'F1',C.ink);text('Delivery status: '+(order.status==='DELIVERED'?'Delivered':'See order updates'),M+190,fulfilTop+35,8,'F1',C.ink);

  const footTop=H-66;line(M,footTop-12,553,footTop-12,C.gold,0.8);
  text('Thank you for choosing MistBean Coffee.',M,footTop+5,9,'F2',C.brown);
  text('For order support, contact MistBean using the details shared at checkout.',M,footTop+20,7.2,'F1',C.muted);
  text('TEST DOCUMENT - Seller details and FSSAI data are placeholders pending verification.',M,footTop+36,6.5,'F2','0.55 0.30 0.18');
  text('This is a commercial sales invoice, not a GST tax invoice.',M,footTop+49,6.5,'F1',C.muted);

  const stream='q\n'+ops.join('\n')+'\nQ';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>','<< /Length '+enc.encode(stream).length+' >>\nstream\n'+stream+'\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((obj,i)=>{offsets.push(enc.encode(pdf).length);pdf+=(i+1)+' 0 obj\n'+obj+'\nendobj\n';});
  const xref=enc.encode(pdf).length;pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';offsets.slice(1).forEach(o=>{pdf+=String(o).padStart(10,'0')+' 00000 n \n';});
  pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';return enc.encode(pdf);
}
async function createInvoice(env, order, actor) {
  if (!env.SELLER_LEGAL_NAME || !env.SELLER_ADDRESS || String(env.SELLER_ADDRESS).toLowerCase().includes('update before launch')) throw new Error('Set the verified seller legal name and full address before generating invoices.');
  if (order.payment_status !== 'PAID') throw new Error('Verify payment before generating the invoice.');
  if (!env.INVOICES) throw new Error('Invoice storage (R2) is not configured.');
  // Re-render an existing invoice with the latest PDF template without consuming a new invoice number.
  let invoiceNumber = order.invoice_number;
  if (!invoiceNumber) {
    const seq = await env.DB.prepare('UPDATE invoice_sequence SET next_number=next_number+1 WHERE id=1 RETURNING next_number-1 AS n').first();
    invoiceNumber = `MB/${new Date().getFullYear()}/${String(seq.n).padStart(5,'0')}`;
  }
  const updated = { ...order, invoice_number: invoiceNumber };
  const key = `invoices/${invoiceNumber.replaceAll('/','-')}.pdf`;
  const bytes = makeInvoicePdf(updated, env);
  await env.INVOICES.put(key, bytes, { httpMetadata:{contentType:'application/pdf'} });
  await env.DB.prepare('UPDATE orders SET invoice_number=?,invoice_key=?,updated_at=? WHERE id=?').bind(invoiceNumber,key,now(),order.id).run();
  await audit(env,'INVOICE_GENERATED',order.id,actor,{invoiceNumber});
  return { invoiceNumber, key };
}
async function sendInvoiceWhatsApp(env, order, key) {
  if (env.WHATSAPP_MODE !== 'meta') return { skipped:true, reason:'WhatsApp mock mode' };
  if (!order.customer_whatsapp_opt_in) throw new Error('Customer WhatsApp opt-in is missing.');
  const obj = await env.INVOICES.get(key);
  if (!obj) throw new Error('Invoice PDF not found.');
  const version = env.WHATSAPP_GRAPH_VERSION || 'v25.0';
  const form = new FormData();
  form.append('messaging_product','whatsapp'); form.append('type','application/pdf');
  form.append('file',new Blob([await obj.arrayBuffer()],{type:'application/pdf'}),`${order.invoice_number.replaceAll('/','-')}.pdf`);
  const upload = await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/media`,{method:'POST',headers:{authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`},body:form});
  const media = await upload.json(); if (!upload.ok) throw new Error(media?.error?.message || 'Invoice media upload failed');
  const sent = await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{authorization:`Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:whatsappRecipient(order.customer_phone),type:'template',template:{name:env.WHATSAPP_TEMPLATE_INVOICE||'mistbean_invoice',language:{code:'en'},components:[{type:'header',parameters:[{type:'document',document:{id:media.id,filename:`${order.invoice_number.replaceAll('/','-')}.pdf`}}]},{type:'body',parameters:[{type:'text',text:order.invoice_number}]}]}})});
  const data=await sent.json(); if(!sent.ok) throw new Error(data?.error?.message || 'Invoice message failed'); return data;
}

async function api(request, env) {
  const url = new URL(request.url); const path = url.pathname; const method = request.method;
  const payMatch = path.match(/^\/pay\/(MB-[A-Z0-9-]+)$/i);
  if (payMatch && method === 'GET') {
    const order = await env.DB.prepare('SELECT order_ref,product_name,pack_grams,quantity,total_amount,payable_paise,status,payment_status,payment_submitted_reference,payment_submitted_at FROM orders WHERE order_ref=?').bind(payMatch[1]).first();
    if (!order) return fail('Payment link not found.', 404);
    if (!['CONFIRMED','PENDING_PAYMENT'].includes(order.status)) return fail('This order is not ready for payment.', 409);
    if (order.payment_status === 'PAID') return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment complete | MistBean Coffee</title><body style="font-family:Arial,sans-serif;background:#f5f0e7;color:#302016;padding:32px"><main style="max-width:520px;margin:auto;background:white;padding:28px;border-radius:16px"><h1>MISTBEAN COFFEE</h1><h2>Payment already received</h2><p>Order '+order.order_ref+' is marked as paid. Thank you!</p></main></body></html>',{status:200,headers:{...SECURITY_HEADERS,'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
    const amount=(Number(order.payable_paise || order.total_amount*100)/100).toFixed(2);
    const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    // HDFC SmartHub Vyapar static merchant QR payload supplied by the merchant.
    // This QR does not encode the order amount; the customer must enter it manually.
    const upiUri=makeUpiUri(env,{...order,total_amount:Number(order.payable_paise||order.total_amount*100)/100});
    const qrUrl='https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=16&data='+encodeURIComponent(upiUri);
    const submitted=Boolean(order.payment_submitted_reference);
    const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#302016"><title>Pay '+amount+' | MistBean Coffee</title><style>*{box-sizing:border-box}body{margin:0;padding:24px 16px;background:#f4efe6;color:#302016;font-family:Arial,sans-serif}.card{max-width:540px;margin:24px auto;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 32px #30201618}.head{background:#302016;color:#fff;padding:24px 28px;border-bottom:5px solid #b8874d}.brand{font-size:25px;font-weight:800;letter-spacing:1px}.sub{color:#e2c69e;font-size:12px;margin-top:5px}.body{padding:26px}.muted{color:#74695f;font-size:13px}.amount{font-size:34px;font-weight:800;margin:8px 0 20px}.item{padding:14px 0;border-bottom:1px solid #eee5d9;line-height:1.6}.pay{display:block;text-align:center;background:#2d7046;color:#fff;text-decoration:none;padding:17px;border-radius:10px;font-weight:800;font-size:17px;margin:20px 0}.qr{text-align:center;background:#faf7f1;border:1px solid #eee5d9;border-radius:12px;padding:16px;margin-top:18px}.qr img{width:240px;height:240px;max-width:100%;background:white}.hint{font-size:13px;line-height:1.5;color:#655b52}.foot{text-align:center;padding:0 24px 24px;color:#74695f;font-size:12px}.confirm{margin-top:22px;padding:18px;background:#f7f4ed;border:1px solid #e8dfd1;border-radius:12px}.confirm h3{margin:0 0 8px}.confirm label{display:block;font-size:13px;font-weight:700;margin:12px 0 6px}.confirm input{width:100%;padding:13px;border:1px solid #d8cebf;border-radius:8px;font-size:16px}.confirm button{width:100%;border:0;border-radius:9px;background:#302016;color:#fff;padding:14px;font-weight:800;font-size:15px;margin-top:14px}.confirm button:disabled{opacity:.55}.notice{font-size:13px;line-height:1.5;margin-top:12px;color:#655b52}.success{padding:13px;border-radius:9px;background:#e8f2e8;color:#24512e;font-size:13px;line-height:1.5}.error{color:#a12d20;font-size:13px;margin-top:10px}</style></head><body><main class="card"><header class="head"><div class="brand">MISTBEAN COFFEE</div><div class="sub">FROM THE COORG HILLS</div></header><section class="body"><div class="muted">PAYMENT FOR ORDER</div><h2 style="margin:6px 0">'+esc(order.order_ref)+'</h2><div class="muted">TOTAL PAYABLE</div><div class="amount">₹'+amount+'</div><div class="item"><strong>'+esc(order.product_name)+' · '+esc(order.pack_grams)+'g × '+esc(order.quantity)+'</strong><br><span class="muted">Order total includes the confirmed delivery charge.</span></div><p class="hint">Scan the HDFC SmartHub Vyapar merchant QR using any UPI app. The QR is static, so enter the exact amount shown above manually. Before paying, confirm the payee displayed by your UPI app is <strong>USHA D V</strong>. Do not proceed if the payee or amount is incorrect.</p><div class="qr"><strong>HDFC SmartHub Vyapar · Scan &amp; Pay</strong><p class="hint">Scan this QR from another phone, or save the QR and open it in your UPI app.</p><img src="'+qrUrl+'" alt="HDFC SmartHub Vyapar merchant UPI QR code"><p class="hint">Static merchant QR · Enter ₹'+amount+' manually. Payment is verified manually by MistBean.</p></div><div class="confirm" id="confirmBox"><h3>Already paid?</h3><p class="hint">Enter the UPI transaction ID / UTR / RRN shown on your payment success screen. MistBean will verify the credit before confirming your order as paid.</p><form id="paymentForm" data-order-ref="'+esc(order.order_ref)+'" data-amount="'+(Number(order.payable_paise||order.total_amount*100)/100)+'"><label for="paidAmount">Amount shown as paid (₹)</label><input id="paidAmount" name="amount" inputmode="decimal" value="'+amount+'" readonly><label for="paymentReference">UPI transaction ID / UTR / RRN</label><input id="paymentReference" name="reference" required minlength="6" maxlength="80" autocomplete="off" placeholder="Enter transaction reference" '+(submitted?'value="'+esc(order.payment_submitted_reference)+'"':'')+'><button id="submitPayment" type="submit" '+(submitted?'disabled':'')+'>'+(submitted?'Payment details submitted':'I have paid – submit details')+'</button><div id="paymentMessage" class="'+(submitted?'success':'notice')+'" role="status">'+(submitted?'Your payment reference has been received. MistBean will check the bank credit and update your order. You do not need to pay again.':'Only submit after your UPI app shows a successful payment. Do not share your UPI PIN or OTP.')+'</div></form></div></section><footer class="foot">MistBean Coffee · Your order remains pending until payment is verified.</footer></main><script src="/payment.js" defer></script></body></html>';
    return new Response(html,{status:200,headers:{...SECURITY_HEADERS,'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if (path === '/api/payment-submissions' && method === 'POST') {
    let body; try { body = await request.json(); } catch { return fail('Invalid payment confirmation details.'); }
    const ref = clean(body.orderRef, 40).toUpperCase();
    const reference = clean(body.reference, 80);
    const amount = Math.round(Number(body.amount) * 100);
    if (!/^MB-[A-Z0-9-]{8,32}$/.test(ref)) return fail('Invalid order reference.');
    if (!/^[A-Za-z0-9-]{6,80}$/.test(reference)) return fail('Enter a valid UPI transaction ID / UTR / RRN.');
    const order = await env.DB.prepare('SELECT id,order_ref,total_amount,payable_paise,status,payment_status FROM orders WHERE order_ref=?').bind(ref).first();
    if (!order) return fail('Order not found. Check the payment link.', 404);
    if (!['CONFIRMED','PENDING_PAYMENT'].includes(order.status)) return fail('This order is not yet ready for payment.', 409);
    if (order.payment_status === 'PAID') return fail('Payment is already verified for this order.', 409);
    if (!Number.isFinite(amount) || amount !== Number(order.payable_paise || order.total_amount*100)) return fail('The amount entered does not match the confirmed order payable amount.', 400);
    const submittedAt = now();
    await env.DB.prepare("UPDATE orders SET payment_submitted_reference=?,payment_submitted_amount=?,payment_submitted_at=?,payment_status='PAYMENT_SUBMITTED',updated_at=? WHERE id=? AND payment_status<>'PAID'")
      .bind(reference, amount, submittedAt, submittedAt, order.id).run();
    await audit(env, 'CUSTOMER_PAYMENT_DETAILS_SUBMITTED', order.id, 'customer', { reference, amount });
    return json({ ok:true, status:'PENDING_VERIFICATION', message:'Payment details received. MistBean will verify the bank credit.' });
  }
  if (method === 'GET' && path === '/api/health') return json({ok:true, service:'mistbean-api', time:now()});
  if (method === 'GET' && path === '/api/content') return json({brandName:env.BUSINESS_NAME || 'MistBean Coffee', products:await getProducts(env), whatsappMode:env.WHATSAPP_MODE || 'mock'});
  if (method === 'POST' && path === '/api/orders') {
    const ipHash=await sha256(request.headers.get('cf-connecting-ip')||'unknown');
    await env.DB.prepare("DELETE FROM rate_limits WHERE julianday(created_at) < julianday('now','-1 day')").run();
    const recent=await env.DB.prepare("SELECT COUNT(*) AS n FROM rate_limits WHERE ip_hash=? AND julianday(created_at) > julianday('now','-10 minutes')").bind(ipHash).first();
    if((recent?.n||0)>=5)return fail('Too many order attempts. Please try again later.',429);
    await env.DB.prepare('INSERT INTO rate_limits(ip_hash) VALUES(?)').bind(ipHash).run();
    let body; try { body=await request.json(); } catch { return fail('Invalid JSON.'); }
    const name=clean(body.customerName,80), phone=clean(body.customerPhone,10), address=clean(body.deliveryAddress,500), pin=clean(body.pinCode,6);
    const productId=clean(body.productId,20), pack=Number(body.packGrams), qty=Number(body.quantity), grind=clean(body.grindPreference,80), blend=clean(body.blendRatio,40), notes=clean(body.notes,500);
    if(name.length<2 || !validPhone(phone) || address.length<10 || !/^\d{6}$/.test(pin)) return fail('Please provide a valid name, Indian mobile number, full address and six-digit PIN code.');
    if(![250,500,1000].includes(pack) || !Number.isInteger(qty) || qty<1 || qty>20) return fail('Invalid pack size or quantity.');
    if(!['Whole beans','Ground coffee'].includes(grind)) return fail('Invalid coffee form.');
    if(productId==='blend') { const parts=blend.split('/').map(Number); if(!/^\d{1,3}\/\d{1,3}$/.test(blend) || parts[0]>100 || parts[1]>100 || parts[0]+parts[1]!==100) return fail('Please provide a blend ratio that totals 100%.'); }
    const product=await env.DB.prepare('SELECT id,name,price_250,price_500,price_1000,active FROM products WHERE id=?').bind(productId).first();
    if(!product || !product.active) return fail('This coffee is currently unavailable.',409);
    const unit=pack===250?product.price_250:pack===500?product.price_500:product.price_1000;
    const subtotal=unit*qty; const id=uuid(); const ref=orderRef();
    const optIn=body.whatsappOptIn===true?1:0;
    const customerId=uuid(), accountRef=`MB-C-${uuid().slice(0,8).toUpperCase()}`, timestamp=now();
    await env.DB.prepare(`INSERT INTO customers(id,account_ref,phone,display_name,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(phone) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`).bind(customerId,accountRef,phone,name,timestamp).run();
    const customer=await env.DB.prepare('SELECT id,account_ref FROM customers WHERE phone=?').bind(phone).first();
    const deliveryCharge=1, totalAmount=subtotal+deliveryCharge;
    await env.DB.prepare(`INSERT INTO orders(id,order_ref,customer_id,customer_account_ref,customer_name,customer_phone,delivery_address,pin_code,product_id,product_name,pack_grams,quantity,grind_preference,blend_ratio,notes,unit_price,subtotal,delivery_charge,total_amount,status,payment_status,customer_whatsapp_opt_in,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING','UNPAID',?,?)`).bind(id,ref,customer.id,customer.account_ref,name,phone,address,pin,product.id,product.name,pack,qty,grind,productId==='blend'?blend:null,notes,unit,subtotal,deliveryCharge,totalAmount,optIn,timestamp).run();
    const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
    await audit(env,'ORDER_CREATED',id,'customer',{orderRef:ref,deliveryCharge,totalAmount});
    return json({ok:true,orderRef:ref,status:'PENDING',paymentStatus:'UNPAID',subtotal,deliveryCharge,totalAmount,message:'Order received. MistBean will review it and send payment instructions.'},201);
  }
  if (path === '/api/webhooks/whatsapp' && method === 'GET') {
    const mode=url.searchParams.get('hub.mode'), token=url.searchParams.get('hub.verify_token'), challenge=url.searchParams.get('hub.challenge');
    if(mode==='subscribe' && token && token===env.WHATSAPP_VERIFY_TOKEN) return new Response(challenge,{status:200});
    return fail('Webhook verification failed.',403);
  }
  if (path === '/api/webhooks/whatsapp' && method === 'POST') {
    const raw=await request.text();
    if(!env.WHATSAPP_APP_SECRET) return fail('Webhook app secret is not configured.',503);
    {
      const signature=request.headers.get('x-hub-signature-256')||'';
      const key=await crypto.subtle.importKey('raw',enc.encode(env.WHATSAPP_APP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
      const digest=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(raw)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(signature!==`sha256=${digest}`) return fail('Invalid webhook signature.',401);
    }
    let payload; try{payload=JSON.parse(raw);}catch{return fail('Invalid webhook JSON.');}
    const entries=payload.entry||[];
    for(const entry of entries) for(const change of (entry.changes||[])) for(const msg of (change.value?.messages||[])) {
      const eventId=msg.id||uuid(); await env.DB.prepare('INSERT OR IGNORE INTO webhook_events(event_id) VALUES(?)').bind(eventId).run();
    }
    return json({received:true});
  }
  if (path.startsWith('/api/admin/')) {
    if (['POST','PUT','PATCH','DELETE'].includes(method)) {
      const origin=request.headers.get('origin');
      if(origin && origin!==url.origin) return fail('Cross-origin request blocked.',403);
    }
    if(path==='/api/admin/login' && method==='POST') {
      const ipHash=await sha256(request.headers.get('cf-connecting-ip')||'unknown');
      await env.DB.prepare("DELETE FROM admin_login_attempts WHERE julianday(created_at) < julianday('now','-1 day')").run();
      const attempts=await env.DB.prepare("SELECT COUNT(*) AS n FROM admin_login_attempts WHERE ip_hash=? AND julianday(created_at) > julianday('now','-15 minutes')").bind(ipHash).first();
      if((attempts?.n||0)>=5) return fail('Too many login attempts. Try again in 15 minutes.',429);
      await env.DB.prepare('INSERT INTO admin_login_attempts(ip_hash) VALUES(?)').bind(ipHash).run();
      let body;try{body=await request.json();}catch{return fail('Invalid JSON.');}
      if(clean(body.email,150).toLowerCase()!==String(env.ADMIN_EMAIL||'').toLowerCase() || !await verifyPassword(String(body.password||''),env.ADMIN_PASSWORD_HASH)) return fail('Invalid email or password.',401);
      if(!env.SESSION_SECRET || env.SESSION_SECRET.length<32) return fail('Admin session secret is not configured securely.',503);
      await env.DB.prepare('DELETE FROM admin_login_attempts WHERE ip_hash=?').bind(ipHash).run();
      const token=await createSession(env,env.ADMIN_EMAIL);
      return json({ok:true,expiresIn:28800},200,{'set-cookie':sessionCookie(token,28800,url.protocol==='https:')});
    }
    const actor=await adminFromRequest(request,env); if(!actor) return fail('Authentication required.',401);
    if(path==='/api/admin/logout' && method==='POST') {
      const token=sessionToken(request);
      if(token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await sha256(token)).run();
      return json({ok:true},200,{'set-cookie':sessionCookie('',0,url.protocol==='https:')});
    }
    if(path==='/api/admin/orders' && method==='GET') {
      const status=url.searchParams.get('status');
      const rows=status?await env.DB.prepare('SELECT * FROM orders WHERE status=? ORDER BY created_at DESC LIMIT 200').bind(status).all():await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();
      return json({orders:rows.results||[]});
    }
    const match=path.match(/^\/api\/admin\/orders\/([\w-]+)\/(confirm|reject|payment|payment-request|dispatch|deliver|invoice|invoice-send|invoice-sent)$/);
    if(match && method==='POST') {
      const [,id,action]=match; const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); if(!order)return fail('Order not found.',404);
      let body={};try{body=await request.json();}catch{}
      if(action==='confirm'){
        if(order.status!=='PENDING')return fail('Only pending orders can be confirmed.',409);
        const delivery=Math.max(0,Math.min(100000,Math.round(Number(body.deliveryCharge)||0)));
        const finalTotal=Number(order.subtotal)+delivery;
        let uniqueAmount; try { uniqueAmount=await uniquePayablePaise(env,id,finalTotal); } catch(e) { return fail(e.message,503); }
        await env.DB.prepare("UPDATE orders SET status='CONFIRMED',delivery_charge=?,total_amount=subtotal+?,payable_paise=?,unique_amount_suffix=?,updated_at=? WHERE id=? AND status='PENDING'").bind(delivery,delivery,uniqueAmount.payable,uniqueAmount.suffix,now(),id).run();
        await audit(env,'ORDER_CONFIRMED',id,actor,{deliveryCharge:delivery});
        const fresh=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
        // Payment instructions are deliberately sent only after the admin clicks
        // the separate "Send Payment Details" action in the admin panel.
      } else if(action==='payment-request'){
        if(order.status!=='CONFIRMED')return fail('Confirm the order and delivery charge before sending payment details.',409);
        if(!order.customer_whatsapp_opt_in)return fail('Customer has not opted in to WhatsApp order updates.',409);
        if(order.payment_status==='PAID')return fail('This order is already marked as paid.',409);
        let paymentUrl;
        try { paymentUrl = makePaymentUrl(env, url, order); } catch(e) { return fail(e.message, 503); }
        const message=[
          `☕ *MISTBEAN COFFEE*`,
          `*Payment request*`,
          `Hello ${order.customer_name},`,
          `Your order *${order.order_ref}* is confirmed.`,
          ``,
          `*ORDER SUMMARY*`,
          `${order.product_name} · ${order.pack_grams}g × ${order.quantity}`,
          `Products: ₹${order.subtotal}`,
          `Delivery: ₹${order.delivery_charge}`,
          `*AMOUNT TO PAY: ₹${(Number(order.payable_paise||order.total_amount*100)/100).toFixed(2)}*`,
          ``,
          `*PAYMENT*`,
          `UPI ID: ${clean(env.UPI_ID,120)}`,
          `Pay securely: ${paymentUrl}`,
          `After payment, share your UPI UTR/reference here. We will verify the payment before dispatch.`,
          ``,
          `Thank you for choosing MistBean Coffee.`
        ].join('\\n');
        if(env.WHATSAPP_MODE==='meta') {
          try {
            const sent=await sendTemplate(env,whatsappRecipient(order.customer_phone),env.WHATSAPP_TEMPLATE_PAYMENT||'mistbean_payment_request',[order.customer_name,order.order_ref,`INR ${(Number(order.payable_paise||order.total_amount*100)/100).toFixed(2)}`,clean(env.UPI_ID,120),paymentUrl],clean(env.WHATSAPP_TEMPLATE_PAYMENT_LANGUAGE||'en',20));
            await env.DB.prepare('UPDATE orders SET payment_details_sent_at=?,updated_at=? WHERE id=?').bind(now(),now(),id).run();
            await audit(env,'PAYMENT_DETAILS_SENT',id,actor,{totalAmount:order.total_amount,whatsappMessageId:sent.messages?.[0]?.id||null});
            return json({ok:true,sent:true,sentVia:'whatsapp-cloud-api',paymentUrl,totalAmount:order.total_amount});
          } catch(e) { console.error('WhatsApp payment request failed',e.message); return fail(`WhatsApp could not send the payment link: ${e.message}`,502); }
        }
        const chatUrl=whatsappChatUrl(order.customer_phone,message);
        await audit(env,'PAYMENT_DETAILS_PREPARED_MANUAL',id,actor,{totalAmount:Number(order.payable_paise||order.total_amount*100)/100});
        await env.DB.prepare('UPDATE orders SET payment_request_sent_at=?,updated_at=? WHERE id=?').bind(now(),now(),id).run();
        return json({ok:true,whatsappUrl:chatUrl,paymentUrl,totalAmount:Number(order.payable_paise||order.total_amount*100)/100});
      } else if(action==='reject'){
        if(order.status!=='PENDING')return fail('Only pending orders can be rejected.',409);
        const reason=clean(body.reason,300); if(!reason)return fail('Please provide a rejection reason.');
        await env.DB.prepare("UPDATE orders SET status='REJECTED',rejection_reason=?,updated_at=? WHERE id=? AND status='PENDING'").bind(reason,now(),id).run();
        await audit(env,'ORDER_REJECTED',id,actor,{reason});
        const fresh=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); await notifyCustomer(env,fresh,env.WHATSAPP_TEMPLATE_ORDER_UPDATE,[fresh.customer_name,fresh.order_ref,'REJECTED',reason]);
      } else if(action==='payment'){
        if(body.status!=='PAID')return fail('Payment status must be PAID.');
        if(order.status!=='CONFIRMED')return fail('Confirm the order before verifying payment.',409);
        const reference=clean(body.reference,80);
        if(reference.length<6)return fail('Enter the UPI transaction reference / UTR (at least 6 characters).');
        if(order.payment_status==='PAID')return fail('Payment is already verified.',409);
        const verifiedAt=now(), paymentId=uuid();
        const results=await env.DB.batch([
          env.DB.prepare(`INSERT INTO customer_payments(id,customer_id,order_id,amount,currency,payment_method,payment_reference,verified_by,verified_at)
            SELECT ?,customer_id,id,total_amount,'INR','UPI',?,?,? FROM orders
            WHERE id=? AND status='CONFIRMED' AND payment_status<>'PAID'`).bind(paymentId,reference,actor,verifiedAt,id),
          env.DB.prepare(`UPDATE orders SET payment_status='PAID',payment_reference=?,payment_verified_at=?,updated_at=?
            WHERE id=? AND payment_status<>'PAID' AND EXISTS(SELECT 1 FROM customer_payments WHERE order_id=orders.id AND id=?)`).bind(reference,verifiedAt,verifiedAt,id,paymentId)
        ]);
        if(!(results?.[0]?.meta?.changes>0) || !(results?.[1]?.meta?.changes>0)) return fail('Payment was already verified or the order changed. Refresh and check payment history.',409);
        await audit(env,'PAYMENT_VERIFIED',id,actor,{reference,amount:order.total_amount});
        const paidOrder=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
        await notifyCustomer(env,paidOrder,env.WHATSAPP_TEMPLATE_ORDER_UPDATE,[paidOrder.customer_name,paidOrder.order_ref,'PAID','Your payment has been verified. Thank you for choosing MistBean Coffee.']);
        try {
          const invoice=await createInvoice(env,paidOrder,actor);
          await audit(env,'INVOICE_AUTO_GENERATED',id,actor,{invoiceNumber:invoice.invoiceNumber,customerAccountRef:paidOrder.customer_account_ref});
        } catch(invoiceError) {
          console.error('Automatic invoice generation failed',invoiceError.message);
          await audit(env,'INVOICE_AUTO_GENERATION_FAILED',id,actor,{reason:clean(invoiceError.message,200)});
        }
      } else if(action==='dispatch' || action==='deliver'){
        const status=action==='dispatch'?'DISPATCHED':'DELIVERED';
        if(action==='dispatch' && order.status!=='CONFIRMED')return fail('Only confirmed orders can be dispatched.',409);
        if(action==='deliver' && order.status!=='DISPATCHED')return fail('Only dispatched orders can be marked delivered.',409);
        if(order.payment_status!=='PAID')return fail('Verify payment before fulfilment status changes.',409);
        if(action==='dispatch' && !order.invoice_key)return fail('Generate the invoice before dispatching this order.',409);
        if(action==='dispatch' && !order.invoice_sent_at)return fail('Mark the invoice as sent on WhatsApp before dispatching this order.',409);
        if(action==='dispatch' && !order.customer_whatsapp_opt_in)return fail('Customer has not opted in to WhatsApp order updates.',409);
        if(action==='dispatch'){
          const courier=clean(body.courierName,80), tracking=clean(body.trackingId,100);
          await env.DB.prepare('UPDATE orders SET status=?,courier_name=?,tracking_id=?,updated_at=? WHERE id=?').bind(status,courier||null,tracking||null,now(),id).run();
          await audit(env,`ORDER_${status}`,id,actor,{courierName:courier,trackingId:tracking});
          const message=[`☕ *MistBean Coffee – Order Dispatched*`,`Hello ${order.customer_name},`,`Your order ${order.order_ref} has been dispatched.`,`Invoice: ${order.invoice_number}`,courier?`Courier: ${courier}`:'',tracking?`Tracking ID: ${tracking}`:'',`Thank you for choosing MistBean Coffee!`].filter(Boolean).join('\n');
          const fresh=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
          if(env.WHATSAPP_MODE!=='meta')return json({ok:true,order:fresh,whatsappUrl:whatsappChatUrl(fresh.customer_phone,message),manualAttachmentRequired:true});
          await notifyCustomer(env,fresh,env.WHATSAPP_TEMPLATE_ORDER_UPDATE,[fresh.customer_name,fresh.order_ref,status,`Invoice ${fresh.invoice_number}. ${courier?`Courier ${courier}. `:''}${tracking?`Tracking ${tracking}`:''}`]);
        } else {
          await env.DB.prepare('UPDATE orders SET status=?,updated_at=? WHERE id=?').bind(status,now(),id).run(); await audit(env,`ORDER_${status}`,id,actor,{});
          const fresh=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); await notifyCustomer(env,fresh,env.WHATSAPP_TEMPLATE_ORDER_UPDATE,[fresh.customer_name,fresh.order_ref,status,`INR ${fresh.total_amount}`]);
        }
      } else if(action==='invoice'){
        if(order.payment_status!=='PAID')return fail('Verify payment before generating and sending the invoice.',409);
        if(!order.customer_whatsapp_opt_in)return fail('Customer has not opted in to WhatsApp order updates.',409);
        let invoice;
        try { invoice = await createInvoice(env,order,actor); } catch(e){return fail(e.message,409);}
        const invoiceOrder = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
        if(env.WHATSAPP_MODE==='meta'){
          try {
            await sendInvoiceWhatsApp(env,invoiceOrder,invoice.key);
            await env.DB.prepare('UPDATE orders SET invoice_sent_at=?,updated_at=? WHERE id=?').bind(now(),now(),id).run();
            await audit(env,'INVOICE_SENT',id,actor,{mode:'meta',invoiceNumber:invoice.invoiceNumber});
          } catch(e) { return fail(`Invoice generated (${invoice.invoiceNumber}) but WhatsApp delivery failed: ${e.message}`,502); }
        } else {
          const message=[
            `☕ *MISTBEAN COFFEE*`,
            `*Invoice ready*`,
            `Hello ${invoiceOrder.customer_name},`,
            `Your invoice *${invoiceOrder.invoice_number}* for order *${invoiceOrder.order_ref}* is ready.`,
            `*Amount paid: ₹${invoiceOrder.total_amount}*`,
            `Please attach the downloaded invoice PDF before sending this message.`,
            `Thank you for choosing MistBean Coffee.`
          ].join('\\n');
          await audit(env,'INVOICE_WHATSAPP_PREPARED',id,actor,{mode:'manual'});
          const whatsappUrl=whatsappChatUrl(invoiceOrder.customer_phone,message);
          return json({ok:true,order:invoiceOrder,whatsappUrl,manualAttachmentRequired:true});
        }
      } else if(action==='invoice-send'){
        if(!order.invoice_key)return fail('Generate the invoice first.',409);
        if(!order.customer_whatsapp_opt_in)return fail('Customer has not opted in to WhatsApp order updates.',409);
        if(order.payment_status!=='PAID')return fail('Verify payment before sending the invoice.',409);
        if(env.WHATSAPP_MODE==='meta'){
          try { await sendInvoiceWhatsApp(env,order,order.invoice_key); await env.DB.prepare('UPDATE orders SET invoice_sent_at=?,updated_at=? WHERE id=?').bind(now(),now(),id).run(); await audit(env,'INVOICE_SENT',id,actor,{mode:'meta'}); }
          catch(e){return fail(e.message,502);}
        } else {
          const message=[
            `☕ *MISTBEAN COFFEE*`,
            `*Invoice ready*`,
            `Hello ${order.customer_name},`,
            `Your invoice *${order.invoice_number}* for order *${order.order_ref}* is ready.`,
            `*Amount paid: ₹${order.total_amount}*`,
            `Please attach the downloaded invoice PDF before sending this message.`,
            `Thank you for choosing MistBean Coffee.`
          ].join('\\n');
          const chatUrl=whatsappChatUrl(order.customer_phone,message);
          await audit(env,'INVOICE_WHATSAPP_PREPARED',id,actor,{mode:'manual'});
          return json({ok:true,whatsappUrl:chatUrl,manualAttachmentRequired:true});
        }
      } else if(action==='invoice-sent'){
        if(!order.invoice_key)return fail('Generate the invoice first.',409);
        if(order.payment_status!=='PAID')return fail('Verify payment before recording invoice delivery.',409);
        await env.DB.prepare('UPDATE orders SET invoice_sent_at=?,updated_at=? WHERE id=?').bind(now(),now(),id).run();
        await audit(env,'INVOICE_SENT_CONFIRMED',id,actor,{mode:'manual'});
      }
      const fresh=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first(); return json({ok:true,order:fresh});
    }
    const invoiceMatch=path.match(/^\/api\/admin\/invoices\/([\w-]+)$/);
    if(invoiceMatch && method==='GET'){
      const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(invoiceMatch[1]).first(); if(!order?.invoice_key)return fail('Invoice not found.',404);
      const obj=await env.INVOICES.get(order.invoice_key); if(!obj)return fail('Invoice file missing.',404);
      return new Response(obj.body,{headers:{'content-type':'application/pdf','content-disposition':`attachment; filename="${order.invoice_number.replaceAll('/','-')}.pdf"`,'cache-control':'no-store'}});
    }
    if(path==='/api/admin/audit' && method==='GET') { const rows=await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200').all(); return json({events:rows.results||[]}); }
    return fail('Admin endpoint not found.',404);
  }
  return fail('API route not found.',404);
}

export default {
  async fetch(request, env, ctx) {
    const url=new URL(request.url);
    if(url.pathname.startsWith('/api/') || url.pathname.startsWith('/pay/')) {
      try { return await api(request,env); }
      catch(error){ console.error('API error',error); return fail('An unexpected server error occurred.',500); }
    }
    const assetResponse=await env.ASSETS.fetch(request);
    const headers=new Headers(assetResponse.headers);
    for(const [key,value] of Object.entries(SECURITY_HEADERS)) headers.set(key,value);
    return new Response(assetResponse.body,{status:assetResponse.status,statusText:assetResponse.statusText,headers});
  }
};
