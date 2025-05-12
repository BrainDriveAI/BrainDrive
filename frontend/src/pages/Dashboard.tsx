import React from 'react';
import {
  Box,
  Grid,
  Paper,
  Typography,
  Card,
  CardContent,
  CardActionArea,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ExtensionIcon from '@mui/icons-material/Extension';
import SettingsIcon from '@mui/icons-material/Settings';
import BuildIcon from '@mui/icons-material/Build'; // Icon for Plugin Manager
import { useAuth } from '../contexts/AuthContext';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const cards = [
    {
      title: 'BrainDrive Studio',
      description: 'Create and manage your plugins',
      icon: <ExtensionIcon sx={{ fontSize: 40 }} />,
      path: '/plugin-studio',
      color: '#2196F3'
    },
    {
      title: 'Settings',
      description: 'Configure your preferences',
      icon: <SettingsIcon sx={{ fontSize: 40 }} />,
      path: '/settings',
      color: '#FF9800'
    },
    {
      title: 'Plugin Manager',
      description: 'Browse and manage installed plugins',
      icon: <BuildIcon sx={{ fontSize: 40 }} />,
      path: '/plugin-manager',
      color: '#4CAF50'
    }
  ];

  return (
    <Box sx={{ p: 3 }}>
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          Welcome back, {user?.username || 'User'}!
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Get started by creating a new plugin or managing your existing ones.
        </Typography>
      </Paper>

      <Grid container spacing={3}>
        {cards.map((card) => (
          <Grid item xs={12} sm={6} md={4} key={card.title}>
            <Card>
              <CardActionArea onClick={() => navigate(card.path)}>
                <CardContent sx={{ textAlign: 'center', py: 4 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      mb: 2,
                      width: 80,
                      height: 80,
                      borderRadius: '50%',
                      backgroundColor: `${card.color}20`,
                      margin: '0 auto',
                    }}
                  >
                    {React.cloneElement(card.icon, {
                      sx: { fontSize: 40, color: card.color }
                    })}
                  </Box>
                  <Typography variant="h6" gutterBottom>
                    {card.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {card.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default Dashboard;
