import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { DocumentData } from '../types';

const NAVY = rgb(0.063, 0.122, 0.38);
const BLACK = rgb(0, 0, 0);

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

// Draw a tick inside an existing template checkbox at (x, y)
function drawTick(page: ReturnType<PDFDocument['addPage']>, x: number, y: number) {
  page.drawLine({ start: { x: x + 1, y: y + 3 }, end: { x: x + 3, y: y + 1 }, thickness: 1.2, color: NAVY });
  page.drawLine({ start: { x: x + 3, y: y + 1 }, end: { x: x + 8, y: y + 8 }, thickness: 1.2, color: NAVY });
}

export async function generateVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  // Load the blank template once
  const templateBytes = await fetch('/ZHL%20Payment%20Voucher.pdf').then(r => r.arrayBuffer());
  const templateDoc = await PDFDocument.load(templateBytes);

  const outputDoc = await PDFDocument.create();
  const regular = await outputDoc.embedFont(StandardFonts.Helvetica);
  const bold    = await outputDoc.embedFont(StandardFonts.HelveticaBold);

  for (const doc of docs) {
    // Copy a fresh template page for each voucher
    const [page] = await outputDoc.copyPages(templateDoc, [0]);
    outputDoc.addPage(page);

    const pv = doc.payment_voucher_details;
    const currency    = detectCurrency(pv?.payable_amount);
    const amount      = stripCurrency(pv?.payable_amount);
    const total       = stripCurrency(pv?.total_payable_amount);
    const ref         = pv?.pss_invoice_number || doc.metadata?.reference_number || '';
    const paymentTo   = pv?.payment_to || doc.metadata?.parties?.consignee_buyer || '';
    const paymentMethod = pv?.payment_method || '';
    const docDate     = doc.metadata?.document_date || '';

    const carrierInv = pv?.carrier_invoice_number || '';
    const blNum      = pv?.bl_number || '';
    const pssNum     = pv?.pss_invoice_number || '';
    const charges    = pv?.charges_summary || '';

    // pssNum may already carry a leading # (e.g. "#25122020") — don't double it
    const pssDisplay = pssNum.startsWith('#') ? pssNum : (pssNum ? `#${pssNum}` : '');
    const blPssLine = [
      blNum       ? `BL. ${blNum}`       : '',
      pssDisplay  ? `(${pssDisplay})`    : '',
    ].filter(Boolean).join(' ');

    // ── Field positions (calibrated to the ZHL Payment Voucher template) ──

    // Ref value (top-right)
    if (ref) page.drawText(ref, { x: 388, y: 720, size: 10, font: regular, color: BLACK });

    // Payment To value
    if (paymentTo) page.drawText(paymentTo, { x: 96, y: 697, size: 9, font: regular, color: BLACK, maxWidth: 290 });

    // Date value
    if (docDate) page.drawText(docDate, { x: 432, y: 697, size: 9, font: regular, color: BLACK });

    // SGD / USD tick in table header checkbox
    // Template has □SGD □USD at approximately x=490/522 — y raised to sit inside the header row
    if (currency === 'SGD') {
      drawTick(page, 488, 678);
    } else {
      drawTick(page, 521, 678);
    }

    // Table data rows — y positions for rows 1-8 (baseline)
    const rowYs = [648, 626, 604, 582, 560, 538, 516, 494];
    const descX  = 100;
    const amtX   = 490;
    const fontSize = 9;

    // Row 1: Payment Invoice number
    if (carrierInv) {
      page.drawText(`Payment Inv.  ${carrierInv}`, { x: descX, y: rowYs[0], size: fontSize, font: regular, color: BLACK, maxWidth: 370 });
    }

    // Row 2: BL + PSS number — amount on this row
    if (blPssLine) {
      page.drawText(blPssLine, { x: descX, y: rowYs[1], size: fontSize, font: regular, color: BLACK, maxWidth: 370 });
      if (amount) page.drawText(amount, { x: amtX, y: rowYs[1], size: fontSize, font: regular, color: BLACK });
    }

    // Row 3: Charges (THC/BL/SEAL etc.)
    if (charges) {
      page.drawText(charges, { x: descX, y: rowYs[2], size: fontSize, font: regular, color: BLACK, maxWidth: 370 });
    }

    // Total row — SGD/USD tick + amount
    // Template total row checkboxes at approximately x=469/501, y=472
    if (currency === 'SGD') {
      drawTick(page, 469, 469);
    } else {
      drawTick(page, 501, 469);
    }
    if (total) page.drawText(total, { x: amtX, y: 472, size: fontSize, font: bold, color: BLACK });

    // Cash / Cheque No. value
    if (paymentMethod) page.drawText(paymentMethod, { x: 158, y: 447, size: 10, font: regular, color: BLACK });
  }

  const bytes = await outputDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
