import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotalPaise, allocateUniquePayablePaise, matchUtrPayment, canTransitionPayment } from '../src/payment-domain.js';

test('calculates order totals using integer paise', () => {
  assert.equal(calculateTotalPaise([{sku:'coffee',quantity:2}], {coffee:45000}, 100), 90100);
});
test('allocates a unique paise suffix', () => {
  const result = allocateUniquePayablePaise(45000, new Set([45001]), () => 0.01);
  assert.deepEqual(result, {payablePaise:45002,suffixPaise:2});
});
test('matches UTR only when UTR and amount both match', () => {
  assert.equal(matchUtrPayment({submittedUtr:'abc123456789',submittedPaise:45002,bankUtr:'ABC123456789',bankPaise:45002}), true);
  assert.equal(matchUtrPayment({submittedUtr:'abc123456789',submittedPaise:45002,bankUtr:'ABC123456789',bankPaise:45003}), false);
});
test('rejects invalid payment status transitions', () => {
  assert.equal(canTransitionPayment('PENDING_PAYMENT','PAID'), false);
  assert.equal(canTransitionPayment('PAYMENT_SUBMITTED','PAID'), true);
  assert.equal(canTransitionPayment('SHIPPED','PAID'), false);
});
