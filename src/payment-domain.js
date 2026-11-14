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
export function formatPaise(amountPaise) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) throw new Error('Invalid amount in paise');
  const rupees = Math.floor(amountPaise / 100);
  const paise = String(amountPaise % 100).padStart(2, '0');
  return String(rupees) + '.' + paise;
}

export function buildUpiLink({ upiId, storeName, amountPaise, orderId }) {
  if (!upiId || !String(upiId).includes('@')) throw new Error('A valid UPI ID is required');
  if (!storeName || !String(storeName).trim()) throw new Error('Store name is required');
  if (!orderId || !String(orderId).trim()) throw new Error('Order reference is required');
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 1) throw new Error('Invalid amount in paise');
  const params = new URLSearchParams({
    pa: String(upiId),
    pn: String(storeName).trim(),
    am: formatPaise(amountPaise),
    cu: 'INR',
    tn: String(orderId)
  });
  return 'upi://pay?' + params.toString();
}
