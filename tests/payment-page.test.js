import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const token='A'.repeat(43);
async function hash(value) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
}
function mockEnv(order) {
  const tokenHash=order ? order.pay_token_hash : '';
  const DB={
    prepare(sql) {
      let values=[];
      return {
        bind(...args){values=args;return this;},
        async first(){
          if(sql.includes('SELECT COUNT(*) AS n FROM payment_page_rate_limits'))return {n:0};
          if(sql.includes('FROM orders WHERE pay_token_hash=?'))return tokenHash && values[0]===tokenHash ? order : null;
          return null;
        },
        async run(){return {meta:{changes:1}};},
        async all(){return {results:[]};}
      };
    }
  };
  return {DB,UPI_ID:'merchant@upi',STORE_NAME:'MistBean & Co'};
}
async function makeOrder(tokenValue,status='CONFIRMED',paymentStatus='UNPAID') {
  return {
    pay_token_hash:await hash(tokenValue),
    order_ref:'MB-261114-ABC123',
    product_name:'Arabica',
    pack_grams:250,
    quantity:1,
    total_amount:450,
    payable_paise:45007,
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
  assert.match(html,/₹450\.07/);
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
test('QR endpoint returns a no-store PNG',async()=>{
  const env=mockEnv(await makeOrder(token));
  const response=await worker.fetch(new Request('https://mistbean.test/qr/'+token+'.png'),env,{});
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
});
