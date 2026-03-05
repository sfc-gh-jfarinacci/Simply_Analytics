import React, { useState, useEffect } from 'react';
import { FiClock, FiX } from 'react-icons/fi';
import { keepSessionAlive } from '../api/apiClient';
import './SessionWarning.css';

const SessionWarning = ({ timeRemaining, onKeepAlive, onSignOut }) => {
  const [countdown, setCountdown] = useState(Math.floor(timeRemaining / 1000));

  useEffect(() => {
    setCountdown(Math.floor(timeRemaining / 1000));
    
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeRemaining]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleKeepAlive = async () => {
    try {
      await keepSessionAlive();
      onKeepAlive?.();
    } catch (error) {
      console.error('Failed to keep session alive:', error);
    }
  };

  if (countdown <= 0) return null;

  return (
    <div className="session-warning-overlay">
      <div className="session-warning-modal">
        <div className="session-warning-icon">
          <FiClock />
        </div>
        <h3>Session Expiring Soon</h3>
        <p>Your session will expire in</p>
        <div className="countdown">{formatTime(countdown)}</div>
        <p className="warning-text">
          Click "Keep me signed in" to continue working, or your session will end automatically.
        </p>
        <div className="session-warning-actions">
          <button className="btn btn-secondary" onClick={onSignOut}>
            Sign Out
          </button>
          <button className="btn btn-primary" onClick={handleKeepAlive}>
            Keep me signed in
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionWarning;
