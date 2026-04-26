import { useState, useCallback } from 'react';
import { workspaceApi } from '../../api/modules/workspaceApi';
import { semanticApi } from '../../api/modules/semanticApi';

/**
 * Parse raw DESCRIBE SEMANTIC VIEW rows into { dimensions, measures }
 */
function parseViewColumns(columns) {
  if (!columns?.length) return { dimensions: [], measures: [] };
  const isSnowflakeFormat = columns[0]?.object_kind !== undefined;
  const dims = [], meas = [];

  if (isSnowflakeFormat) {
    const objectMap = new Map();
    columns.forEach(row => {
      const { object_kind, object_name, property, property_value, parent_entity } = row;
      if (!object_name) return;
      if (!objectMap.has(object_name)) objectMap.set(object_name, { name: object_name, kind: object_kind, parentEntity: parent_entity, props: {} });
      if (property) objectMap.get(object_name).props[property] = property_value;
    });
    objectMap.forEach(obj => {
      const kind = (obj.kind || '').toUpperCase();
      const cleanName = obj.name.includes('.') ? obj.name.split('.').pop() : obj.name;
      const field = { name: cleanName, data_type: obj.props.DATA_TYPE || 'VARCHAR' };
      if (kind === 'METRIC' || kind === 'MEASURE') meas.push(field);
      else if (kind === 'DIMENSION') dims.push(field);
    });
  } else {
    columns.forEach(col => {
      const name = col.name || col.column_name;
      const kind = (col.semantic_type || col.kind || '').toUpperCase();
      const field = { name, data_type: col.type || col.data_type || 'VARCHAR' };
      if (kind === 'METRIC' || kind === 'MEASURE') meas.push(field);
      else if (kind === 'DIMENSION') dims.push(field);
    });
  }
  return { dimensions: dims, measures: meas };
}

const EMPTY_FORM = {
  name: '', slug: '', description: '', endpointType: 'structured',
  connectionId: '', viewFqn: '',
  dimensions: [], measures: [], filters: [], isPublic: false, limit: 1000,
  testQuestion: '',
};

