import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Grid,
  Alert,
  Divider,
  Card,
  CardContent,
  IconButton,
  InputAdornment,
  CircularProgress,
  Avatar
} from '@mui/material';
import { Visibility, VisibilityOff, Person, Email, Lock } from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useApi } from '../contexts/ServiceContext';

const ProfilePage = () => {
  const { user } = useAuth();
  const apiService = useApi();
  
  // Username update state
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [isUpdatingUsername, setIsUpdatingUsername] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState(false);
  
  // Password update state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Initialize form with user data
  useEffect(() => {
    if (user) {
      setUsername(user.username || '');
    }
  }, [user]);

  // Handle username update
  const handleUsernameUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess(false);
    
    if (!username.trim()) {
      setUsernameError('Username cannot be empty');
      return;
    }
    
    setIsUpdatingUsername(true);
    
    try {
      const response = await apiService?.put('/api/v1/auth/profile/username', { username });
      setUsernameSuccess(true);
      
      // Refresh user info to update the UI
      try {
        const updatedUser = await apiService?.get('/api/v1/auth/me');
        // Update local state to reflect the changes
        if (updatedUser) {
          window.location.reload(); // Simple solution to refresh the page with updated user data
        }
      } catch (refreshErr) {
        console.error('Error refreshing user info:', refreshErr);
      }
    } catch (err: any) {
      console.error('Error updating username:', err);
      
      if (err.response && err.response.data && err.response.data.detail) {
        setUsernameError(err.response.data.detail);
      } else {
        setUsernameError('Failed to update username. Please try again.');
      }
    } finally {
      setIsUpdatingUsername(false);
    }
  };

  // Handle password update
  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess(false);
    
    // Validate password fields
    if (!currentPassword) {
      setPasswordError('Current password is required');
      return;
    }
    
    if (!newPassword) {
      setPasswordError('New password is required');
      return;
    }
    
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }
    
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match');
      return;
    }
    
    setIsUpdatingPassword(true);
    
    try {
      const response = await apiService?.put('/api/v1/auth/profile/password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword
      });
      
      setPasswordSuccess(true);
      
      // Clear password fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      console.error('Error updating password:', err);
      
      if (err.response && err.response.data && err.response.data.detail) {
        setPasswordError(err.response.data.detail);
      } else {
        setPasswordError('Failed to update password. Please try again.');
      }
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  // Toggle password visibility
  const togglePasswordVisibility = (field: 'current' | 'new' | 'confirm') => {
    if (field === 'current') {
      setShowCurrentPassword(!showCurrentPassword);
    } else if (field === 'new') {
      setShowNewPassword(!showNewPassword);
    } else {
      setShowConfirmPassword(!showConfirmPassword);
    }
  };

  if (!user) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', p: 3 }}>
      <Typography variant="h4" gutterBottom>
        Profile
      </Typography>
      
      <Grid container spacing={3}>
        {/* User Info Card */}
        <Grid item xs={12} md={4}>
          <Card sx={{ height: '100%' }}>
            <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
              <Avatar 
                sx={{ 
                  width: 100, 
                  height: 100, 
                  mb: 2,
                  bgcolor: 'primary.main',
                  fontSize: '2.5rem'
                }}
              >
                {user.username ? user.username[0].toUpperCase() : 'U'}
              </Avatar>
              
              <Typography variant="h5" gutterBottom>
                {user.full_name || user.username}
              </Typography>
              
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Email fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                <Typography variant="body1" color="text.secondary">
                  {user.email}
                </Typography>
              </Box>
              
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Person fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} />
                <Typography variant="body1" color="text.secondary">
                  {user.username}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        
        {/* Settings Cards */}
        <Grid item xs={12} md={8}>
          <Grid container spacing={3}>
            {/* Username Update Card */}
            <Grid item xs={12}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Update Username
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                {usernameSuccess && (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    Username updated successfully!
                  </Alert>
                )}
                
                {usernameError && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {usernameError}
                  </Alert>
                )}
                
                <form onSubmit={handleUsernameUpdate}>
                  <TextField
                    fullWidth
                    label="Username"
                    variant="outlined"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Person />
                        </InputAdornment>
                      ),
                    }}
                    sx={{ mb: 2 }}
                  />
                  
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={isUpdatingUsername || username === user.username}
                    sx={{ mt: 1 }}
                  >
                    {isUpdatingUsername ? 'Updating...' : 'Update Username'}
                  </Button>
                </form>
              </Paper>
            </Grid>
            
            {/* Password Update Card */}
            <Grid item xs={12}>
              <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>
                  Change Password
                </Typography>
                <Divider sx={{ mb: 3 }} />
                
                {passwordSuccess && (
                  <Alert severity="success" sx={{ mb: 2 }}>
                    Password updated successfully!
                  </Alert>
                )}
                
                {passwordError && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {passwordError}
                  </Alert>
                )}
                
                <form onSubmit={handlePasswordUpdate}>
                  <TextField
                    fullWidth
                    label="Current Password"
                    variant="outlined"
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Lock />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label="toggle password visibility"
                            onClick={() => togglePasswordVisibility('current')}
                            edge="end"
                          >
                            {showCurrentPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    sx={{ mb: 2 }}
                  />
                  
                  <TextField
                    fullWidth
                    label="New Password"
                    variant="outlined"
                    type={showNewPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Lock />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label="toggle password visibility"
                            onClick={() => togglePasswordVisibility('new')}
                            edge="end"
                          >
                            {showNewPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    sx={{ mb: 2 }}
                  />
                  
                  <TextField
                    fullWidth
                    label="Confirm New Password"
                    variant="outlined"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <Lock />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label="toggle password visibility"
                            onClick={() => togglePasswordVisibility('confirm')}
                            edge="end"
                          >
                            {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    }}
                    sx={{ mb: 2 }}
                  />
                  
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={isUpdatingPassword || !currentPassword || !newPassword || !confirmPassword}
                    sx={{ mt: 1 }}
                  >
                    {isUpdatingPassword ? 'Updating...' : 'Change Password'}
                  </Button>
                </form>
              </Paper>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
};

export default ProfilePage;