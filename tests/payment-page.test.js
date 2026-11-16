import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const token='A'.repeat(43);
async function hash(value) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
function mockEnv(order, overrides={}) {
  const tokenHash=order ? order.pay_token_hash : '';
  const DB={
    prepare(sql) {
      let values=[];
      return {
        bind(...args){values=args;return this;},
        async first(){
          if(sql.includes('SELECT COUNT(*) AS n FROM payment_page_rate_limits'))return {n:0};
          if(sql.includes('SELECT COUNT(*) AS n FROM payment_submission_rate_limits'))return {n:0};
          if(sql.includes('FROM orders WHERE pay_token_hash=?'))return tokenHash && values[0]===tokenHash ? order : null;
          return null;
        },
        async run(){
          if(sql.includes("SET payment_status='PAYMENT_SUBMITTED'")) {
            if(!order || order.status!=='CONFIRMED' || order.payment_status!=='UNPAID') return {meta:{changes:0}};
            order.payment_status='PAYMENT_SUBMITTED';
            order.payment_submitted_reference=values[0];
            order.payment_submitted_amount=values[1];
            order.payment_submitted_at=values[2];
            return {meta:{changes:1}};
          }
          return {meta:{changes:1}};
        },
        async all(){return {results:[]};}
      };
    }
  };
  return {DB,UPI_ID:'merchant@upi',STORE_NAME:'MistBean & Co',...overrides};
}
async function makeOrder(tokenValue,status='CONFIRMED',paymentStatus='UNPAID') {
  return {
    id:'order_internal_123',
    pay_token_hash:await hash(tokenValue),
    order_ref:'MB-261114-ABC123',
    product_name:'Arabica',
    pack_grams:250,
    quantity:1,
    total_amount:450,
    payable_paise:45000,
    status,
    payment_status:paymentStatus,
    payment_submitted_at:null
  };
}

test('payment page rejects an unknown token', async()=>{
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),mockEnv(null),{});
  assert.equal(response.status,404);
});
test('payment page shows the server payable amount and ignores request amount',async()=>{
  const env=mockEnv(await makeOrder(token));
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token+'?amount=0'),env,{});
  const html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/₹450\.00/);
  assert.match(html,/upi:\/\/pay/);
  assert.match(response.headers.get('cache-control'),/no-store/);
});
test('paid order shows a status message and no payment action',async()=>{
  const env=mockEnv(await makeOrder(token,'CONFIRMED','PAID'));
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  const html=await response.text();
  assert.match(html,/Payment received/);
  assert.doesNotMatch(html,/Pay with UPI app/);
});
test('QR endpoint returns a no-store SVG',async()=>{
  const env=mockEnv(await makeOrder(token));
  const response=await worker.fetch(new Request('https://mistbean.test/qr/'+token+'.svg'),env,{});
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/svg+xml; charset=utf-8');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(new TextDecoder().decode(bytes), /<svg[\s>]/i);
});

test('pending order does not expose payment actions or QR',async()=>{
  const env=mockEnv(await makeOrder(token,'PENDING','UNPAID'));
  const page=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  const html=await page.text();
  assert.equal(page.status,200);
  assert.match(html,/Order awaiting confirmation/);
  assert.doesNotMatch(html,/Pay with UPI app/);
  const qr=await worker.fetch(new Request('https://mistbean.test/qr/'+token+'.svg'),env,{});
  assert.equal(qr.status,404);
});
test('payment-submitted order is shown as awaiting verification without another pay action',async()=>{
  const env=mockEnv(await makeOrder(token,'CONFIRMED','PAYMENT_SUBMITTED'));
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  const html=await response.text();
  assert.match(html,/Payment submitted/);
  assert.doesNotMatch(html,/Pay with UPI app/);
});
test('dispatched and delivered orders show fulfilment status rather than payment status',async()=>{
  for (const [status,expected] of [['DISPATCHED','Order dispatched'],['DELIVERED','Order delivered']]) {
    const env=mockEnv(await makeOrder(token,status,'PAID'));
    const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
    const html=await response.text();
    assert.match(html,new RegExp(expected));
    assert.doesNotMatch(html,/Pay with UPI app/);
  }
});
test('missing payment configuration returns a clear temporary-unavailable response',async()=>{
  const env=mockEnv(await makeOrder(token));
  delete env.UPI_ID;
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  assert.equal(response.status,503);
  assert.match(await response.text(),/Payment temporarily unavailable/);
});
test('payment page loads same-origin payment.js permitted by CSP',async()=>{
  const env=mockEnv(await makeOrder(token));
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  const html=await response.text();
  assert.ok(html.includes('<script src="/payment.js" defer></script>'));
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('missing payment configuration returns 503 for QR instead of an unhandled error',async()=>{
  const env=mockEnv(await makeOrder(token));
  delete env.UPI_ID;
  const response=await worker.fetch(new Request('https://mistbean.test/qr/'+token+'.svg'),env,{});
  assert.equal(response.status,503);
  assert.match(await response.text(),/payment configuration is incomplete/i);
});

test('legacy or unknown order states never expose a payment action',async()=>{
  const env=mockEnv(await makeOrder(token,'PENDING_PAYMENT','UNPAID'));
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  const html=await response.text();
  assert.match(html,/Order awaiting confirmation/);
  assert.doesNotMatch(html,/Pay with UPI app/);
  const qr=await worker.fetch(new Request('https://mistbean.test/qr/'+token+'.svg'),env,{});
  assert.equal(qr.status,404);
});

test('payment page renders a UTR submission form bound to the opaque token',async()=>{
  const env=mockEnv(await makeOrder(token));
  const response=await worker.fetch(new Request('https://mistbean.test/pay/'+token),env,{});
  const html=await response.text();
  assert.match(html,/id="paymentForm"/);
  assert.match(html,/data-payment-token="/);
  assert.match(html,/I have paid – submit UTR/);
  assert.doesNotMatch(html,/data-order-ref=/);
});
test('customer can submit UTR using the payment token and the server records server-calculated amount',async()=>{
  const order=await makeOrder(token);
  const env=mockEnv(order);
  const response=await worker.fetch(new Request('https://mistbean.test/api/payment-submissions/'+token,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({reference:'123456789012'})
  }),env,{});
  assert.equal(response.status,200);
  assert.equal(order.payment_status,'PAYMENT_SUBMITTED');
  assert.equal(order.payment_submitted_reference,'123456789012');
  assert.equal(order.payment_submitted_amount,450);
  assert.match((await response.json()).message,/verify the bank credit/i);
});
test('customer cannot submit UTR twice or after the order is paid',async()=>{
  const order=await makeOrder(token);
  const env=mockEnv(order);
  const request=()=>new Request('https://mistbean.test/api/payment-submissions/'+token,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:'123456789012'})
  });
  assert.equal((await worker.fetch(request(),env,{})).status,200);
  assert.equal((await worker.fetch(request(),env,{})).status,409);
});
test('customer UTR submission rejects invalid references and unconfirmed orders',async()=>{
  const invalidEnv=mockEnv(await makeOrder(token));
  const invalid=await worker.fetch(new Request('https://mistbean.test/api/payment-submissions/'+token,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:'12!'})
  }),invalidEnv,{});
  assert.equal(invalid.status,400);
  const pendingEnv=mockEnv(await makeOrder(token,'PENDING','UNPAID'));
  const pending=await worker.fetch(new Request('https://mistbean.test/api/payment-submissions/'+token,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:'123456789012'})
  }),pendingEnv,{});
  assert.equal(pending.status,409);
});
