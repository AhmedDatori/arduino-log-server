import React, { useState, useEffect, useRef } from 'react';
import { fetchConversations, deleteConversations, sendChatMessage } from '../api';
import './ChatView.css';

const HINTS = [
  'How is my plant doing?',
  'Is the soil too dry?',
  'Should I turn on the pump?',
  'What is the temperature trend?',
];

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

function Message({ role, content, time }) {
  const isUser = role === 'user';
  // Safely render newlines as line breaks
  const lines = content.split('\n');

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
      {time && (
        <div className="msg-time">
          {new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

export default function ChatView() {
  const [messages, setMessages] = useState([]);
  const [input,    setInput]    = useState('');
  const [sending,  setSending]  = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    fetchConversations()
      .then(setMessages)
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
    }]);

    try {
      const res = await sendChatMessage(msg);
      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    res.error || res.response || 'No response received.',
        created_at: new Date().toISOString(),
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role:       'assistant',
        content:    `Error: ${err.message}`,
        created_at: new Date().toISOString(),
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

      <div className="chat-messages">
        {showEmpty && (
          <div className="chat-empty">
            <div className="chat-empty-icon">🤖</div>
            <p>Ask me anything about your plant</p>
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
          <Message key={i} role={msg.role} content={msg.content} time={msg.created_at} />
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
          placeholder="Ask about your plant..."
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
