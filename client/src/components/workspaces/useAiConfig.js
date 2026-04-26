import { useState, useCallback } from 'react';
import { workspaceApi } from '../../api/modules/workspaceApi';

const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'openai-gpt-5.4', label: 'GPT 5.4' },
  { id: 'openai-gpt-5.2', label: 'GPT 5.2' },
  { id: 'openai-gpt-5', label: 'GPT 5' },
  { id: 'openai-gpt-4.1', label: 'GPT 4.1' },
  { id: 'llama3.1-8b', label: 'Llama 3.1 8B' },
  { id: 'llama3.1-70b', label: 'Llama 3.1 70B' },
  { id: 'mistral-large2', label: 'Mistral Large 2' },
  { id: 'deepseek-r1', label: 'DeepSeek R1' },
];

const DEFAULT_MODEL_ID = 'claude-sonnet-4-6';

export function useAiConfig({ activeWorkspace, isAdmin, toast }) {
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [aiSaving, setAiSaving] = useState(false);

  const loadAiConfig = useCallback(async () => {
    if (!activeWorkspace?.id) return;
    try {
      const data = await workspaceApi.getAiConfig(activeWorkspace.id);
      const cfg = data.aiConfig || {};
      setSelectedModel(cfg.defaultModel || DEFAULT_MODEL_ID);
    } catch { /* ignore */ }
  }, [activeWorkspace?.id]);

  const handleSelectModel = async (modelId) => {
    if (!activeWorkspace || !isAdmin) return;
    setSelectedModel(modelId);
    setAiSaving(true);
    try {
      const payload = { defaultModel: modelId };
      await workspaceApi.updateAiConfig(activeWorkspace.id, payload);
      const model = AVAILABLE_MODELS.find(m => m.id === modelId);
      toast.success(`Model set to ${model?.label || modelId}`);
    } catch (e) {
      toast.error(e.message || 'Failed to update model');
    } finally {
      setAiSaving(false);
    }
  };

  return {
    selectedModel, aiSaving,
    loadAiConfig, handleSelectModel,
    AVAILABLE_MODELS, DEFAULT_MODEL_ID,
  };
}
