import './index.css';
import './bootstrap';
import ComponentOllamaServer from './ComponentOllamaServer';
import ComponentTheme from './ComponentTheme';

// Export the components
export { 

  ComponentOllamaServer,
  ComponentTheme,
};

// For local development
//if (process.env.NODE_ENV === 'development') {
//  const { createRoot } = require('react-dom/client');
 // const root = createRoot(document.getElementById('root'));
//  root.render(<Component />);
//}
