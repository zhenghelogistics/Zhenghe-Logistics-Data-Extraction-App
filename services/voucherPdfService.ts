import { PDFDocument, StandardFonts, TextAlignment, PDFName, PDFBool } from 'pdf-lib';
import type { DocumentData } from '../types';

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
  // Only shorten if prefix is long enough to be a real series (not coincidental overlap)
  // and all suffixes are at least 2 chars
  if (prefix.length < 8) return raw;
  if (parts.some(p => p.slice(prefix.length).length < 2)) return raw;
  return [parts[0], ...parts.slice(1).map(p => p.slice(prefix.length))].join(', ');
}

function stripCurrency(val: string | null | undefined): string {
  if (!val) return '';
  return val.replace(/SGD\s*/gi, '').replace(/USD\s*/gi, '').trim();
}

function detectCurrency(val: string | null | undefined): 'SGD' | 'USD' {
  if (val && /USD/i.test(val)) return 'USD';
  return 'SGD';
}

export async function generateCDASVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL_Payment_Voucher_CDASUPDATED.pdf').then(r => r.arrayBuffer());
  // Load directly — do not copy to a new doc so AcroForm is preserved (editable in Acrobat)
  const templateDoc = await PDFDocument.load(templateBytes);
  const form = templateDoc.getForm();

  const setField = (name: string, value: string, fontSize = 11.5) => {
    try {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setAlignment(TextAlignment.Left);
      for (const widget of field.acroField.getWidgets()) {
        const r = widget.getRectangle();
        widget.setRectangle({ x: r.x, y: r.y, width: r.width, height: fontSize + 4 });
      }
      field.setText(value);
    } catch { /* field not in template — skip */ }
  };

  const parse = (v: string | null | undefined) => parseFloat(v?.replace(/[^0-9.]/g, '') || '0') || 0;

  // Aggregate all CDAS entries by charge type
  type ContainerEntry = { container: string; amount: number };
  let dhcTotal = 0;
  let adminTotal = 0;
  let washingTotal = 0;
  const washingEntries: ContainerEntry[] = [];
  let repairTotal = 0;
  const repairEntries: ContainerEntry[] = [];
  let detentionTotal = 0;
  const detentionEntries: ContainerEntry[] = [];
  let demurrageTotal = 0;
  const demurrageEntries: ContainerEntry[] = [];

  for (const doc of docs) {
    const c = doc.cdas_report;
    if (!c) continue;
    // DHC + DHE lumped together, no container breakdown
    dhcTotal   += parse(c.dhc_in) + parse(c.dhc_out) + parse(c.dhe_in) + parse(c.dhe_out);
    // Admin fee lump, no breakdown
    adminTotal += parse(c.data_admin_fee);
    // Washing: per-container amount shown
    const w = parse(c.washing);
    if (w > 0) { washingTotal += w; if (c.container_number) washingEntries.push({ container: c.container_number, amount: w }); }
    // Repair: per-container amount shown
    const r = parse(c.repair);
    if (r > 0) { repairTotal += r; if (c.container_number) repairEntries.push({ container: c.container_number, amount: r }); }
    // Detention: per-container amount shown
    const det = parse(c.detention);
    if (det > 0) { detentionTotal += det; if (c.container_number) detentionEntries.push({ container: c.container_number, amount: det }); }
    // Demurrage: per-container amount shown
    const dem = parse(c.demurrage);
    if (dem > 0) { demurrageTotal += dem; if (c.container_number) demurrageEntries.push({ container: c.container_number, amount: dem }); }
  }

  const containerDetail = (entries: ContainerEntry[]) =>
    entries.map(e => `${e.container} $${e.amount}/-`).join(', ');

  const rows: { desc: string; amount: number }[] = [];
  if (dhcTotal > 0)        rows.push({ desc: 'DHC', amount: dhcTotal });
  if (adminTotal > 0)      rows.push({ desc: 'ADMIN FEE', amount: adminTotal });
  if (washingTotal > 0)    rows.push({ desc: washingEntries.length ? `WASHING - ${containerDetail(washingEntries)}` : 'WASHING', amount: washingTotal });
  if (repairTotal > 0)     rows.push({ desc: repairEntries.length ? `REPAIR - ${containerDetail(repairEntries)}` : 'REPAIR', amount: repairTotal });
  if (detentionTotal > 0)  rows.push({ desc: detentionEntries.length ? `DETENTION - ${containerDetail(detentionEntries)}` : 'DETENTION', amount: detentionTotal });
  if (demurrageTotal > 0)  rows.push({ desc: demurrageEntries.length ? `DEMURRAGE - ${containerDetail(demurrageEntries)}` : 'DEMURRAGE', amount: demurrageTotal });

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  // Date: YYYY-MM-DD → "17 MARCH 2026"
  const rawDate = docs[0]?.cdas_report?.invoice_date || docs[0]?.metadata?.date || '';
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dateDisplay = rawDate
    ? (() => { const [y, m, d] = rawDate.split('-'); return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`; })()
    : '';

  setField('ref', ''); // ZHL internal batch ref — blank, fill manually
  setField('Payment To', 'CDAS LOGISTICS ALLIANCE LTD');
  setField('Date', dateDisplay);
  setField('CASH CHEQUE No', 'CIMB - GIRO');

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (rowNum > 6) return;
    setField(`row${rowNum}_desc`, row.desc);
    setField(`SGD USDRow${rowNum}`, row.amount.toFixed(2));
  });

  setField('SGD  USD Total', grandTotal.toFixed(2));
  try { form.getCheckBox('sgd_check').check(); } catch { /* skip */ }

  // Embed a standard font so appearance streams render in all PDF viewers
  const font = await templateDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  // Clear NeedAppearances so Adobe Acrobat uses our pre-generated streams
  // instead of regenerating them with fonts it cannot find (which produces blank fields)
  (form.acroForm.dict as any).set(PDFName.of('NeedAppearances'), PDFBool.False);

  // Save templateDoc directly — preserves AcroForm so fields remain editable in Acrobat
  const bytes = await templateDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function generateAlliedVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL_Payment_Voucher_ALLIEDUPDTAED.pdf').then(r => r.arrayBuffer());
  const templateDoc = await PDFDocument.load(templateBytes);
  const form = templateDoc.getForm();

  const setField = (name: string, value: string, fontSize = 11.5) => {
    try {
      const field = form.getTextField(name);
      field.setFontSize(fontSize);
      field.setAlignment(TextAlignment.Left);
      for (const widget of field.acroField.getWidgets()) {
        const r = widget.getRectangle();
        widget.setRectangle({ x: r.x, y: r.y, width: r.width, height: fontSize + 4 });
      }
      field.setText(value);
    } catch { /* field not in template — skip */ }
  };

  const parse = (v: string | null | undefined) => parseFloat(v?.replace(/[^0-9.]/g, '') || '0') || 0;

  type ContainerEntry = { container: string; amount: number };
  let dhcTotal = 0;
  let dheTotal = 0;
  let adminTotal = 0;
  let washingTotal = 0;
  const washingEntries: ContainerEntry[] = [];
  let repairTotal = 0;
  const repairEntries: ContainerEntry[] = [];
  let detentionTotal = 0;
  const detentionEntries: ContainerEntry[] = [];
  let demurrageTotal = 0;
  const demurrageEntries: ContainerEntry[] = [];

  for (const doc of docs) {
    const a = doc.allied_report;
    if (!a) continue;
    dhcTotal  += parse(a.dhc_in) + parse(a.dhc_out);
    dheTotal  += parse(a.dhe_in) + parse(a.dhe_out);
    adminTotal += parse(a.data_admin_fee);
    const w = parse(a.washing);
    if (w > 0) { washingTotal += w; if (a.container_booking_no) washingEntries.push({ container: a.container_booking_no, amount: w }); }
    const r = parse(a.repair);
    if (r > 0) { repairTotal += r; if (a.container_booking_no) repairEntries.push({ container: a.container_booking_no, amount: r }); }
    const det = parse(a.detention);
    if (det > 0) { detentionTotal += det; if (a.container_booking_no) detentionEntries.push({ container: a.container_booking_no, amount: det }); }
    const dem = parse(a.demurrage);
    if (dem > 0) { demurrageTotal += dem; if (a.container_booking_no) demurrageEntries.push({ container: a.container_booking_no, amount: dem }); }
  }

  const containerDetail = (entries: ContainerEntry[]) =>
    entries.map(e => `${e.container} $${e.amount}/-`).join(', ');

  const rows: { desc: string; amount: number }[] = [];
  if (dhcTotal > 0)        rows.push({ desc: 'DHC', amount: dhcTotal });
  if (dheTotal > 0)        rows.push({ desc: 'DHE', amount: dheTotal });
  if (adminTotal > 0)      rows.push({ desc: 'ADMIN FEE', amount: adminTotal });
  if (washingTotal > 0)    rows.push({ desc: washingEntries.length ? `WASHING - ${containerDetail(washingEntries)}` : 'WASHING', amount: washingTotal });
  if (repairTotal > 0)     rows.push({ desc: repairEntries.length ? `REPAIR - ${containerDetail(repairEntries)}` : 'REPAIR', amount: repairTotal });
  if (detentionTotal > 0)  rows.push({ desc: detentionEntries.length ? `DETENTION - ${containerDetail(detentionEntries)}` : 'DETENTION', amount: detentionTotal });
  if (demurrageTotal > 0)  rows.push({ desc: demurrageEntries.length ? `DEMURRAGE - ${containerDetail(demurrageEntries)}` : 'DEMURRAGE', amount: demurrageTotal });

  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  const rawDate = docs[0]?.allied_report?.invoice_date || docs[0]?.metadata?.date || '';
  const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
  const dateDisplay = rawDate
    ? (() => { const [y, m, d] = rawDate.split('-'); return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`; })()
    : '';

  setField('ref', '');
  setField('Payment To', 'ALLIED CONTAINER (E&M) PTE LTD');
  setField('Date', dateDisplay);
  setField('CASH CHEQUE No', 'CIMB - GIRO');

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    if (rowNum > 6) return;
    setField(`row${rowNum}_desc`, row.desc);
    setField(`SGD USDRow${rowNum}`, row.amount.toFixed(2));
  });

  setField('SGD  USD Total', grandTotal.toFixed(2));
  try { form.getCheckBox('sgd_check').check(); } catch { /* skip */ }

  const font = await templateDoc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  (form.acroForm.dict as any).set(PDFName.of('NeedAppearances'), PDFBool.False);

  const bytes = await templateDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function generateVoucherPdf(docs: DocumentData[]): Promise<Blob> {
  const templateBytes = await fetch('/ZHL_Payment_Voucher_Updated.pdf').then(r => r.arrayBuffer());

  const fillTemplate = async (doc: DocumentData): Promise<PDFDocument> => {
    const templateDoc = await PDFDocument.load(templateBytes);
    const form = templateDoc.getForm();

    const pv = doc.payment_voucher_details;

    const currencySource = pv?.total_payable_amount || pv?.payable_amount;
    const currency      = detectCurrency(currencySource);
    const amount        = stripCurrency(pv?.payable_amount);
    const total         = stripCurrency(pv?.total_payable_amount) || stripCurrency(pv?.payable_amount);
    const paymentTo     = pv?.payment_to || doc.metadata?.parties?.shipper_supplier || '';
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
    const autoDate = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

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

    if (carrierInv) setField('row1_desc', `Payment Inv.  ${shortenInvoiceList(carrierInv)}`);

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

    setField('CASH CHEQUE No', 'UOB SGD FAST / GIRO PAYMENT');

    // Currency checkboxes share their name between header row and total row,
    // so one check() call ticks both simultaneously.
    if (currency === 'SGD') {
      form.getCheckBox('sgd_check').check();
    } else {
      form.getCheckBox('usd_check').check();
    }

    // Embed a standard font so appearance streams render in all PDF viewers
    const font = await templateDoc.embedFont(StandardFonts.Helvetica);
    form.updateFieldAppearances(font);
    // Clear NeedAppearances so Adobe Acrobat uses our pre-generated streams
    (form.acroForm.dict as any).set(PDFName.of('NeedAppearances'), PDFBool.False);

    return templateDoc;
  };

  if (docs.length === 1) {
    // Single PV: save templateDoc directly — AcroForm preserved, fully editable in Acrobat
    const filled = await fillTemplate(docs[0]);
    const bytes = await filled.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // Multiple PVs: merge pages into one PDF.
  // copyPages does not transfer AcroForm so fields become static,
  // but the multi-page layout is correct.
  const outputDoc = await PDFDocument.create();
  for (const doc of docs) {
    const filled = await fillTemplate(doc);
    const [page] = await outputDoc.copyPages(filled, [0]);
    outputDoc.addPage(page);
  }

  const bytes = await outputDoc.save();
  return new Blob([bytes], { type: 'application/pdf' });
}
