/**
 * State Serialization Utilities for Plugin State Management
 * Provides safe serialization/deserialization with error handling and validation
 */

export interface SerializationOptions {
  maxDepth?: number;
  maxSize?: number;
  allowedTypes?: string[];
  customSerializers?: Map<string, (value: any) => any>;
  customDeserializers?: Map<string, (value: any) => any>;
}

export interface SerializationResult {
  success: boolean;
  data?: string;
  error?: string;
  size?: number;
  warnings?: string[];
}

export interface DeserializationResult {
  success: boolean;
  data?: any;
  error?: string;
  warnings?: string[];
}

export class StateSerializationUtils {
  private static readonly DEFAULT_MAX_DEPTH = 10;
  private static readonly DEFAULT_MAX_SIZE = 1024 * 1024; // 1MB
  private static readonly ALLOWED_TYPES = ['string', 'number', 'boolean', 'object', 'array'];

  /**
   * Safely serialize state with comprehensive error handling
   */
  static serialize(state: any, options: SerializationOptions = {}): SerializationResult {
    const {
      maxDepth = StateSerializationUtils.DEFAULT_MAX_DEPTH,
      maxSize = StateSerializationUtils.DEFAULT_MAX_SIZE,
      allowedTypes = StateSerializationUtils.ALLOWED_TYPES,
      customSerializers = new Map()
    } = options;

    const warnings: string[] = [];
    
    try {
      // Pre-validation
      const validationResult = StateSerializationUtils.validateForSerialization(
        state, 
        { maxDepth, allowedTypes }
      );
      
      if (!validationResult.valid) {
        return {
          success: false,
          error: `Validation failed: ${validationResult.errors.join(', ')}`
        };
      }

      warnings.push(...validationResult.warnings);

      // Clean and prepare state for serialization
      const cleanedState = StateSerializationUtils.cleanStateForSerialization(
        state, 
        { maxDepth, customSerializers }
      );

      // Serialize
      const serialized = JSON.stringify(cleanedState, (key, value) => {
        // Handle custom serializers
        const valueType = StateSerializationUtils.getValueType(value);
        if (customSerializers.has(valueType)) {
          try {
            return customSerializers.get(valueType)!(value);
          } catch (error) {
            warnings.push(`Custom serializer failed for type ${valueType}: ${error}`);
            return null;
          }
        }
        return value;
      });

      // Check size limits
      if (serialized.length > maxSize) {
        return {
          success: false,
          error: `Serialized state size (${serialized.length}) exceeds maximum allowed size (${maxSize})`
        };
      }

      return {
        success: true,
        data: serialized,
        size: serialized.length,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      return {
        success: false,
        error: `Serialization failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Safely deserialize state with comprehensive error handling
   */
  static deserialize(serializedState: string, options: SerializationOptions = {}): DeserializationResult {
    const {
      customDeserializers = new Map()
    } = options;

    const warnings: string[] = [];

    try {
      if (!serializedState || typeof serializedState !== 'string') {
        return {
          success: false,
          error: 'Invalid serialized state: must be a non-empty string'
        };
      }

      // Parse JSON
      const parsed = JSON.parse(serializedState);

      // Apply custom deserializers
      const deserialized = StateSerializationUtils.applyCustomDeserializers(
        parsed,
        customDeserializers,
        warnings
      );

      // Post-deserialization validation
      const validationResult = StateSerializationUtils.validateDeserialized(deserialized);
      if (!validationResult.valid) {
        warnings.push(...validationResult.warnings);
      }

      return {
        success: true,
        data: deserialized,
        warnings: warnings.length > 0 ? warnings : undefined
      };

    } catch (error) {
      return {
        success: false,
        error: `Deserialization failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Create a compressed serialization for large states
   */
  static serializeCompressed(state: any, options: SerializationOptions = {}): SerializationResult {
    const result = StateSerializationUtils.serialize(state, options);
    
    if (!result.success || !result.data) {
      return result;
    }

    try {
      // Simple compression using repeated pattern replacement
      const compressed = StateSerializationUtils.compressString(result.data);
      
      return {
        ...result,
        data: compressed,
        size: compressed.length
      };
    } catch (error) {
      // Fall back to uncompressed if compression fails
      return result;
    }
  }

  /**
   * Deserialize compressed state
   */
  static deserializeCompressed(compressedState: string, options: SerializationOptions = {}): DeserializationResult {
    try {
      const decompressed = StateSerializationUtils.decompressString(compressedState);
      return StateSerializationUtils.deserialize(decompressed, options);
    } catch (error) {
      // Try direct deserialization in case it's not compressed
      return StateSerializationUtils.deserialize(compressedState, options);
    }
  }

  /**
   * Validate state before serialization
   */
  private static validateForSerialization(
    state: any, 
    options: { maxDepth: number; allowedTypes: string[] }
  ): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    const validateRecursive = (value: any, depth: number, path: string = 'root'): void => {
      if (depth > options.maxDepth) {
        errors.push(`Maximum depth (${options.maxDepth}) exceeded at path: ${path}`);
        return;
      }

      const valueType = StateSerializationUtils.getValueType(value);
      
      if (!options.allowedTypes.includes(valueType)) {
        errors.push(`Unsupported type '${valueType}' at path: ${path}`);
        return;
      }

      // Check for circular references
      if (typeof value === 'object' && value !== null) {
        try {
          JSON.stringify(value);
        } catch (error) {
          if (error instanceof Error && error.message.includes('circular')) {
            errors.push(`Circular reference detected at path: ${path}`);
            return;
          }
        }

        // Recursively validate object properties
        if (Array.isArray(value)) {
          value.forEach((item, index) => {
            validateRecursive(item, depth + 1, `${path}[${index}]`);
          });
        } else {
          Object.keys(value).forEach(key => {
            validateRecursive(value[key], depth + 1, `${path}.${key}`);
          });
        }
      }

      // Check for potentially problematic values
      if (value === undefined) {
        warnings.push(`Undefined value at path: ${path} (will be omitted in JSON)`);
      }
      
      if (typeof value === 'function') {
        warnings.push(`Function at path: ${path} (will be omitted in JSON)`);
      }
    };

    validateRecursive(state, 0);

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Clean state for safe serialization
   */
  private static cleanStateForSerialization(
    state: any, 
    options: { maxDepth: number; customSerializers: Map<string, (value: any) => any> }
  ): any {
    const cleanRecursive = (value: any, depth: number): any => {
      if (depth > options.maxDepth) {
        return null;
      }

      if (value === null || value === undefined) {
        return value;
      }

      const valueType = StateSerializationUtils.getValueType(value);

      // Apply custom serializers
      if (options.customSerializers.has(valueType)) {
        try {
          return options.customSerializers.get(valueType)!(value);
        } catch (error) {
          return null;
        }
      }

      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          return value.map(item => cleanRecursive(item, depth + 1));
        } else {
          const cleaned: any = {};
          Object.keys(value).forEach(key => {
            const cleanedValue = cleanRecursive(value[key], depth + 1);
            if (cleanedValue !== undefined) {
              cleaned[key] = cleanedValue;
            }
          });
          return cleaned;
        }
      }

      return value;
    };

    return cleanRecursive(state, 0);
  }

  /**
   * Apply custom deserializers to parsed data
   */
  private static applyCustomDeserializers(
    data: any,
    customDeserializers: Map<string, (value: any) => any>,
    warnings: string[]
  ): any {
    const applyRecursive = (value: any): any => {
      if (value === null || value === undefined) {
        return value;
      }

      const valueType = StateSerializationUtils.getValueType(value);
      
      // Apply custom deserializers
      if (customDeserializers.has(valueType)) {
        try {
          return customDeserializers.get(valueType)!(value);
        } catch (error) {
          warnings.push(`Custom deserializer failed for type ${valueType}: ${error}`);
          return value;
        }
      }

      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          return value.map(item => applyRecursive(item));
        } else {
          const result: any = {};
          Object.keys(value).forEach(key => {
            result[key] = applyRecursive(value[key]);
          });
          return result;
        }
      }

      return value;
    };

    return applyRecursive(data);
  }

