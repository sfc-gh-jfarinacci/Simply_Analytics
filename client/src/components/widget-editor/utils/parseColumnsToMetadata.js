/**
 * parseColumnsToMetadata - Helper function to parse Snowflake DESCRIBE SEMANTIC VIEW output
 * Snowflake returns flattened rows like:
 * { object_kind: "METRIC", object_name: "TOTAL_SALES", property: "DATA_TYPE", property_value: "NUMBER" }
 */
export const parseColumnsToMetadata = (columns) => {
    const dimensions = [];
    const measures = [];
    const facts = [];
    
    // Helper to strip entity prefix (e.g., "ORDERS.ORDER_COUNT" -> "ORDER_COUNT")
    const stripPrefix = (name) => {
      if (!name) return name;
      return name.includes('.') ? name.split('.').pop() : name;
    };
    
    // Check if this is Snowflake's flattened property format
    const isSnowflakeFormat = columns && columns.length > 0 && 
      columns[0].object_kind !== undefined && 
      columns[0].object_name !== undefined;
    
    if (isSnowflakeFormat) {
      
      // Group rows by object_name to build complete field objects
      const objectMap = new Map();
      
      columns.forEach(row => {
        const { object_kind, object_name, property, property_value, parent_entity } = row;
        
        if (!object_name) return;
        
        // Create or get existing object
        if (!objectMap.has(object_name)) {
          objectMap.set(object_name, {
            name: stripPrefix(object_name), // Strip entity prefix
            kind: object_kind,
            parentEntity: parent_entity,
            properties: {},
          });
        }
        
        // Store the property
        if (property && property_value !== undefined) {
          objectMap.get(object_name).properties[property] = property_value;
        }
      });
      
      objectMap.forEach((obj) => {
        const kind = (obj.kind || '').toUpperCase();
        
        const fieldObj = {
          name: obj.name,
          type: obj.properties.DATA_TYPE || obj.properties.DATATYPE || '',
          description: obj.properties.DESCRIPTION || obj.properties.COMMENT || '',
          expression: obj.properties.EXPRESSION || obj.properties.EXPR || '',
          parentEntity: obj.parentEntity,
        };
        
        if (kind === 'METRIC' || kind === 'MEASURE') {
          measures.push({
            ...fieldObj,
            aggregation: obj.properties.DEFAULT_AGGREGATION || obj.properties.AGGREGATION || 'sum',
          });
        } else if (kind === 'DIMENSION') {
          dimensions.push(fieldObj);
        } else if (kind === 'FACT') {
          facts.push(fieldObj);
        }
      });
      
    } else {
      // Standard column format (name, type, etc.)
      
      (columns || []).forEach(col => {
        const colName = col.name || col.column_name || col.NAME || col.COLUMN_NAME;
        const colType = col.type || col.data_type || col.TYPE || col.DATA_TYPE || '';
        const colDescription = col.description || col.comment || col.DESCRIPTION || col.COMMENT || '';
        const semanticType = col.semantic_type || col.kind || col.SEMANTIC_TYPE || col.KIND;
        
        if (!colName) return;
        
        const fieldObj = { name: colName, type: colType, description: colDescription };
        
        if (semanticType === 'measure' || col.aggregation) {
          measures.push({ ...fieldObj, aggregation: col.aggregation || 'sum' });
        } else if (semanticType === 'dimension') {
          dimensions.push(fieldObj);
        } else if (semanticType === 'fact') {
          facts.push(fieldObj);
        } else {
          const upperType = (colType || '').toUpperCase();
          if (upperType.includes('NUMBER') || upperType.includes('INT') || 
              upperType.includes('FLOAT') || upperType.includes('DECIMAL')) {
            facts.push(fieldObj);
          } else {
            dimensions.push(fieldObj);
          }
        }
      });
    }
    
    // When multiple entities exist, show the source entity on every field
    // so users always know the granularity context (e.g., "REVENUE (Orders)").
    // For single-entity views, keep labels clean with just the field name.
    const entitySet = new Set(
      [...dimensions, ...measures, ...facts]
        .map(f => f.parentEntity)
        .filter(Boolean)
    );
    const hasMultipleEntities = entitySet.size > 1;

    const annotate = (field) => {
      const entity = field.parentEntity;
      const entityLabel = entity
        ? entity.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        : null;
      return {
        ...field,
        qualifiedName: entity ? `${entity}.${field.name}` : field.name,
        displayName: hasMultipleEntities && entityLabel
          ? `${field.name} (${entityLabel})`
          : field.name,
      };
    };

    return {
      dimensions: dimensions.map(annotate),
      measures: measures.map(annotate),
      facts: facts.map(annotate),
    };
  };
  
  export default parseColumnsToMetadata;
  