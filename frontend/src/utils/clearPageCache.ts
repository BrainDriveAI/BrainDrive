/**
 * Clear page cache for a specific page or all pages
 */
export function clearPageCache(pageId?: string) {
  if (typeof window === 'undefined') return;
  
  const keysToRemove: string[] = [];
  
  // Find all page cache keys
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes('page_cache_')) {
      if (!pageId || key.includes(pageId)) {
        keysToRemove.push(key);
      }
    }
  }
  
  // Remove the keys
  keysToRemove.forEach(key => {
    localStorage.removeItem(key);
    console.log(`[Cache] Cleared cache for key: ${key}`);
  });
  
  if (keysToRemove.length > 0) {
    console.log(`[Cache] Cleared ${keysToRemove.length} cached page(s)`);
  }
}

// Clear AI Chat page cache on load (temporary fix)
if (typeof window !== 'undefined') {
  // Clear cache for AI Chat page
  clearPageCache('0c8f4dc670a4409c87030c3000779e14');
  clearPageCache('ai-chat');
}