  /**
   * Validate deserialized data
   */
  private static validateDeserialized(data: any): { valid: boolean; warnings: string[] } {
    const warnings: string[] = [];

    // Basic validation - can be extended
    if (data === null || data === undefined) {
      warnings.push('Deserialized data is null or undefined');
    }

    return {
      valid: true, // Currently always valid, but can be enhanced
      warnings
    };
  }

  /**
   * Get the type of a value for serialization purposes
   */
  private static getValueType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Simple string compression using pattern replacement
   */
  private static compressString(str: string): string {
    // Simple compression - replace common JSON patterns
    return str
      .replace(/{"([^"]+)":/g, '{$1:')
      .replace(/,"([^"]+)":/g, ',$1:')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Simple string decompression
   */
  private static decompressString(str: string): string {
    // Reverse the compression - add quotes back to property names
    return str
      .replace(/{([^":]+):/g, '{"$1":')
      .replace(/,([^":]+):/g, ',"$1":');
  }

  /**
   * Calculate the memory footprint of a state object
   */
  static calculateStateSize(state: any): number {
    try {
      return JSON.stringify(state).length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Check if state can be safely serialized
   */
  static canSerialize(state: any): boolean {
    try {
      JSON.stringify(state);
      return true;
    } catch (error) {
      return false;
    }
  }
}