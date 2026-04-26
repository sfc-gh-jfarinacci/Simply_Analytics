import { useState, useCallback } from 'react';
import { workspaceApi } from '../../api/modules/workspaceApi';

export function useApiKeys({ activeWorkspace, toast }) {
  const [wsApiKeys, setWsApiKeys] = useState([]);
  const [showCreateKey, setShowCreateKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState(null);

  const loadApiKeys = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const data = await workspaceApi.listApiKeys(activeWorkspace.id);
      setWsApiKeys(data.keys || []);
    } catch { setWsApiKeys([]); }
  }, [activeWorkspace?.id]);

  const handleCreateApiKey = async () => {
    if (!activeWorkspace || !newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const result = await workspaceApi.createApiKey(activeWorkspace.id, { name: newKeyName.trim() });
      setRevealedKey(result.rawKey);
      setNewKeyName('');
      setShowCreateKey(false);
      await loadApiKeys();
    } catch (e) {
      toast.error(e.message || 'Failed to create API key');
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeApiKey = async (keyId) => {
    if (!activeWorkspace) return;
    try {
      await workspaceApi.revokeApiKey(activeWorkspace.id, keyId);
      toast.success('API key revoked');
      await loadApiKeys();
    } catch (e) {
      toast.error(e.message || 'Failed to revoke key');
    }
  };

  return {
    wsApiKeys, showCreateKey, setShowCreateKey, newKeyName, setNewKeyName,
    creatingKey, revealedKey, setRevealedKey,
    loadApiKeys, handleCreateApiKey, handleRevokeApiKey,
  };
}
