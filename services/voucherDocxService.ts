import {
  Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun,
  WidthType, AlignmentType, BorderStyle, HeadingLevel, VerticalAlign,
} from 'docx';
import type { DocumentData } from '../types';

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

function shortenInvoiceList(raw: string | null | undefined): string {
  if (!raw) return '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return raw;
  let prefix = parts[0];
  for (let i = 1; i < parts.length; i++) {
    while (prefix.length > 0 && !parts[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
    }
  }
  if (prefix.length < 8) return raw;
  if (parts.some(p => p.slice(prefix.length).length < 2)) return raw;
  return [parts[0], ...parts.slice(1).map(p => p.slice(prefix.length))].join(', ');
}

const noBorder = {
  top:    { style: BorderStyle.NONE, size: 0 },
  bottom: { style: BorderStyle.NONE, size: 0 },
  left:   { style: BorderStyle.NONE, size: 0 },
  right:  { style: BorderStyle.NONE, size: 0 },
};

const thinBorder = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
};

function cell(text: string, opts: {
  bold?: boolean;
  width?: number;
  align?: typeof AlignmentType[keyof typeof AlignmentType];
  borders?: typeof thinBorder;
  shade?: string;
} = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    borders: opts.borders ?? thinBorder,
    shading: opts.shade ? { fill: opts.shade } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: opts.align ?? AlignmentType.LEFT,
      children: [new TextRun({ text, bold: opts.bold ?? false, size: 20 })],
    })],
  });
}

function buildVoucherDoc(doc: DocumentData): Document {
  const pv = doc.payment_voucher_details;
  const currencySource = pv?.total_payable_amount || pv?.payable_amount;
  const currency    = detectCurrency(currencySource);
  const amount      = stripCurrency(pv?.payable_amount);
  const total       = stripCurrency(pv?.total_payable_amount) || stripCurrency(pv?.payable_amount);
  const paymentTo   = pv?.payment_to || doc.metadata?.parties?.shipper_supplier || '';
  const carrierInv  = pv?.carrier_invoice_number || '';
  const blNum       = pv?.bl_number || '';
  const pssNum      = pv?.pss_invoice_number || '';
  const charges     = pv?.charges_summary || '';

  const pssDisplay = pssNum.startsWith('#') ? pssNum : (pssNum ? `#${pssNum}` : '');
  const blPssLine  = [blNum ? `BL. ${blNum}` : '', pssDisplay ? `(${pssDisplay})` : ''].filter(Boolean).join(' ');

  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  // Build description rows (max 6)
  const descRows: { desc: string; amt: string }[] = [];
  if (carrierInv) descRows.push({ desc: `Payment Inv.  ${shortenInvoiceList(carrierInv)}`, amt: '' });

  if (pv?.bl_entries && pv.bl_entries.length > 0) {
    pv.bl_entries.forEach(entry => {
      const pd = entry.pss_invoice_number
        ? (entry.pss_invoice_number.startsWith('#') ? entry.pss_invoice_number : `#${entry.pss_invoice_number}`)
        : '';
      const bl = [entry.bl_number ? `BL. ${entry.bl_number}` : '', pd ? `(${pd})` : ''].filter(Boolean).join(' ');
      descRows.push({ desc: bl, amt: stripCurrency(entry.amount) });
    });
  } else {
    if (blPssLine) descRows.push({ desc: blPssLine, amt: amount });
  }

  while (descRows.length < 6) descRows.push({ desc: '', amt: '' });

  const headerShade = 'D9E1F2';

  const rows = [
    // Header row
    new TableRow({
      children: [
        cell('Item',        { bold: true, width: 12, align: AlignmentType.CENTER, shade: headerShade }),
        cell('Description', { bold: true, width: 66, align: AlignmentType.CENTER, shade: headerShade }),
        cell(`${currency === 'SGD' ? '☑ SGD  ☐ USD' : '☐ SGD  ☑ USD'}`, { bold: true, width: 22, align: AlignmentType.CENTER, shade: headerShade }),
      ],
    }),
    // Data rows
    ...descRows.map((r, i) => new TableRow({
      children: [
        cell('', { width: 12 }),
        cell(i === descRows.length - 2 && charges ? charges : r.desc, { width: 66 }),
        cell(r.amt, { width: 22, align: AlignmentType.RIGHT }),
      ],
    })),
    // Total row
    new TableRow({
      children: [
        cell('', { width: 12 }),
        cell(`${currency === 'SGD' ? '☑ SGD  ☐ USD' : '☐ SGD  ☑ USD'}  Total`, { width: 66, align: AlignmentType.RIGHT, bold: true }),
        cell(total, { width: 22, align: AlignmentType.RIGHT, bold: true }),
      ],
    }),
  ];

  return new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, bottom: 720, left: 900, right: 900 },
        },
      },
      children: [
        // Title row
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: noBorder.top, bottom: noBorder.bottom, left: noBorder.left, right: noBorder.right },
          rows: [new TableRow({
            children: [
              new TableCell({
                borders: noBorder,
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [new Paragraph({
                  children: [new TextRun({ text: 'Payment Voucher', bold: true, size: 36, color: '1F3864' })],
                })],
              }),
              new TableCell({
                borders: noBorder,
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [new TextRun({ text: 'Ref: ___________________', size: 20 })],
                })],
              }),
            ],
          })],
        }),

        new Paragraph({ text: '' }),

        // Payment To / Date row
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: noBorder.top, bottom: noBorder.bottom, left: noBorder.left, right: noBorder.right },
          rows: [new TableRow({
            children: [
              new TableCell({
                borders: noBorder,
                width: { size: 60, type: WidthType.PERCENTAGE },
                children: [new Paragraph({
                  children: [
                    new TextRun({ text: 'Payment To: ', bold: true, size: 22 }),
                    new TextRun({ text: paymentTo, size: 22 }),
                  ],
                })],
              }),
              new TableCell({
                borders: noBorder,
                width: { size: 40, type: WidthType.PERCENTAGE },
                children: [new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Date: ', bold: true, size: 22 }),
                    new TextRun({ text: dateStr, size: 22 }),
                  ],
                })],
              }),
            ],
          })],
        }),

        new Paragraph({ text: '' }),

        // Main description table
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows,
        }),

        new Paragraph({ text: '' }),

        // Cash/Cheque
        new Paragraph({
          children: [
            new TextRun({ text: 'CASH / CHEQUE No.:  ', bold: true, size: 22 }),
            new TextRun({ text: 'UOB SGD FAST / GIRO PAYMENT', size: 22 }),
          ],
        }),

        new Paragraph({ text: '' }),
        new Paragraph({ text: '' }),

        // Approved / Received
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: { top: noBorder.top, bottom: noBorder.bottom, left: noBorder.left, right: noBorder.right },
          rows: [new TableRow({
            children: [
              new TableCell({
                borders: noBorder,
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [new Paragraph({
                  children: [new TextRun({ text: 'Approved By: ________________________', size: 20 })],
                })],
              }),
              new TableCell({
                borders: noBorder,
                width: { size: 50, type: WidthType.PERCENTAGE },
                children: [new Paragraph({
                  children: [new TextRun({ text: 'Received By: ________________________', size: 20 })],
                })],
              }),
            ],
          })],
        }),
      ],
    }],
  });
}

export async function generateVoucherDocx(docs: DocumentData[]): Promise<Blob> {
  // One .docx per PV — if multiple, generate the first one
  // (Word doesn't support multi-page form merging the way PDF does)
  const doc = buildVoucherDoc(docs[0]);
  const buffer = await Packer.toBlob(doc);
  return buffer;
}
