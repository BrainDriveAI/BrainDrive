/**
 * Authentication Error Handler Utility
 * Provides enhanced, user-friendly error messages for authentication scenarios
 */

export interface AuthError {
  code: string;
  message: string;
  suggestions?: string[];
  actionable?: boolean;
  field?: string;
}

export interface ErrorResponse {
  response?: {
    status: number;
    data?: {
      detail?: string;
      code?: string;
    };
  };
  message?: string;
}

/**
 * Enhanced error messages for login scenarios
 */
export const getLoginErrorMessage = (error: ErrorResponse): AuthError => {
  // Network/Connection errors
  if (error.message && error.message.includes('Network Error')) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Unable to connect to the server. Please check your internet connection and try again.',
      suggestions: [
        'Check your internet connection',
        'Verify the server is running',
        'Try refreshing the page'
      ],
      actionable: true
    };
  }

  // Server response errors
  if (error.response) {
    const { status, data } = error.response;
    
    switch (status) {
      case 401:
        // Check if it's specifically about wrong password vs account not found
        if (data?.detail?.toLowerCase().includes('password')) {
          return {
            code: 'INVALID_PASSWORD',
            message: 'Incorrect password. Please check your password and try again.',
            suggestions: [
              'Make sure you\'re typing the correct password',
              'Check if Caps Lock is turned on',
              'Try typing your password in a text editor first to verify it',
              'Contact an administrator if you\'ve forgotten your password'
            ],
            actionable: true,
            field: 'password'
          };
        } else {
          return {
            code: 'INVALID_CREDENTIALS',
            message: 'Login failed. Please check your email and password.',
            suggestions: [
              'Make sure your email address is spelled correctly',
              'Verify you\'re using the right password',
              'Check if Caps Lock is turned on',
              'Try copying and pasting your credentials if you have them saved'
            ],
            actionable: true
          };
        }

      case 404:
        return {
          code: 'ACCOUNT_NOT_FOUND',
          message: 'We couldn\'t find an account with this email address.',
          suggestions: [
            'Double-check that you typed your email correctly',
            'Try using a different email address you might have registered with',
            'Make sure you\'re not missing any characters or have extra spaces'
          ],
          actionable: true,
          field: 'email'
        };

      case 429:
        return {
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many failed attempts. Please wait a moment before trying again.',
          suggestions: [
            'Wait about 5 minutes before your next attempt',
            'Use this time to double-check your login credentials',
            'Make sure you have the correct email and password ready'
          ],
          actionable: false
        };

      case 500:
        return {
          code: 'SERVER_ERROR',
          message: 'Something went wrong on our end. Please try again in a moment.',
          suggestions: [
            'Wait a minute or two and try logging in again',
            'Check if other parts of the application are working',
            'If the problem continues, contact your system administrator'
          ],
          actionable: false
        };

      case 503:
        return {
          code: 'SERVICE_UNAVAILABLE',
          message: 'The system is temporarily unavailable.',
          suggestions: [
            'The system might be undergoing maintenance',
            'Try again in 10-15 minutes',
            'Check with your administrator if this continues'
          ],
          actionable: false
        };

      default:
        return {
          code: 'UNKNOWN_ERROR',
          message: 'Something unexpected happened. Please try again.',
          suggestions: [
            'Refresh the page and try logging in again',
            'Clear your browser cache if the problem continues',
            'Try using a different browser or device'
          ],
          actionable: true
        };
    }
  }

  // Generic fallback
  return {
    code: 'GENERIC_ERROR',
    message: 'Failed to login. Please try again.',
    suggestions: [
      'Check your internet connection',
      'Try refreshing the page'
    ],
    actionable: true
  };
};

/**
 * Enhanced error messages for registration scenarios
 */
