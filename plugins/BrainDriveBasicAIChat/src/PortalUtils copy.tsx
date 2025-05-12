import React from 'react';

/**
 * Creates or gets a DOM node to use as a portal container
 */
export function getPortalContainer(id: string = 'dropdown-portal-container'): HTMLElement {
  let container = document.getElementById(id);
  
  if (!container) {
    container = document.createElement('div');
    container.id = id;
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.overflow = 'hidden';
    container.style.pointerEvents = 'none'; // Allow clicking through the container
    container.style.zIndex = '9999'; // Very high z-index
    
    document.body.appendChild(container);
  }
  
  return container;
}

/**
 * Positions an element relative to a reference element
 */
export function positionElement(
  element: HTMLElement, 
  referenceElement: HTMLElement,
  offsetY: number = 4
): void {
  const rect = referenceElement.getBoundingClientRect();
  
  // Position the element below the reference element
  element.style.position = 'absolute';
  element.style.top = `${rect.bottom + offsetY}px`;
  element.style.left = `${rect.left}px`;
  element.style.width = `${rect.width}px`;
  element.style.maxHeight = '300px'; // Limit the height
  element.style.overflowY = 'auto';
  element.style.pointerEvents = 'auto'; // Enable pointer events
}
