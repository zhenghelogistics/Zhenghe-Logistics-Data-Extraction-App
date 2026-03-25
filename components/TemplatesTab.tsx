import React, { useState, useRef, useCallback } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import { jsonrepair } from 'jsonrepair';
import { Plus, Pencil, Trash2, FlaskConical, Download, X, GripVertical, ChevronRight, ChevronLeft, Copy, Check, Blocks } from 'lucide-react';
import { ExtractionTemplate, TemplateField, ProcessedFile, FileStatus } from '../types';
import { saveTemplate, updateTemplate, deleteTemplate } from '../services/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  templates: ExtractionTemplate[];
  onTemplatesChange: (templates: ExtractionTemplate[]) => void;
  files: ProcessedFile[];
  currentUserId: string | null;
  pinnedTemplateIds: string[];
  onPinToggle: (id: string) => void;
  focusedTemplateName?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toKey = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const ADMIN_USER_ID = 'a43ea670-2ca8-4c0c-8445-7d95e38cdb6c';

// ─── Wizard ──────────────────────────────────────────────────────────────────

interface WizardState {
  name: string;
  document_hint: string;
  fields: TemplateField[];
}

const emptyWizard = (): WizardState => ({
  name: '',
  document_hint: '',
  fields: [{ key: '', label: '', hint: '' }],
});

