import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FiX, FiSend, FiLoader, FiAlertCircle, FiTrash2 } from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi2';
import { BsStars } from 'react-icons/bs';
import { sfConnectionApi } from '../api/apiClient';
import './CortexAgentChat.css';

const CortexAgentChat = ({ connectionId, cortexAgents = [], role, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const typeBufferRef = useRef('');
  const typeTimerRef = useRef(null);

  useEffect(() => {
    if (cortexAgents.length >= 1 && !selectedAgent) {
      const fqn = typeof cortexAgents[0] === 'object' ? cortexAgents[0].fullyQualifiedName : cortexAgents[0];
      setSelectedAgent(fqn);
    }
  }, [cortexAgents, selectedAgent]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const toggleOpen = () => {
    setIsOpen(prev => !prev);
    setError(null);
  };

  const handleClose = () => {
    if (isStreaming && abortRef.current) {
      abortRef.current.abort();
    }
    setIsOpen(false);
    if (onClose) onClose();
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const switchAgent = (fqn) => {
    if (fqn === selectedAgent || isStreaming) return;
    setSelectedAgent(fqn);
    setMessages([]);
    setError(null);
  };

  const drainWord = useCallback(() => {
    if (typeBufferRef.current.length === 0) {
      typeTimerRef.current = null;
      return;
    }

    // Pull next word (split on whitespace boundaries, keep the space with the word)
    const match = typeBufferRef.current.match(/^\S+\s?/);
    const word = match ? match[0] : typeBufferRef.current;
    typeBufferRef.current = typeBufferRef.current.slice(word.length);

    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === 'assistant') {
        updated[updated.length - 1] = { ...last, content: last.content + word };
      }
      return updated;
    });

    // Vary the delay slightly for a natural feel
    const delay = 25 + Math.random() * 20;
    typeTimerRef.current = setTimeout(drainWord, delay);
  }, []);

  const enqueueText = useCallback((text) => {
    typeBufferRef.current += text;
    if (!typeTimerRef.current) {
      drainWord();
    }
  }, [drainWord]);

  const flushTypeBuffer = useCallback(() => {
    if (typeTimerRef.current) {
      clearTimeout(typeTimerRef.current);
      typeTimerRef.current = null;
    }
    if (typeBufferRef.current.length > 0) {
      const remaining = typeBufferRef.current;
      typeBufferRef.current = '';
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: last.content + remaining };
        }
        return updated;
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (typeTimerRef.current) clearTimeout(typeTimerRef.current);
    };
  }, []);

  const updateLastAssistant = (updater) => {
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === 'assistant') {
        updated[updated.length - 1] = updater(last);
      }
      return updated;
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming || !selectedAgent) return;

    setInput('');
    setError(null);

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    const assistantMsg = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      status: null,
      thinking: '',
      phase: 'waiting',
    };
    setMessages(prev => [...prev, assistantMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const apiMessages = [...messages.filter(m => !m.isStreaming), userMsg].map(m => ({
        role: m.role,
        content: [{ type: 'text', text: m.content }],
      }));

      await sfConnectionApi.cortexAgentRun(
        {
          connectionId,
          agentFqn: selectedAgent,
          messages: apiMessages,
          role,
        },
        (eventType, data) => {
          switch (eventType) {
            case 'response.status':
              updateLastAssistant(last => ({
                ...last,
                status: data?.message || data?.status || 'Processing...',
                phase: data?.status === 'proceeding_to_answer' ? 'answering' : 'thinking',
              }));
              break;

            case 'response.thinking.delta':
              updateLastAssistant(last => ({
                ...last,
                thinking: (last.thinking || '') + (data?.text || ''),
                phase: 'thinking',
              }));
              break;

            case 'response.thinking':
              updateLastAssistant(last => ({
                ...last,
                thinking: data?.text || last.thinking,
                phase: 'thinking',
              }));
              break;

            case 'response.text.delta':
              if (data?.text) {
                updateLastAssistant(last => ({
                  ...last,
                  phase: 'answering',
                  status: null,
                }));
                enqueueText(data.text);
              }
              break;

            case 'response.text':
              if (data?.text) {
                updateLastAssistant(last => {
                  if (!last.content && !typeBufferRef.current) {
                    return { ...last, content: data.text, phase: 'answering', status: null };
                  }
                  return { ...last, phase: 'answering', status: null };
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
                  flushTypeBuffer();
                  updateLastAssistant(last => ({
                    ...last,
                    content: last.content || textContent,
                    isStreaming: false,
                    phase: 'done',
                    status: null,
                  }));
                }
              }
              break;

            case 'error':
              setError(typeof data === 'object' ? data.error : String(data));
              break;

            default:
              break;
          }
        },
        abortController.signal,
      );
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    } finally {
      flushTypeBuffer();
      setIsStreaming(false);
      updateLastAssistant(last => ({
        ...last,
        isStreaming: false,
        phase: 'done',
        status: null,
      }));
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const agentDisplayName = (fqn) => {
    if (!fqn) return '';
    const parts = fqn.split('.');
    return parts[parts.length - 1];
  };

  const renderMarkdown = (text) => {
    if (!text) return null;

    // Split into lines for block-level processing
    const lines = text.split('\n');
    const elements = [];
    let key = 0;

    const parseInline = (line) => {
      // Process inline patterns: **bold**, [text](url), raw URLs
      const parts = [];
      // Combined regex: markdown links, bold, or standalone URLs
      const inlineRe = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*(.+?)\*\*)|(https?:\/\/[^\s)]+)/g;
      let lastIdx = 0;
      let match;

      while ((match = inlineRe.exec(line)) !== null) {
        if (match.index > lastIdx) {
          parts.push(line.slice(lastIdx, match.index));
        }
        if (match[1]) {
          // Markdown link [text](url)
          parts.push(
            <a key={`l${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer" className="cortex-link">{match[2]}</a>
          );
        } else if (match[4]) {
          // Bold **text**
          parts.push(<strong key={`b${match.index}`}>{match[5]}</strong>);
        } else if (match[6]) {
          // Raw URL
          parts.push(
            <a key={`u${match.index}`} href={match[6]} target="_blank" rel="noopener noreferrer" className="cortex-link">{match[6]}</a>
          );
        }
        lastIdx = match.index + match[0].length;
      }

      if (lastIdx < line.length) {
        parts.push(line.slice(lastIdx));
      }

      return parts.length > 0 ? parts : [line];
    };

    lines.forEach((line, i) => {
      if (i > 0) elements.push(<br key={`br${key++}`} />);
      const inline = parseInline(line);
      inline.forEach(part => {
        elements.push(<React.Fragment key={`f${key++}`}>{part}</React.Fragment>);
      });
    });

    return elements;
  };

  const renderAssistantContent = (msg) => {
    const { content, status, phase, isStreaming: streaming } = msg;

    if (streaming && !content && phase !== 'answering') {
      if (!status) {
        return (
          <span className="cortex-typing-indicator">
            <span /><span /><span />
          </span>
        );
      }
      return (
        <div className="cortex-shimmer-wrap">
          <div className="cortex-shimmer-status" key={status}>
            <HiSparkles className="cortex-shimmer-status-icon" />
            <span>{status}</span>
          </div>
          <div className="cortex-shimmer-line cortex-shimmer-1" />
          <div className="cortex-shimmer-line cortex-shimmer-2" />
          <div className="cortex-shimmer-line cortex-shimmer-3" />
        </div>
      );
    }

    return (
      <div className="cortex-msg-text">
        {renderMarkdown((content || 'No response').trimStart())}
        {streaming && <span className="cortex-cursor" />}
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button className="cortex-chat-fab" onClick={toggleOpen} title="Cortex Agent Chat">
        <HiSparkles className="fab-icon" />
      </button>
    );
  }

  return (
    <div className="cortex-chat-panel">
      {/* Header */}
      <div className="cortex-chat-header">
        <div className="cortex-chat-header-left">
          <HiSparkles className="cortex-chat-logo" />
          <span className="cortex-chat-title">Cortex Agent</span>
        </div>
        <div className="cortex-chat-header-actions">
          <button className="cortex-chat-header-btn" onClick={clearChat} title="Clear chat">
            <FiTrash2 />
          </button>
          <button className="cortex-chat-header-btn" onClick={handleClose} title="Close">
            <FiX />
          </button>
        </div>
      </div>

      {/* Messages area */}
      <div className="cortex-chat-messages">
        {messages.length === 0 ? (
          <div className="cortex-chat-welcome">
            <div className="cortex-welcome-icon">
              <BsStars className="cortex-welcome-stars" />
            </div>
            <h3 className="cortex-welcome-gradient">Cortex Agent</h3>
            <p className="cortex-welcome-sub">Ask questions about your data and get AI-powered answers.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`cortex-chat-msg cortex-chat-msg-${msg.role}`}>
              {msg.role === 'assistant' && (
                <div className="cortex-msg-avatar">
                  <HiSparkles />
                </div>
              )}
              <div className="cortex-msg-bubble">
                {msg.role === 'assistant'
                  ? renderAssistantContent(msg)
                  : <div className="cortex-msg-text">{msg.content}</div>
                }
              </div>
            </div>
          ))
        )}
        {error && (
          <div className="cortex-chat-error">
            <FiAlertCircle />
            <span>{error}</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area with agent chips */}
      <div className="cortex-chat-input-area">
        <div className="cortex-input-wrapper">
          <textarea
            ref={inputRef}
            className="cortex-chat-input"
            placeholder={selectedAgent ? `Ask ${agentDisplayName(selectedAgent)}...` : 'Select an agent...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming || !selectedAgent}
            rows={1}
          />
          <div className="cortex-agent-chips">
            {cortexAgents.map(agent => {
              const fqn = typeof agent === 'object' ? agent.fullyQualifiedName : agent;
              const isActive = fqn === selectedAgent;
              return (
                <button
                  key={fqn}
                  className={`cortex-agent-chip ${isActive ? 'cortex-agent-chip-active' : ''}`}
                  onClick={() => switchAgent(fqn)}
                  disabled={isStreaming}
                  title={fqn}
                >
                  <HiSparkles className="cortex-chip-icon" />
                  <span>{agentDisplayName(fqn)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          className="cortex-chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming || !selectedAgent}
          title="Send"
        >
          {isStreaming ? <FiLoader className="cortex-spin" /> : <FiSend />}
        </button>
      </div>
    </div>
  );
};

export default CortexAgentChat;
