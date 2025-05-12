import React from 'react';
import { SvgIconProps } from '@mui/material';
import * as Icons from '@mui/icons-material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

interface IconResolverProps extends Omit<SvgIconProps, 'component'> {
  icon: string | React.ComponentType<SvgIconProps>;
  fallbackIcon?: React.ComponentType<SvgIconProps>;
  suppressWarnings?: boolean;
}

/**
 * Dynamically resolves an icon identifier to a Material-UI icon component.
 * Supports both string names and direct component references.
 *
 * Example usage:
 * <IconResolver icon="Brightness7" />
 * <IconResolver icon={Icons.Brightness7} />
 * <IconResolver icon="InvalidIcon" fallbackIcon={HelpOutlineIcon} />
 */
export const IconResolver: React.FC<IconResolverProps> = ({ 
  icon, 
  fallbackIcon = HelpOutlineIcon, 
  suppressWarnings = false,
  ...props 
}) => {
  // If icon is already a component, use it directly
  if (typeof icon !== 'string') {
    return React.createElement(icon, props);
  }

  // Dynamically resolve the icon from MUI icons
  const IconComponent = (Icons as Record<string, React.ComponentType<SvgIconProps>>)[icon];

  // If icon is not found or there's an error, return the fallback icon without logging warnings
  if (!IconComponent) {
    return React.createElement(fallbackIcon, props);
  }

  try {
    return <IconComponent {...props} />;
  } catch (error) {
    // If there's an error rendering the icon, use the fallback
    return React.createElement(fallbackIcon, props);
  }
};
