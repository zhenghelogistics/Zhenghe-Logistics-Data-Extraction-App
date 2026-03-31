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
