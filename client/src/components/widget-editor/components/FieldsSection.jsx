/**
 * FieldsSection - Collapsible section showing dimensions, measures, and calculated fields
 */
import React from 'react';
import { 
  FiHash, FiPlus, FiChevronDown, FiChevronRight, 
  FiTrendingUp, FiCpu, FiEdit2, FiTrash2, FiAlertCircle, FiX 
} from 'react-icons/fi';
import FormulaBar from './FormulaBar';
import { getDataTypeIcon } from '../utils';

const FieldsSection = ({
  expanded,
  toggleSection,
  viewMetadata,
  allDimensions,
  customColumns,
  setCustomColumns,
  loadingMetadata,
  setFieldTooltip,
  // Formula bar state
  showFormulaBar,
  setShowFormulaBar,
  editingCalculatedField,
  setEditingCalculatedField,
  // Deletion error
  calcFieldDeleteError,
  setCalcFieldDeleteError,
  handleDeleteCalculatedField,
}) => {
  const totalFields = (allDimensions?.length || 0) + 
                      (viewMetadata?.measures?.length || 0) + 
                      (customColumns?.length || 0);

  return (
    <div className={`embedded-section collapsible ${expanded ? 'expanded' : ''}`}>
      <div className="section-header-row">
        <button className="section-toggle" onClick={() => toggleSection('fields')}>
          <FiHash /> Fields
          {viewMetadata && (
            <span className="section-badge">{totalFields}</span>
          )}
          <span className="toggle-icon">{expanded ? <FiChevronDown /> : <FiChevronRight />}</span>
        </button>
        <button 
          className="section-add-btn"
          onClick={(e) => {
            e.stopPropagation();
            setEditingCalculatedField(null);
            setShowFormulaBar(true);
          }}
          onMouseEnter={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setFieldTooltip({
              visible: true,
              name: '+ Calculated Field',
              type: 'action',
              dataType: '',
              description: 'Create a custom calculated field using the formula bar',
              x: rect.left,
              y: rect.bottom + 8
            });
          }}
          onMouseLeave={() => setFieldTooltip({ visible: false })}
        >
          <FiPlus />
        </button>
      </div>
      
      {/* Formula Bar - bottom panel that slides up over dashboard */}
      {showFormulaBar && (
        <FormulaBar
          isOpen={showFormulaBar}
          bottomPanel={true}
          onClose={() => {
            setShowFormulaBar(false);
            setEditingCalculatedField(null);
          }}
          availableFields={[
            ...allDimensions.map(d => ({ ...d, fieldType: 'dimension' })),
            ...(viewMetadata?.measures || []).map(m => ({ ...m, fieldType: 'measure' })),
          ]}
          existingFields={customColumns}
          editingField={editingCalculatedField}
          onSave={(calculatedField, existingField) => {
            if (existingField) {
              setCustomColumns(prev => prev.map(c => 
                c.name === existingField.name ? calculatedField : c
              ));
            } else {
              setCustomColumns(prev => [...prev, calculatedField]);
            }
            setShowFormulaBar(false);
            setEditingCalculatedField(null);
          }}
        />
      )}
      
      {/* Loading skeleton for fields */}
      {expanded && loadingMetadata && (
        <div className="section-content">
          <div className="fields-skeleton">
            <div className="skeleton-field" style={{ width: '80%' }}></div>
            <div className="skeleton-field" style={{ width: '65%' }}></div>
            <div className="skeleton-field" style={{ width: '90%' }}></div>
            <div className="skeleton-field" style={{ width: '70%' }}></div>
            <div className="skeleton-field" style={{ width: '55%' }}></div>
            <div className="skeleton-field" style={{ width: '85%' }}></div>
          </div>
        </div>
      )}
      
      {expanded && viewMetadata && !loadingMetadata && (
        <div className="section-content">
          <FieldsList 
            allDimensions={allDimensions}
            measures={viewMetadata.measures}
            customColumns={customColumns}
            setFieldTooltip={setFieldTooltip}
            setEditingCalculatedField={setEditingCalculatedField}
            setShowFormulaBar={setShowFormulaBar}
            handleDeleteCalculatedField={handleDeleteCalculatedField}
          />
          
          {/* Error message for calculated field deletion */}
          {calcFieldDeleteError && (
            <div className="calc-field-delete-error embedded">
              <FiAlertCircle className="error-icon" />
              <span>{calcFieldDeleteError.message}</span>
              <button 
                className="dismiss-error-btn"
                onClick={() => setCalcFieldDeleteError(null)}
              >
                <FiX />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Subcomponent for the fields list
const FieldsList = ({
  allDimensions,
  measures,
  customColumns,
  setFieldTooltip,
  setEditingCalculatedField,
  setShowFormulaBar,
  handleDeleteCalculatedField,
}) => (
  <div className="embedded-fields-list compact">
    {/* All dimensions (includes facts, dimensions, date parts) */}
    {allDimensions.map(dim => (
      <DimensionChip 
        key={dim.name} 
        dim={dim} 
        setFieldTooltip={setFieldTooltip} 
      />
    ))}
    
    {/* Measures */}
    {(measures || []).map(measure => (
      <MeasureChip 
        key={measure.name} 
        measure={measure} 
        setFieldTooltip={setFieldTooltip} 
      />
    ))}
    
    {/* Calculated Fields */}
    {customColumns.map(calc => (
      <CalculatedChip 
        key={calc.name} 
        calc={calc} 
        setFieldTooltip={setFieldTooltip}
        setEditingCalculatedField={setEditingCalculatedField}
        setShowFormulaBar={setShowFormulaBar}
        handleDeleteCalculatedField={handleDeleteCalculatedField}
      />
    ))}
  </div>
);

// Dimension field chip
const DimensionChip = ({ dim, setFieldTooltip }) => {
  const IconComponent = getDataTypeIcon(dim.type || dim.dataType || dim.data_type);
  
  return (
    <div
      className="embedded-field-chip dimension"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('field', JSON.stringify({ ...dim, fieldType: 'dimension' }));
        e.dataTransfer.setData('application/json', JSON.stringify({ name: dim.name, fieldType: 'dimension' }));
      }}
      onMouseMove={(e) => {
        setFieldTooltip({
          visible: true,
          name: dim.name,
          type: 'dimension',
          dataType: dim.type || dim.dataType || dim.data_type || 'VARCHAR',
          description: dim.description || dim.parentEntity || dim.entity || '',
          x: e.clientX + 12,
          y: e.clientY + 12
        });
      }}
      onMouseLeave={() => setFieldTooltip({ visible: false })}
    >
      <IconComponent className="chip-icon" />
      <span className="chip-label">{dim.name}</span>
    </div>
  );
};

// Measure field chip
const MeasureChip = ({ measure, setFieldTooltip }) => (
  <div
    className="embedded-field-chip measure"
    draggable
    onDragStart={(e) => {
      e.dataTransfer.setData('field', JSON.stringify({ ...measure, fieldType: 'measure' }));
      e.dataTransfer.setData('application/json', JSON.stringify({ name: measure.name, fieldType: 'measure' }));
    }}
    onMouseMove={(e) => {
      setFieldTooltip({
        visible: true,
        name: measure.name,
        type: 'measure',
        dataType: measure.type || measure.dataType || measure.data_type || 'NUMBER',
        description: measure.description || measure.expression || '',
        x: e.clientX + 12,
        y: e.clientY + 12
      });
    }}
    onMouseLeave={() => setFieldTooltip({ visible: false })}
  >
    <FiTrendingUp className="chip-icon" />
    <span className="chip-label">{measure.name}</span>
  </div>
);

// Calculated field chip
const CalculatedChip = ({ 
  calc, 
  setFieldTooltip,
  setEditingCalculatedField,
  setShowFormulaBar,
  handleDeleteCalculatedField,
}) => (
  <div
    className="embedded-field-chip calculated"
    draggable
    onDragStart={(e) => {
      const fieldType = calc.isAggregate ? 'measure' : 'dimension';
      e.dataTransfer.setData('field', JSON.stringify({ ...calc, fieldType }));
      e.dataTransfer.setData('application/json', JSON.stringify({ name: calc.name, fieldType }));
    }}
    onDoubleClick={(e) => {
      e.stopPropagation();
      setEditingCalculatedField(calc);
      setShowFormulaBar(true);
    }}
    onMouseMove={(e) => {
      setFieldTooltip({
        visible: true,
        name: calc.name,
        type: calc.isAggregate ? 'measure' : 'dimension',
        dataType: 'CALCULATED',
        description: calc.expression,
        x: e.clientX + 12,
        y: e.clientY + 12
      });
    }}
    onMouseLeave={() => setFieldTooltip({ visible: false })}
    title="Double-click to edit"
  >
    <FiCpu className="chip-icon" />
    <span className="chip-label">{calc.name}</span>
    <FiEdit2 
      className="chip-edit-icon"
      onClick={(e) => {
        e.stopPropagation();
        setEditingCalculatedField(calc);
        setShowFormulaBar(true);
      }}
    />
    <FiTrash2
      className="chip-delete-icon"
      onClick={(e) => {
        e.stopPropagation();
        handleDeleteCalculatedField(calc);
      }}
    />
  </div>
);

export default FieldsSection;
