import { useEffect, useCallback } from 'react';

/**
 * Custom hook to handle click-outside events
 * 
 * @param {React.RefObject|React.RefObject[]} refs - Single ref or array of refs to check against
 * @param {Function} callback - Function to call when click is outside
 * @param {boolean} isActive - Whether the hook is active (default: true)
 * @param {number} delay - Optional delay before attaching listener (prevents immediate trigger)
 * 
 * @example
 * // Single ref
 * useClickOutside(menuRef, () => setIsOpen(false), isOpen);
 * 
 * @example
 * // Multiple refs (click outside all of them triggers callback)
 * useClickOutside([triggerRef, menuRef], () => setIsOpen(false), isOpen);
 */
const useClickOutside = (refs, callback, isActive = true, delay = 0) => {
  const handleClickOutside = useCallback((e) => {
    // Normalize to array
    const refArray = Array.isArray(refs) ? refs : [refs];
    
    // Check if click is inside any of the refs
    const isInsideAny = refArray.some(ref => 
      ref?.current?.contains(e.target)
    );
    
    if (!isInsideAny) {
      callback(e);
    }
  }, [refs, callback]);

  useEffect(() => {
    if (!isActive) return;

    let timeoutId;
    
    if (delay > 0) {
      timeoutId = setTimeout(() => {
        document.addEventListener('mousedown', handleClickOutside);
      }, delay);
    } else {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isActive, handleClickOutside, delay]);
};

export default useClickOutside;
