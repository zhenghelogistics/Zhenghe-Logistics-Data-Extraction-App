import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { DocumentData } from '../types';

const NAVY = rgb(0.063, 0.122, 0.38);
const BLACK = rgb(0, 0, 0);

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  // Check total_payable_amount first, then payable_amount
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

// Draw a tick (✓) inside a template checkbox at bottom-left corner (x, y)
function drawTick(page: ReturnType<PDFDocument['addPage']>, x: number, y: number) {
  page.drawLine({ start: { x: x + 1, y: y + 3 }, end: { x: x + 3, y: y + 1 }, thickness: 1.2, color: NAVY });
  page.drawLine({ start: { x: x + 3, y: y + 1 }, end: { x: x + 8, y: y + 7 }, thickness: 1.2, color: NAVY });
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

    // Detect currency from total_payable_amount first, then payable_amount
    const currencySource = pv?.total_payable_amount || pv?.payable_amount;
    const currency    = detectCurrency(currencySource);
    const amount      = stripCurrency(pv?.payable_amount);
    const total       = stripCurrency(pv?.total_payable_amount) || stripCurrency(pv?.payable_amount);
    const paymentTo   = pv?.payment_to || doc.metadata?.parties?.shipper_supplier || '';
    const paymentMethod = pv?.payment_method || '';
    const docDate     = doc.metadata?.date || '';

    const carrierInv = pv?.carrier_invoice_number || '';
    const blNum      = pv?.bl_number || '';
    const pssNum     = pv?.pss_invoice_number || '';
    const charges    = pv?.charges_summary || '';

    // pssNum may already carry a leading # — don't double it
    const pssDisplay = pssNum.startsWith('#') ? pssNum : (pssNum ? `#${pssNum}` : '');
    const blPssLine = [
      blNum      ? `BL. ${blNum}`    : '',
      pssDisplay ? `(${pssDisplay})` : '',
    ].filter(Boolean).join(' ');

    // ── Coordinates calibrated from ZHL Payment Voucher.pdf pixel analysis ──
    // Page: A4 595.2 × 841.68 pts, origin bottom-left
    // Positions verified by rendering template at 3x zoom and scanning navy pixel clusters

    // Ref: intentionally left blank per accounts team

    // Payment To — baseline at y=714, starts just after "Payment To:" label
    if (paymentTo) {
      page.drawText(paymentTo, { x: 117, y: 714, size: 10, font: regular, color: BLACK, maxWidth: 285 });
    }

    // Date — to the right of "Date:" label
    const today = new Date();
    const autoDate = docDate ||
      `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    page.drawText(autoDate, { x: 447, y: 717, size: 10, font: regular, color: BLACK });

    // Header row: □SGD left=484 (confirmed from annotation xref12 x=485.1), □USD left=523, bottom=691
    if (currency === 'SGD') {
      drawTick(page, 484, 691);
    } else {
      drawTick(page, 523, 691);
    }

    // ── Table data rows ──
    // Baselines from pixel scan: row 1 confirmed at y=666 (from Acrobat annotation),
    // spacing ~18.75pt, 8 rows total.
    const rowYs = [666, 647, 628, 610, 591, 572, 553, 535];
    const descX    = 107;   // description column left edge
    const amtX     = 499;   // amount column left edge (confirmed from Acrobat annotation)
    const fontSize = 10;

    // Row 1: Carrier invoice number
    if (carrierInv) {
      page.drawText(`Payment Inv.  ${carrierInv}`, {
        x: descX, y: rowYs[0], size: fontSize, font: regular, color: BLACK, maxWidth: 360,
      });
    }

    // Row 2: BL number + PSS invoice — amount in right column
    if (blPssLine) {
      page.drawText(blPssLine, {
        x: descX, y: rowYs[1], size: fontSize, font: regular, color: BLACK, maxWidth: 360,
      });
      if (amount) {
        page.drawText(amount, { x: amtX, y: rowYs[1], size: fontSize, font: regular, color: BLACK });
      }
    }

    // Row 4: Charges summary (THC / BL / SEALS etc.)
    if (charges) {
      page.drawText(charges, {
        x: descX, y: rowYs[3], size: fontSize, font: regular, color: BLACK, maxWidth: 360,
      });
    }

    // ── Total row: □SGD □USD   Total  |  amount ──
    // Measured from 8x render: □SGD left=359, □USD left=405, text baseline y=519
    const totalY = 519;
    if (currency === 'SGD') {
      drawTick(page, 359, totalY);
    } else {
      drawTick(page, 405, totalY);
    }
    if (total) {
      page.drawText(total, { x: amtX, y: totalY, size: fontSize, font: bold, color: BLACK });
    }

    // ── Cash / Cheque No. section ──
    // Text-only field — no checkbox exists here in the template
    const cashChequeText = paymentMethod || 'UOB SGD FAST / GIRO PAYMENT';
    page.drawText(cashChequeText, { x: 164, y: 484, size: 10, font: regular, color: BLACK });
  }

  const bytes = await outputDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
