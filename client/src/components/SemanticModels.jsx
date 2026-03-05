import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import {
  FiLayers,
  FiPlus,
  FiEdit3,
  FiTrash2,
  FiHash,
  FiType,
  FiCalendar,
  FiActivity,
  FiTrendingUp,
  FiPieChart,
} from 'react-icons/fi';
import './SemanticModels.css';

const SemanticModels = () => {
  const { semanticModels, selectedModel, selectModel, loadModels } = useAppStore();
  const [activeTab, setActiveTab] = useState('dimensions');

  const getTypeIcon = (type) => {
    switch (type) {
      case 'string': return <FiType />;
      case 'number': return <FiHash />;
      case 'date': return <FiCalendar />;
      default: return <FiType />;
    }
  };

  const getAggIcon = (agg) => {
    switch (agg) {
      case 'sum': return <FiTrendingUp />;
      case 'count': return <FiActivity />;
      case 'avg': return <FiPieChart />;
      default: return <FiActivity />;
    }
  };

  return (
    <div className="semantic-models">
      <div className="models-sidebar">
        <div className="models-header">
          <h3>
            <FiLayers /> Semantic Models
          </h3>
          <button className="btn btn-icon btn-primary btn-sm">
            <FiPlus />
          </button>
        </div>

        <div className="models-list">
          {semanticModels.map((model) => (
            <button
              key={model.id}
              className={`model-card ${selectedModel?.id === model.id ? 'active' : ''}`}
              onClick={() => selectModel(model)}
            >
              <div className="model-card-icon">
                <FiLayers />
              </div>
              <div className="model-card-content">
                <h4>{model.name}</h4>
                <p>{model.tableName}</p>
              </div>
              <div className="model-card-stats">
                <span>{model.dimensions?.length || 0} dims</span>
                <span>{model.measures?.length || 0} measures</span>
              </div>
            </button>
          ))}

          {semanticModels.length === 0 && (
            <div className="empty-models">
              <FiLayers />
              <p>No semantic models yet</p>
              <span>Create one from the Data Explorer</span>
            </div>
          )}
        </div>
      </div>

      <div className="models-main">
        {selectedModel ? (
          <>
            <div className="model-detail-header">
              <div className="model-info">
                <h2>{selectedModel.name}</h2>
                <p className="model-table">{selectedModel.table}</p>
                {selectedModel.description && (
                  <p className="model-description">{selectedModel.description}</p>
                )}
              </div>
              <div className="model-actions">
                <button className="btn btn-secondary btn-sm">
                  <FiEdit3 /> Edit
                </button>
                <button className="btn btn-danger btn-sm">
                  <FiTrash2 /> Delete
                </button>
              </div>
            </div>

            <div className="model-tabs">
              <button
                className={`tab ${activeTab === 'dimensions' ? 'active' : ''}`}
                onClick={() => setActiveTab('dimensions')}
              >
                Dimensions ({selectedModel.dimensions?.length || 0})
              </button>
              <button
                className={`tab ${activeTab === 'measures' ? 'active' : ''}`}
                onClick={() => setActiveTab('measures')}
              >
                Measures ({selectedModel.measures?.length || 0})
              </button>
              <button
                className={`tab ${activeTab === 'joins' ? 'active' : ''}`}
                onClick={() => setActiveTab('joins')}
              >
                Joins ({selectedModel.joins?.length || 0})
              </button>
            </div>

            <div className="model-content">
              {activeTab === 'dimensions' && (
                <div className="fields-grid">
                  {selectedModel.dimensions?.map((dim) => (
                    <div key={dim.id} className="field-card dimension">
                      <div className="field-header">
                        <div className="field-icon">
                          {getTypeIcon(dim.type)}
                        </div>
                        <div className="field-type-badge">{dim.type}</div>
                      </div>
                      <h4 className="field-name">{dim.name}</h4>
                      <p className="field-description">{dim.description}</p>
                      <code className="field-sql">{dim.sql}</code>
                    </div>
                  ))}

                  <button className="add-field-card">
                    <FiPlus />
                    <span>Add Dimension</span>
                  </button>
                </div>
              )}

              {activeTab === 'measures' && (
                <div className="fields-grid">
                  {selectedModel.measures?.map((measure) => (
                    <div key={measure.id} className="field-card measure">
                      <div className="field-header">
                        <div className="field-icon">
                          {getAggIcon(measure.aggregation)}
                        </div>
                        <div className="field-type-badge">{measure.aggregation}</div>
                      </div>
                      <h4 className="field-name">{measure.name}</h4>
                      <p className="field-description">{measure.description}</p>
                      <code className="field-sql">{measure.sql}</code>
                    </div>
                  ))}

                  <button className="add-field-card">
                    <FiPlus />
                    <span>Add Measure</span>
                  </button>
                </div>
              )}

              {activeTab === 'joins' && (
                <div className="joins-section">
                  {selectedModel.joins?.length > 0 ? (
                    <div className="joins-list">
                      {selectedModel.joins.map((join, i) => (
                        <div key={i} className="join-card">
                          <div className="join-tables">
                            <span>{join.leftTable}</span>
                            <span className="join-arrow">→</span>
                            <span>{join.rightTable}</span>
                          </div>
                          <code className="join-condition">{join.condition}</code>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p className="empty-state-text">No joins configured. Add joins to combine data from multiple tables.</p>
                      <button className="btn btn-secondary">
                        <FiPlus /> Add Join
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <FiLayers className="empty-state-icon" />
            <h3 className="empty-state-title">Select a Model</h3>
            <p className="empty-state-text">
              Choose a semantic model from the list to view and edit its dimensions, measures, and joins
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SemanticModels;

