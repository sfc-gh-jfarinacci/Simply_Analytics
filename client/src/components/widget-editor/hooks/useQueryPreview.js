/**
 * useQueryPreview - Custom hook for generating live SQL query preview
 * 
 * Calls the backend API to generate SQL preview.
 * Backend is the SINGLE SOURCE OF TRUTH for SQL generation.
 * 
 * Uses the unified config from useWidgetConfig.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { semanticApi } from '../../../api/apiClient';

// Debounce delay in milliseconds
const DEBOUNCE_MS = 300;

export const useQueryPreview = ({
  // Unified config from useWidgetConfig
  config,
  // Or individual props (for backwards compatibility)
  semanticViewFQN,
  fields,
  filters,
  sorts,
  customColumns,
  connectionId,
  role,
  warehouse,
}) => {
  const [previewResult, setPreviewResult] = useState({
    sql: '-- Select a data source to see SQL preview',
    dimensions: [],
    measures: [],
    valid: false,
  });
  const [loading, setLoading] = useState(false);
  
  // Ref for debounce timer
  const debounceRef = useRef(null);
  // Ref for tracking latest request to avoid race conditions
  const requestIdRef = useRef(0);

  // Build the request config - use unified config if provided, else individual props
  const getRequestConfig = useCallback(() => {
    if (config) {
      return config;
    }
    // Fallback to individual props
    return {
      semanticView: semanticViewFQN,
      fields: fields || [],
      filters: filters || [],
      sorts: sorts || [],
      customColumns: customColumns || [],
      connectionId,
      role,
      warehouse,
    };
  }, [config, semanticViewFQN, fields, filters, sorts, customColumns, connectionId, role, warehouse]);

  // Fetch preview from backend
  const fetchPreview = useCallback(async () => {
    const requestConfig = getRequestConfig();
    
    if (!requestConfig.semanticView) {
      setPreviewResult({
        sql: '-- Select a data source to see SQL preview',
        dimensions: [],
        measures: [],
        valid: false,
      });
      return;
    }
    
    const hasContent = (requestConfig.fields?.length > 0) || 
                       (requestConfig.customColumns?.length > 0);
    
    if (!hasContent) {
      setPreviewResult({
        sql: '-- Add fields to Columns or Rows to see SQL preview',
        dimensions: [],
        measures: [],
        valid: false,
      });
      return;
    }
    
    // Track this request
    const thisRequestId = ++requestIdRef.current;
    setLoading(true);
    
    try {
      const result = await semanticApi.preview(requestConfig);
      
      // Only update if this is still the latest request
      if (thisRequestId === requestIdRef.current) {
        setPreviewResult(result);
      }
    } catch (error) {
      console.error('Preview fetch error:', error);
      if (thisRequestId === requestIdRef.current) {
        setPreviewResult({
          sql: `-- Error: ${error.message}`,
          dimensions: [],
          measures: [],
          valid: false,
        });
      }
    } finally {
      if (thisRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [getRequestConfig]);

  // Debounced effect to fetch preview on changes
  useEffect(() => {
    // Clear existing timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    // Set new debounced timer
    debounceRef.current = setTimeout(() => {
      fetchPreview();
    }, DEBOUNCE_MS);
    
    // Cleanup
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [fetchPreview]);

  return {
    liveQueryPreview: previewResult.sql,
    dimensions: previewResult.dimensions,
    measures: previewResult.measures,
    previewValid: previewResult.valid,
    previewLoading: loading,
  };
};

export default useQueryPreview;
