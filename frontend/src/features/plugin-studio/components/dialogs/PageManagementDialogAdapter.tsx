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
    savePage,
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
    console.log('🚀 PageManagementDialogAdapter handlePublish called:', { pageId, publish, currentPageId: currentPage?.id });
    
    try {
      // Auto-save if publishing the current page (always save to ensure latest changes are published)
      if (publish && currentPage && pageId === currentPage.id) {
        console.log('🔄 Auto-saving page before publishing...', { pageId, currentPageId: currentPage.id });
        
        try {
          console.log('💾 Calling savePage...');
          await savePage(pageId);
          console.log('✅ Auto-save completed successfully');
        } catch (saveErr) {
          console.error('❌ Auto-save failed:', saveErr);
          throw new Error('Failed to auto-save page before publishing. Please save manually first.');
        }
      } else {
        console.log('⏭️ Skipping auto-save:', { publish, hasCurrentPage: !!currentPage, isCurrentPage: pageId === currentPage?.id });
      }
      
      // Proceed with publish/unpublish
      console.log('📤 Calling publishPage...');
      await publishPage(pageId, publish);
      console.log('✅ Publish completed successfully');
    } catch (err) {
      console.error('❌ Publish failed:', err);
      throw err;
    }
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