interface WizardProps {
  initial?: ExtractionTemplate | null;
  initialStep?: number;
  onSave: (t: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onSaveAndTest: (t: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onClose: () => void;
}

const PRECISION_TIPS = [
  '💡 Use a name your team will recognise — e.g. "FR Meyer Freight Invoice", not just "Invoice"',
  '💡 Mention what makes the document unique — the company name, layout, key headings',
  '💡 Describe what the value means, not where it is. e.g. "the total freight charge before GST, may also appear as Ocean Freight or Base Rate"',
  '💡 Review all fields before saving. You can always edit later.',
];

const Wizard: React.FC<WizardProps> = ({ initial, initialStep = 1, onSave, onSaveAndTest, onClose }) => {
  const [step, setStep] = useState(initialStep);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<WizardState>(() =>
    initial
      ? { name: initial.name, document_hint: initial.document_hint, fields: initial.fields.length ? initial.fields : [{ key: '', label: '', hint: '' }] }
      : emptyWizard()
  );

  const setField = (idx: number, key: keyof TemplateField, value: string) => {
    setForm(prev => {
      const fields = prev.fields.map((f, i) => {
        if (i !== idx) return f;
        const updated = { ...f, [key]: value };
        if (key === 'label') updated.key = toKey(value);
        return updated;
      });
      return { ...prev, fields };
    });
  };

  const addField = () =>
    setForm(prev => ({ ...prev, fields: [...prev.fields, { key: '', label: '', hint: '' }] }));

  const removeField = (idx: number) =>
    setForm(prev => ({ ...prev, fields: prev.fields.filter((_, i) => i !== idx) }));

  const canAdvance = () => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return form.document_hint.trim().length > 0;
    if (step === 3) return form.fields.some(f => f.label.trim().length > 0);
    return true;
  };

  const buildPayload = () => ({
    name: form.name.trim(),
    document_hint: form.document_hint.trim(),
    fields: form.fields.filter(f => f.label.trim()),
    is_active: initial?.is_active ?? true,
  });

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(buildPayload()); } finally { setSaving(false); }
  };

  const handleSaveAndTest = async () => {
    setSaving(true);
    try { await onSaveAndTest(buildPayload()); } finally { setSaving(false); }
  };

  const progress = ((step - 1) / 3) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-lowest rounded-2xl w-[640px] max-h-[90vh] overflow-y-auto shadow-2xl">

        {/* Header */}
        <div className="px-7 pt-6 pb-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568]">
              Step {step} of 4
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">
                Draft Mode
              </span>
              <button onClick={onClose} className="text-outline hover:text-primary transition-colors cursor-pointer">
                <X size={16} />
              </button>
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1 bg-surface-container rounded-full overflow-hidden">
            <div
              className="h-full bg-secondary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Body */}
        <div className="px-7 pb-6 space-y-5">

          {/* Step 1 — Name */}
          {step === 1 && (
            <>
              <div>
                <p className="text-[1.75rem] font-bold text-primary leading-tight">What do you call this document?</p>
                <p className="text-[0.875rem] text-[#4a5568] mt-1">Step 1 of 4: Give your template a clear, recognisable name</p>
              </div>
              <input
                autoFocus
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. FR Meyer Freight Invoice"
                className="w-full bg-surface-low rounded-lg px-4 py-3 text-sm text-primary placeholder-outline focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/10 border border-transparent transition"
              />
              <div className="bg-secondary-fixed/40 rounded-xl p-4 text-sm text-[#4a5568]">
                {PRECISION_TIPS[0]}
              </div>
            </>
          )}

          {/* Step 2 — Describe */}
          {step === 2 && (
            <>
              <div>
                <p className="text-[1.75rem] font-bold text-primary leading-tight">Describe this document</p>
                <p className="text-[0.875rem] text-[#4a5568] mt-1">Step 2 of 4: Explain it as if to a new colleague</p>
              </div>
              <textarea
                autoFocus
                rows={4}
                value={form.document_hint}
                onChange={e => setForm(prev => ({ ...prev, document_hint: e.target.value }))}
                placeholder="e.g. A freight invoice from FR Meyer containing BL references and charge breakdowns. Usually 1–2 pages with the company logo at top left."
                className="w-full bg-surface-low rounded-lg px-4 py-3 text-sm text-primary placeholder-outline focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/10 border border-transparent transition resize-none"
              />
              <div className="bg-secondary-fixed/40 rounded-xl p-4 text-sm text-[#4a5568]">
                {PRECISION_TIPS[1]}
              </div>
            </>
          )}

          {/* Step 3 — Fields */}
          {step === 3 && (
            <>
              <div>
                <p className="text-[1.75rem] font-bold text-primary leading-tight">Define extraction fields</p>
                <p className="text-[0.875rem] text-[#4a5568] mt-1">Step 3 of 4: Name each field and optionally describe what it means</p>
              </div>
              <div className="space-y-3">
                {form.fields.map((f, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <GripVertical size={16} className="mt-3 text-outline flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <input
                            value={f.label}
                            onChange={e => setField(i, 'label', e.target.value)}
                            placeholder="Field name (e.g. Total Freight Charge)"
                            className="w-full bg-surface-low rounded-lg px-3 py-2 text-sm text-primary placeholder-outline focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/10 border border-transparent transition"
                          />
                          {f.key && (
                            <p className="text-[0.6875rem] font-mono text-outline mt-0.5 ml-1">key: {f.key}</p>
                          )}
                        </div>
                        <input
                          value={f.hint}
                          onChange={e => setField(i, 'hint', e.target.value)}
                          placeholder="Optional: what is this value? e.g. 'total freight before GST, may also say Ocean Freight'"
                          className="flex-[2] bg-surface-low rounded-lg px-3 py-2 text-sm text-primary placeholder-outline focus:outline-none focus:border-secondary focus:ring-2 focus:ring-secondary/10 border border-transparent transition"
                        />
                        <button
                          onClick={() => removeField(i)}
                          disabled={form.fields.length === 1}
                          className="mt-1 text-outline hover:text-red-400 disabled:opacity-30 transition-colors cursor-pointer"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                <button
                  onClick={addField}
                  className="text-secondary text-sm font-medium hover:text-on-secondary-container transition-colors cursor-pointer"
                >
                  + Add another field
                </button>
              </div>
              <div className="bg-secondary-fixed/40 rounded-xl p-4 text-sm text-[#4a5568]">
                {form.fields.filter(f => f.label).length >= 3 ? PRECISION_TIPS[2] : PRECISION_TIPS[2]}
              </div>
            </>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <>
              <div>
                <p className="text-[1.75rem] font-bold text-primary leading-tight">Review your template</p>
                <p className="text-[0.875rem] text-[#4a5568] mt-1">Step 4 of 4: Confirm everything looks right</p>
              </div>
              <div className="bg-surface-low rounded-xl p-5 space-y-3">
                <div>
                  <p className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568]">Template Name</p>
                  <p className="text-primary font-semibold mt-0.5">{form.name}</p>
                </div>
                <div>
                  <p className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568]">Document Hint</p>
                  <p className="text-primary text-sm mt-0.5">{form.document_hint}</p>
                </div>
                <div>
                  <p className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568] mb-1.5">Fields ({form.fields.filter(f => f.label).length})</p>
                  <div className="space-y-1">
                    {form.fields.filter(f => f.label).map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="font-semibold text-primary min-w-[120px]">{f.label}</span>
                        <span className="font-mono text-[0.6875rem] text-outline bg-surface-container rounded px-1 py-0.5 mt-0.5">{f.key}</span>
                        <span className="text-[#4a5568] text-xs flex-1">{f.hint}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Footer nav */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-[#4a5568] hover:bg-surface-low transition-colors cursor-pointer"
            >
              <ChevronLeft size={15} />
              {step === 1 ? 'Cancel' : 'Back'}
            </button>
            {step < 4 ? (
              <button
                onClick={() => setStep(s => s + 1)}
                disabled={!canAdvance()}
                className="inline-flex items-center gap-1 px-5 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity cursor-pointer"
              >
                Next
                <ChevronRight size={15} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveAndTest}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg border border-secondary text-secondary text-sm font-medium hover:bg-secondary-fixed/30 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  Save & Test
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold disabled:opacity-40 cursor-pointer"
                >
                  {saving ? 'Saving…' : 'Save Template'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Test Mode Panel ──────────────────────────────────────────────────────────

interface TestPanelProps {
  template: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>;
  onClose: () => void;
  onFixHints: () => void;
}

const TestPanel: React.FC<TestPanelProps> = ({ template, onClose, onFixHints }) => {
  const [testResults, setTestResults] = useState<Record<string, string | null> | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null); // null | stage label
  const [attempts, setAttempts] = useState(0);
  const [copied, setCopied] = useState(false);
  const [testFileName, setTestFileName] = useState('');
  const [discovery, setDiscovery] = useState<{label: string; value: string}[] | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [descriptionsUpdated, setDescriptionsUpdated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toBase64 = (arrayBuffer: ArrayBuffer): string => {
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i += 8192) {
      binary += String.fromCharCode(...uint8.subarray(i, i + 8192));
    }
    return btoa(binary);
  };

  const friendlyError = (err: any): string => {
    const msg: string = err?.message || err?.toString() || '';
    if (msg.includes('JSON') || msg.includes('token') || msg.includes('is not valid')) {
      return "Claude's response wasn't in the expected format. Try re-running — this usually fixes itself.";
    }
    if (msg.includes('401') || msg.toLowerCase().includes('api_key') || msg.toLowerCase().includes('authentication')) {
      return "API key problem. The app may need to be redeployed with the correct API key.";
    }
    if (msg.includes('400') || msg.toLowerCase().includes('invalid request')) {
      return "The PDF couldn't be read. Make sure it's not password-protected or corrupted.";
    }
    if (msg.includes('529') || msg.toLowerCase().includes('overloaded')) {
      return "Claude is busy right now. Wait a few seconds and try again.";
    }
    return msg || 'Something went wrong. Try again.';
  };

  const runTest = async (file: File) => {
    setTestError(null);
    setDescriptionsUpdated(false);
    setTestFileName(file.name);

    try {
      setTesting('Reading document…');
      const arrayBuffer = await file.arrayBuffer();
      const base64 = toBase64(arrayBuffer);
      const client = new Anthropic({ apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true });

      const docContent = { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 } };

      const fieldLines = template.fields.map(f => {
        const desc = f.hint?.trim() ? ` — ${f.hint}` : '';
        return `- ${f.key}${desc}`;
      }).join('\n');

      setTesting('Extracting your fields…');
      // Run field extraction + discovery in parallel
      const [extractionMsg, discoveryMsg] = await Promise.all([
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: 'You are a JSON extraction API. Respond with ONLY a valid JSON object — no prose, no explanation, no apology. Every key must be present; use null if the value is not found. Your entire response must be parseable by JSON.parse().',
          messages: [
            { role: 'user', content: [docContent, { type: 'text', text: `Extract these fields:\n${fieldLines}` }] },
            { role: 'assistant', content: [{ type: 'text', text: '{' }] },
          ],
        }),
        client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 768,
          system: 'You are a document scanner. Respond with ONLY a valid JSON array — no prose, no explanation.',
          messages: [
            { role: 'user', content: [docContent, { type: 'text', text: 'List every clearly labelled value in this document (amounts, dates, IDs, names, codes). Return a JSON array of {"label": "...", "value": "..."} objects. Include all you can find.' }] },
            { role: 'assistant', content: [{ type: 'text', text: '[' }] },
          ],
        }),
      ]);

      // Parse extraction — prepend the prefill '{' that the assistant continued from
      const rawExtraction = '{' + (extractionMsg.content[0] as { text: string }).text;
      const parsed = JSON.parse(jsonrepair(rawExtraction));
      setTestResults(parsed);
      setAttempts(a => a + 1);

      // Parse discovery (optional — don't fail if it errors)
      try {
        const rawDiscovery = '[' + (discoveryMsg.content[0] as { text: string }).text;
        const disc = JSON.parse(jsonrepair(rawDiscovery));
        setDiscovery(Array.isArray(disc) ? disc : []);
      } catch { /* discovery is bonus, ignore parse errors */ }

    } catch (err: any) {
      console.error('Test extraction failed:', err);
      setTestError(friendlyError(err));
    } finally {
      setTesting(null);
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') runTest(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) runTest(file);
    e.target.value = '';
  };

  const failingFields = testResults
    ? template.fields.filter(f => !testResults[f.key])
    : [];

  const copyDiagnostic = () => {
    const lines = [
      'TEMPLATE DIAGNOSTIC',
      `Template: "${template.name}"`,
      `Test file: ${testFileName}`,
      '',
      ...template.fields.map(f => {
        const val = testResults?.[f.key];
        const status = val ? `PASSING → ${val}` : `FAILING → null`;
        return `${f.key}: ${status}`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasResults = testResults !== null && !testError;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-lowest rounded-2xl w-[800px] max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="px-7 pt-6 pb-4 flex items-center justify-between">
          <div>
            <p className="text-[1rem] font-semibold text-primary">Test Mode — {template.name}</p>
            <p className="text-xs text-[#4a5568] mt-0.5">Upload a sample PDF to see what Claude can extract</p>
          </div>
          <button onClick={onClose} className="text-outline hover:text-primary transition-colors cursor-pointer">
            <X size={16} />
          </button>
        </div>

        <div className="px-7 pb-7 space-y-5">
          <div className={`grid gap-5 ${hasResults || testError ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {/* Drop zone */}
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => !testing && fileRef.current?.click()}
              className="flex flex-col items-center justify-center min-h-48 rounded-xl border-2 border-dashed border-outline/40 bg-surface-low hover:border-secondary/50 hover:bg-secondary-fixed/10 transition-all cursor-pointer"
            >
              {testing ? (
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-secondary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-sm text-[#4a5568]">{testing}</p>
                </div>
              ) : (
                <div className="text-center px-4">
                  <FlaskConical size={28} className="mx-auto mb-2 text-outline" />
                  <p className="text-sm font-medium text-primary">{testFileName ? 'Drop another PDF to re-test' : 'Drop a sample PDF to test'}</p>
                  <p className="text-xs text-[#4a5568] mt-1">{testFileName || 'or click to browse'}</p>
                </div>
              )}
              <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" onChange={handleFileSelect} />
            </div>

            {/* Error */}
            {testError && (
              <div className="space-y-3">
                <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">
                  <p className="font-semibold mb-1">Something went wrong</p>
                  <p className="text-xs">{testError}</p>
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="px-3 py-1.5 rounded-lg bg-surface-low text-primary text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer"
                >
                  Try again
                </button>
              </div>
            )}

            {/* Results */}
            {hasResults && (
              <div className="space-y-2">
                {descriptionsUpdated && (
                  <div className="flex items-center gap-1.5 text-xs text-secondary mb-2">
                    <Check size={12} />
                    Descriptions updated — results below use your new descriptions
                  </div>
                )}
                <p className="text-[0.6875rem] font-medium uppercase tracking-[0.05em] text-[#4a5568] mb-2">
                  Your fields — {template.fields.filter((f: TemplateField) => testResults![f.key]).length}/{template.fields.length} found
                </p>
                {template.fields.map(f => {
                  const val = testResults![f.key];
                  const found = !!val;
                  return (
                    <div key={f.key} className="space-y-1">
                      <div className="flex items-start gap-2 text-sm">
                        <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${found ? 'bg-secondary' : 'bg-red-400'}`} />
                        <span className="font-semibold text-primary flex-shrink-0">{f.label}</span>
                        <span className={`flex-1 text-xs mt-0.5 ${found ? 'text-[#4a5568]' : 'text-red-400 italic'}`}>
                          {found ? val : 'not found'}
                        </span>
                      </div>
                      {!found && (
                        <div className="ml-4 bg-amber-50 rounded-lg p-2.5 text-xs text-amber-700">
                          <p className="font-medium mb-0.5">Couldn't find this automatically.</p>
                          <p>Check the "What's in your doc" section below — find the value you're after and note what it's labelled on the document, then click <span className="font-semibold">Update descriptions</span>.</p>
                        </div>
                      )}
                    </div>
                  );
                })}

                <div className="pt-3 flex flex-wrap gap-2">
                  {failingFields.length > 0 && (
                    <button
                      onClick={() => { setDescriptionsUpdated(false); onFixHints(); }}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold cursor-pointer hover:opacity-90"
                    >
                      Update descriptions →
                    </button>
                  )}
                  {attempts >= 2 && failingFields.length > 0 && (
                    <button
                      onClick={copyDiagnostic}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-low text-[#4a5568] text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied!' : 'Copy diagnostic'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Discovery — what's in the document */}
          {discovery && discovery.length > 0 && (
            <div className="bg-surface-low rounded-xl overflow-hidden">
              <button
                onClick={() => setShowDiscovery((s: boolean) => !s)}
                className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-primary cursor-pointer hover:bg-surface-container transition-colors"
              >
                <span>What's in your document ({discovery.length} values found)</span>
                <span className="text-outline text-xs">{showDiscovery ? '▲ hide' : '▼ show'}</span>
              </button>
              {showDiscovery && (
                <div className="px-4 pb-4">
                  <p className="text-xs text-[#4a5568] mb-3">Everything Claude detected in your PDF. If a field above shows "not found", look for it here — the label Claude sees may be different from what you called it.</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {discovery.map((d: {label: string; value: string}, i: number) => (
                      <div key={i} className="flex items-baseline gap-2 text-xs bg-surface-lowest rounded-lg px-3 py-2">
                        <span className="text-[#4a5568] flex-shrink-0 min-w-[80px]">{d.label}</span>
                        <span className="font-medium text-primary truncate">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Delete Confirm ───────────────────────────────────────────────────────────

interface DeleteConfirmProps {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirm: React.FC<DeleteConfirmProps> = ({ name, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 backdrop-blur-sm">
    <div className="bg-surface-lowest rounded-2xl w-[400px] shadow-2xl p-7 space-y-4">
      <p className="text-[1rem] font-semibold text-primary">Delete Template</p>
      <p className="text-sm text-[#4a5568]">Delete <span className="font-semibold text-primary">"{name}"</span>? This cannot be undone.</p>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-outline/20 text-[#4a5568] text-sm hover:bg-surface-low transition-colors cursor-pointer">
          Cancel
        </button>
        <button onClick={onConfirm} className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors cursor-pointer">
          Delete
        </button>
      </div>
    </div>
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

const TemplatesTab: React.FC<Props> = ({ templates, onTemplatesChange, files, currentUserId, pinnedTemplateIds, onPinToggle, focusedTemplateName }) => {
  const isAdmin = currentUserId === ADMIN_USER_ID;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ExtractionTemplate | null>(null);
  const [testingTemplate, setTestingTemplate] = useState<Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'> | null>(null);
  const [deletingTemplate, setDeletingTemplate] = useState<ExtractionTemplate | null>(null);
  const [goToStep3, setGoToStep3] = useState(false);

  const canManage = (t: ExtractionTemplate) =>
    currentUserId === t.user_id || isAdmin;

  // ── CRUD ──

  const handleSave = useCallback(async (payload: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>) => {
    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, payload);
      onTemplatesChange(templates.map(t => t.id === editingTemplate.id ? { ...t, ...payload } : t));
    } else {
      const saved = await saveTemplate(payload);
      if (saved) onTemplatesChange([saved, ...templates]);
    }
    setWizardOpen(false);
    setEditingTemplate(null);
  }, [editingTemplate, templates, onTemplatesChange]);

  const handleSaveAndTest = useCallback(async (payload: Omit<ExtractionTemplate, 'id' | 'user_id' | 'created_at'>) => {
    if (editingTemplate) {
      await updateTemplate(editingTemplate.id, payload);
      onTemplatesChange(templates.map(t => t.id === editingTemplate.id ? { ...t, ...payload } : t));
    } else {
      const saved = await saveTemplate(payload);
      if (saved) onTemplatesChange([saved, ...templates]);
    }
    setWizardOpen(false);
    setEditingTemplate(null);
    setTestingTemplate(payload);
  }, [editingTemplate, templates, onTemplatesChange]);

  const handleDelete = async () => {
    if (!deletingTemplate) return;
    await deleteTemplate(deletingTemplate.id);
    onTemplatesChange(templates.filter(t => t.id !== deletingTemplate.id));
    setDeletingTemplate(null);
  };

  const handleToggleActive = async (t: ExtractionTemplate) => {
    await updateTemplate(t.id, { is_active: !t.is_active });
    onTemplatesChange(templates.map(r => r.id === t.id ? { ...r, is_active: !r.is_active } : r));
  };

  // ── Extracted Results ──

  const extractedGroups = templates.map(t => {
    const rows: { filename: string; date: string | null; fields: Record<string, string | null> }[] = [];
    for (const f of files) {
      if (f.status !== FileStatus.COMPLETED && f.status !== FileStatus.WARNING) continue;
      for (const doc of f.data ?? []) {
        if (doc.document_type !== t.name) continue;
        rows.push({
          filename: f.file.name,
          date: doc.metadata?.date ?? null,
          fields: (doc.custom_fields as Record<string, string | null>) ?? {},
        });
      }
    }
    return { template: t, rows };
  }).filter(g => g.rows.length > 0);

  const exportCSV = (g: typeof extractedGroups[0]) => {
    const cols = g.template.fields.map(f => f.label);
    const headers = ['Filename', 'Date', ...cols];
    const safe = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = g.rows.map(r => [
      safe(r.filename),
      safe(r.date),
      ...g.template.fields.map(f => safe(r.fields[f.key])),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${g.template.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Focused tab view (when template is pinned and active in sidebar) ──
  if (focusedTemplateName) {
    const focused = templates.find(t => t.name === focusedTemplateName);
    const group = extractedGroups.find(g => g.template.name === focusedTemplateName);
    if (!focused) return null;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#4a5568]">
            {group ? `${group.rows.length} document${group.rows.length !== 1 ? 's' : ''} extracted` : 'No documents extracted yet for this template.'}
          </p>
          {group && (
            <button
              onClick={() => exportCSV(group)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold cursor-pointer hover:opacity-90"
            >
              <Download size={14} />
              Export CSV
            </button>
          )}
        </div>
        {group ? (
          <div className="bg-surface-lowest rounded-xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface-low">
                    <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Filename</th>
                    <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Date</th>
                    {focused.fields.map(f => (
                      <th key={f.key} className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, i) => (
                    <tr key={i} className={`hover:bg-surface-low transition-colors ${i % 2 === 1 ? 'bg-surface-low/50' : ''}`}>
                      <td className="px-4 py-2 text-primary font-mono text-[11px]">{row.filename}</td>
                      <td className="px-4 py-2 text-[#4a5568]">{row.date ?? '—'}</td>
                      {focused.fields.map(f => (
                        <td key={f.key} className="px-4 py-2 text-primary">{row.fields[f.key] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-64 rounded-xl border-2 border-dashed border-outline/30 bg-surface-lowest text-[#4a5568]">
            <Blocks size={28} className="mb-3 text-outline" />
            <p className="font-medium text-primary">No results yet</p>
            <p className="text-sm mt-1">Process documents that match the <span className="font-semibold">{focusedTemplateName}</span> template to see them here.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[1.75rem] font-bold text-primary">Template Library</h2>
          <p className="text-[0.875rem] text-[#4a5568] mt-0.5">Reuse extraction schemas across your organisation.</p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <span className="bg-amber-50 text-amber-700 rounded-full px-3 py-1 text-xs font-medium">
              Admin view — you can edit any template
            </span>
          )}
          <button
            onClick={() => { setEditingTemplate(null); setWizardOpen(true); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-sm font-semibold transition-opacity cursor-pointer hover:opacity-90"
          >
            <Plus size={15} />
            New Template
          </button>
        </div>
      </div>

      {/* ── Template Cards ── */}
      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-64 rounded-xl border-2 border-dashed border-outline/30 bg-surface-lowest text-[#4a5568]">
          <Blocks size={32} className="mb-3 text-outline" />
          <p className="font-medium text-primary">No templates yet</p>
          <p className="text-sm mt-1">Create your first template to extract custom fields from any document.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {templates.map(t => (
            <div key={t.id} className="bg-surface-lowest rounded-xl p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[1rem] font-semibold text-primary leading-snug">{t.name}</p>
                {currentUserId !== t.user_id && (
                  <span className="bg-secondary-fixed text-on-secondary-container rounded-full text-xs px-2 py-0.5 flex-shrink-0">
                    Shared
                  </span>
                )}
              </div>
              <p className="text-xs text-[#4a5568] line-clamp-2">{t.document_hint}</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="bg-secondary-fixed text-on-secondary-container rounded-full text-xs px-2 py-0.5">
                  {t.fields.length} field{t.fields.length !== 1 ? 's' : ''}
                </span>
                {canManage(t) && (
                  <button
                    onClick={() => handleToggleActive(t)}
                    className={`rounded-full text-xs px-2 py-0.5 transition-colors cursor-pointer ${
                      t.is_active
                        ? 'bg-secondary-fixed text-on-secondary-container hover:bg-secondary/20'
                        : 'bg-surface-container text-outline hover:bg-surface-low'
                    }`}
                  >
                    {t.is_active ? 'Active' : 'Inactive'}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                <button
                  onClick={() => onPinToggle(t.id)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    pinnedTemplateIds.includes(t.id)
                      ? 'bg-secondary-fixed text-on-secondary-container hover:bg-secondary/20'
                      : 'bg-surface-low text-[#4a5568] hover:bg-surface-container'
                  }`}
                  title={pinnedTemplateIds.includes(t.id) ? 'Remove from sidebar' : 'Add to sidebar'}
                >
                  {pinnedTemplateIds.includes(t.id) ? '📌 In sidebar' : '+ Add to sidebar'}
                </button>
                <button
                  onClick={() => setTestingTemplate(t)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-low text-primary text-xs font-medium hover:bg-surface-container transition-colors cursor-pointer"
                >
                  <FlaskConical size={12} />
                  Test
                </button>
                {canManage(t) && (
                  <>
                    <button
                      onClick={() => { setEditingTemplate(t); setGoToStep3(false); setWizardOpen(true); }}
                      className="p-1.5 rounded-lg text-outline hover:text-primary hover:bg-surface-low transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setDeletingTemplate(t)}
                      className="p-1.5 rounded-lg text-outline hover:text-red-400 hover:bg-surface-low transition-colors cursor-pointer"
                      title="Delete template"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Extracted Results ── */}
      {extractedGroups.length > 0 && (
        <div className="space-y-5">
          <h3 className="text-[1rem] font-semibold text-primary">Extracted Results</h3>
          {extractedGroups.map(g => (
            <div key={g.template.id} className="bg-surface-lowest rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 bg-surface-low">
                <p className="text-sm font-semibold text-primary">{g.template.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#4a5568]">{g.rows.length} row{g.rows.length !== 1 ? 's' : ''}</span>
                  <button
                    onClick={() => exportCSV(g)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-container text-white text-xs font-semibold cursor-pointer hover:opacity-90"
                  >
                    <Download size={12} />
                    Export CSV
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-low">
                      <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Filename</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">Date</th>
                      {g.template.fields.map(f => (
                        <th key={f.key} className="text-left px-4 py-2.5 font-semibold text-[#4a5568] whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((row, i) => (
                      <tr key={i} className={`hover:bg-surface-low transition-colors ${i % 2 === 1 ? 'bg-surface-low/50' : ''}`}>
                        <td className="px-4 py-2 text-primary font-mono text-[11px]">{row.filename}</td>
                        <td className="px-4 py-2 text-[#4a5568]">{row.date ?? '—'}</td>
                        {g.template.fields.map(f => (
                          <td key={f.key} className="px-4 py-2 text-primary">{row.fields[f.key] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Modals ── */}
      {wizardOpen && (
        <Wizard
          initial={editingTemplate}
          initialStep={goToStep3 ? 3 : 1}
          onSave={handleSave}
          onSaveAndTest={handleSaveAndTest}
          onClose={() => { setWizardOpen(false); setEditingTemplate(null); setGoToStep3(false); }}
        />
      )}

      {testingTemplate && (
        <TestPanel
          template={testingTemplate}
          onClose={() => setTestingTemplate(null)}
          onFixHints={() => {
            const full = templates.find(t => t.name === testingTemplate.name);
            setEditingTemplate(full ?? null);
            setGoToStep3(true);
            setTestingTemplate(null);
            setWizardOpen(true);
          }}
        />
      )}

      {deletingTemplate && (
        <DeleteConfirm
          name={deletingTemplate.name}
          onConfirm={handleDelete}
          onCancel={() => setDeletingTemplate(null)}
        />
      )}
    </div>
  );
};

export default TemplatesTab;
