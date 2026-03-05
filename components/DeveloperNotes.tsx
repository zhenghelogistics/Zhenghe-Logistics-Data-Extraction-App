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
    <div className="bg-white shadow sm:rounded-lg overflow-hidden mt-8">
      <div className="px-4 py-5 sm:px-6 bg-gray-50 border-b border-gray-200">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Developer Documentation</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Technical details, configuration, and AI logic used in this application.
        </p>
      </div>

      <div className="border-t border-gray-200 px-4 py-5 sm:px-6">
        <dl className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2">

          <div className="sm:col-span-1">
            <dt className="text-sm font-medium text-gray-500">Application Architecture</dt>
            <dd className="mt-1 text-sm text-gray-900">
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
            <dt className="text-sm font-medium text-gray-500">Recent Changes & Features</dt>
            <dd className="mt-1 text-sm text-gray-900">
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
              <dt className="text-sm font-medium text-gray-500">System Prompt (AI Instruction)</dt>
              <button
                onClick={() => handleCopy(BASE_SYSTEM_PROMPT)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  copiedPrompt
                    ? 'bg-green-100 text-green-700 border-green-200'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {copiedPrompt ? 'Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
            <dd className="mt-1 text-sm text-gray-900 bg-gray-800 rounded-md p-4 overflow-x-auto">
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
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
