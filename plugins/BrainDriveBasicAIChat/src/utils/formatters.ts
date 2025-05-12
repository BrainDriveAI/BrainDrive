/**
 * Format a timestamp string to a human-readable time
 * @param timestamp ISO timestamp string
 * @returns Formatted time string (e.g., "2:30 PM")
 */
export const formatTimestamp = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return '';
  }
};

/**
 * Extract text content from various API response formats
 * @param data API response data
 * @returns Extracted text content
 */
export const extractTextFromData = (data: any): string => {
  let text = '';
  
  if (data.text) {
    text = data.text;
  } else if (data.response) {
    text = data.response;
  } else if (data.choices && data.choices.length > 0) {
    const content = data.choices[0].delta?.content || 
                   data.choices[0].message?.content;
    if (content) {
      text = content;
    }
  }
  
  return text;
};

/**
 * Generate a unique ID with an optional prefix
 * @param prefix Optional prefix for the ID
 * @returns Unique ID string
 */
export const generateId = (prefix: string = 'id'): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};
