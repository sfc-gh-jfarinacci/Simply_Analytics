import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FiX, FiSend, FiLoader, FiAlertCircle, FiTrash2 } from 'react-icons/fi';
import { HiSparkles } from 'react-icons/hi2';
import { BsStars } from 'react-icons/bs';
import { streamAgentChat } from '../api/modules/askApi';
import '../styles/CortexAgentChat.css';

function ThinkingBlock({ thinking, currentStatus, isActive }) {
  const [fadingOut, setFadingOut] = useState(false);
  const [gone, setGone] = useState(false);
  const contentRef = useRef(null);
  const prevActive = useRef(isActive);

  useEffect(() => {
    if (prevActive.current && !isActive && !fadingOut) {
      setFadingOut(true);
      const timer = setTimeout(() => setGone(true), 350);
      return () => clearTimeout(timer);
    }
    prevActive.current = isActive;
  }, [isActive, fadingOut]);

  useEffect(() => {
    if (isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [thinking, isActive]);

  if (gone) return null;

  return (
    <div className={`cortex-thinking-block cortex-thinking-active ${fadingOut ? 'cortex-thinking-fadeout' : ''}`}>
      <div className="cortex-thinking-toggle">
        <HiSparkles className="cortex-thinking-icon cortex-thinking-icon-spin" />
        <span className="cortex-thinking-title-animate" key={currentStatus}>
          {currentStatus || 'Processing...'}
        </span>
      </div>
      {thinking && !fadingOut && (
        <div className="cortex-thinking-content" ref={contentRef}>
          <div className="cortex-thinking-text">
            {thinking}
            {isActive && <span className="cortex-cursor" />}
          </div>
        </div>
      )}
    </div>
  );
}

const DashboardChat = ({ connectionId, workspaceId, semanticViews = [] }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

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
  };

  const clearChat = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  const updateLastAssistant = (updater) => {
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last && last.role === 'assistant') {
        updated[updated.length - 1] = typeof updater === 'function' ? updater(last) : { ...last, ...updater };
      }
      return updated;
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setError(null);

    const userMsg = { role: 'user', content: text, timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);

    const assistantMsg = {
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      currentStatus: '',
      thinking: '',
      phase: 'waiting',
      artifacts: [],
    };
    setMessages(prev => [...prev, assistantMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const primaryView = semanticViews.length > 0
        ? (typeof semanticViews[0] === 'object'
          ? semanticViews[0].fullyQualifiedName || semanticViews[0]
          : semanticViews[0])
        : undefined;

      await streamAgentChat(
        {
          conversationId: conversationId || undefined,
          content: text,
          connectionId,
          workspaceId,
          semanticView: primaryView,
        },
        (eventType, data) => {
          switch (eventType) {
            case 'response.conversation_id':
              if (data?.conversationId) setConversationId(data.conversationId);
              break;

            case 'response.status':
              updateLastAssistant(last => ({
                ...last,
                currentStatus: data?.message || 'Processing...',
                phase: 'thinking',
              }));
              break;

            case 'response.tool_step':
              updateLastAssistant(last => ({
                ...last,
                thinking: data?.thinking || '',
                currentStatus: data?.thinking || last.currentStatus,
                phase: 'thinking',
              }));
              break;

            case 'response.text':
              if (data?.text) {
                updateLastAssistant(last => ({
                  ...last,
                  content: data.text,
                  phase: 'answering',
                }));
              }
              break;

            case 'response.artifact':
              updateLastAssistant(last => ({
                ...last,
                artifacts: [...(last.artifacts || []), data],
              }));
              break;

            case 'response.done':
              updateLastAssistant(last => ({
                ...last,
                isStreaming: false,
                phase: 'done',
              }));
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
      setIsStreaming(false);
      updateLastAssistant(last => ({
        ...last,
        isStreaming: false,
        phase: 'done',
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

  const renderMarkdown = (text) => {
    if (!text) return null;
    const lines = text.split('\n');
    const elements = [];
    let key = 0;

    const parseInline = (line) => {
      const parts = [];
      const inlineRe = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*(.+?)\*\*)|(https?:\/\/[^\s)]+)/g;
      let lastIdx = 0;
      let match;

      while ((match = inlineRe.exec(line)) !== null) {
        if (match.index > lastIdx) parts.push(line.slice(lastIdx, match.index));
        if (match[1]) {
          parts.push(<a key={`l${match.index}`} href={match[3]} target="_blank" rel="noopener noreferrer" className="cortex-link">{match[2]}</a>);
        } else if (match[4]) {
          parts.push(<strong key={`b${match.index}`}>{match[5]}</strong>);
        } else if (match[6]) {
          parts.push(<a key={`u${match.index}`} href={match[6]} target="_blank" rel="noopener noreferrer" className="cortex-link">{match[6]}</a>);
        }
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < line.length) parts.push(line.slice(lastIdx));
      return parts.length > 0 ? parts : [line];
    };

    lines.forEach((line, i) => {
      if (i > 0) elements.push(<br key={`br${key++}`} />);
      parseInline(line).forEach(part => {
        elements.push(<React.Fragment key={`f${key++}`}>{part}</React.Fragment>);
      });
    });

    return elements;
  };

  const renderAssistantContent = (msg) => {
    const { content, thinking, currentStatus, phase, isStreaming: streaming } = msg;
    const isThinking = streaming && (phase === 'thinking' || phase === 'waiting');
    const hasThinkingContent = !!(thinking || currentStatus);
    const showAnswer = !!content || phase === 'answering' || phase === 'done';

    if (!showAnswer && !hasThinkingContent) {
      return (
        <span className="cortex-typing-indicator">
          <span /><span /><span />
        </span>
      );
    }

    return (
      <div>
        {hasThinkingContent && phase !== 'done' && (
          <ThinkingBlock thinking={thinking} currentStatus={currentStatus} isActive={isThinking} />
        )}
        {showAnswer && (
          <div className="cortex-msg-text cortex-answer-fadein">
            {renderMarkdown((content || '').trimStart())}
            {streaming && <span className="cortex-cursor" />}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) {
    return (
      <button className="cortex-chat-fab" onClick={toggleOpen} title="Simply">
        <HiSparkles className="fab-icon" />
      </button>
    );
  }

  const viewName = semanticViews.length > 0
    ? (typeof semanticViews[0] === 'object'
      ? semanticViews[0].name || semanticViews[0].fullyQualifiedName?.split('.').pop()
      : semanticViews[0].split('.').pop())
    : 'Data';

  return (
    <div className="cortex-chat-panel">
      <div className="cortex-chat-header">
        <div className="cortex-chat-header-left">
          <HiSparkles className="cortex-chat-logo" />
          <span className="cortex-chat-title">Simply</span>
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

      <div className="cortex-chat-messages">
        {messages.length === 0 ? (
          <div className="cortex-chat-welcome">
            <div className="cortex-welcome-icon">
              <BsStars className="cortex-welcome-stars" />
            </div>
            <h3 className="cortex-welcome-gradient">Simply</h3>
            <p className="cortex-welcome-sub">Ask questions about your {viewName} data and get AI-powered answers with charts.</p>
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

      <div className="cortex-chat-input-area">
        <div className={`cortex-input-wrapper ${isStreaming ? 'cortex-input-streaming' : ''}`}>
          <textarea
            ref={inputRef}
            className="cortex-chat-input"
            placeholder={`Ask Simply about your ${viewName} data...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming}
            rows={1}
          />
        </div>
        <button
          className="cortex-chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          title="Send"
        >
          {isStreaming ? <FiLoader className="cortex-spin" /> : <FiSend />}
        </button>
      </div>
    </div>
  );
};

export default DashboardChat;
