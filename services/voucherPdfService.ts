import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage } from 'pdf-lib';
import type { DocumentData } from '../types';

const NAVY = rgb(0.063, 0.122, 0.38);   // ZHL dark blue
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const GREY = rgb(0.5, 0.5, 0.5);

// A4 portrait in points
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

function drawCheckbox(
  page: PDFPage,
  x: number,
  y: number,
  checked: boolean,
  label: string,
  font: PDFFont,
  fontSize: number
) {
  const size = 8;
  page.drawRectangle({ x, y, width: size, height: size, borderColor: BLACK, borderWidth: 0.8, color: WHITE });
  if (checked) {
    // Draw a simple tick using two lines (avoids Unicode issues with standard fonts)
    page.drawLine({ start: { x: x + 1, y: y + 3 }, end: { x: x + 3, y: y + 1 }, thickness: 1, color: BLACK });
    page.drawLine({ start: { x: x + 3, y: y + 1 }, end: { x: x + 7, y: y + 7 }, thickness: 1, color: BLACK });
  }
  page.drawText(label, { x: x + size + 3, y: y + 1, size: fontSize, font, color: BLACK });
}

async function drawVoucherPage(
  pdfDoc: PDFDocument,
  doc: DocumentData,
  boldFont: PDFFont,
  regularFont: PDFFont,
  logoBytes: ArrayBuffer | null
) {
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const pv = doc.payment_voucher_details;

  const currency = detectCurrency(pv?.payable_amount);
  const amount = stripCurrency(pv?.payable_amount);
  const total = stripCurrency(pv?.total_payable_amount);
  const ref = pv?.pss_invoice_number || pv?.carrier_invoice_number || doc.metadata?.reference_number || '';
  const paymentTo = pv?.payment_to || doc.metadata?.parties?.consignee_buyer || '';
  const paymentMethod = pv?.payment_method || '';
  const docDate = doc.metadata?.document_date || new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();

  // --- Outer border ---
  page.drawRectangle({ x: MARGIN, y: MARGIN, width: PAGE_W - MARGIN * 2, height: PAGE_H - MARGIN * 2, borderColor: NAVY, borderWidth: 1, color: WHITE });

  // --- Header area ---
  const headerH = 70;
  const headerY = PAGE_H - MARGIN - headerH;

  // Logo
  let logoEmbedded = false;
  if (logoBytes) {
    try {
      // Try PNG first, fall back to JPEG
      let logoImage;
      try {
        logoImage = await pdfDoc.embedPng(logoBytes);
      } catch {
        logoImage = await pdfDoc.embedJpg(logoBytes);
      }
      const logoDims = logoImage.scaleToFit(80, 50);
      page.drawImage(logoImage, {
        x: MARGIN + 15,
        y: headerY + (headerH - logoDims.height) / 2,
        width: logoDims.width,
        height: logoDims.height,
      });
      logoEmbedded = true;
    } catch {
      // fall through to text header
    }
  }

  if (!logoEmbedded) {
    page.drawText('ZHL', { x: MARGIN + 15, y: headerY + 28, size: 22, font: boldFont, color: NAVY });
  }

  // Company name
  page.drawText('Zhenghe Logistics Pte Ltd', {
    x: MARGIN + 110,
    y: headerY + 25,
    size: 14,
    font: boldFont,
    color: NAVY,
  });

  // Top blue rule
  page.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 3 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 3 }, thickness: 3, color: NAVY });
  // Bottom header rule (double)
  page.drawLine({ start: { x: MARGIN, y: headerY - 2 }, end: { x: PAGE_W - MARGIN, y: headerY - 2 }, thickness: 2.5, color: NAVY });
  page.drawLine({ start: { x: MARGIN, y: headerY - 7 }, end: { x: PAGE_W - MARGIN, y: headerY - 7 }, thickness: 0.8, color: NAVY });

  // --- Title + Ref ---
  const titleY = headerY - 32;
  page.drawText('Payment Voucher', { x: MARGIN + 15, y: titleY, size: 16, font: boldFont, color: NAVY });

  page.drawText('Ref:', { x: PAGE_W - MARGIN - 180, y: titleY, size: 10, font: boldFont, color: BLACK });
  // Underline for ref value
  page.drawLine({ start: { x: PAGE_W - MARGIN - 155, y: titleY - 2 }, end: { x: PAGE_W - MARGIN - 15, y: titleY - 2 }, thickness: 0.5, color: BLACK });
  page.drawText(ref, { x: PAGE_W - MARGIN - 153, y: titleY, size: 10, font: regularFont, color: BLACK });

  // --- Payment To + Date ---
  const infoY = titleY - 24;
  page.drawText('Payment To:', { x: MARGIN + 15, y: infoY, size: 10, font: boldFont, color: BLACK });
  page.drawLine({ start: { x: MARGIN + 85, y: infoY - 2 }, end: { x: PAGE_W - MARGIN - 195, y: infoY - 2 }, thickness: 0.5, color: BLACK });
  page.drawText(paymentTo, { x: MARGIN + 87, y: infoY, size: 9, font: regularFont, color: BLACK });

  page.drawText('Date:', { x: PAGE_W - MARGIN - 190, y: infoY, size: 10, font: boldFont, color: BLACK });
  page.drawLine({ start: { x: PAGE_W - MARGIN - 158, y: infoY - 2 }, end: { x: PAGE_W - MARGIN - 15, y: infoY - 2 }, thickness: 0.5, color: BLACK });
  page.drawText(docDate, { x: PAGE_W - MARGIN - 156, y: infoY, size: 9, font: regularFont, color: BLACK });

  // --- Table ---
  const tableTop = infoY - 20;
  const tableLeft = MARGIN;
  const tableRight = PAGE_W - MARGIN;
  const tableWidth = tableRight - tableLeft;

  // Column widths
  const colItem = 45;
  const colAmt = 90;
  const colDesc = tableWidth - colItem - colAmt;

  // Header row
  const rowH = 22;
  page.drawRectangle({ x: tableLeft, y: tableTop - rowH, width: tableWidth, height: rowH, color: rgb(0.9, 0.93, 0.97), borderColor: NAVY, borderWidth: 0.5 });

  // Column dividers in header
  page.drawLine({ start: { x: tableLeft + colItem, y: tableTop }, end: { x: tableLeft + colItem, y: tableTop - rowH }, thickness: 0.5, color: NAVY });
  page.drawLine({ start: { x: tableRight - colAmt, y: tableTop }, end: { x: tableRight - colAmt, y: tableTop - rowH }, thickness: 0.5, color: NAVY });

  page.drawText('Item', { x: tableLeft + 10, y: tableTop - 15, size: 9, font: boldFont, color: BLACK });
  page.drawText('Description', { x: tableLeft + colItem + 8, y: tableTop - 15, size: 9, font: boldFont, color: BLACK });

  // SGD/USD checkboxes in header
  const chkX = tableRight - colAmt + 6;
  const chkY = tableTop - 16;
  drawCheckbox(page, chkX, chkY, currency === 'SGD', 'SGD', regularFont, 8);
  drawCheckbox(page, chkX + 42, chkY, currency === 'USD', 'USD', regularFont, 8);

  // Accounts PV row structure:
  // Row 1: Payment Invoice number
  // Row 2: BL number + PSS number — amount shown here
  // Row 3: Invoice charges (THC/BL/SEAL etc.)
  const carrierInv = pv?.carrier_invoice_number || '';
  const blNum = pv?.bl_number || '';
  const pssNum = pv?.pss_invoice_number || '';
  const charges = pv?.charges_summary || '';

  const blPssLine = [
    blNum ? `BL. ${blNum}` : '',
    pssNum ? `(#${pssNum})` : '',
  ].filter(Boolean).join(' ');

  const contentRows: { desc: string; amount?: string }[] = [];
  if (carrierInv) contentRows.push({ desc: `Payment Inv.  ${carrierInv}` });
  if (blPssLine)  contentRows.push({ desc: blPssLine, amount });
  if (charges)    contentRows.push({ desc: charges });

  const MIN_ROWS = 8;
  const dataRows = Math.max(contentRows.length, MIN_ROWS);

  let currentY = tableTop - rowH;

  for (let i = 0; i < dataRows; i++) {
    const rowY = currentY - rowH;
    page.drawRectangle({ x: tableLeft, y: rowY, width: tableWidth, height: rowH, borderColor: NAVY, borderWidth: 0.5, color: WHITE });
    page.drawLine({ start: { x: tableLeft + colItem, y: currentY }, end: { x: tableLeft + colItem, y: rowY }, thickness: 0.5, color: NAVY });
    page.drawLine({ start: { x: tableRight - colAmt, y: currentY }, end: { x: tableRight - colAmt, y: rowY }, thickness: 0.5, color: NAVY });

    if (i < contentRows.length) {
      const row = contentRows[i];
      page.drawText(row.desc, { x: tableLeft + colItem + 8, y: rowY + 7, size: 9, font: regularFont, color: BLACK, maxWidth: colDesc - 16 });
      if (row.amount) {
        page.drawText(row.amount, { x: tableRight - colAmt + 6, y: rowY + 7, size: 9, font: regularFont, color: BLACK });
      }
    }

    currentY = rowY;
  }

  // Total row
  const totalRowY = currentY - rowH;
  page.drawRectangle({ x: tableLeft, y: totalRowY, width: tableWidth, height: rowH, color: rgb(0.9, 0.93, 0.97), borderColor: NAVY, borderWidth: 0.5 });
  page.drawLine({ start: { x: tableRight - colAmt, y: currentY }, end: { x: tableRight - colAmt, y: totalRowY }, thickness: 0.5, color: NAVY });

  // SGD/USD checkboxes in total row
  const totalChkX = tableRight - colAmt - 80;
  drawCheckbox(page, totalChkX, totalRowY + 7, currency === 'SGD', 'SGD', regularFont, 8);
  drawCheckbox(page, totalChkX + 42, totalRowY + 7, currency === 'USD', 'USD', regularFont, 8);

  page.drawText('Total', { x: tableRight - colAmt - 35, y: totalRowY + 7, size: 9, font: boldFont, color: BLACK });
  if (total) {
    page.drawText(total, { x: tableRight - colAmt + 6, y: totalRowY + 7, size: 9, font: boldFont, color: BLACK });
  }

  // --- Cash / Cheque No ---
  const chequeY = totalRowY - 30;
  page.drawText('CASH / CHEQUE No.:', { x: MARGIN + 15, y: chequeY, size: 10, font: boldFont, color: BLACK });
  page.drawLine({ start: { x: MARGIN + 140, y: chequeY - 2 }, end: { x: PAGE_W - MARGIN - 15, y: chequeY - 2 }, thickness: 0.5, color: BLACK });
  if (paymentMethod) {
    page.drawText(paymentMethod, { x: MARGIN + 143, y: chequeY, size: 10, font: regularFont, color: BLACK });
  }

  // --- Signature line ---
  const sigY = chequeY - 50;
  page.drawText('Approved By:', { x: MARGIN + 15, y: sigY, size: 10, font: boldFont, color: BLACK });
  page.drawLine({ start: { x: MARGIN + 90, y: sigY - 2 }, end: { x: MARGIN + 240, y: sigY - 2 }, thickness: 0.5, color: BLACK });

  page.drawText('Received By:', { x: PAGE_W / 2 + 20, y: sigY, size: 10, font: boldFont, color: BLACK });
  page.drawLine({ start: { x: PAGE_W / 2 + 95, y: sigY - 2 }, end: { x: PAGE_W - MARGIN - 15, y: sigY - 2 }, thickness: 0.5, color: BLACK });
}

export async function generateVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Try to load the logo once
  const logoBytes = await fetch('/Zhenghe%20Logistics%20Logo-02.png')
    .then(r => r.arrayBuffer())
    .catch(() => null);

  for (const doc of docs) {
    await drawVoucherPage(pdfDoc, doc, boldFont, regularFont, logoBytes);
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}