export const getRegistrationErrorMessage = (error: ErrorResponse): AuthError => {
  // Network/Connection errors
  if (error.message && error.message.includes('Network Error')) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Unable to connect to the server. Please check your internet connection and try again.',
      suggestions: [
        'Check your internet connection',
        'Verify the server is running',
        'Try refreshing the page'
      ],
      actionable: true
    };
  }

  // Server response errors
  if (error.response) {
    const { status, data } = error.response;
    
    switch (status) {
      case 400:
        if (data?.detail) {
          // Email already registered
          if (data.detail.toLowerCase().includes('email already registered')) {
            return {
              code: 'EMAIL_EXISTS',
              message: 'An account with this email already exists.',
              suggestions: [
                'Try logging in with this email instead',
                'Use a different email address to create a new account',
                'Reset your password if you forgot it'
              ],
              actionable: true,
              field: 'email'
            };
          }
          
          // Username already taken
          if (data.detail.toLowerCase().includes('username already taken')) {
            return {
              code: 'USERNAME_EXISTS',
              message: 'Someone else is already using this username.',
              suggestions: [
                'Try adding numbers to your username (like "john123")',
                'Use underscores or hyphens (like "john_doe" or "john-smith")',
                'Try a variation or nickname instead'
              ],
              actionable: true,
              field: 'username'
            };
          }

          // Password validation errors
          if (data.detail.toLowerCase().includes('password')) {
            return {
              code: 'INVALID_PASSWORD',
              message: 'Password does not meet requirements.',
              suggestions: [
                'Use at least 8 characters',
                'Include uppercase and lowercase letters',
                'Add numbers and special characters'
              ],
              actionable: true,
              field: 'password'
            };
          }

          // Email format errors
          if (data.detail.toLowerCase().includes('email') && data.detail.toLowerCase().includes('invalid')) {
            return {
              code: 'INVALID_EMAIL',
              message: 'Please enter a valid email address.',
              suggestions: [
                'Check the email format (example@domain.com)',
                'Make sure there are no typos',
                'Use a complete email address'
              ],
              actionable: true,
              field: 'email'
            };
          }

          // Generic 400 error with detail
          return {
            code: 'VALIDATION_ERROR',
            message: data.detail,
            suggestions: [
              'Check all required fields',
              'Make sure all information is correct'
            ],
            actionable: true
          };
        }

        return {
          code: 'INVALID_DATA',
          message: 'Invalid registration information. Please check your details and try again.',
          suggestions: [
            'Verify all fields are filled correctly',
            'Check email format and password requirements'
          ],
          actionable: true
        };

      case 409:
        return {
          code: 'CONFLICT',
          message: 'An account with this information already exists.',
          suggestions: [
            'Try logging in instead',
            'Use different email or username',
            'Contact support if you need help'
          ],
          actionable: true
        };

      case 500:
        return {
          code: 'SERVER_ERROR',
          message: 'Server error occurred during registration. Please try again later.',
          suggestions: [
            'Wait a few minutes and try again',
            'Contact support if the problem persists'
          ],
          actionable: false
        };

      default:
        return {
          code: 'UNKNOWN_ERROR',
          message: 'An unexpected error occurred during registration.',
          suggestions: [
            'Try again in a few moments',
            'Contact support if the problem persists'
          ],
          actionable: true
        };
    }
  }

  // Generic fallback
  return {
    code: 'GENERIC_ERROR',
    message: 'Failed to register. Please try again.',
    suggestions: [
      'Check your internet connection',
      'Verify all information is correct'
    ],
    actionable: true
  };
};

/**
 * Validation helpers for real-time form validation
 */
export const validateEmail = (email: string): { isValid: boolean; message?: string } => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!email) {
    return { isValid: false, message: 'Email is required' };
  }
  
  if (!emailRegex.test(email)) {
    return { isValid: false, message: 'Please enter a valid email address (example@domain.com)' };
  }
  
  return { isValid: true };
};

export const validatePassword = (password: string): { 
  isValid: boolean; 
  message?: string; 
  strength: 'weak' | 'medium' | 'strong';
  suggestions: string[];
} => {
  const suggestions: string[] = [];
  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  
  if (!password) {
    return { 
      isValid: false, 
      message: 'Password is required',
      strength: 'weak',
      suggestions: ['Enter a password']
    };
  }
  
  if (password.length < 8) {
    suggestions.push('Use at least 8 characters');
  }
  
  if (!/[a-z]/.test(password)) {
    suggestions.push('Include lowercase letters');
  }
  
  if (!/[A-Z]/.test(password)) {
    suggestions.push('Include uppercase letters');
  }
  
  if (!/\d/.test(password)) {
    suggestions.push('Include numbers');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    suggestions.push('Include special characters');
  }
  
  // Determine strength
  const hasLength = password.length >= 8;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  const criteriaCount = [hasLength, hasLower, hasUpper, hasNumber, hasSpecial].filter(Boolean).length;
  
  if (criteriaCount >= 4) {
    strength = 'strong';
  } else if (criteriaCount >= 2) {
    strength = 'medium';
  }
  
  const isValid = hasLength && hasLower && hasUpper && hasNumber;
  
  return {
    isValid,
    message: suggestions.length > 0 ? `Password needs: ${suggestions.join(', ')}` : undefined,
    strength,
    suggestions
  };
};

export const validateUsername = (username: string): { isValid: boolean; message?: string } => {
  if (!username) {
    return { isValid: false, message: 'Username is required' };
  }
  
  if (username.length < 3) {
    return { isValid: false, message: 'Username must be at least 3 characters long' };
  }
  
  if (username.length > 50) {
    return { isValid: false, message: 'Username must be less than 50 characters' };
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { isValid: false, message: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  
  return { isValid: true };
};

export const validatePasswordConfirmation = (password: string, confirmPassword: string): { isValid: boolean; message?: string } => {
  if (!confirmPassword) {
    return { isValid: false, message: 'Please confirm your password' };
  }
  
  if (password !== confirmPassword) {
    return { isValid: false, message: 'Passwords do not match' };
  }
  
  return { isValid: true };
};