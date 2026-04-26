import React from 'react';
import {
  FiLayers, FiDatabase, FiPlus, FiLoader, FiX,
  FiKey, FiLink, FiLock, FiCode, FiFilter, FiSettings, FiUsers,
  FiCheckCircle, FiAlertCircle, FiZap, FiMessageSquare, FiGrid,
} from 'react-icons/fi';

const OPERATORS = ['=', '!=', '>', '<', '>=', '<=', 'IN', 'NOT IN', 'LIKE', 'IS NULL', 'IS NOT NULL'];

export default function EndpointModal({
  endpointModal, setEndpointModal, epForm, setEpForm, epViewMeta, setEpViewMeta,
  epViewLoading, epSaving, epError, slugifyEp, handleEpViewSelect,
  toggleEpField, addEpFilter, updateEpFilter, toggleFilterMode,
  updateEpParamDef, removeEpFilter, handleSaveEndpoint,
  wsConnections, wsDetail,
  epValidating, epValidation, handleValidateEndpoint,
}) {
  if (!endpointModal) return null;

  const isAnalyst = epForm.endpointType === 'analyst';

  const viewsForConn = epForm.connectionId
    ? (wsDetail?.semanticViews || []).filter(v => v.workspace_connection_id === epForm.connectionId)
    : [];
  const allColumns = [...(epViewMeta?.dimensions || []), ...(epViewMeta?.measures || [])];

  const canValidate = isAnalyst
    ? !!(epForm.connectionId && epForm.viewFqn && epForm.testQuestion?.trim())
    : !!(epForm.connectionId && epForm.viewFqn && (epForm.dimensions.length > 0 || epForm.measures.length > 0));

  const canSave = epForm.name.trim() && epForm.slug.trim() && epValidation?.valid;

  return (
    <div className="ws-create-overlay" onClick={() => { if (!epSaving) setEndpointModal(null); }}>
      <div className="ws-ep-modal-lg" onClick={e => e.stopPropagation()}>
        <div className="ws-ep-modal-header">
          <h2>{endpointModal.mode === 'edit' ? 'Edit Endpoint' : 'Create API Endpoint'}</h2>
          <button className="ws-assign-close" onClick={() => setEndpointModal(null)}><FiX /></button>
        </div>

        <div className="ws-ep-modal-body">
          {/* ── Endpoint Type Selector ── */}
          <div className="ws-ep-section">
            <h3 className="ws-ep-section-title"><FiZap size={15} /> Endpoint Type</h3>
            <div className="ws-ep-type-selector">
              <button
                className={`ws-ep-type-btn ${!isAnalyst ? 'active' : ''}`}
                onClick={() => {
                  setEpForm(prev => ({ ...prev, endpointType: 'structured', dimensions: [], measures: [], filters: [], testQuestion: '' }));
                  setEpViewMeta(null);
                }}
                disabled={endpointModal.mode === 'edit'}
              >
                <FiGrid size={18} />
                <div>
                  <strong>Structured Query</strong>
                  <span>Select dimensions & measures, define filters</span>
                </div>
              </button>
              <button
                className={`ws-ep-type-btn ${isAnalyst ? 'active' : ''}`}
                onClick={() => {
                  setEpForm(prev => ({ ...prev, endpointType: 'analyst', dimensions: [], measures: [], filters: [], testQuestion: '' }));
                  setEpViewMeta(null);
                }}
                disabled={endpointModal.mode === 'edit'}
              >
                <FiMessageSquare size={18} />
                <div>
                  <strong>Cortex Analyst</strong>
                  <span>Natural language queries via Snowflake Cortex</span>
                </div>
              </button>
            </div>
          </div>

          {/* ── Info ── */}
          <div className="ws-ep-section">
            <h3 className="ws-ep-section-title"><FiLayers size={15} /> Info</h3>
            <div className="ws-ep-row-2">
              <div className="ws-field">
                <label>Name</label>
                <input value={epForm.name} onChange={e => { const n = e.target.value; setEpForm(prev => ({ ...prev, name: n, slug: prev.slug === slugifyEp(prev.name) ? slugifyEp(n) : prev.slug })); }} placeholder="e.g. Revenue by Region" autoFocus />
              </div>
              <div className="ws-field">
                <label>Slug</label>
                <input value={epForm.slug} onChange={e => setEpForm(prev => ({ ...prev, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="revenue-by-region" className="ws-mono" />
              </div>
            </div>
            <div className="ws-field">
              <label>Description <span className="optional">(optional)</span></label>
              <textarea value={epForm.description} onChange={e => setEpForm(prev => ({ ...prev, description: e.target.value }))} placeholder="What does this endpoint return?" rows={2} />
            </div>
          </div>

          {/* ── Data Source ── */}
          <div className="ws-ep-section">
            <h3 className="ws-ep-section-title"><FiDatabase size={15} /> Data Source</h3>
            <div className="ws-ep-row-2">
              <div className="ws-field">
                <label>Connection</label>
                <select value={epForm.connectionId} onChange={e => { setEpForm(prev => ({ ...prev, connectionId: e.target.value, viewFqn: '', dimensions: [], measures: [], filters: [] })); setEpViewMeta(null); }}>
                  <option value="">Select a connection...</option>
                  {wsConnections.map(wc => <option key={wc.id} value={wc.id}>{wc.connection_name}</option>)}
                </select>
              </div>
              <div className="ws-field">
                <label>Semantic View</label>
                {epForm.connectionId ? (
                  viewsForConn.length > 0 ? (
                    <select value={epForm.viewFqn} onChange={e => handleEpViewSelect(e.target.value, epForm.connectionId)}>
                      <option value="">Select a view...</option>
                      {viewsForConn.map(v => <option key={v.id} value={v.semantic_view_fqn}>{v.semantic_view_fqn}</option>)}
                    </select>
                  ) : <p className="ws-muted">No views assigned to this connection.</p>
                ) : <select disabled><option>Select a connection first</option></select>}
              </div>
            </div>
          </div>

          {/* ── Structured: Fields ── */}
          {!isAnalyst && (
            <div className="ws-ep-section">
              <h3 className="ws-ep-section-title"><FiLayers size={15} /> Fields</h3>
              {epViewLoading ? (
                <div className="ws-ep-inline-loading"><FiLoader className="spinner" /> Loading fields...</div>
              ) : epViewMeta ? (
                <div className="ws-ep-field-picker">
                  <div className="ws-ep-field-col">
                    <h4>Dimensions <span className="ws-ep-field-count">{epForm.dimensions.length}</span></h4>
                    <div className="ws-ep-field-list">
                      {epViewMeta.dimensions.map(d => (
                        <label key={d.name} className={`ws-ep-field-item ${epForm.dimensions.includes(d.name) ? 'selected' : ''}`}>
                          <input type="checkbox" checked={epForm.dimensions.includes(d.name)} onChange={() => toggleEpField(d.name, 'dimension')} />
                          <span>{d.name}</span>
                          {d.data_type && <span className="ws-ep-field-type">{d.data_type}</span>}
                        </label>
                      ))}
                      {epViewMeta.dimensions.length === 0 && <p className="ws-muted">No dimensions</p>}
                    </div>
                  </div>
                  <div className="ws-ep-field-col">
                    <h4>Measures <span className="ws-ep-field-count">{epForm.measures.length}</span></h4>
                    <div className="ws-ep-field-list">
                      {epViewMeta.measures.map(m => (
                        <label key={m.name} className={`ws-ep-field-item ${epForm.measures.includes(m.name) ? 'selected' : ''}`}>
                          <input type="checkbox" checked={epForm.measures.includes(m.name)} onChange={() => toggleEpField(m.name, 'measure')} />
                          <span>{m.name}</span>
                          {m.data_type && <span className="ws-ep-field-type">{m.data_type}</span>}
                        </label>
                      ))}
                      {epViewMeta.measures.length === 0 && <p className="ws-muted">No measures</p>}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="ws-muted">Select a data source above to see available fields.</p>
              )}
            </div>
          )}

          {/* ── Structured: Filters ── */}
          {!isAnalyst && (
            <div className="ws-ep-section">
              <h3 className="ws-ep-section-title"><FiFilter size={15} /> Filters</h3>
              <p className="ws-ep-section-desc">Literal filters are always applied. Parameter filters let callers pass values dynamically.</p>
              {epForm.filters.map((f, idx) => (
                <div key={idx} className={`ws-ep-filter-card ${f.mode === 'param' ? 'ws-ep-filter-is-param' : 'ws-ep-filter-is-literal'}`}>
                  <div className="ws-ep-filter-main">
                    <button className={`ws-ep-mode-btn ${f.mode}`} onClick={() => toggleFilterMode(idx)} title={f.mode === 'literal' ? 'Literal — always applied. Click for parameter.' : 'Parameter — caller provides. Click for literal.'}>
                      {f.mode === 'literal' ? <FiLock size={12} /> : <FiCode size={12} />}
                    </button>
                    <select className="ws-ep-fcol" value={f.column} onChange={e => updateEpFilter(idx, { column: e.target.value })}>
                      <option value="">Column...</option>
                      {allColumns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <select className="ws-ep-fop" value={f.operator} onChange={e => updateEpFilter(idx, { operator: e.target.value })}>
                      {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                    </select>
                    {!['IS NULL', 'IS NOT NULL'].includes(f.operator) && (
                      f.mode === 'literal' ? (
                        <input className="ws-ep-fval" value={f.value} onChange={e => updateEpFilter(idx, { value: e.target.value })} placeholder="value" />
                      ) : (
                        <span className="ws-ep-param-tag">
                          {'{{'}
                          <input className="ws-ep-param-name-input" value={f.paramDef?.name || ''} onChange={e => updateEpParamDef(idx, { name: e.target.value.replace(/[^a-z0-9_]/gi, '') })} placeholder="param" />
                          {'}}'}
                        </span>
                      )
                    )}
                    <button className="ws-btn-icon-sm" onClick={() => removeEpFilter(idx)} title="Remove"><FiX size={13} /></button>
                  </div>
                  {f.mode === 'param' && f.paramDef && (
                    <div className="ws-ep-param-config">
                      <div className="ws-ep-pcfg">
                        <label>Type</label>
                        <select value={f.paramDef.type} onChange={e => updateEpParamDef(idx, { type: e.target.value })}>
                          <option value="string">String</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Boolean</option>
                        </select>
                      </div>
                      <label className="ws-ep-pcfg-check"><input type="checkbox" checked={f.paramDef.required || false} onChange={e => updateEpParamDef(idx, { required: e.target.checked })} /> Required</label>
                      <div className="ws-ep-pcfg ws-ep-pcfg-grow">
                        <label>Default</label>
                        <input value={f.paramDef.default || ''} onChange={e => updateEpParamDef(idx, { default: e.target.value })} placeholder="Default value" />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              <button className="ws-ep-add-filter" onClick={addEpFilter}><FiPlus /> Add Filter</button>
              <div className="ws-field ws-ep-limit-field">
                <label>Row Limit</label>
                <input type="number" value={epForm.limit} onChange={e => setEpForm(prev => ({ ...prev, limit: parseInt(e.target.value) || 1000 }))} min={1} max={10000} />
              </div>
            </div>
          )}

          {/* ── Analyst: Config ── */}
          {isAnalyst && (
            <div className="ws-ep-section">
              <h3 className="ws-ep-section-title"><FiMessageSquare size={15} /> Cortex Analyst</h3>
              <p className="ws-ep-section-desc">
                Callers will send a natural language question via <code>?question=...</code> and Cortex Analyst will generate SQL from the semantic view.
              </p>
              <div className="ws-field">
                <label>Test Question <span className="ws-ep-required">*required for validation</span></label>
                <input
                  value={epForm.testQuestion}
                  onChange={e => setEpForm(prev => ({ ...prev, testQuestion: e.target.value }))}
                  placeholder="e.g. What were total sales by region last quarter?"
                />
              </div>
              <div className="ws-field ws-ep-limit-field">
                <label>Row Limit</label>
                <input type="number" value={epForm.limit} onChange={e => setEpForm(prev => ({ ...prev, limit: parseInt(e.target.value) || 1000 }))} min={1} max={10000} />
              </div>
            </div>
          )}

          {/* ── Validation ── */}
          <div className="ws-ep-section">
            <h3 className="ws-ep-section-title"><FiCheckCircle size={15} /> Validation</h3>
            <p className="ws-ep-section-desc">
              {isAnalyst
                ? 'Run a test question against Cortex Analyst to verify the semantic view works.'
                : 'Execute the query to verify it returns data without errors.'}
            </p>
            <button
              className="ws-btn ws-btn-secondary ws-ep-validate-btn"
              onClick={handleValidateEndpoint}
              disabled={!canValidate || epValidating}
            >
              {epValidating ? <><FiLoader className="spinner" /> Validating...</> : <><FiZap size={14} /> Validate Endpoint</>}
            </button>

            {epValidation && !epValidation.skipped && (
              <div className={`ws-ep-validation-result ${epValidation.valid ? 'ws-ep-valid' : 'ws-ep-invalid'}`}>
                {epValidation.valid ? (
                  <>
                    <div className="ws-ep-validation-header">
                      <FiCheckCircle size={16} /> <strong>Validation passed</strong>
                      {epValidation.rowCount !== undefined && <span className="ws-ep-validation-meta">{epValidation.rowCount} rows returned</span>}
                    </div>
                    {epValidation.analystText && (
                      <div className="ws-ep-validation-analyst-text">{epValidation.analystText}</div>
                    )}
                    {epValidation.sql && (
                      <details className="ws-ep-validation-sql">
                        <summary>Generated SQL</summary>
                        <pre>{epValidation.sql}</pre>
                      </details>
                    )}
                    {epValidation.preview?.length > 0 && (
                      <details className="ws-ep-validation-preview" open>
                        <summary>Preview ({epValidation.preview.length} rows)</summary>
                        <div className="ws-ep-preview-table-wrap">
                          <table className="ws-ep-preview-table">
                            <thead>
                              <tr>{Object.keys(epValidation.preview[0]).map(k => <th key={k}>{k}</th>)}</tr>
                            </thead>
                            <tbody>
                              {epValidation.preview.map((row, i) => (
                                <tr key={i}>{Object.values(row).map((v, j) => <td key={j}>{v === null ? <em>null</em> : String(v)}</td>)}</tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                    {epValidation.suggestions?.length > 0 && (
                      <div className="ws-ep-validation-suggestions">
                        <strong>Suggestions from Cortex Analyst:</strong>
                        <ul>{epValidation.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="ws-ep-validation-header">
                    <FiAlertCircle size={16} /> <strong>Validation failed</strong>
                    <span className="ws-ep-validation-error">{epValidation.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Access ── */}
          <div className="ws-ep-section">
            <h3 className="ws-ep-section-title"><FiSettings size={15} /> Access</h3>
            <label className="ws-ep-public-toggle">
              <input type="checkbox" checked={epForm.isPublic} onChange={e => setEpForm(prev => ({ ...prev, isPublic: e.target.checked }))} />
              <div>
                <strong>Public endpoint</strong>
                <p className="ws-muted">Anyone can call this endpoint via its share token URL.</p>
              </div>
            </label>
            <div className="ws-ep-access-summary">
              <span><FiKey size={12} /> API Key</span>
              <span><FiUsers size={12} /> Authenticated</span>
              {epForm.isPublic && <span><FiLink size={12} /> Share Token</span>}
            </div>
          </div>
        </div>

        {epError && <div className="ws-error" style={{ margin: '0 24px 8px' }}>{epError}</div>}

        <div className="ws-ep-modal-footer">
          <button className="ws-btn ws-btn-ghost" onClick={() => setEndpointModal(null)} disabled={epSaving}>Cancel</button>
          <button className="ws-btn ws-btn-primary" onClick={handleSaveEndpoint} disabled={epSaving || !canSave}>
            {epSaving ? <><FiLoader className="spinner" /> Saving...</> : (endpointModal.mode === 'edit' ? 'Save Changes' : 'Create Endpoint')}
          </button>
        </div>
      </div>
    </div>
  );
}
