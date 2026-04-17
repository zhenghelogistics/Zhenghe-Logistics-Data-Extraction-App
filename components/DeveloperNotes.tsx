import React from 'react';
import { CheckCircle } from 'lucide-react';

interface Update {
  date: string;
  title: string;
  description: string;
  items: string[];
}

const UPDATES: Update[] = [
  {
    date: '17 Apr 2026',
    title: 'ONE BL Filing Charges Fixed',
    description: 'AMS ADVANCE, ESD ENTRY SUMMARY, and EES EUROPE now land in the correct column with proper SGD conversion.',
    items: [
      'These ONE carrier charge codes were not recognised as ENS/AMS-type charges — they were incorrectly placed in column K (BL Printed Fee) instead of column L (ENS/AMS/SCMC)',
      'USD amounts are now converted to SGD using the exchange rate printed on the BL (e.g. AMS ADVANCE USD 35 × 1.2753 = SGD 44.64)',
      'When multiple filing charges appear on the same BL (e.g. ESD + EES EUROPE), they are now summed into a single SGD total in column L',
      'Column K is now explicitly guarded — only charges labeled "PRINTED BL" or "BL PRINTED FEE" will populate it',
    ],
  },
  {
    date: '16 Apr 2026',
    title: 'Large PDF Processing Improvements',
    description: 'Large logistics PDFs are less likely to time out during extraction.',
    items: [
      'Logistics PDFs are now split into smaller batches before sending to Claude — reduces the chance of hitting the 60-second server time limit',
      'Timeout errors now show a clear [ERR-TIMEOUT] code with the batch number so you know exactly where it failed',
      'Very large files (e.g. 90+ page OPD bundles) may still time out — splitting the file into smaller PDFs before uploading is the recommended workaround for now',
    ],
  },
  {
    date: '15 Apr 2026',
    title: 'Logistics Local Charges Extraction Fixes',
    description: 'Several extraction bugs affecting the Shipping Department\'s Local Charges table have been fixed.',
    items: [
      'Forwarder-issued invoices now correctly use the House BL number — previously they sometimes used the Master BL number',
      'ISOCC (International Seal) is no longer incorrectly included in Seal Fee or Other Charges — it is not a local charge',
      'For OOCL multi-BL invoices, the per-unit seal rate is now applied to every BL entry, not just the first one',
      'ADV MFST CHGR (Advance Manifest Charge) is now captured in column L with correct USD→SGD conversion',
      'Surrender Fee and Food Grade are no longer included in the charges summary — they are not local charges',
    ],
  },
  {
    date: '1 Apr 2026',
    title: 'Fuel Surcharge & Dynamic Price Factor (Transport Team)',
    description: 'Allied and CDAS surcharges are now tracked separately and shown correctly on voucher PDFs.',
    items: [
      'Fuel Surcharge (EFS) and Dynamic Price Factor are now extracted as their own fields — no longer silently added into the DHC amount',
      'The transport table shows new Fuel Surcharge and Dynamic Price Factor columns, showing the exact charge name from the document (e.g. "EFS", "DYNAMIC PRICE FACTOR (IN)")',
      'Voucher PDFs now list each surcharge on its own line with the correct label and amount',
      'The processing animation has been improved — file names and current stage are now shown clearly while extraction is running',
    ],
  },
  {
    date: '31 Mar 2026',
    title: 'Stability & Security',
    description: 'The app is now more resilient to crashes and the API key is properly secured.',
    items: [
      'If any part of the app crashes, you now see a friendly error message with a "Try again" button instead of a blank white screen',
      'Claude API key moved fully server-side — it is no longer bundled into the app\'s JavaScript where it could be extracted',
    ],
  },
  {
    date: '30 Mar 2026',
    title: 'Housekeeping & Code Quality',
    description: 'Behind-the-scenes cleanup to keep the app fast and maintainable.',
    items: [
      'Removed an unused Google AI library that was installed but never used — smaller app, less clutter',
      'Deleted a duplicate file that could have caused confusing bugs down the line',
      'Split the main app file into smaller, focused files — easier to find things when something breaks',
    ],
  },
  {
    date: '30 Mar 2026',
    title: 'Error Reporting & Alerts',
    description: 'When something goes wrong, you\'ll now know exactly what happened and can report it instantly.',
    items: [
      'Every error now shows a short error code (e.g. [ERR-RATE-LIMIT]) so it\'s easy to identify the problem',
      'Click the copy icon next to any failed file to copy a full error report — paste it directly to your developer to get it fixed',
      'PDF generation failures now show a non-blocking notification instead of a pop-up that freezes the page',
    ],
  },
  {
    date: '30 Mar 2026',
    title: 'Automated Tests Added',
    description: 'The app now has a safety net that catches silent bugs before they reach you.',
    items: [
      '15 automated tests now run on every code change',
      'Specifically guards against container data being mixed up between different companies',
      'Covers the document merging and deduplication logic that runs on every extraction',
    ],
  },
  {
    date: '30 Mar 2026',
    title: 'Schutz Shipment Extraction Fixed',
    description: 'Export Permit PSS now correctly picks up Schütz GmbH proforma invoices.',
    items: [
      'Schutz shipment items (electrodes, coupling, sliding rail) now appear in the Export Permit PSS CSV',
      'HS codes in the Comm.code.no. format are now read correctly',
      'EUR currency and Your order / Order No. references are extracted properly',
    ],
  },
  {
    date: '30 Mar 2026',
    title: 'Export Permit PSS in ZIP + Re-process Button',
    description: 'Two small but useful additions to daily workflow.',
    items: [
      'Export Permit PSS data is now included when you download the ZIP report',
      'Any file can now be re-processed without re-uploading — useful if extraction produced unexpected results',
    ],
  },
  {
    date: '13 Mar 2026',
    title: 'Export Permit Declaration (PSS) Tab',
    description: 'New document type for the Shipping Department.',
    items: [
      'PSS shipment documents are now extracted into their own tab',
      'Line items extracted: HS Code, Qty, UOM, Item Description, Product of Origin, Nett Weight, Amount, Currency, PO Number, Invoice Number',
      'Included in the ZIP export as a separate CSV',
    ],
  },
  {
    date: '13 Mar 2026',
    title: 'Templates Feature Removed',
    description: 'The custom template builder has been removed from the app.',
    items: [
      'The feature was unreliable and difficult to maintain',
      'New document types will be added properly by a developer when genuinely needed',
      'All existing document types continue to work exactly as before',
    ],
  },
  {
    date: '13 Mar 2026',
    title: 'CRM Billing Tab',
    description: 'Transport team can now track container charges through their full billing lifecycle.',
    items: [
      'Allied and CDAS report charges are automatically imported into the billing tab',
      'Mark containers as billed, add remarks, and archive old records',
      'Mass delete for bulk cleanup',
    ],
  },
  {
    date: '13 Mar 2026',
    title: 'Voucher PDF Generation',
    description: 'Generate formatted payment voucher PDFs directly from the app.',
    items: [
      'Payment Voucher/GL, Allied Report, and CDAS Report tabs each have an Export Voucher PDF button',
      'PDFs download instantly — no external tools needed',
    ],
  },
  {
    date: '13 Mar 2026',
    title: 'Role-Based Access',
    description: 'Each team only sees what\'s relevant to them.',
    items: [
      'Accounts team sees Payment Voucher/GL',
      'Shipping Department sees Logistics Local Charges, Outward Permit, and Export Permit PSS',
      'Transport team sees Allied Report, CDAS Report, and CRM Billing',
    ],
  },
];

const DeveloperNotes: React.FC = () => {
  return (
    <div className="max-w-3xl space-y-4">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-primary">What's New</h2>
        <p className="text-sm text-[#4a5568] mt-0.5">A log of every update made to Pluckd, in plain English.</p>
      </div>

      {UPDATES.map((update, i) => (
        <div key={i} className="bg-surface-lowest rounded-xl p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-primary">{update.title}</h3>
              <p className="text-xs text-[#4a5568] mt-0.5">{update.description}</p>
            </div>
            <span className="text-[11px] text-[#4a5568] whitespace-nowrap shrink-0 mt-0.5">{update.date}</span>
          </div>
          <ul className="space-y-1.5">
            {update.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2 text-xs text-primary">
                <CheckCircle size={13} className="text-secondary shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default DeveloperNotes;
