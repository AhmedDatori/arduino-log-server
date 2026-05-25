import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchConversations, deleteConversations, sendChatMessage, executeChatAction } from '../api';
import './ChatView.css';

const HINTS = [
  'How is my plant doing?',
  'Is the soil too dry?',
  'Should I turn on the pump?',
  'What is the temperature trend?',
];

const ACTION_ICONS = { pump: '💧', light: '💡', buzzer: '🔔' };
const ACTION_COLORS = { pump: '#38b2f8', light: '#f5a524', buzzer: '#ff4d6d' };

// ── Typing indicator ───────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="message ai">
      <div className="msg-role">🌿 AI</div>
      <div className="typing-bubble">
        <span /><span /><span />
      </div>
    </div>
  );
}

// ── Action block that appears below AI messages ────────────────────────────
function ActionBlock({ action, onExecuted }) {
  const [state,  setState]  = useState('idle'); // idle | confirming | running | done | error
  const [result, setResult] = useState('');

  const icon  = ACTION_ICONS[action.type]  ?? '⚡';
  const color = ACTION_COLORS[action.type] ?? '#3dffa0';

  const handleConfirm = async () => {
    setState('running');
    try {
      const res = await executeChatAction({
        type:                  action.type,
        value:                 action.value,
        pump_duration_seconds: action.pump_duration_seconds,
      });
      setResult(res.message ?? 'Action completed.');
      setState('done');
      if (onExecuted) onExecuted(res);
    } catch (err) {
      setResult(err.message);
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div className="chat-action-result done">
        <span className="chat-action-result-icon">✓</span>
        <span>{result}</span>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="chat-action-result error">
        <span className="chat-action-result-icon">✗</span>
        <span>{result}</span>
      </div>
    );
  }

  return (
    <div
      className="chat-action-block"
      style={{ '--action-color': color, '--action-bg': `${color}14`, '--action-border': `${color}3a` }}
    >
      <div className="chat-action-top">
        <span className="chat-action-icon">{icon}</span>
        <div className="chat-action-info">
          <span className="chat-action-label">AI RECOMMENDED ACTION</span>
          <span className="chat-action-name">{action.label}</span>
        </div>
      </div>

      {action.confirm_text && (
        <p className="chat-action-confirm-text">{action.confirm_text}</p>
      )}

      <div className="chat-action-buttons">
        <button
          className="chat-action-btn-run"
          style={{ background: color, color: '#060b11' }}
          onClick={handleConfirm}
          disabled={state === 'running'}
        >
          {state === 'running' ? '⟳ Running…' : `${icon} ${action.label}`}
        </button>
        <button
          className="chat-action-btn-cancel"
          onClick={() => setState('done') /* just hide it */}
          disabled={state === 'running'}
        >
          ✗ Cancel
        </button>
      </div>
    </div>
  );
}

// ── Single message bubble ──────────────────────────────────────────────────
function Message({ role, content, time, action }) {
  const isUser = role === 'user';
  const lines  = content.split('\n');

  return (
    <div className={`message ${isUser ? 'user' : 'ai'}`}>
      <div className="msg-role">{isUser ? 'You' : '🌿 AI'}</div>
      <div className="msg-bubble">
        {lines.map((line, i) => (
          <React.Fragment key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </React.Fragment>
        ))}
      </div>
      {!isUser && action && (
        <ActionBlock action={action} />
      )}
      {time && (
        <div className="msg-time">
          {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

// ── Main ChatView ──────────────────────────────────────────────────────────
export default function ChatView() {
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetchConversations()
      .then(rows => setMessages(rows.map(r => ({ ...r, action: null }))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending) return;

    setInput('');
    setSending(true);
    setMessages(prev => [...prev, {
      role:       'user',
      content:    msg,
      created_at: new Date().toISOString(),
      action:     null,
    }]);

    try {
      const res = await sendChatMessage(msg);
      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    res.error || res.response || 'No response received.',
        created_at: new Date().toISOString(),
        action:     res.action ?? null,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    `Error: ${err.message}`,
        created_at: new Date().toISOString(),
        action:     null,
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleClear = async () => {
    if (!confirm('Clear all conversations?')) return;
    await deleteConversations();
    setMessages([]);
  };

  const showEmpty = messages.length === 0 && !sending;

  return (
    <div className="view-wrap chat-view">

      <div className="view-header">
        <h2 className="section-title">🌿 AI Plant Assistant</h2>
        <button className="btn-danger" onClick={handleClear}>🗑 Clear Chat</button>
      </div>

      {/* Action capabilities hint */}
      <div className="chat-capabilities">
        <span className="chat-cap-item">💧 Run pump</span>
        <span className="chat-cap-div">·</span>
        <span className="chat-cap-item">💡 Toggle grow light</span>
        <span className="chat-cap-div">·</span>
        <span className="chat-cap-item">🔔 Toggle buzzer</span>
        <span className="chat-cap-note">Ask the AI to take action — confirm before it runs</span>
      </div>

      <div className="chat-messages">
        {showEmpty && (
          <div className="chat-empty">
            <div className="chat-empty-icon">🤖</div>
            <p>Ask me anything about your plant — or tell me to do something</p>
            <div className="hint-chips">
              {HINTS.map(hint => (
                <button key={hint} className="hint-chip" onClick={() => send(hint)}>
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <Message
            key={i}
            role={msg.role}
            content={msg.content}
            time={msg.created_at}
            action={msg.action}
          />
        ))}

        {sending && <TypingIndicator />}

        <div ref={bottomRef} />
      </div>

      <form
        className="chat-form"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about your plant, or say 'Turn on the pump'…"
          disabled={sending}
          autoComplete="off"
        />
        <button
          type="submit"
          className="chat-send"
          disabled={sending || !input.trim()}
        >
          Send ➤
        </button>
      </form>

    </div>
  );
}
