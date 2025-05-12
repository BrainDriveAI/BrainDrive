import React from 'react';
import './CustomDropdown.css';
import { getPortalContainer, positionElement } from './PortalUtils';

interface DropdownOption {
  id: string;
  primaryText: string;
  secondaryText: string;
}

interface CustomDropdownProps {
  options: DropdownOption[];
  selectedId: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

interface CustomDropdownState {
  isOpen: boolean;
  highlightedIndex: number;
}

class CustomDropdown extends React.Component<CustomDropdownProps, CustomDropdownState> {
  private dropdownRef: React.RefObject<HTMLDivElement>;
  private optionsRef: React.RefObject<HTMLUListElement>;
  private portalContainer: HTMLElement | null = null;
  private optionsContainer: HTMLDivElement | null = null;
  private handleClickOutsideBound: (event: MouseEvent) => void;

  constructor(props: CustomDropdownProps) {
    super(props);
    
    this.state = {
      isOpen: false,
      highlightedIndex: -1
    };
    
    this.dropdownRef = React.createRef();
    this.optionsRef = React.createRef();
    this.handleClickOutsideBound = this.handleClickOutside.bind(this);
  }
  
  private resizeObserver: ResizeObserver | null = null;
  private scrollListener: EventListenerOrEventListenerObject | null = null;
  private positionUpdateTimeout: number | null = null;

