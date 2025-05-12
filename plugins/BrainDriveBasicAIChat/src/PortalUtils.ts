/**
 * Utility functions for creating and positioning portal elements
 * These functions are used by the CustomDropdown component to render
 * dropdown options outside their DOM hierarchy for better positioning
 */

/**
 * Get or create a portal container for rendering elements outside their DOM hierarchy
 * @returns HTMLElement The portal container element
 */
export function getPortalContainer(): HTMLElement {
  // Check if portal container already exists
  let portalContainer = document.getElementById('dropdown-portal-container');
  
  // If not, create it
  if (!portalContainer) {
    portalContainer = document.createElement('div');
    portalContainer.id = 'dropdown-portal-container';
    document.body.appendChild(portalContainer);
  }
  
  return portalContainer;
}

/**
 * Position an element relative to a reference element
 * @param element The element to position
 * @param referenceElement The reference element to position against
 */
export function positionElement(element: HTMLElement, referenceElement: HTMLElement): void {
  // Get the position and dimensions of the reference element
  const referenceRect = referenceElement.getBoundingClientRect();
  
  // Calculate the position for the element
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
  
  // Position the element below the reference element
  const top = referenceRect.bottom + scrollTop;
  const left = referenceRect.left + scrollLeft;
  
  // Set the width to match the reference element
  const width = referenceRect.width;
  
  // Apply the position
  element.style.position = 'absolute';
  element.style.top = `${top}px`;
  element.style.left = `${left}px`;
  element.style.width = `${width}px`;
  element.style.maxHeight = '300px'; // Limit the height and enable scrolling
  
  // Check if the element would go off the bottom of the viewport
  const elementHeight = element.offsetHeight;
  const viewportHeight = window.innerHeight;
  const bottomPosition = top + elementHeight;
  
  // If it would go off the bottom, position it above the reference element instead
  if (bottomPosition > viewportHeight + scrollTop) {
    element.style.top = `${referenceRect.top + scrollTop - elementHeight}px`;
  }
  
  // Check if the element would go off the right of the viewport
  const viewportWidth = window.innerWidth;
  const rightPosition = left + element.offsetWidth;
  
  // If it would go off the right, align it to the right edge of the reference element
  if (rightPosition > viewportWidth + scrollLeft) {
    element.style.left = `${viewportWidth + scrollLeft - element.offsetWidth}px`;
  }
}