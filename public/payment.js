const form = document.getElementById('paymentForm');
if (form) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = document.getElementById('submitPayment');
    const message = document.getElementById('paymentMessage');
    const reference = document.getElementById('paymentReference').value.trim();
    if (reference.length < 6) {
      message.className = 'error';
      message.textContent = 'Enter the transaction reference shown by your UPI app.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Submitting…';
    message.className = 'notice';
    message.textContent = 'Submitting your payment details…';
    try {
      const response = await fetch('/api/payment-submissions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          orderRef: form.dataset.orderRef,
          amount: Number(form.dataset.amount),
          reference
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not submit payment details.');
      message.className = 'success';
      message.textContent = 'Payment details received for order ' + form.dataset.orderRef + '. MistBean will verify the bank credit and update your order. Please do not pay again.';
      button.textContent = 'Details submitted';
    } catch (error) {
      message.className = 'error';
      message.textContent = error.message;
      button.disabled = false;
      button.textContent = 'I have paid – submit details';
    }
  });
}
