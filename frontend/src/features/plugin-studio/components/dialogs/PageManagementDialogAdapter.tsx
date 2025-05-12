import React from 'react';
import { PageManagementDialog as OldPageManagementDialog } from '../../../../components/PageManagementDialog';
import { usePluginStudio } from '../../hooks';

interface PageManagementDialogAdapterProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Adapter component that uses the old PageManagementDialog with the new context system
 * @param props The component props
 * @returns The page management dialog adapter component
 */
export const PageManagementDialog: React.FC<PageManagementDialogAdapterProps> = ({ 
  open, 
  onClose 
}) => {
  const { 
    currentPage,
    publishPage,
    backupPage,
    restorePage,
    updatePage
  } = usePluginStudio();

  // Only render the dialog if we have a current page
  if (!currentPage) {
    return null;
  }

  // Handle publishing a page
  const handlePublish = async (pageId: string, publish: boolean) => {
    await publishPage(pageId, publish);
  };

  // Handle backing up a page
  const handleBackup = async (pageId: string) => {
    await backupPage(pageId);
  };

  // Handle restoring a page from backup
  const handleRestore = async (pageId: string) => {
    await restorePage(pageId);
  };

  // Handle updating a page
  const handleUpdatePage = async (pageId: string, updates: any) => {
    await updatePage(pageId, updates);
  };

  return (
    <OldPageManagementDialog
      open={open}
      onClose={onClose}
      page={currentPage}
      onPublish={handlePublish}
      onBackup={handleBackup}
      onRestore={handleRestore}
      onUpdatePage={handleUpdatePage}
    />
  );
};