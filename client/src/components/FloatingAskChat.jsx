import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HiSparkles } from 'react-icons/hi2';
import {
  FiX, FiSend, FiLoader, FiMessageSquare, FiTrash2,
  FiChevronDown, FiAlertCircle,
} from 'react-icons/fi';
import { streamAskChat } from '../api/modules/askApi';
import { useAppStore } from '../store/appStore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import '../styles/FloatingAskChat.css';

function ThinkingIndicator({ status }) {
  if (!status) return null;
  return (
    <div className="fac-thinking">
      <HiSparkles className="fac-thinking-icon" />
      <span className="fac-thinking-text">{status}</span>
    </div>
  );
}

export default function FloatingAskChat() {
  const { activeWorkspace, currentDashboard } = useAppStore();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const connectionId = currentDashboard?.connection_id;
  const workspaceId = activeWorkspace?.id;

  const semanticView = currentDashboard?.semanticViewsReferenced?.[0]?.fullyQualifiedName || null;

  const handleSend = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || isStreaming) return;
    if (!workspaceId) return;

    const userMsg = { id: crypto.randomUUID(), role: 'user', content };
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
      status: 'Thinking...',
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsStreaming(true);

    const assistantId = assistantMsg.id;
    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      await streamAskChat(
        {
          conversationId: conversationId || undefined,
          content,
          connectionId: connectionId || undefined,
          workspaceId,
          semanticView: semanticView || undefined,
        },
        (eventType, data) => {
          switch (eventType) {
            case 'response.conversation_id':
              if (data?.conversationId) setConversationId(data.conversationId);
              break;

            case 'response.status':
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, status: data?.message || 'Processing...' } : m
              ));
              break;

            case 'response.tool_step':
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  status: data?.thinking || `Querying data with ${data?.tool}...`,
                } : m
              ));
              break;

            case 'response.text.delta':
              if (data?.text) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: (m.content || '') + data.text } : m
                ));
              }
              break;

            case 'response.text':
              if (data?.text) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId && !m.content ? { ...m, content: data.text } : m
                ));
              }
              break;

            case 'response.done':
              break;

            case 'error':
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  content: m.content || `Error: ${typeof data === 'object' ? data.error : data}`,
                  isStreaming: false,
                  status: null,
                  isError: true,
                } : m
              ));
              break;

            default:
              break;
          }
        },
        abortController.signal,
      );

      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, isStreaming: false, status: null } : m
      ));
    } catch (err) {
      if (err.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? {
            ...m,
            content: m.content || err.message || 'Something went wrong',
            isStreaming: false,
            status: null,
            isError: true,
          } : m
        ));
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, conversationId, connectionId, workspaceId, semanticView]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClear = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setConversationId(null);
    setIsStreaming(false);
  };

  if (!workspaceId || !connectionId) return null;

  return createPortal(
    <>
      {!isOpen && (
        <button
          className="fac-fab"
          onClick={() => setIsOpen(true)}
          title="Ask about your data"
        >
          <HiSparkles className="fac-fab-icon" />
        </button>
      )}

      {isOpen && (
        <div className="fac-popup">
          <div className="fac-header">
            <div className="fac-header-left">
              <HiSparkles className="fac-header-icon" />
              <span className="fac-header-title">Ask AI</span>
            </div>
            <div className="fac-header-actions">
              {messages.length > 0 && (
                <button className="fac-header-btn" onClick={handleClear} title="Clear chat">
                  <FiTrash2 />
                </button>
              )}
              <button className="fac-header-btn" onClick={() => setIsOpen(false)} title="Minimize">
                <FiChevronDown />
              </button>
              <button className="fac-header-btn" onClick={() => { setIsOpen(false); handleClear(); }} title="Close">
                <FiX />
              </button>
            </div>
          </div>

          <div className="fac-messages">
            {messages.length === 0 && (
              <div className="fac-empty">
                <FiMessageSquare className="fac-empty-icon" />
                <p>Ask questions about your data</p>
                <p className="fac-empty-hint">
                  Powered by your semantic views
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} className={`fac-msg fac-msg-${msg.role}${msg.isError ? ' fac-msg-error' : ''}`}>
                {msg.role === 'assistant' && msg.isStreaming && !msg.content && (
                  <ThinkingIndicator status={msg.status} />
                )}
                {msg.content && (
                  <div className="fac-msg-content">
                    {msg.role === 'assistant' ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                )}
                {msg.role === 'assistant' && msg.isStreaming && msg.content && (
                  <ThinkingIndicator status={msg.status} />
                )}
              </div>
            ))}

            <div ref={messagesEndRef} />
          </div>

          <div className="fac-input-bar">
            <textarea
              ref={inputRef}
              className="fac-input"
              placeholder="Ask about your data..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isStreaming}
            />
            <button
              className="fac-send"
              onClick={() => handleSend()}
              disabled={!input.trim() || isStreaming}
            >
              {isStreaming ? <FiLoader className="fac-spinner" /> : <FiSend />}
            </button>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
