import React, { useEffect, useRef, useState } from 'react';
import { APP_SECTIONS } from '../appSections';
import './Header.css';

export default function Header({ tab, onTabChange, onRefresh, unreadCount }) {
  const navRef = useRef(null);
  const [barStyle, setBarStyle] = useState({ width: 0, transform: 'translateX(0px)' });

  useEffect(() => {
    const nav = navRef.current;
    const activeTab = nav?.querySelector(`[data-tab="${tab}"]`);
    if (!nav || !activeTab) return;

    const navBox = nav.getBoundingClientRect();
    const tabBox = activeTab.getBoundingClientRect();

    setBarStyle({
      width: `${tabBox.width}px`,
      transform: `translateX(${tabBox.left - navBox.left}px)`,
    });
  }, [tab]);

  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo" aria-label="Smart Green House">
          <svg viewBox="0 0 24 24" fill="none" width="26" height="26" aria-hidden="true">
            <path d="M12 22C12 22 4 16 4 9a7 7 0 0 1 10.9-5.8" stroke="#3dffa0" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M12 22C12 22 20 16 20 9a7 7 0 0 0-3-5.8" stroke="#3dffa0" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M12 22V11" stroke="#3dffa0" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span>SMART<em>.</em>GREEN HOUSE</span>
        </div>

        <nav className="tabs" ref={navRef} aria-label="Main sections">
          {APP_SECTIONS.map(section => (
            <button
              key={section.id}
              data-tab={section.id}
              className={`tab ${tab === section.id ? 'active' : ''}`}
              onClick={() => onTabChange(section.id)}
            >
              {section.label}
              {section.id === 'alerts' && unreadCount > 0 && (
                <span className="tab-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          ))}
          <div className="tab-bar" style={barStyle} />
        </nav>

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
            !
            {unreadCount > 0 && (
              <span className="notif-dot">{unreadCount > 9 ? '9+' : unreadCount}</span>
            )}
          </button>
          <button className="icon-btn" onClick={onRefresh} title="Refresh">R</button>
        </div>
      </div>
    </header>
  );
}
