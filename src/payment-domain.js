export function calculateTotalPaise(items, priceBySku, deliveryPaise = 0) {
  if (!Array.isArray(items) || !Number.isSafeInteger(deliveryPaise) || deliveryPaise < 0) throw new Error('Invalid order amounts');
  const subtotal = items.reduce((sum, item) => {
    const qty = Number(item.quantity), unit = priceBySku[item.sku];
    if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(unit) || unit < 0) throw new Error('Invalid order item');
    return sum + qty * unit;
  }, 0);
  const total = subtotal + deliveryPaise;
  if (!Number.isSafeInteger(total)) throw new Error('Order total is outside the supported range');
  return total;
}
export function allocateUniquePayablePaise(totalPaise, usedAmounts, random = Math.random) {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 1) throw new Error('Invalid total in paise');
  if (!usedAmounts || typeof usedAmounts.has !== 'function') throw new Error('Invalid used amounts collection');
  const randomValue = random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) throw new Error('Invalid random value');
  const startSuffix = 1 + Math.floor(randomValue * 99);
  for (let offset = 0; offset < 99; offset++) {
    const suffix = 1 + ((startSuffix - 1 + offset) % 99);
    const payable = totalPaise + suffix;
    if (!usedAmounts.has(payable)) return { payablePaise: payable, suffixPaise: suffix };
  }
  throw new Error('No unique paise amount is available');
}
export function matchUtrPayment({ submittedUtr, submittedPaise, bankUtr, bankPaise }) {
  if (!submittedUtr || !bankUtr) return false;
  return String(submittedUtr).trim().toUpperCase() === String(bankUtr).trim().toUpperCase()
    && Number(submittedPaise) === Number(bankPaise);
}
export function canTransitionPayment(from, to) {
  const allowed = {
    PENDING_PAYMENT: ['PAYMENT_SUBMITTED', 'CANCELLED', 'REVIEW'],
    PAYMENT_SUBMITTED: ['PAID', 'REVIEW', 'CANCELLED'],
    REVIEW: ['PAID', 'CANCELLED', 'PAYMENT_SUBMITTED'],
    PAID: ['SHIPPED'],
    SHIPPED: [],
    CANCELLED: []
  };
  return (allowed[from] || []).includes(to);
}
