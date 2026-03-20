import { PDFDocument, TextAlignment } from 'pdf-lib';
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
  const templateBytes = await fetch('/ZHL_Payment_Voucher_Updated.pdf').then(r => r.arrayBuffer());
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
    const setField = (name: string, value: string, fontSize = 11.5) => {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setAlignment(TextAlignment.Left);
      // Shrink field height to just fit the text so it sits on the form line
      // instead of floating in the middle of a tall field box.
      for (const widget of field.acroField.getWidgets()) {
        const r = widget.getRectangle();
        widget.setRectangle({ x: r.x, y: r.y, width: r.width, height: fontSize + 4 });
      }
      field.setText(value);
    };

    if (paymentTo)           setField('Payment To', paymentTo);
    setField('Date', autoDate);

    if (carrierInv) setField('row1_desc', `Payment Inv.  ${carrierInv}`, 9.5);

    if (pv?.bl_entries && pv.bl_entries.length > 0) {
      // Combined PV: populate one row per BL entry (rows 2–6)
      pv.bl_entries.forEach((entry, i) => {
        const rowNum = i + 2;
        if (rowNum > 6) return;
        const pssDisp = entry.pss_invoice_number
          ? (entry.pss_invoice_number.startsWith('#') ? entry.pss_invoice_number : `#${entry.pss_invoice_number}`)
          : '';
        const blLine = [entry.bl_number ? `BL. ${entry.bl_number}` : '', pssDisp ? `(${pssDisp})` : ''].filter(Boolean).join(' ');
        if (blLine) setField(`row${rowNum}_desc`, blLine);
        if (entry.amount) setField(`SGD USDRow${rowNum}`, stripCurrency(entry.amount));
      });
    } else {
      // Single BL
      if (blPssLine) setField('row2_desc', blPssLine);
      if (blPssLine && amount) setField('SGD USDRow2', amount);
    }

    if (charges) setField('charges', charges);

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
