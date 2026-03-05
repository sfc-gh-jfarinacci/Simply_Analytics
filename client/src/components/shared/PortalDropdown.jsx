/**
 * PortalDropdown - Reusable dropdown rendered via portal
 * 
 * Features:
 * - Renders via createPortal to escape overflow containers
 * - Smart positioning (respects viewport bounds)
 * - Optional backdrop for click-outside handling
 * - Consistent animation and styling
 */
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './PortalDropdown.css';

const PortalDropdown = ({
  isOpen,
  onClose,
  triggerRef,
  children,
  // Positioning options
  width = 280,
  maxHeight = 400,
  align = 'left', // 'left', 'right', 'center'
  verticalAlign = 'below', // 'below', 'above', 'auto'
  offset = { x: 0, y: 6 },
  // Styling options
  className = '',
  showBackdrop = false, // Transparent backdrop for click handling
  // Animation
  animation = 'slide', // 'slide', 'fade', 'none'
}) => {
  const dropdownRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, maxHeight });

  // Calculate position based on trigger element
  const updatePosition = useCallback(() => {
    if (!triggerRef?.current) return;
    
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Horizontal positioning
    let left;
    switch (align) {
      case 'right':
        left = triggerRect.right - width;
        break;
      case 'center':
        left = triggerRect.left + (triggerRect.width / 2) - (width / 2);
        break;
      case 'left':
      default:
        left = triggerRect.left;
    }
    
    // Clamp to viewport
    left = Math.max(8, Math.min(left, viewportWidth - width - 8));
    left += offset.x;
    
    // Vertical positioning
    const spaceBelow = viewportHeight - triggerRect.bottom - 16;
    const spaceAbove = triggerRect.top - 16;
    
    let top;
    let actualMaxHeight = maxHeight;
    let openDirection = verticalAlign;
    
    if (verticalAlign === 'auto') {
      openDirection = spaceBelow >= Math.min(maxHeight, 200) ? 'below' : 'above';
    }
    
    if (openDirection === 'above') {
      actualMaxHeight = Math.min(maxHeight, spaceAbove);
      top = triggerRect.top - actualMaxHeight - offset.y;
    } else {
      actualMaxHeight = Math.min(maxHeight, spaceBelow);
      top = triggerRect.bottom + offset.y;
    }
    
    setPosition({ top, left, maxHeight: actualMaxHeight, openDirection });
  }, [triggerRef, width, maxHeight, align, verticalAlign, offset]);

  // Update position when open
  useEffect(() => {
    if (!isOpen) return;
    
    updatePosition();
    
    const handleResize = () => updatePosition();
    const handleScroll = () => updatePosition();
    
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);
    
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, updatePosition]);

  // Handle backdrop click
  const handleBackdropClick = useCallback((e) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
      onClose?.();
    }
  }, [onClose]);

  if (!isOpen) return null;

  const animationClass = animation === 'none' ? '' : 
    position.openDirection === 'above' ? 'animate-up' : 'animate-down';

  const dropdownContent = (
    <div
      ref={dropdownRef}
      className={`portal-dropdown ${animationClass} ${className}`}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        width,
        maxHeight: position.maxHeight,
        zIndex: 9999,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );

  return createPortal(
    showBackdrop ? (
      <div className="portal-dropdown-backdrop" onClick={handleBackdropClick}>
        {dropdownContent}
      </div>
    ) : dropdownContent,
    document.body
  );
};

export default PortalDropdown;
