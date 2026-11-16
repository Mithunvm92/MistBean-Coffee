import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotalPaise, matchUtrPayment, canTransitionPayment, formatPaise, buildUpiLink } from '../src/payment-domain.js';

test('calculates order totals using integer paise', () => {
  assert.equal(calculateTotalPaise([{sku:'coffee',quantity:2}], {coffee:45000}, 100), 90100);
});
test('matches UTR only when UTR and amount both match', () => {
  assert.equal(matchUtrPayment({submittedUtr:'abc123456789',submittedPaise:45000,bankUtr:'ABC123456789',bankPaise:45000}), true);
  assert.equal(matchUtrPayment({submittedUtr:'abc123456789',submittedPaise:45000,bankUtr:'ABC123456789',bankPaise:45001}), false);
});
test('rejects invalid payment status transitions', () => {
  assert.equal(canTransitionPayment('PENDING_PAYMENT','PAID'), false);
  assert.equal(canTransitionPayment('PAYMENT_SUBMITTED','PAID'), true);
  assert.equal(canTransitionPayment('SHIPPED','PAID'), false);
});

test('formats integer paise without floating point rounding', () => {
  assert.equal(formatPaise(45000), '450.00');
  assert.equal(formatPaise(100), '1.00');
  assert.equal(formatPaise(5), '0.05');
});
test('builds an encoded UPI link', () => {
  const link = buildUpiLink({ upiId:'merchant@upi', storeName:'MistBean & Co', amountPaise:45000, orderId:'MB/2026 #1' });
  const parsed = new URL(link);
  assert.equal(parsed.protocol, 'upi:');
  assert.equal(parsed.searchParams.get('pa'), 'merchant@upi');
  assert.equal(parsed.searchParams.get('pn'), 'MistBean & Co');
  assert.equal(parsed.searchParams.get('am'), '450.00');
  assert.equal(parsed.searchParams.get('tn'), 'MB/2026 #1');
});
