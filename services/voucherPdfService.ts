import { PDFDocument } from 'pdf-lib';
import type { DocumentData } from '../types';

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

export async function generateVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL%20Payment%20Voucher_Form.pdf').then(r => r.arrayBuffer());
  const outputDoc = await PDFDocument.create();

  for (const doc of docs) {
    // Load a fresh copy of the form template for each voucher
    const templateDoc = await PDFDocument.load(templateBytes);
    const form = templateDoc.getForm();

    const pv = doc.payment_voucher_details;

    const currencySource = pv?.total_payable_amount || pv?.payable_amount;
    const currency      = detectCurrency(currencySource);
    const amount        = stripCurrency(pv?.payable_amount);
    const total         = stripCurrency(pv?.total_payable_amount) || stripCurrency(pv?.payable_amount);
    const paymentTo     = pv?.payment_to || doc.metadata?.parties?.shipper_supplier || '';
    const paymentMethod = pv?.payment_method || '';
    const docDate       = doc.metadata?.date || '';
    const carrierInv    = pv?.carrier_invoice_number || '';
    const blNum         = pv?.bl_number || '';
    const pssNum        = pv?.pss_invoice_number || '';
    const charges       = pv?.charges_summary || '';

    const pssDisplay = pssNum.startsWith('#') ? pssNum : (pssNum ? `#${pssNum}` : '');
    const blPssLine = [
      blNum      ? `BL. ${blNum}`    : '',
      pssDisplay ? `(${pssDisplay})` : '',
    ].filter(Boolean).join(' ');

    const today = new Date();
    const autoDate = docDate ||
      `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

    // ── Fill form fields by name — no coordinate guessing ──
    const setField = (name: string, value: string, fontSize = 9) => {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setText(value);
    };

    if (paymentTo)           setField('Payment To', paymentTo);
    setField('Date', autoDate);

    if (carrierInv)          setField('row1_desc', `Payment Inv.  ${carrierInv}`);
    if (blPssLine)           setField('row2_desc', blPssLine);
    if (blPssLine && amount) setField('SGD USDRow2', amount);
    if (charges)             setField('charges', charges);

    // 'SGD  USD Total' has a double space — exact field name from Acrobat
    if (total) setField('SGD  USD Total', total);

    setField('CASH CHEQUE No', paymentMethod || 'UOB SGD FAST / GIRO PAYMENT');

    // Currency checkboxes share their name between header row and total row,
    // so one check() call ticks both simultaneously.
    if (currency === 'SGD') {
      form.getCheckBox('sgd_check').check();
    } else {
      form.getCheckBox('usd_check').check();
    }

    // Flatten: burns filled values into the page as static content
    form.flatten();

    const [page] = await outputDoc.copyPages(templateDoc, [0]);
    outputDoc.addPage(page);
  }

  const bytes = await outputDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
