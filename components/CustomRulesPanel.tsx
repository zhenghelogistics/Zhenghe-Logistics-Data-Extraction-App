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
    <div className="mb-6 border border-indigo-100 rounded-lg bg-indigo-50/50 overflow-hidden">
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-indigo-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-indigo-500" />
          <span className="text-sm font-semibold text-indigo-700">
            Custom Extraction Rules
          </span>
          {rules.length > 0 && (
            <span className="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
              {rules.length} active
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={16} className="text-indigo-400" /> : <ChevronDown size={16} className="text-indigo-400" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-xs text-indigo-600">
            Tell the AI what extra information to look for — plain English, no coding needed.
            These rules apply to every document you process.
          </p>

          {/* Active Rules */}
          {rules.length > 0 && (
            <ul className="space-y-2">
              {rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-2 bg-white rounded-md px-3 py-2 text-sm text-gray-700 shadow-sm">
                  <span className="flex-1">{rule}</span>
                  <button
                    type="button"
                    onClick={() => removeRule(i)}
                    className="text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5"
                  >
                    <Trash2 size={14} />
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
              className="flex-1 text-sm rounded-md border border-indigo-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            />
            <button
              type="button"
              onClick={addRule}
              disabled={!newRule.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <PlusCircle size={14} />
              Add
            </button>
          </div>

          {/* Example suggestions */}
          <div>
            <p className="text-xs font-medium text-indigo-500 mb-2">Quick add examples:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_RULES.filter(ex => !rules.includes(ex)).map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => addExample(ex)}
                  className="text-xs bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 rounded-full px-3 py-1 transition-colors"
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
