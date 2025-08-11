/**
 * Utility functions for converting between camelCase and snake_case
 */

/**
 * Convert a camelCase string to snake_case
 * @param str The camelCase string to convert
 * @returns The snake_case string
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convert a snake_case string to camelCase
 * @param str The snake_case string to convert
 * @returns The camelCase string
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert all keys in an object from camelCase to snake_case
 * @param obj The object with camelCase keys
 * @returns A new object with snake_case keys
 */
export function objectCamelToSnake(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);
    
    // Recursively convert nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[snakeKey] = objectCamelToSnake(value);
    } else if (Array.isArray(value)) {
      // Handle arrays of objects
      result[snakeKey] = value.map(item => 
        item && typeof item === 'object' ? objectCamelToSnake(item) : item
      );
    } else {
      result[snakeKey] = value;
    }
  }
  
  return result;
}

/**
 * Convert all keys in an object from snake_case to camelCase
 * @param obj The object with snake_case keys
 * @returns A new object with camelCase keys
 */
export function objectSnakeToCamel(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);
    
    // Recursively convert nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[camelKey] = objectSnakeToCamel(value);
    } else if (Array.isArray(value)) {
      // Handle arrays of objects
      result[camelKey] = value.map(item => 
        item && typeof item === 'object' ? objectSnakeToCamel(item) : item
      );
    } else {
      result[camelKey] = value;
    }
  }
  
  return result;
}

/**
 * Normalize an object by ensuring all keys are in camelCase
 * This is useful when an object might have a mix of camelCase and snake_case keys
 * @param obj The object to normalize
 * @returns A new object with all keys in camelCase
 */
export function normalizeObjectKeys(obj: Record<string, any>): Record<string, any> {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Special handling for module IDs - don't normalize keys that look like module IDs
    // Module IDs typically contain plugin names and UUIDs separated by underscores
    const isModuleId = key.match(/^[A-Za-z]+(_[a-f0-9]{32}_|\w+_)+\d+$/) ||
                      key.match(/^[A-Za-z]+[A-Za-z0-9]*(_[a-f0-9]+)*(_\d+)?$/) ||
                      key.includes('BrainDrive') ||
                      key.includes('Plugin');
    
    // Convert snake_case to camelCase if needed, but preserve module IDs
    const camelKey = (!isModuleId && key.includes('_')) ? snakeToCamel(key) : key;
    
    // Recursively normalize nested objects
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[camelKey] = normalizeObjectKeys(value);
    } else if (Array.isArray(value)) {
      // Handle arrays of objects
      result[camelKey] = value.map(item =>
        item && typeof item === 'object' ? normalizeObjectKeys(item) : item
      );
    } else {
      result[camelKey] = value;
    }
  }
  
  return result;
}