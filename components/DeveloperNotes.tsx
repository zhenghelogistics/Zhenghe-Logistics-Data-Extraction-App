import React, { useState } from 'react';
import { BASE_SYSTEM_PROMPT } from "../services/claudeService";

const DeveloperNotes: React.FC = () => {
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <div className="bg-surface-lowest shadow-sm rounded-xl overflow-hidden mt-8">
      <div className="px-4 py-5 sm:px-6 bg-surface-low">
        <h3 className="text-lg leading-6 font-semibold text-primary">Developer Documentation</h3>
        <p className="mt-1 max-w-2xl text-sm text-[#4a5568]">
          Technical details, configuration, and AI logic used in this application.
        </p>
      </div>

      <div className="px-4 py-5 sm:px-6">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">

          <div className="sm:col-span-1">
            <dt className="text-sm font-medium text-[#4a5568]">Application Architecture</dt>
            <dd className="mt-1 text-sm text-primary">
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Frontend:</strong> React + TypeScript + Vite</li>
                <li><strong>Styling:</strong> Tailwind CSS</li>
                <li><strong>AI Engine:</strong> Anthropic Claude (claude-haiku-4-5)</li>
                <li><strong>Backend:</strong> Supabase (Auth + Postgres)</li>
                <li><strong>Export:</strong> JSZip (Client-side ZIP generation)</li>
              </ul>
            </dd>
          </div>

          <div className="sm:col-span-1">
            <dt className="text-sm font-medium text-[#4a5568]">Recent Changes & Features</dt>
            <dd className="mt-1 text-sm text-primary">
              <ul className="list-disc pl-4 space-y-1">
                <li><strong>Switched to Claude API:</strong> Replaced Gemini with Anthropic Claude for more reliable structured extraction.</li>
                <li><strong>Custom Rules:</strong> Non-technical users can add their own extraction instructions in plain English.</li>
                <li><strong>Multi-Document Mode:</strong> Single PDFs containing multiple merged documents are parsed separately.</li>
                <li><strong>Typed Filtering:</strong> Tabular views specific to document types per role.</li>
                <li><strong>Dual-Entry Rule:</strong> Tax invoices automatically create both a Logistics and Payment Voucher entry.</li>
              </ul>
            </dd>
          </div>

          <div className="sm:col-span-2">
            <div className="flex justify-between items-center mb-1">
              <dt className="text-sm font-medium text-[#4a5568]">System Prompt (AI Instruction)</dt>
              <button
                onClick={() => handleCopy(BASE_SYSTEM_PROMPT)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  copiedPrompt
                    ? 'bg-secondary-fixed text-on-secondary-container border-secondary/20'
                    : 'bg-surface-low text-[#4a5568] border-outline/20 hover:bg-surface-container'
                }`}
              >
                {copiedPrompt ? 'Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
            <dd className="mt-1 text-sm text-primary bg-primary rounded-xl p-4 overflow-x-auto">
              <pre className="text-xs text-secondary-container font-mono whitespace-pre-wrap">
                {BASE_SYSTEM_PROMPT}
              </pre>
            </dd>
          </div>

        </dl>
      </div>
    </div>
  );
};

export default DeveloperNotes;
