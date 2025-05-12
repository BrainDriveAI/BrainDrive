import React from 'react';
import { RouteManagementDialog as OldRouteManagementDialog } from '../../../../components/RouteManagementDialog';
import { usePluginStudio } from '../../hooks';

interface RouteManagementDialogAdapterProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Adapter component that uses the old RouteManagementDialog with the new context system
 * @param props The component props
 * @returns The route management dialog adapter component
 */
export const RouteManagementDialog: React.FC<RouteManagementDialogAdapterProps> = ({ 
  open, 
  onClose 
}) => {
  const { 
    pages,
    updatePage,
    // We don't have a direct refreshPages function in the context
  } = usePluginStudio();

  // Handle updating a page
  const handleUpdatePage = async (pageId: string, updates: any) => {
    await updatePage(pageId, updates);
  };

  // Handle refreshing pages
  // Since we don't have a direct refreshPages function, we'll create a placeholder
  // In a real implementation, you might want to add this function to the context
  const handleRefreshPages = async () => {
    console.log('RefreshPages called - this is a placeholder implementation');
    // In a real implementation, you might want to refresh the pages
    // For example, by fetching them again from the server
    // For now, we'll just log a message
  };

  return (
    <OldRouteManagementDialog
      open={open}
      onClose={onClose}
      pages={pages || []}
      onUpdatePage={handleUpdatePage}
      onRefreshPages={handleRefreshPages}
    />
  );
};