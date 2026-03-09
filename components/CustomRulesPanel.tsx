import React, { useState } from 'react';
import { PlusCircle, Trash2, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react';

interface CustomRulesPanelProps {
  rules: string[];
  onRulesChange: (rules: string[]) => void;
}

const EXAMPLE_RULES = [
  "Also extract the freight agent's phone number if present",
  "Flag any document that mentions 'hazardous goods' or 'dangerous cargo'",
  "Extract the booking reference number if different from the BL number",
  "Note if the document mentions 'refrigerated' or 'reefer' cargo",
  "Extract any discount amounts separately from the total",
];

const CustomRulesPanel: React.FC<CustomRulesPanelProps> = ({ rules, onRulesChange }) => {
  const [newRule, setNewRule] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const addRule = () => {
    const trimmed = newRule.trim();
    if (!trimmed) return;
    onRulesChange([...rules, trimmed]);
    setNewRule('');
  };

  const removeRule = (index: number) => {
    onRulesChange(rules.filter((_, i) => i !== index));
  };

  const addExample = (example: string) => {
    if (!rules.includes(example)) {
      onRulesChange([...rules, example]);
    }
  };

  return (
    <div className="mb-4 border border-slate-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Lightbulb size={15} className="text-blue-500" />
          <span className="text-sm font-semibold text-slate-700">
            Custom Extraction Rules
          </span>
          {rules.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
              {rules.length} active
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 pt-3">
            Tell the AI what extra information to look for — plain English, no coding needed.
          </p>

          {/* Active Rules */}
          {rules.length > 0 && (
            <ul className="space-y-1.5">
              {rules.map((rule, i) => (
                <li key={i} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700">
                  <span className="flex-1">{rule}</span>
                  <button
                    type="button"
                    onClick={() => removeRule(i)}
                    className="text-slate-400 hover:text-red-500 flex-shrink-0 transition-colors cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add New Rule */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newRule}
              onChange={(e) => setNewRule(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRule()}
              placeholder='e.g. "Also extract the vessel departure date"'
              className="flex-1 text-sm rounded-lg border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white text-slate-800 placeholder-slate-400"
            />
            <button
              type="button"
              onClick={addRule}
              disabled={!newRule.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <PlusCircle size={13} />
              Add
            </button>
          </div>

          {/* Example suggestions */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">Quick add:</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_RULES.filter(ex => !rules.includes(ex)).map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => addExample(ex)}
                  className="text-xs bg-slate-50 border border-slate-200 text-slate-600 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 rounded-full px-3 py-1 transition-colors cursor-pointer"
                >
                  + {ex}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomRulesPanel;