  componentDidMount() {
    document.addEventListener('mousedown', this.handleClickOutsideBound);
    // Get the portal container
    this.portalContainer = getPortalContainer();
    
    // Add scroll listener to handle parent scrolling
    this.scrollListener = this.handleParentMovement;
    window.addEventListener('scroll', this.scrollListener, true);
    
    // Add resize observer to handle parent resizing
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.handleParentMovement);
      if (this.dropdownRef.current) {
        this.resizeObserver.observe(this.dropdownRef.current);
        
        // Also observe parent elements up to 3 levels
        let parent = this.dropdownRef.current.parentElement;
        for (let i = 0; i < 3 && parent; i++) {
          this.resizeObserver.observe(parent);
          parent = parent.parentElement;
        }
      }
    }
  }
  
  componentDidUpdate(prevProps: CustomDropdownProps, prevState: CustomDropdownState) {
    // If dropdown was just opened, create and position the options container
    if (!prevState.isOpen && this.state.isOpen) {
      this.renderOptionsInPortal();
    }
    
    // If dropdown was just closed, remove the options container
    if (prevState.isOpen && !this.state.isOpen) {
      this.removeOptionsFromPortal();
    }
    
    // If dropdown is open and props changed, update position
    if (this.state.isOpen && 
        (prevProps.options !== this.props.options || 
         prevProps.selectedId !== this.props.selectedId)) {
      this.updateDropdownPosition();
    }
  }
  
  componentWillUnmount() {
    document.removeEventListener('mousedown', this.handleClickOutsideBound);
    
    // Remove scroll listener
    if (this.scrollListener) {
      window.removeEventListener('scroll', this.scrollListener, true);
    }
    
    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    // Clear any pending timeouts
    if (this.positionUpdateTimeout !== null) {
      window.clearTimeout(this.positionUpdateTimeout);
    }
    
    this.removeOptionsFromPortal();
  }
  
  handleParentMovement = () => {
    if (this.state.isOpen) {
      // Debounce position updates to avoid excessive recalculations
      if (this.positionUpdateTimeout !== null) {
        window.clearTimeout(this.positionUpdateTimeout);
      }
      
      this.positionUpdateTimeout = window.setTimeout(() => {
        // Check if the dropdown trigger is still visible
        if (this.dropdownRef.current) {
          const rect = this.dropdownRef.current.getBoundingClientRect();
          const isVisible = rect.top >= 0 && 
                           rect.left >= 0 && 
                           rect.bottom <= window.innerHeight && 
                           rect.right <= window.innerWidth;
          
          if (isVisible) {
            // Update position if visible
            this.updateDropdownPosition();
          } else {
            // Close dropdown if not visible
            this.setState({ isOpen: false });
          }
        }
      }, 50);
    }
  };
  
  updateDropdownPosition = () => {
    if (this.dropdownRef.current && this.optionsContainer) {
      positionElement(this.optionsContainer, this.dropdownRef.current);
    }
  };
  
  handleClickOutside(event: MouseEvent) {
    // Check if click was outside both the dropdown trigger and the options container
    const clickedDropdown = this.dropdownRef.current && this.dropdownRef.current.contains(event.target as Node);
    const clickedOptions = this.optionsContainer && this.optionsContainer.contains(event.target as Node);
    
    if (!clickedDropdown && !clickedOptions) {
      this.setState({ isOpen: false });
    }
  }
  
  renderOptionsInPortal() {
    if (!this.dropdownRef.current || !this.portalContainer) {
      console.error('Cannot render options portal: missing reference element or portal container');
      return;
    }
    
    try {
      // Create a container for the options
      this.optionsContainer = document.createElement('div');
      this.optionsContainer.className = 'dropdown-options-portal';
      
      // Add theme class if in dark mode
      const isDarkTheme = document.body.classList.contains('dark-theme') ||
                          document.documentElement.classList.contains('dark-theme') ||
                          this.props.options.length > 0 && document.querySelector('.dark-theme');
      
      console.log('Rendering dropdown options with theme:', isDarkTheme ? 'dark' : 'light');
      
      if (isDarkTheme) {
        this.optionsContainer.classList.add('dark-theme-dropdown');
      }
      
      // Apply styles to match the dropdown options
      this.optionsContainer.style.backgroundColor = isDarkTheme ? '#1e293b' : '#ffffff';
      this.optionsContainer.style.border = `1px solid ${isDarkTheme ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.2)'}`;
      this.optionsContainer.style.borderRadius = '0.375rem';
      this.optionsContainer.style.boxShadow = isDarkTheme ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)';
      this.optionsContainer.style.zIndex = '10000';
      this.optionsContainer.style.overflowY = 'auto';
      this.optionsContainer.style.scrollbarWidth = 'thin';
      this.optionsContainer.style.scrollbarColor = isDarkTheme ? 'rgba(255, 255, 255, 0.3) transparent' : 'rgba(0, 0, 0, 0.3) transparent';
      
      // Add custom scrollbar styles for WebKit browsers
      if (this.optionsContainer.style.scrollbarWidth === '') {
        // WebKit browsers don't support scrollbar-width, so we need to use pseudo-elements
        // These are added via CSS classes, but we can enhance them with direct styles
        if (isDarkTheme) {
          this.optionsContainer.style.setProperty('--scrollbar-thumb-color', 'rgba(255, 255, 255, 0.3)');
          this.optionsContainer.style.setProperty('--scrollbar-thumb-hover-color', 'rgba(255, 255, 255, 0.5)');
        } else {
          this.optionsContainer.style.setProperty('--scrollbar-thumb-color', 'rgba(0, 0, 0, 0.3)');
          this.optionsContainer.style.setProperty('--scrollbar-thumb-hover-color', 'rgba(0, 0, 0, 0.5)');
        }
      }
      
      // Add the options container to the portal
      this.portalContainer.appendChild(this.optionsContainer);
      
      // Position the options container relative to the dropdown trigger
      positionElement(this.optionsContainer, this.dropdownRef.current);
      
      // Render the options into the container
      this.renderOptionsContent();
    } catch (error) {
      console.error('Error creating options container:', error);
      return;
    }
    
    // No duplicate code here - everything is handled in the try block above
  }
  
  renderOptionsContent() {
    if (!this.optionsContainer) {
      console.error('Cannot render options content: missing options container');
      return;
    }
    
    const { options, selectedId } = this.props;
    const { highlightedIndex } = this.state;
    
    try {
      console.log('Rendering dropdown options content with', options.length, 'options');
      
      // Check if we're in dark mode
      const isDarkTheme = this.optionsContainer.classList.contains('dark-theme-dropdown');
      
      // Create the options list
      const optionsList = document.createElement('ul');
      optionsList.className = 'dropdown-options';
      optionsList.setAttribute('role', 'listbox');
      if (highlightedIndex >= 0 && options[highlightedIndex]) {
        optionsList.setAttribute('aria-activedescendant', `option-${options[highlightedIndex].id}`);
      }
      
      // Add each option
      options.forEach((option, index) => {
        try {
          if (!option || !option.id) {
            console.warn('Invalid option:', option);
            return;
          }
          
          const optionItem = document.createElement('li');
          optionItem.id = `option-${option.id}`;
          optionItem.className = `dropdown-option ${selectedId === option.id ? 'selected' : ''} ${highlightedIndex === index ? 'highlighted' : ''}`;
          optionItem.setAttribute('role', 'option');
          optionItem.setAttribute('aria-selected', selectedId === option.id ? 'true' : 'false');
          
          // Add primary text
          const primaryText = document.createElement('div');
          primaryText.className = 'dropdown-option-primary';
          primaryText.textContent = option.primaryText || 'Untitled';
          if (isDarkTheme) {
            primaryText.style.color = '#e0e0e0';
          }
          optionItem.appendChild(primaryText);
          
          // Add secondary text
          const secondaryText = document.createElement('div');
          secondaryText.className = 'dropdown-option-secondary';
          secondaryText.textContent = option.secondaryText || '';
          if (isDarkTheme) {
            secondaryText.style.color = '#9ca3af';
          }
          optionItem.appendChild(secondaryText);
          
          // Add hover effect
          optionItem.addEventListener('mouseenter', () => {
            optionItem.style.backgroundColor = isDarkTheme ? 'rgba(33, 150, 243, 0.2)' : 'rgba(33, 150, 243, 0.1)';
          });
          
          optionItem.addEventListener('mouseleave', () => {
            if (!optionItem.classList.contains('selected') && !optionItem.classList.contains('highlighted')) {
              optionItem.style.backgroundColor = '';
            }
          });
          
          // Add click handler
          optionItem.addEventListener('click', () => {
            this.handleOptionClick(option.id);
          });
          
          optionsList.appendChild(optionItem);
        } catch (optionError) {
          console.error('Error rendering option:', optionError, option);
        }
      });
      
      // Clear and append the options list
      this.optionsContainer.innerHTML = '';
      this.optionsContainer.appendChild(optionsList);
      console.log('Options list rendered successfully');
    } catch (error) {
      console.error('Error rendering options content:', error);
    }
    
// This is an empty replacement to remove this block since it's now included in the previous block
    
// This is an empty replacement to remove this block since it's now included in the previous block
  }
  
  removeOptionsFromPortal() {
    if (this.optionsContainer && this.portalContainer) {
      this.portalContainer.removeChild(this.optionsContainer);
      this.optionsContainer = null;
    }
  }
  
  handleKeyDown = (e: React.KeyboardEvent) => {
    const { disabled, options } = this.props;
    const { isOpen, highlightedIndex } = this.state;
    
    if (disabled) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          this.setState({ 
            isOpen: true,
            highlightedIndex: 0
          });
        } else {
          this.setState(prevState => ({
            highlightedIndex: prevState.highlightedIndex < options.length - 1 
              ? prevState.highlightedIndex + 1 
              : prevState.highlightedIndex
          }));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) {
          this.setState(prevState => ({
            highlightedIndex: prevState.highlightedIndex > 0 
              ? prevState.highlightedIndex - 1 
              : 0
          }));
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isOpen && highlightedIndex >= 0) {
          this.props.onChange(options[highlightedIndex].id);
          this.setState({ isOpen: false });
        } else {
          this.setState(prevState => ({ isOpen: !prevState.isOpen }));
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.setState({ isOpen: false });
        break;
      case 'Tab':
        this.setState({ isOpen: false });
        break;
      default:
        break;
    }
  };
  
  toggleDropdown = () => {
    const { disabled, selectedId, options } = this.props;
    
    if (!disabled) {
      this.setState(prevState => {
        const newState: Partial<CustomDropdownState> = { isOpen: !prevState.isOpen };
        
        if (!prevState.isOpen) {
          // Set highlighted index to the selected option when opening
          const index = options.findIndex(option => option.id === selectedId);
          newState.highlightedIndex = index >= 0 ? index : 0;
        }
        
        return newState as CustomDropdownState;
      });
    }
  };
  
  handleOptionClick = (id: string) => {
    this.props.onChange(id);
    this.setState({ isOpen: false });
  };
  
  render() {
    const { options, selectedId, placeholder = 'Select an option', disabled = false, ariaLabel = 'Dropdown' } = this.props;
    const { isOpen, highlightedIndex } = this.state;
    
    const selectedOption = options.find(option => option.id === selectedId);
    
    return (
      <div 
        className={`custom-dropdown ${disabled ? 'disabled' : ''}`} 
        ref={this.dropdownRef}
        onKeyDown={this.handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        role="combobox"
      >
        <div 
          className={`dropdown-selected ${isOpen ? 'open' : ''}`}
          onClick={this.toggleDropdown}
        >
          {selectedOption ? (
            <div className="dropdown-selected-content">
              <div className="dropdown-option-primary">{selectedOption.primaryText}</div>
              <div className="dropdown-option-secondary">{selectedOption.secondaryText}</div>
            </div>
          ) : (
            <div className="dropdown-placeholder">{placeholder}</div>
          )}
          <div className="dropdown-arrow">▼</div>
        </div>

        {/* Options are rendered in the portal */}
      </div>
    );
  }
}

export default CustomDropdown;
