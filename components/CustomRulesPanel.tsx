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
    <div className="mb-4 rounded-xl bg-surface-lowest overflow-hidden shadow-sm">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-surface-low transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Lightbulb size={15} className="text-secondary" />
          <span className="text-sm font-semibold text-primary">
            Custom Extraction Rules
          </span>
          {rules.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary-fixed text-on-secondary-container">
              {rules.length} active
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp size={15} className="text-outline" /> : <ChevronDown size={15} className="text-outline" />}
      </button>

      {isOpen && (
        <div className="px-4 pb-4 space-y-3 bg-surface-low">
          <p className="text-xs text-[#4a5568] pt-3">
            Tell the AI what extra information to look for — plain English, no coding needed.
          </p>

          {/* Active Rules */}
          {rules.length > 0 && (
            <ul className="space-y-1.5">
              {rules.map((rule, i) => (
                <li key={i} className="flex items-center gap-2 bg-surface-lowest rounded-lg px-3 py-2 text-sm text-primary">
                  <span className="flex-1">{rule}</span>
                  <button
                    type="button"
                    onClick={() => removeRule(i)}
                    className="text-outline hover:text-red-500 flex-shrink-0 transition-colors cursor-pointer"
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
              className="flex-1 text-sm rounded-lg border border-outline/20 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-secondary/20 focus:border-secondary bg-surface-lowest text-primary placeholder-outline"
            />
            <button
              type="button"
              onClick={addRule}
              disabled={!newRule.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-primary to-primary-container px-3 py-2 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <PlusCircle size={13} />
              Add
            </button>
          </div>

          {/* Example suggestions */}
          <div>
            <p className="text-xs font-medium text-outline mb-2">Quick add:</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_RULES.filter(ex => !rules.includes(ex)).map((ex, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => addExample(ex)}
                  className="text-xs bg-surface-lowest text-[#4a5568] hover:bg-secondary-fixed hover:text-on-secondary-container rounded-full px-3 py-1 transition-colors cursor-pointer"
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
