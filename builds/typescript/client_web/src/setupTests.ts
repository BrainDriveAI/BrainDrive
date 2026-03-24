import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}

  unobserve() {}

  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// jsdom/happy-dom don't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();
