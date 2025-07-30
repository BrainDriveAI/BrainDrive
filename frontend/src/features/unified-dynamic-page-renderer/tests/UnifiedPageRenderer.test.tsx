import React from 'react';
import { render, screen } from '@testing-library/react';
import { UnifiedPageRenderer } from '../components/UnifiedPageRenderer';
import { RenderMode } from '../types';

// Mock the hooks to avoid dependency issues in tests
jest.mock('../hooks/usePageLoader', () => ({
  usePageLoader: () => ({
    pageData: {
      id: 'test-page',
      name: 'Test Page',
      route: '/test',
      layouts: {
        mobile: [],
        tablet: [],
        desktop: [],
      },
      modules: [],
      metadata: {
        title: 'Test Page',
      },
      isPublished: true,
    },
    loading: false,
    error: null,
  }),
}));

jest.mock('../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    error: null,
    handleError: jest.fn(),
    clearError: jest.fn(),
  }),
}));

describe('UnifiedPageRenderer', () => {
  const defaultProps = {
    mode: RenderMode.PUBLISHED,
    pageId: 'test-page',
  };

  it('renders without crashing', () => {
    render(<UnifiedPageRenderer {...defaultProps} />);
    expect(screen.getByTestId('unified-page-renderer')).toBeInTheDocument();
  });

  it('displays loading state initially', () => {
    render(<UnifiedPageRenderer {...defaultProps} />);
    // This test would need to be adjusted based on actual loading behavior
  });

  it('handles different render modes', () => {
    const { rerender } = render(
      <UnifiedPageRenderer {...defaultProps} mode={RenderMode.STUDIO} />
    );
    
    expect(screen.getByTestId('unified-page-renderer')).toHaveClass('unified-page-renderer--studio');
    
    rerender(
      <UnifiedPageRenderer {...defaultProps} mode={RenderMode.PUBLISHED} />
    );
    
    expect(screen.getByTestId('unified-page-renderer')).toHaveClass('unified-page-renderer--published');
  });

  it('handles responsive configuration', () => {
    render(
      <UnifiedPageRenderer 
        {...defaultProps} 
        responsive={true}
        containerQueries={true}
      />
    );
    
    // Test responsive container is rendered
    expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
  });
});