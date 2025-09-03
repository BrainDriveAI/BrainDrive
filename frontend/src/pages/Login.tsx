import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Alert,
  Tabs,
  Tab,
  Grid,
  useMediaQuery,
  useTheme,
  Divider,
  Card,
  CardContent,
  IconButton,
  InputAdornment
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import {
  getLoginErrorMessage,
  getRegistrationErrorMessage,
  validateEmail,
  validatePassword,
  validateUsername,
  validatePasswordConfirmation,
  AuthError
} from '../utils/authErrorHandler';
import EnhancedErrorDisplay from '../components/auth/EnhancedErrorDisplay';
import PasswordStrengthIndicator from '../components/auth/PasswordStrengthIndicator';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`auth-tabpanel-${index}`}
      aria-labelledby={`auth-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box sx={{ pt: 3 }}>
          {children}
        </Box>
      )}
    </div>
  );
}

function a11yProps(index: number) {
  return {
    id: `auth-tab-${index}`,
    'aria-controls': `auth-tabpanel-${index}`,
  };
}

const Login = () => {
  const [tabValue, setTabValue] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState<AuthError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  
  // Real-time validation states
  const [emailValidation, setEmailValidation] = useState<{ isValid: boolean; message?: string } | null>(null);
  const [usernameValidation, setUsernameValidation] = useState<{ isValid: boolean; message?: string } | null>(null);
  const [passwordValidation, setPasswordValidation] = useState<any>(null);
  const [confirmPasswordValidation, setConfirmPasswordValidation] = useState<{ isValid: boolean; message?: string } | null>(null);
  
  // Configuration option: Set to true to show the Full Name field in registration form
  // This can be easily toggled when full name collection is needed in the future
  const [showFullNameField] = useState<boolean>(false);
  
  const { login, register, user } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Prevent error clearing during auth context operations
  useEffect(() => {
    // If user becomes authenticated, clear any error states
    if (user) {
      setError('');
      setAuthError(null);
    }
  }, [user]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    // Only clear errors when explicitly switching tabs, not during other operations
    if (newValue !== tabValue) {
      setError('');
      setAuthError(null);
      // Clear validation states when switching tabs
      setEmailValidation(null);
      setUsernameValidation(null);
      setPasswordValidation(null);
      setConfirmPasswordValidation(null);
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setAuthError(null);
    setIsSubmitting(true);
    console.log('Login submission started - disabling button');
    
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      console.log('Login error occurred - re-enabling button', err);
      
      // Create enhanced error message
      const enhancedError = getLoginErrorMessage(err);
      
      // Set both error states to ensure persistence
      setAuthError(enhancedError);
      
      // Keep the old error for backward compatibility if needed
      if (err.response && err.response.status === 401) {
        setError('Invalid email or password. Please try again.');
      } else if (err.response && err.response.status === 404) {
        setError('Account not found. Please check your email or register for a new account.');
      } else if (err.message && err.message.includes('Network Error')) {
        setError('Unable to connect to the server. Please check your internet connection and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to login. Please try again later.');
      }
      
      // Ensure error persists by preventing any automatic clearing
      setTimeout(() => {
        if (!user) { // Only keep error if user is still not logged in
          setAuthError(enhancedError);
        }
      }, 100);
      
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setAuthError(null);
    setIsSubmitting(true);
    console.log('Registration submission started - disabling button');

    // Validate passwords match
    if (password !== confirmPassword) {
      const passwordError: AuthError = {
        code: 'PASSWORD_MISMATCH',
        message: 'Passwords do not match',
        suggestions: ['Make sure both password fields contain the same password'],
        actionable: true,
        field: 'confirmPassword'
      };
      setAuthError(passwordError);
      setError('Passwords do not match');
      setIsSubmitting(false);
      return;
    }

    try {
      await register({
        username,
        email,
        password,
        full_name: showFullNameField ? fullName : "" // Send empty string if field is hidden
      });
      navigate('/');
    } catch (err: any) {
      console.log('Registration error occurred - re-enabling button');
      const enhancedError = getRegistrationErrorMessage(err);
      setAuthError(enhancedError);
      
      // Keep the old error for backward compatibility if needed
      if (err.response && err.response.status === 400) {
        if (err.response.data && err.response.data.detail) {
          if (err.response.data.detail.includes('Email already registered')) {
            setError('This email is already registered. Please use a different email or try logging in.');
          } else if (err.response.data.detail.includes('Username already taken')) {
            setError('This username is already taken. Please choose a different username.');
          } else {
            setError(err.response.data.detail);
          }
        } else {
          setError('Invalid registration information. Please check your details and try again.');
        }
      } else if (err.response && err.response.status === 500) {
        setError('Server error occurred. Please try again later.');
      } else if (err.message && err.message.includes('Network Error')) {
        setError('Unable to connect to the server. Please check your internet connection and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to register. Please try again later.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClickShowPassword = () => {
    setShowPassword(!showPassword);
  };

  const handleFieldFocus = (fieldName: string) => {
    setFocusedField(fieldName);
  };

  const handleFieldBlur = () => {
    setFocusedField(null);
  };

  // Real-time validation handlers
  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (value) {
      const validation = validateEmail(value);
      setEmailValidation(validation);
    } else {
      setEmailValidation(null);
    }
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value);
    if (value) {
      const validation = validateUsername(value);
      setUsernameValidation(validation);
    } else {
      setUsernameValidation(null);
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (value) {
      const validation = validatePassword(value);
      setPasswordValidation(validation);
    } else {
      setPasswordValidation(null);
    }
    
    // Also validate confirm password if it exists
    if (confirmPassword) {
      const confirmValidation = validatePasswordConfirmation(value, confirmPassword);
      setConfirmPasswordValidation(confirmValidation);
    }
  };

  const handleConfirmPasswordChange = (value: string) => {
    setConfirmPassword(value);
    if (value) {
      const validation = validatePasswordConfirmation(password, value);
      setConfirmPasswordValidation(validation);
    } else {
      setConfirmPasswordValidation(null);
    }
  };

  // Helper function to get field-specific help text
  const getFieldHelpText = (fieldName: string | null) => {
    switch (fieldName) {
      case 'email':
        return "Enter a valid email address (example@domain.com)";
      case 'password':
        return "Password must be at least 8 characters long";
      case 'confirmPassword':
        return "Re-enter your password to confirm";
      case 'username':
        return "Choose a unique username (3-50 characters)";
      case 'fullName':
        return "Enter your full name as you'd like it to appear";
      default:
        return "";
    }
  };

  // Helper function to handle switching to registration tab
  const handleSwitchToRegister = () => {
    setTabValue(1);
    setAuthError(null);
    setError('');
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        py: 4
      }}
    >
      <Box sx={{ mb: 4, textAlign: 'center', width: '100%', maxWidth: '400px' }}>
        <img 
          src={theme.palette.mode === 'dark' ? "/braindrive/braindrive-dark.svg" : "/braindrive/braindrive-light.svg"} 
          alt="BrainDrive Logo" 
          style={{ width: '100%', height: 'auto' }}
        />
        <Typography variant="h6" fontWeight="bold" color="text.primary" sx={{ mt: 2 }}>
          Your AI. Your Rules.
        </Typography>
      </Box>
      
      <Box
        sx={{
          width: '100%',
          maxWidth: '450px',
          mx: 'auto',
          px: 2
        }}
      >
          <Paper
            elevation={3}
            sx={{
              p: 4,
              width: '100%',
              borderRadius: 2,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
            }}
          >
            {/* Mobile logo - only show on mobile */}
            {isMobile && (
              <Box sx={{ mb: 4, textAlign: 'center' }}>
                <img 
                  src={theme.palette.mode === 'dark' ? "/braindrive/braindrive-dark.svg" : "/braindrive/braindrive-light.svg"} 
                  alt="BrainDrive Logo" 
                  style={{ maxWidth: '80%', height: 'auto' }}
                />
                <Typography variant="h6" fontWeight="bold" color="text.primary" sx={{ mt: 2 }}>
                  Your AI, Your Rules
                </Typography>
              </Box>
            )}

            <Tabs 
              value={tabValue} 
              onChange={handleTabChange} 
              variant="fullWidth" 
              sx={{ 
                borderBottom: 1, 
                borderColor: 'divider',
                '& .MuiTab-root': {
                  fontWeight: 600,
                  fontSize: '1rem'
                }
              }}
            >
              <Tab label="Login" {...a11yProps(0)} />
              <Tab label="Register" {...a11yProps(1)} />
            </Tabs>

            {/* Enhanced Error Display */}
            <EnhancedErrorDisplay
              error={authError}
              onAction={authError?.code === 'ACCOUNT_NOT_FOUND' ? handleSwitchToRegister : undefined}
              actionLabel={authError?.code === 'ACCOUNT_NOT_FOUND' ? 'Create Account' : undefined}
              showSuggestions={true}
            />

            {/* Fallback to old error display if enhanced error is not available */}
            {error && !authError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}

            <TabPanel value={tabValue} index={0}>
              <form onSubmit={handleLogin}>
                <TextField
                  fullWidth
                  label="Email"
                  margin="normal"
                  variant="outlined"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  onFocus={() => handleFieldFocus('email')}
                  onBlur={handleFieldBlur}
                  autoComplete="username"
                  error={
                    (!!error && error.toLowerCase().includes('email')) ||
                    (!!authError && authError.field === 'email') ||
                    (!!emailValidation && !emailValidation.isValid)
                  }
                  helperText={
                    focusedField === 'email'
                      ? getFieldHelpText('email')
                      : emailValidation && !emailValidation.isValid
                        ? emailValidation.message
                        : authError && authError.field === 'email'
                          ? "Please check your email address"
                          : error && error.toLowerCase().includes('email')
                            ? "Please check your email address"
                            : " "
                  }
                />
                <TextField
                  fullWidth
                  label="Password"
                  margin="normal"
                  variant="outlined"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onFocus={() => handleFieldFocus('password')}
                  onBlur={handleFieldBlur}
                  autoComplete="current-password"
                  error={
                    (!!error && error.toLowerCase().includes('password')) ||
                    (!!authError && authError.field === 'password')
                  }
                  helperText={
                    focusedField === 'password'
                      ? getFieldHelpText('password')
                      : authError && authError.field === 'password'
                        ? "Please check your password"
                        : error && error.toLowerCase().includes('password')
                          ? "Please check your password"
                          : " "
                  }
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={handleClickShowPassword}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={isSubmitting}
                  sx={{
                    mt: 3,
                    py: 1.5,
                    borderRadius: 2,
                    textTransform: 'none',
                    fontSize: '1rem'
                  }}
                >
                  {isSubmitting ? 'Signing In...' : 'Sign In'}
                </Button>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  align="center"
                  sx={{ display: 'block', mt: 2 }}
                >
                  All data is stored locally on your device
                </Typography>
              </form>
              
            </TabPanel>

            <TabPanel value={tabValue} index={1}>
              <form onSubmit={handleRegister}>
                {showFullNameField && (
                  <TextField
                    fullWidth
                    label="Full Name"
                    margin="normal"
                    variant="outlined"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    onFocus={() => handleFieldFocus('fullName')}
                    onBlur={handleFieldBlur}
                    helperText={focusedField === 'fullName' ? getFieldHelpText('fullName') : " "}
                  />
                )}
                <TextField
                  fullWidth
                  label="Username"
                  margin="normal"
                  variant="outlined"
                  required
                  value={username}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  onFocus={() => handleFieldFocus('username')}
                  onBlur={handleFieldBlur}
                  autoComplete="username"
                  error={
                    (!!error && error.toLowerCase().includes('username')) ||
                    (!!authError && authError.field === 'username') ||
                    (!!usernameValidation && !usernameValidation.isValid)
                  }
                  helperText={
                    focusedField === 'username'
                      ? getFieldHelpText('username')
                      : usernameValidation && !usernameValidation.isValid
                        ? usernameValidation.message
                        : authError && authError.field === 'username'
                          ? authError.message
                          : error && error.toLowerCase().includes('username')
                            ? error
                            : " "
                  }
                />
                <TextField
                  fullWidth
                  label="Email"
                  margin="normal"
                  variant="outlined"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  onFocus={() => handleFieldFocus('email')}
                  onBlur={handleFieldBlur}
                  autoComplete="username"
                  error={
                    (!!error && error.toLowerCase().includes('email')) ||
                    (!!authError && authError.field === 'email') ||
                    (!!emailValidation && !emailValidation.isValid)
                  }
                  helperText={
                    focusedField === 'email'
                      ? getFieldHelpText('email')
                      : emailValidation && !emailValidation.isValid
                        ? emailValidation.message
                        : authError && authError.field === 'email'
                          ? authError.message
                          : error && error.toLowerCase().includes('email')
                            ? error
                            : " "
                  }
                />
                <TextField
                  fullWidth
                  label="Password"
                  margin="normal"
                  variant="outlined"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => handlePasswordChange(e.target.value)}
                  onFocus={() => handleFieldFocus('password')}
                  onBlur={handleFieldBlur}
                  autoComplete="new-password"
                  error={
                    (!!error && error.toLowerCase().includes('password')) ||
                    (!!authError && authError.field === 'password') ||
                    (!!passwordValidation && !passwordValidation.isValid)
                  }
                  helperText={
                    focusedField === 'password'
                      ? getFieldHelpText('password')
                      : passwordValidation && !passwordValidation.isValid
                        ? passwordValidation.message
                        : authError && authError.field === 'password'
                          ? authError.message
                          : error && error.toLowerCase().includes('password')
                            ? error
                            : " "
                  }
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={handleClickShowPassword}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
                
                {/* Password Strength Indicator */}
                {password && tabValue === 1 && (
                  <PasswordStrengthIndicator
                    password={password}
                    showDetails={focusedField === 'password'}
                    compact={focusedField !== 'password'}
                  />
                )}
                
                <TextField
                  fullWidth
                  label="Confirm Password"
                  margin="normal"
                  variant="outlined"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => handleConfirmPasswordChange(e.target.value)}
                  onFocus={() => handleFieldFocus('confirmPassword')}
                  onBlur={handleFieldBlur}
                  autoComplete="new-password"
                  error={
                    (!!error && error.toLowerCase().includes('password')) ||
                    (!!authError && authError.field === 'confirmPassword') ||
                    (!!confirmPasswordValidation && !confirmPasswordValidation.isValid)
                  }
                  helperText={
                    focusedField === 'confirmPassword'
                      ? getFieldHelpText('confirmPassword')
                      : confirmPasswordValidation && !confirmPasswordValidation.isValid
                        ? confirmPasswordValidation.message
                        : authError && authError.field === 'confirmPassword'
                          ? authError.message
                          : error && error.toLowerCase().includes('password') && error.toLowerCase().includes('match')
                            ? error
                            : " "
                  }
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label="toggle password visibility"
                          onClick={handleClickShowPassword}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={isSubmitting}
                  sx={{
                    mt: 3,
                    py: 1.5,
                    borderRadius: 2,
                    textTransform: 'none',
                    fontSize: '1rem'
                  }}
                >
                  {isSubmitting ? 'Creating Account...' : 'Create Account'}
                </Button>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  align="center"
                  sx={{ display: 'block', mt: 2 }}
                >
                  All data is stored locally on your device
                </Typography>
              </form>
              
            </TabPanel>
          </Paper>
          
        </Box>
    </Box>
  );
};

export default Login;
