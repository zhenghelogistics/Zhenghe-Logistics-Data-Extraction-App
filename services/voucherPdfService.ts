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

    // ── Field positions (pixel-calibrated to the ZHL Payment Voucher template) ──
    // Template image: 1104×790 px placed at pdf-lib x=23.04–552.96, y=430.8–810.0
    // Conversion: x = 23.04 + px*0.48,  y = 810 - py*0.48

    // Ref: left blank per accounts team preference

    // Payment To value — on the underline (y=714 puts text on the line)
    if (paymentTo) page.drawText(paymentTo, { x: 102, y: 714, size: 11, font: regular, color: BLACK, maxWidth: 290 });

    // Date — "as of today" (auto-generated)
    const today = new Date();
    const autoDate = docDate ||
      `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    page.drawText(autoDate, { x: 452, y: 714, size: 11, font: regular, color: BLACK });

    // SGD / USD tick in table header checkbox (raised to align with □ boxes)
    if (currency === 'SGD') {
      drawTick(page, 452, 695);
    } else {
      drawTick(page, 502, 695);
    }

    // Table data rows — baselines calibrated from horizontal line scan
    const rowYs = [651, 629, 607, 585, 563, 541, 517, 491];
    const descX  = 105;
    const amtX   = 479;
    const fontSize = 11;

    // Row 1: Payment Invoice number
    if (carrierInv) {
      page.drawText(`Payment Inv.  ${carrierInv}`, { x: descX, y: rowYs[0], size: fontSize, font: regular, color: BLACK, maxWidth: 370 });
    }

    // Row 2: BL + PSS number — amount on this row
    if (blPssLine) {
      page.drawText(blPssLine, { x: descX, y: rowYs[1], size: fontSize, font: regular, color: BLACK, maxWidth: 370 });
      if (amount) page.drawText(amount, { x: amtX, y: rowYs[1], size: fontSize, font: regular, color: BLACK });
    }

    // Row 7: Charges (THC/BL/SEAL etc.) — near bottom of data rows
    if (charges) {
      page.drawText(charges, { x: descX, y: rowYs[6], size: fontSize, font: regular, color: BLACK, maxWidth: 370 });
    }

    // Total row (table): tick in □SGD or □USD — amount stays in Cash/Cheque section
    if (currency === 'SGD') {
      drawTick(page, 452, rowYs[7]);
    } else {
      drawTick(page, 502, rowYs[7]);
    }

    // Cash / Cheque No. section: payment method on left, tick + total amount on right
    if (paymentMethod) page.drawText(paymentMethod, { x: 158, y: 474, size: 11, font: regular, color: BLACK });
    if (currency === 'SGD') {
      drawTick(page, 452, 474);
    } else {
      drawTick(page, 502, 474);
    }
    if (total) page.drawText(total, { x: amtX, y: 474, size: 11, font: bold, color: BLACK });
  }

  const bytes = await outputDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
