import { useState } from 'react';
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  
  // Configuration option: Set to true to show the Full Name field in registration form
  // This can be easily toggled when full name collection is needed in the future
  const [showFullNameField] = useState<boolean>(false);
  
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
    setError('');
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    console.log('Login submission started - disabling button');
    
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      // Provide more user-friendly error messages
      if (err.response && err.response.status === 401) {
        setError('Invalid email or password. Please try again.');
      } else if (err.response && err.response.status === 404) {
        setError('Account not found. Please check your email or register for a new account.');
      } else if (err.message && err.message.includes('Network Error')) {
        setError('Unable to connect to the server. Please check your internet connection and try again.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to login. Please try again later.');
      }
      console.log('Login error occurred - re-enabling button');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    console.log('Registration submission started - disabling button');

    if (password !== confirmPassword) {
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
      // Provide more user-friendly error messages for registration
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
      console.log('Registration error occurred - re-enabling button');
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

            {error && (
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
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => handleFieldFocus('email')}
                  onBlur={handleFieldBlur}
                  autoComplete="username"
                  error={!!error && error.toLowerCase().includes('email')}
                  helperText={
                    focusedField === 'email'
                      ? getFieldHelpText('email')
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
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => handleFieldFocus('password')}
                  onBlur={handleFieldBlur}
                  autoComplete="current-password"
                  error={!!error && error.toLowerCase().includes('password')}
                  helperText={
                    focusedField === 'password'
                      ? getFieldHelpText('password')
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
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => handleFieldFocus('username')}
                  onBlur={handleFieldBlur}
                  autoComplete="username"
                  error={!!error && error.toLowerCase().includes('username')}
                  helperText={
                    focusedField === 'username'
                      ? getFieldHelpText('username')
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
                  onChange={(e) => setEmail(e.target.value)}
                  onFocus={() => handleFieldFocus('email')}
                  onBlur={handleFieldBlur}
                  autoComplete="username"
                  error={!!error && error.toLowerCase().includes('email')}
                  helperText={
                    focusedField === 'email'
                      ? getFieldHelpText('email')
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
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => handleFieldFocus('password')}
                  onBlur={handleFieldBlur}
                  autoComplete="new-password"
                  error={!!error && error.toLowerCase().includes('password')}
                  helperText={
                    focusedField === 'password'
                      ? getFieldHelpText('password')
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
                <TextField
                  fullWidth
                  label="Confirm Password"
                  margin="normal"
                  variant="outlined"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onFocus={() => handleFieldFocus('confirmPassword')}
                  onBlur={handleFieldBlur}
                  autoComplete="new-password"
                  error={!!error && error.toLowerCase().includes('password')}
                  helperText={
                    focusedField === 'confirmPassword'
                      ? getFieldHelpText('confirmPassword')
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
