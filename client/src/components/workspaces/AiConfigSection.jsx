import React from 'react';
import {
  FiCpu, FiLoader,
  FiChevronDown, FiChevronUp,
} from 'react-icons/fi';

export default function AiConfigSection({
  isOpen, onToggle, isAdmin,
  selectedModel, handleSelectModel, aiSaving,
  AVAILABLE_MODELS, DEFAULT_MODEL_ID,
}) {
  const modelLabel = AVAILABLE_MODELS.find(m => m.id === selectedModel)?.label || selectedModel;

  return (
    <div className="ws-flat-section">
      <button className="ws-flat-section-toggle" onClick={onToggle}>
        <span className="ws-flat-section-label"><FiCpu size={14} /> AI Model <span className="ws-flat-count">{modelLabel}</span></span>
        {isOpen ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
      </button>
      {isOpen && (
        <div className="ws-flat-section-body">
          <div className="ws-ai-config-form">
            <label className="ws-form-label">Active Model</label>
            <div className="ws-ai-model-select-row">
              <select
                className="ws-ai-model-dropdown"
                value={selectedModel}
                onChange={e => handleSelectModel(e.target.value)}
                disabled={!isAdmin || aiSaving}
              >
                {AVAILABLE_MODELS.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label}{m.id === DEFAULT_MODEL_ID ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              {aiSaving && <FiLoader className="spinner" size={14} />}
            </div>
            <p className="ws-muted" style={{ fontSize: 11, marginTop: 4 }}>
              This model is used for chat, dashboard generation, and data exploration.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