export function useEndpoints({ activeWorkspace, wsDetail, toast }) {
  const [wsEndpoints, setWsEndpoints] = useState([]);
  const [endpointMenuOpen, setEndpointMenuOpen] = useState(null);
  const [endpointToDelete, setEndpointToDelete] = useState(null);

  const [endpointModal, setEndpointModal] = useState(null);
  const [epForm, setEpForm] = useState(EMPTY_FORM);
  const [epViewMeta, setEpViewMeta] = useState(null);
  const [epViewLoading, setEpViewLoading] = useState(false);
  const [epSaving, setEpSaving] = useState(false);
  const [epError, setEpError] = useState('');

  // Validation state
  const [epValidating, setEpValidating] = useState(false);
  const [epValidation, setEpValidation] = useState(null); // { valid, preview, sql, error, analystText, suggestions }

  const loadEndpoints = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const data = await workspaceApi.listEndpoints(activeWorkspace.id);
      setWsEndpoints(data.endpoints || []);
    } catch { setWsEndpoints([]); }
  }, [activeWorkspace?.id]);

  const handleDeleteEndpoint = async () => {
    if (!activeWorkspace || !endpointToDelete) return;
    try {
      await workspaceApi.deleteEndpoint(activeWorkspace.id, endpointToDelete.slug);
      toast.success('Endpoint deleted');
      setEndpointToDelete(null);
      await loadEndpoints();
    } catch (e) {
      toast.error(e.message || 'Failed to delete endpoint');
      setEndpointToDelete(null);
    }
  };

  const copyEndpointUrl = (ep) => {
    const base = window.location.origin;
    const url = ep.is_public && ep.share_token
      ? `${base}/api/v1/pipe/${ep.share_token}`
      : `${base}/api/v1/pipe/${activeWorkspace.id}/${ep.slug}`;
    navigator.clipboard.writeText(url);
    toast.success('Endpoint URL copied');
  };

  const slugifyEp = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 100);

  const openEndpointCreate = () => {
    setEpForm(EMPTY_FORM);
    setEpViewMeta(null);
    setEpError('');
    setEpValidation(null);
    setEndpointModal({ mode: 'create' });
  };

  const openEndpointEdit = async (ep) => {
    setEndpointMenuOpen(null);
    const qd = typeof ep.query_definition === 'string' ? JSON.parse(ep.query_definition) : ep.query_definition;
    const params = typeof ep.parameters === 'string' ? JSON.parse(ep.parameters) : (ep.parameters || []);
    const epType = ep.endpoint_type || 'structured';

    const filters = (qd.filters || []).map(f => {
      const paramMatch = params.find(p => f.value === `{{${p.name}}}`);
      return { ...f, mode: paramMatch ? 'param' : 'literal', paramDef: paramMatch || null };
    });
    setEpForm({
      name: ep.name, slug: ep.slug, description: ep.description || '',
      endpointType: epType,
      connectionId: ep.workspace_connection_id, viewFqn: ep.semantic_view_fqn,
      dimensions: qd.dimensions || [], measures: qd.measures || [],
      filters, isPublic: ep.is_public, limit: qd.limit || 1000,
      testQuestion: '',
    });
    setEpError('');
    setEpValidation(ep.validated_at ? { valid: true, skipped: true } : null);
    setEndpointModal({ mode: 'edit', endpoint: ep });

    const parts = ep.semantic_view_fqn.split('.');
    if (parts.length === 3) {
      setEpViewLoading(true);
      try {
        const wc = (wsDetail?.connections || []).find(c => c.id === ep.workspace_connection_id);
        const meta = await semanticApi.getView(parts[0], parts[1], parts[2], {
          connectionId: wc?.connection_id, role: wc?.role, warehouse: wc?.warehouse,
        });
        if (meta.error) {
          setEpError(`Failed to load view fields: ${meta.error}`);
          setEpViewMeta({ dimensions: [], measures: [] });
        } else {
          setEpViewMeta(parseViewColumns(meta.columns));
        }
      } catch (e) {
        setEpError(`Failed to load view: ${e.message}`);
      }
      setEpViewLoading(false);
    }
  };

  const handleEpViewSelect = async (viewFqn, connectionId) => {
    setEpForm(prev => ({ ...prev, viewFqn, connectionId, dimensions: [], measures: [], filters: [] }));
    setEpViewMeta(null);
    setEpValidation(null);
    setEpError('');
    const parts = viewFqn.split('.');
    if (parts.length !== 3) return;
    setEpViewLoading(true);
    try {
      const wc = (wsDetail?.connections || []).find(c => c.id === connectionId);
      if (!wc) {
        setEpError('Connection not found in workspace');
        setEpViewLoading(false);
        return;
      }
      const meta = await semanticApi.getView(parts[0], parts[1], parts[2], {
        connectionId: wc.connection_id, role: wc.role, warehouse: wc.warehouse,
      });
      if (meta.error) {
        setEpError(`Failed to load view fields: ${meta.error}`);
        setEpViewMeta({ dimensions: [], measures: [] });
      } else {
        setEpViewMeta(parseViewColumns(meta.columns));
      }
    } catch (e) {
      setEpError(`Failed to load view: ${e.message}`);
    }
    setEpViewLoading(false);
  };

  const toggleEpField = (fieldName, kind) => {
    const key = kind === 'dimension' ? 'dimensions' : 'measures';
    setEpForm(prev => ({ ...prev, [key]: prev[key].includes(fieldName) ? prev[key].filter(f => f !== fieldName) : [...prev[key], fieldName] }));
    setEpValidation(null);
  };

  const addEpFilter = () => {
    setEpForm(prev => ({ ...prev, filters: [...prev.filters, { column: '', operator: '=', value: '', mode: 'literal', paramDef: null }] }));
    setEpValidation(null);
  };

  const updateEpFilter = (idx, updates) => {
    setEpForm(prev => {
      const filters = [...prev.filters];
      filters[idx] = { ...filters[idx], ...updates };
      return { ...prev, filters };
    });
    setEpValidation(null);
  };

  const toggleFilterMode = (idx) => {
    setEpForm(prev => {
      const filters = [...prev.filters];
      const f = filters[idx];
      if (f.mode === 'literal') {
        const paramName = f.column ? f.column.toLowerCase().replace(/[^a-z0-9_]/g, '_') : 'param';
        filters[idx] = { ...f, mode: 'param', value: `{{${paramName}}}`, paramDef: { name: paramName, type: 'string', required: false, default: '' } };
      } else {
        filters[idx] = { ...f, mode: 'literal', value: '', paramDef: null };
      }
      return { ...prev, filters };
    });
    setEpValidation(null);
  };

  const updateEpParamDef = (idx, updates) => {
    setEpForm(prev => {
      const filters = [...prev.filters];
      const pd = { ...filters[idx].paramDef, ...updates };
      filters[idx] = { ...filters[idx], paramDef: pd, ...(updates.name !== undefined ? { value: `{{${updates.name}}}` } : {}) };
      return { ...prev, filters };
    });
    setEpValidation(null);
  };

  const removeEpFilter = (idx) => {
    setEpForm(prev => ({ ...prev, filters: prev.filters.filter((_, i) => i !== idx) }));
    setEpValidation(null);
  };

  const handleValidateEndpoint = async () => {
    if (!activeWorkspace) return;
    setEpValidating(true);
    setEpValidation(null);
    setEpError('');
    try {
      const body = {
        endpointType: epForm.endpointType,
        workspaceConnectionId: epForm.connectionId,
        semanticViewFqn: epForm.viewFqn,
      };

      if (epForm.endpointType === 'analyst') {
        body.testQuestion = epForm.testQuestion;
      } else {
        body.queryDefinition = {
          dimensions: epForm.dimensions,
          measures: epForm.measures,
          filters: epForm.filters.map(({ mode, paramDef, ...f }) => f),
          limit: 5,
        };
      }

      const result = await workspaceApi.validateEndpoint(activeWorkspace.id, body);
      setEpValidation(result);
      if (!result.valid) {
        setEpError(result.error || 'Validation failed');
      }
    } catch (e) {
      setEpValidation({ valid: false, error: e.message });
      setEpError(e.message);
    } finally {
      setEpValidating(false);
    }
  };

  const handleSaveEndpoint = async () => {
    if (!activeWorkspace) return;
    if (!epValidation?.valid) {
      setEpError('You must validate the endpoint before saving.');
      return;
    }
    setEpSaving(true);
    setEpError('');
    try {
      const parameters = epForm.endpointType === 'structured'
        ? epForm.filters.filter(f => f.paramDef).map(f => f.paramDef)
        : [];
      const queryDefinition = epForm.endpointType === 'structured'
        ? {
            dimensions: epForm.dimensions,
            measures: epForm.measures,
            filters: epForm.filters.map(({ mode, paramDef, ...f }) => f),
            limit: epForm.limit,
          }
        : { limit: epForm.limit };

      const body = {
        slug: epForm.slug, name: epForm.name, description: epForm.description,
        endpointType: epForm.endpointType,
        semanticViewFqn: epForm.viewFqn, workspaceConnectionId: epForm.connectionId,
        queryDefinition, parameters, isPublic: epForm.isPublic,
        validatedAt: new Date().toISOString(),
      };

      if (endpointModal.mode === 'edit') {
        await workspaceApi.updateEndpoint(activeWorkspace.id, endpointModal.endpoint.slug, body);
        toast.success('Endpoint updated');
      } else {
        await workspaceApi.createEndpoint(activeWorkspace.id, body);
        toast.success('Endpoint created');
      }
      setEndpointModal(null);
      await loadEndpoints();
    } catch (e) {
      setEpError(e.message);
    } finally {
      setEpSaving(false);
    }
  };

  return {
    wsEndpoints, endpointMenuOpen, setEndpointMenuOpen, endpointToDelete, setEndpointToDelete,
    endpointModal, setEndpointModal, epForm, setEpForm, epViewMeta, setEpViewMeta, epViewLoading, epSaving, epError,
    epValidating, epValidation,
    loadEndpoints, handleDeleteEndpoint, copyEndpointUrl, slugifyEp,
    openEndpointCreate, openEndpointEdit, handleEpViewSelect,
    toggleEpField, addEpFilter, updateEpFilter, toggleFilterMode, updateEpParamDef, removeEpFilter,
    handleValidateEndpoint, handleSaveEndpoint,
  };
}
