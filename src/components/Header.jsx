import React, { useRef, useEffect, useState } from 'react';
import './Header.css';

const TABS = [
  { id: 'status',  label: 'Status'   },
  { id: 'history', label: 'History'  },
  { id: 'reports', label: 'Reports'  },
  { id: 'plants',  label: 'Plants'   },
  { id: 'chat',    label: 'AI Chat'  },
  { id: 'alerts',  label: 'Alerts'   },
];

export default function Header({ tab, onTabChange, onRefresh, unreadCount }) {
  const navRef = useRef(null);
  const [barStyle, setBarStyle] = useState({ width: 0, transform: 'translateX(0px)' });

  // Slide the indicator bar under the active tab
  useEffect(() => {
    const nav    = navRef.current;
    const active = nav?.querySelector(`[data-tab="${tab}"]`);
    if (!nav || !active) return;
    const nr = nav.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    setBarStyle({
      width:     `${ar.width}px`,
      transform: `translateX(${ar.left - nr.left}px)`,
    });
  }, [tab]);

  return (
    <header className="header">
      <div className="header-inner">

        {/* Logo */}
        <div className="logo">
          <svg viewBox="0 0 24 24" fill="none" width="26" height="26">
            <path d="M12 22C12 22 4 16 4 9a7 7 0 0 1 10.9-5.8"  stroke="#3dffa0" strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M12 22C12 22 20 16 20 9a7 7 0 0 0-3-5.8"   stroke="#3dffa0" strokeWidth="1.6" strokeLinecap="round"/>
            <path d="M12 22V11"                                   stroke="#3dffa0" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          <span>PLANT<em>.</em>MONITOR</span>
        </div>

        {/* Tab navigation */}
        <nav className="tabs" ref={navRef}>
          {TABS.map(t => (
            <button
              key={t.id}
              data-tab={t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
              {t.id === 'alerts' && unreadCount > 0 && (
                <span className="tab-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          ))}
          <div className="tab-bar" style={barStyle} />
        </nav>

        {/* Right controls */}
        <div className="header-right">
          <div className="live-badge">
            <span className="pulse" />
            LIVE
          </div>
          <button
            className="icon-btn"
            onClick={() => onTabChange('alerts')}
            title="Alerts"
            style={{ position: 'relative' }}
          >
            🔔
            {unreadCount > 0 && (
              <span className="notif-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
          <button className="icon-btn" onClick={onRefresh} title="Refresh">↻</button>
        </div>

      </div>
    </header>
  );
}
