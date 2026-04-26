import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { askApi, streamAskChat } from '../api/modules/askApi';
import { workspaceApi } from '../api/modules/workspaceApi';
import ChatMessage from '../components/ask/AskChatMessage';
import ChatInput from '../components/ask/AskChatInput';
import { HiSparkles } from 'react-icons/hi2';
import {
  FiChevronDown, FiLayers, FiDatabase,
  FiArrowLeft, FiPlus, FiMessageSquare, FiTrash2, FiSearch, FiMenu,
} from 'react-icons/fi';
import '../styles/SimplyAsk.css';

function shortName(fqn) {
  if (!fqn) return '';
  const parts = fqn.split('.');
  return parts.length >= 3 ? parts[parts.length - 1] : fqn;
}

export default function AskView() {
  const navigate = useNavigate();
  const {
    askMessages, addAskMessage, updateLastAskAssistantMessage,
    askIsStreaming, setAskStreaming,
    askActiveConversationId, setAskActiveConversation,
    askConversations, setAskConversations,
    renameAskConversation, removeAskConversation,
    activeWorkspace,
    askWorkspaceConnections, askActiveConnectionId, setAskActiveConnectionId,
    askWorkspaceViews,
    askActiveViewFqn, setAskActiveViewFqn,
    setAskWorkspaceResources,
    getAskSavedSession,
  } = useAppStore();

  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);
  const restoredRef = useRef(false);

  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const [resourceDropdownOpen, setResourceDropdownOpen] = useState(false);
  const [convDropdownOpen, setConvDropdownOpen] = useState(false);
  const [convSearchQuery, setConvSearchQuery] = useState('');
  const [convsLoading, setConvsLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const connDropdownRef = useRef(null);
  const resourceDropdownRef = useRef(null);
  const convDropdownRef = useRef(null);
  const convSearchRef = useRef(null);
  const mobileMenuRef = useRef(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef(null);

  // ── Data fetching (from former AskSidebar) ────────────────

  useEffect(() => {
    const saved = getAskSavedSession();
    if (saved.conversationId) {
      restoredRef.current = true;
    }
  }, []);

  useEffect(() => {
    const wsId = activeWorkspace?.id;
    if (!wsId) {
      setAskWorkspaceResources([], []);
      return;
    }
    workspaceApi.get(wsId)
      .then(res => {
        setAskWorkspaceResources(res.connections || [], res.semanticViews || []);
      })
      .catch(console.error);
  }, [activeWorkspace?.id]);

  useEffect(() => {
    const wsId = activeWorkspace?.id;
    if (!wsId) {
      setAskConversations([]);
      setConvsLoading(false);
      return;
    }
    setConvsLoading(true);
    askApi.listConversations(wsId, 'semantic')
      .then(res => {
        const convs = res.conversations || [];
        setAskConversations(convs);

        if (restoredRef.current) {
          restoredRef.current = false;
          const saved = getAskSavedSession();
          if (saved.conversationId && convs.some(c => c.id === saved.conversationId)) {
            askApi.getConversation(saved.conversationId)
              .then(r => setAskActiveConversation(saved.conversationId, r.messages || []))
              .catch(console.error);
          }
        }
      })
      .catch(console.error)
      .finally(() => setConvsLoading(false));
  }, [activeWorkspace?.id]);

  // ── General effects ───────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [askMessages]);

  useEffect(() => {
    const handler = (e) => {
      if (connDropdownRef.current && !connDropdownRef.current.contains(e.target)) setConnDropdownOpen(false);
      if (resourceDropdownRef.current && !resourceDropdownRef.current.contains(e.target)) setResourceDropdownOpen(false);
      if (convDropdownRef.current && !convDropdownRef.current.contains(e.target)) {
        setConvDropdownOpen(false);
        setConvSearchQuery('');
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target)) setMobileMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (convDropdownOpen) {
      requestAnimationFrame(() => convSearchRef.current?.focus());
    }
  }, [convDropdownOpen]);

  useEffect(() => {
    setEditingTitle(false);
  }, [askActiveConversationId]);

  // ── Derived state ─────────────────────────────────────────

  const wsHasConnection = askWorkspaceConnections.length > 0;

  const activeWsConn = askWorkspaceConnections.find(c => c.connection_id === askActiveConnectionId);

  const filteredViews = useMemo(() => {
    if (!activeWsConn) return [];
    return askWorkspaceViews.filter(v => v.workspace_connection_id === activeWsConn.id);
  }, [askWorkspaceViews, activeWsConn?.id]);

  const resources = filteredViews;
  const activeFqn = askActiveViewFqn;
  const setActiveFqn = setAskActiveViewFqn;
  const hasResource = !!activeFqn && resources.some(r => r.semantic_view_fqn === activeFqn);

  useEffect(() => {
    if (!hasResource && resources.length > 0) {
      setActiveFqn(resources[0].semantic_view_fqn);
    }
  }, [askActiveConnectionId, resources.length]);

  const activeConv = askConversations.find(c => c.id === askActiveConversationId);
  const chatTitle = activeConv?.title
    || (askMessages.length > 0 ? askMessages[0].content : '');

  const filteredConversations = useMemo(() => {
    if (!convSearchQuery.trim()) return askConversations;
    const q = convSearchQuery.toLowerCase();
    return askConversations.filter(c => c.title?.toLowerCase().includes(q));
  }, [askConversations, convSearchQuery]);

  const hasMessages = askMessages.length > 0;
  const isConnected = wsHasConnection && !!askActiveConnectionId;

  const activeResourceObj = askWorkspaceViews.find(v => v.semantic_view_fqn === askActiveViewFqn);
  const rawSampleQ = activeResourceObj?.sample_questions;
  const sampleQuestions = Array.isArray(rawSampleQ)
    ? rawSampleQ
    : (typeof rawSampleQ === 'string' ? (() => { try { return JSON.parse(rawSampleQ); } catch { return []; } })() : []);

  const emptyTitle = 'Hi there';
  const emptySubtitle = !isConnected
    ? 'No connection configured. Assign a connection to this workspace first.'
    : !hasResource
      ? 'Select a semantic view above to start chatting.'
      : 'What would you like to explore?';
  const placeholder = hasResource
    ? `Ask about ${activeWorkspace?.name ?? ''}...`
    : 'Select a semantic view to start';

  // ── Handlers ──────────────────────────────────────────────

  const handleSelectConnection = (connId) => {
    setAskActiveConnectionId(connId);
    setConnDropdownOpen(false);
  };

  const handleSelectResource = (fqn) => {
    setActiveFqn(fqn);
    setResourceDropdownOpen(false);
  };

  const handleNewConversation = () => {
    setAskActiveConversation(null, []);
    setConvDropdownOpen(false);
    setConvSearchQuery('');
  };

  const handleSelectConversation = async (conv) => {
    if (askIsStreaming || conv.id === askActiveConversationId) return;
    try {
      const res = await askApi.getConversation(conv.id);
      setAskActiveConversation(conv.id, res.messages || []);
    } catch (err) {
      console.error('Failed to load conversation:', err);
    }
    setConvDropdownOpen(false);
    setConvSearchQuery('');
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();
    try {
      await askApi.deleteConversation(id);
      removeAskConversation(id);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleTitleClick = () => {
    if (!askActiveConversationId || askIsStreaming) return;
    setTitleDraft(chatTitle);
    setEditingTitle(true);
    requestAnimationFrame(() => titleInputRef.current?.select());
  };

  const commitTitleEdit = async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === chatTitle || !askActiveConversationId) return;
    renameAskConversation(askActiveConversationId, trimmed);
    try {
      await askApi.updateConversation(askActiveConversationId, { title: trimmed });
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  };

  const handleTitleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitleEdit();
    } else if (e.key === 'Escape') {
      setEditingTitle(false);
    }
  };

  const handleSend = useCallback(async (content) => {
    if (!content.trim() || askIsStreaming) return;
    if (!activeWorkspace) return;
    if (!wsHasConnection) return;

    const userMsg = { id: crypto.randomUUID(), role: 'user', content, created_at: new Date().toISOString() };
    addAskMessage(userMsg);

    const assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      artifacts: null,
      isStreaming: true,
      thinking: '',
      currentStatus: '',
      phase: 'waiting',
      created_at: new Date().toISOString(),
    };
    addAskMessage(assistantMsg);
    setAskStreaming(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      await streamAskChat(
        {
          conversationId: askActiveConversationId || undefined,
          content,
          connectionId: askActiveConnectionId || undefined,
          workspaceId: activeWorkspace?.id,
          semanticView: askActiveViewFqn,
        },
        (eventType, data) => {
          switch (eventType) {
            case 'response.conversation_id':
              if (data?.conversationId) {
                setAskActiveConversation(data.conversationId, undefined);
              }
              break;

            case 'response.status': {
              const statusText = data?.message || data?.status || 'Processing...';
              updateLastAskAssistantMessage(m => ({
                ...m,
                currentStatus: statusText,
                thinking: m.currentStatus !== statusText ? '' : m.thinking,
                phase: data?.status === 'proceeding_to_answer' ? 'answering' : 'thinking',
              }));
              break;
            }

            case 'response.thinking.delta':
              updateLastAskAssistantMessage(m => ({
                ...m,
                thinking: (m.thinking || '') + (data?.text || ''),
                phase: 'thinking',
              }));
              break;

            case 'response.thinking':
              updateLastAskAssistantMessage(m => ({
                ...m,
                thinking: data?.text || m.thinking,
                phase: 'thinking',
              }));
              break;

            case 'response.text.delta':
              if (data?.text) {
                updateLastAskAssistantMessage(m => ({
                  ...m,
                  content: (m.content || '') + data.text,
                  phase: 'answering',
                }));
              }
              break;

            case 'response.text':
              if (data?.text) {
                updateLastAskAssistantMessage(m => {
                  if (!m.content) {
                    return { ...m, content: data.text, phase: 'answering' };
                  }
                  return { ...m, phase: 'answering' };
                });
              }
              break;

            case 'response':
              if (data?.content) {
                const textContent = data.content
                  .filter(c => c.type === 'text')
                  .map(c => c.text)
                  .join('\n');
                if (textContent) {
                  updateLastAskAssistantMessage(m => ({
                    ...m,
                    content: m.content || textContent,
                    isStreaming: false,
                    phase: 'done',
                  }));
                }
              }
              break;

            case 'response.tool_step':
              updateLastAskAssistantMessage(m => ({
                ...m,
                currentStatus: data?.thinking
                  ? `Using ${data.tool}: ${data.thinking}`
                  : `Querying data with ${data?.tool}...`,
                phase: 'thinking',
              }));
              break;

            case 'response.artifact':
              if (data?.updateWidgetId) {
                updateLastAskAssistantMessage(m => {
                  const allMsgs = useAppStore.getState().askMessages;
                  const updatedMsgs = allMsgs.map(msg => {
                    if (!msg.artifacts || msg.role !== 'assistant') return msg;
                    const updatedArts = msg.artifacts.map(a =>
                      a.type === 'widget' && a.widget?.id === data.updateWidgetId
                        ? { ...data, updateWidgetId: undefined }
                        : a
                    );
                    return { ...msg, artifacts: updatedArts };
                  });
                  useAppStore.setState({ askMessages: updatedMsgs });
                  return m;
                });
              } else {
                updateLastAskAssistantMessage(m => ({
                  ...m,
                  artifacts: [...(Array.isArray(m.artifacts) ? m.artifacts : m.artifacts ? [m.artifacts] : []), data],
                }));
              }
              break;

            case 'response.done':
              break;

            case 'error':
              updateLastAskAssistantMessage(m => ({
                ...m,
                content: m.content || `Error: ${typeof data === 'object' ? data.error : data}`,
                phase: 'done',
              }));
              break;

            default:
              break;
          }
        },
        abortController.signal,
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        updateLastAskAssistantMessage(m => ({ ...m, content: m.content || `Error: ${err.message}` }));
      }
    } finally {
      setAskStreaming(false);
      updateLastAskAssistantMessage(m => ({ ...m, isStreaming: false, phase: 'done' }));
      abortRef.current = null;
      askApi.listConversations(activeWorkspace?.id, 'semantic')
        .then(res => setAskConversations(res.conversations || []))
        .catch(console.error);
    }
  }, [askActiveConversationId, wsHasConnection, askIsStreaming, activeWorkspace?.id, askActiveConnectionId, askActiveViewFqn]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="ask-layout">
      <div className="ask-main">
        {/* Session bar */}
        <div className="ask-session-bar">
          <div className="ask-session-left">
            <button
              className="ask-back-btn"
              onClick={() => navigate(activeWorkspace ? `/workspaces/${activeWorkspace.id}` : '/workspaces')}
              title="Back to workspace"
            >
              <FiArrowLeft />
            </button>

            {/* Conversations dropdown */}
            <div className="ask-conv-dropdown-wrap" ref={convDropdownRef}>
              <button
                className="ask-conv-dropdown-btn"
                onClick={() => setConvDropdownOpen(o => !o)}
                disabled={!activeWorkspace}
                title="Conversations"
              >
                <FiMessageSquare />
                <FiChevronDown className={`ask-session-chevron ${convDropdownOpen ? 'open' : ''}`} />
              </button>

              {convDropdownOpen && (
                <div className="ask-conv-popover">
                  <div className="ask-conv-popover-search">
                    <FiSearch className="ask-conv-popover-search-icon" />
                    <input
                      ref={convSearchRef}
                      className="ask-conv-popover-search-input"
                      type="text"
                      placeholder="Search conversations..."
                      value={convSearchQuery}
                      onChange={e => setConvSearchQuery(e.target.value)}
                    />
                  </div>

                  <div className="ask-conv-popover-list">
                    {convsLoading && (
                      <p className="ask-conv-popover-empty">Loading...</p>
                    )}
                    {!convsLoading && filteredConversations.length === 0 && (
                      <p className="ask-conv-popover-empty">
                        {convSearchQuery ? 'No matches' : 'No conversations yet'}
                      </p>
                    )}
                    {filteredConversations.map(conv => (
                      <div
                        key={conv.id}
                        onClick={() => handleSelectConversation(conv)}
                        className={`ask-conv-popover-item ${conv.id === askActiveConversationId ? 'active' : ''}`}
                      >
                        <span className="ask-conv-popover-item-title">{conv.title}</span>
                        <button
                          onClick={(e) => handleDeleteConversation(e, conv.id)}
                          className="ask-conv-popover-item-delete"
                          title="Delete"
                        >
                          <FiTrash2 />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <span className="ask-session-divider" />

            {/* Chat title */}
            {hasMessages ? (
              editingTitle ? (
                <input
                  ref={titleInputRef}
                  className="ask-session-title-input"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={commitTitleEdit}
                  onKeyDown={handleTitleKeyDown}
                  maxLength={120}
                  autoFocus
                />
              ) : (
                <span
                  className="ask-session-title"
                  onClick={handleTitleClick}
                  title={chatTitle || ''}
                >
                  {chatTitle || 'New chat'}
                </span>
              )
            ) : (
              <span className="ask-session-title muted">
                {activeWorkspace ? 'New chat' : 'AskAI'}
              </span>
            )}
          </div>

          <div className="ask-session-right">
            {/* ── Desktop inline controls ── */}
            <div className="ask-session-right-items">
              {activeWorkspace && (
                <>
                  <div className="ask-session-dropdown-wrap" ref={connDropdownRef}>
                    <button
                      className="ask-session-dropdown-btn"
                      onClick={() => setConnDropdownOpen(o => !o)}
                      disabled={askIsStreaming || askWorkspaceConnections.length === 0}
                      title={activeWsConn?.connection_name || 'No connection'}
                    >
                      <FiDatabase className="ask-session-dropdown-icon" />
                      <span className="ask-session-dropdown-label">
                        {activeWsConn?.connection_name || 'Connection'}
                      </span>
                      {askWorkspaceConnections.length > 1 && <FiChevronDown className={`ask-session-chevron ${connDropdownOpen ? 'open' : ''}`} />}
                    </button>
                    {connDropdownOpen && askWorkspaceConnections.length > 0 && (
                      <div className="ask-session-dropdown-menu">
                        {askWorkspaceConnections.map(c => (
                          <button
                            key={c.id}
                            className={`ask-session-dropdown-option ${c.connection_id === askActiveConnectionId ? 'active' : ''}`}
                            onClick={() => handleSelectConnection(c.connection_id)}
                            title={c.connection_account}
                          >
                            <span className="ask-session-dropdown-option-dot" />
                            <span>{c.connection_name}</span>
                            {c.connection_account && <span className="ask-session-dropdown-option-fqn">{c.connection_account}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <span className="ask-session-divider" />

                  <div className="ask-session-dropdown-wrap" ref={resourceDropdownRef}>
                    <button
                      className="ask-session-dropdown-btn"
                      onClick={() => setResourceDropdownOpen(o => !o)}
                      disabled={askIsStreaming || resources.length === 0}
                      title={activeFqn || 'No semantic view'}
                    >
                      <FiLayers className="ask-session-dropdown-icon" />
                      <span className="ask-session-dropdown-label">
                        {activeFqn ? shortName(activeFqn) : 'Semantic View'}
                      </span>
                      {resources.length > 1 && <FiChevronDown className={`ask-session-chevron ${resourceDropdownOpen ? 'open' : ''}`} />}
                    </button>
                    {resourceDropdownOpen && resources.length > 0 && (
                      <div className="ask-session-dropdown-menu">
                        {resources.map(r => {
                          const fqn = r.semantic_view_fqn;
                          return (
                            <button
                              key={r.id}
                              className={`ask-session-dropdown-option ${fqn === activeFqn ? 'active' : ''}`}
                              onClick={() => handleSelectResource(fqn)}
                              title={fqn}
                            >
                              <span className="ask-session-dropdown-option-dot" />
                              <span>{shortName(fqn)}</span>
                              <span className="ask-session-dropdown-option-fqn">{fqn}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <span className="ask-session-divider" />

                  <button
                    className="ask-new-conv-icon-btn"
                    onClick={handleNewConversation}
                    disabled={askIsStreaming || !activeWorkspace}
                    title="New conversation"
                  >
                    <FiPlus />
                  </button>
                </>
              )}

            </div>

            {/* ── Mobile hamburger ── */}
            <div className="ask-mobile-menu-wrap" ref={mobileMenuRef}>
              <button
                className="ask-mobile-menu-btn"
                onClick={() => setMobileMenuOpen(o => !o)}
                title="Menu"
              >
                <FiMenu />
              </button>

              {mobileMenuOpen && activeWorkspace && (
                <div className="ask-mobile-menu">
                  <div className="ask-mobile-menu-section">
                    <span className="ask-mobile-menu-label">Connection</span>
                    {askWorkspaceConnections.map(c => (
                      <button
                        key={c.id}
                        className={`ask-mobile-menu-option ${c.connection_id === askActiveConnectionId ? 'active' : ''}`}
                        onClick={() => { handleSelectConnection(c.connection_id); setMobileMenuOpen(false); }}
                      >
                        <FiDatabase className="ask-session-dropdown-icon" />
                        <span>{c.connection_name}</span>
                      </button>
                    ))}
                    {askWorkspaceConnections.length === 0 && (
                      <span className="ask-mobile-menu-empty">No connections</span>
                    )}
                  </div>

                  <div className="ask-mobile-menu-section">
                    <span className="ask-mobile-menu-label">Semantic View</span>
                    {resources.map(r => {
                      const fqn = r.semantic_view_fqn;
                      return (
                        <button
                          key={r.id}
                          className={`ask-mobile-menu-option ${fqn === activeFqn ? 'active' : ''}`}
                          onClick={() => { handleSelectResource(fqn); setMobileMenuOpen(false); }}
                        >
                          <FiLayers className="ask-session-dropdown-icon" />
                          <span>{shortName(fqn)}</span>
                        </button>
                      );
                    })}
                    {resources.length === 0 && (
                      <span className="ask-mobile-menu-empty">None assigned</span>
                    )}
                  </div>

                  <div className="ask-mobile-menu-actions">
                    <button
                      className="ask-mobile-menu-action"
                      onClick={() => { handleNewConversation(); setMobileMenuOpen(false); }}
                      disabled={askIsStreaming}
                    >
                      <FiPlus /> New Conversation
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ask-messages">
          {!hasMessages ? (
            <div className="ask-empty">
              <div className="ask-empty-icon-wrap">
                <HiSparkles className="ask-empty-icon" />
              </div>
              {!activeWorkspace ? (
                <>
                  <h2>Welcome to AskAI</h2>
                  <p className="ask-empty-subtitle">Select a workspace to start chatting</p>
                </>
              ) : (
                <>
                  <h2>{emptyTitle}</h2>
                  <p className="ask-empty-subtitle">{emptySubtitle}</p>

                  <div className="ask-empty-input-wrap">
                    <ChatInput
                      onSend={handleSend}
                      disabled={askIsStreaming || !isConnected || !hasResource}
                      placeholder={placeholder}
                      onStop={() => abortRef.current?.abort()}
                      isStreaming={askIsStreaming}
                    />
                  </div>

                  <div className="ask-chips">
                    {hasResource && sampleQuestions.filter(q => q.trim()).map((prompt, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(prompt)}
                        disabled={!isConnected}
                        className="ask-chip"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="ask-messages-container">
              {askMessages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} connectionId={askActiveConnectionId} />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {hasMessages && activeWorkspace && (
          <div className="ask-input-area">
            <div className="ask-input-inner">
              <ChatInput
                onSend={handleSend}
                disabled={askIsStreaming || !isConnected || !hasResource}
                placeholder={placeholder}
                onStop={() => abortRef.current?.abort()}
                isStreaming={askIsStreaming}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
