import { useState, useEffect } from 'react';

export interface UseBreakpointResult {
  currentBreakpoint: string;
  isDesktop: boolean;
  isTablet: boolean;
  isMobile: boolean;
  isWide: boolean;
}

const breakpoints = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  wide: 1440,
};

export function useBreakpoint(): UseBreakpointResult {
  const [currentBreakpoint, setCurrentBreakpoint] = useState<string>('desktop');

  useEffect(() => {
    const getBreakpoint = () => {
      if (typeof window === 'undefined') return 'desktop';
      
      const width = window.innerWidth;
      
      if (width >= breakpoints.wide) return 'wide';
      if (width >= breakpoints.desktop) return 'desktop';
      if (width >= breakpoints.tablet) return 'tablet';
      return 'mobile';
    };

    const handleResize = () => {
      setCurrentBreakpoint(getBreakpoint());
    };

    // Set initial breakpoint
    handleResize();

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    currentBreakpoint,
    isDesktop: currentBreakpoint === 'desktop',
    isTablet: currentBreakpoint === 'tablet',
    isMobile: currentBreakpoint === 'mobile',
    isWide: currentBreakpoint === 'wide',
  };
}

export default useBreakpoint;