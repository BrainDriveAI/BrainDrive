import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircularProgress, Box } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/ServiceContext';
import { defaultPageService } from '../services/defaultPageService';

const DefaultPageRedirect: React.FC = () => {
  const { user } = useAuth();
  const settingsService = useSettings();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const performRedirect = async () => {
      if (!user) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        const rawSettings = await settingsService.getSetting<any>('general_settings', { userId: user.id });
        let settings = rawSettings;
        if (typeof rawSettings === 'string') {
          try {
            settings = JSON.parse(rawSettings);
          } catch (err) {
            console.error('Error parsing general settings:', err);
          }
        }
        let defaultPage: string = 'Dashboard';
        if (settings && settings.settings) {
          const entry = settings.settings.find((s: any) => s.Setting_Name === 'default_page');
          if (entry && entry.Setting_Data) {
            defaultPage = entry.Setting_Data;
          }
        }
        if (defaultPage === 'Dashboard') {
          navigate('/dashboard', { replace: true });
        } else {
          try {
            const page = await defaultPageService.getDefaultPage(defaultPage);
            if (page && page.route) {
              navigate(`/pages/${page.route}`, { replace: true });
            } else {
              console.error('Default page not found or missing route');
              navigate('/dashboard', { replace: true });
            }
          } catch (err) {
            console.error('Error loading default page:', err);
            navigate('/dashboard', { replace: true });
          }
        }
      } catch (err) {
        console.error('Failed to load general settings:', err);
        navigate('/dashboard', { replace: true });
      } finally {
        setLoading(false);
      }
    };

    performRedirect();
  }, [user, settingsService, navigate]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }
  return null;
};

export default DefaultPageRedirect;
