import {
  SEOService as ISEOService,
  PublishedPageMetadata,
  StructuredData,
  SEOIssue,
  PublishedPageData
} from '../types/published';

/**
 * SEOService - Handles dynamic SEO optimization, meta tag generation, and structured data
 */
export class SEOService implements ISEOService {
  private metaTagsCache = new Map<string, string>();
  private structuredDataCache = new Map<string, string>();

  /**
   * Generate HTML meta tags from page metadata
   */
  generateMetaTags(metadata: PublishedPageMetadata): string {
    const cacheKey = this.generateCacheKey(metadata);
    
    if (this.metaTagsCache.has(cacheKey)) {
      return this.metaTagsCache.get(cacheKey)!;
    }

    const metaTags: string[] = [];

    // Basic meta tags
    metaTags.push(`<title>${this.escapeHtml(metadata.title)}</title>`);
    metaTags.push(`<meta name="description" content="${this.escapeHtml(metadata.description)}">`);
    
    if (metadata.keywords.length > 0) {
      metaTags.push(`<meta name="keywords" content="${this.escapeHtml(metadata.keywords.join(', '))}">`);
    }

    if (metadata.author) {
      metaTags.push(`<meta name="author" content="${this.escapeHtml(metadata.author)}">`);
    }

    // Technical meta tags
    metaTags.push(`<meta name="robots" content="${metadata.robots || 'index,follow'}">`);
    metaTags.push(`<meta name="viewport" content="${metadata.viewport || 'width=device-width, initial-scale=1'}">`);
    metaTags.push(`<meta charset="${metadata.charset || 'utf-8'}">`);

    // Canonical URL
    if (metadata.canonicalUrl) {
      metaTags.push(`<link rel="canonical" href="${this.escapeHtml(metadata.canonicalUrl)}">`);
    }

    // Open Graph tags
    if (metadata.ogTitle || metadata.title) {
      metaTags.push(`<meta property="og:title" content="${this.escapeHtml(metadata.ogTitle || metadata.title)}">`);
    }
    
    if (metadata.ogDescription || metadata.description) {
      metaTags.push(`<meta property="og:description" content="${this.escapeHtml(metadata.ogDescription || metadata.description)}">`);
    }
    
    if (metadata.ogImage) {
      metaTags.push(`<meta property="og:image" content="${this.escapeHtml(metadata.ogImage)}">`);
    }
    
    if (metadata.ogType) {
      metaTags.push(`<meta property="og:type" content="${this.escapeHtml(metadata.ogType)}">`);
    }

    // Twitter Card tags
    if (metadata.twitterCard) {
      metaTags.push(`<meta name="twitter:card" content="${this.escapeHtml(metadata.twitterCard)}">`);
    }
    
    if (metadata.twitterTitle || metadata.title) {
      metaTags.push(`<meta name="twitter:title" content="${this.escapeHtml(metadata.twitterTitle || metadata.title)}">`);
    }
    
    if (metadata.twitterDescription || metadata.description) {
      metaTags.push(`<meta name="twitter:description" content="${this.escapeHtml(metadata.twitterDescription || metadata.description)}">`);
    }
    
    if (metadata.twitterImage || metadata.ogImage) {
      metaTags.push(`<meta name="twitter:image" content="${this.escapeHtml(metadata.twitterImage || metadata.ogImage || '')}">`);
    }

    // Publication meta tags
    if (metadata.publishedAt) {
      metaTags.push(`<meta name="article:published_time" content="${metadata.publishedAt.toISOString()}">`);
    }
    
    if (metadata.lastModified) {
      metaTags.push(`<meta name="article:modified_time" content="${metadata.lastModified.toISOString()}">`);
    }

    const result = metaTags.join('\n');
    this.metaTagsCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Generate structured data JSON-LD
   */
  generateStructuredData(data: StructuredData[]): string {
    if (data.length === 0) {
      return '';
    }

    const cacheKey = JSON.stringify(data);
    
    if (this.structuredDataCache.has(cacheKey)) {
      return this.structuredDataCache.get(cacheKey)!;
    }

    const structuredDataObjects = data.map(item => ({
      '@context': item.context || 'https://schema.org',
      '@type': item.type,
      ...item.data
    }));

    const jsonLd = structuredDataObjects.length === 1 
      ? structuredDataObjects[0]
      : structuredDataObjects;

    const result = `<script type="application/ld+json">${JSON.stringify(jsonLd, null, 2)}</script>`;
    this.structuredDataCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Validate SEO elements and return issues
   */
  validateSEO(page: PublishedPageData): SEOIssue[] {
    const issues: SEOIssue[] = [];
    const metadata = page.metadata;

    // Title validation
    if (!metadata.title) {
      issues.push({
        type: 'missing',
        severity: 'critical',
        element: 'title',
        message: 'Page title is missing',
        recommendation: 'Add a descriptive title between 30-60 characters'
      });
    } else if (metadata.title.length < 30) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'title',
        message: 'Page title is too short',
        recommendation: 'Expand title to 30-60 characters for better SEO'
      });
    } else if (metadata.title.length > 60) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'title',
        message: 'Page title is too long',
        recommendation: 'Shorten title to under 60 characters to prevent truncation'
      });
    }

    // Description validation
    if (!metadata.description) {
      issues.push({
        type: 'missing',
        severity: 'critical',
        element: 'description',
        message: 'Meta description is missing',
        recommendation: 'Add a compelling description between 120-160 characters'
      });
    } else if (metadata.description.length < 120) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'description',
        message: 'Meta description is too short',
        recommendation: 'Expand description to 120-160 characters'
      });
    } else if (metadata.description.length > 160) {
      issues.push({
        type: 'optimization',
        severity: 'medium',
        element: 'description',
        message: 'Meta description is too long',
        recommendation: 'Shorten description to under 160 characters'
      });
    }

    // Keywords validation
    if (metadata.keywords.length === 0) {
      issues.push({
        type: 'missing',
        severity: 'low',
        element: 'keywords',
        message: 'No keywords specified',
        recommendation: 'Add relevant keywords to improve discoverability'
      });
    } else if (metadata.keywords.length > 10) {
      issues.push({
        type: 'optimization',
        severity: 'low',
        element: 'keywords',
        message: 'Too many keywords',
        recommendation: 'Focus on 5-10 most relevant keywords'
      });
    }

    // Open Graph validation
    if (!metadata.ogTitle && !metadata.title) {
      issues.push({
        type: 'missing',
        severity: 'high',
        element: 'og:title',
        message: 'Open Graph title is missing',
        recommendation: 'Add og:title for better social media sharing'
      });
    }

    if (!metadata.ogDescription && !metadata.description) {
      issues.push({
        type: 'missing',
        severity: 'high',
        element: 'og:description',
        message: 'Open Graph description is missing',
        recommendation: 'Add og:description for better social media sharing'
      });
    }

    if (!metadata.ogImage) {
      issues.push({
        type: 'missing',
        severity: 'medium',
        element: 'og:image',
        message: 'Open Graph image is missing',
        recommendation: 'Add an engaging image for social media sharing'
      });
    }

    // Canonical URL validation
    if (!metadata.canonicalUrl) {
      issues.push({
        type: 'missing',
        severity: 'medium',
        element: 'canonical',
        message: 'Canonical URL is missing',
        recommendation: 'Add canonical URL to prevent duplicate content issues'
      });
    }

    // Structured data validation
    if (!metadata.structuredData || metadata.structuredData.length === 0) {
      issues.push({
        type: 'missing',
        severity: 'low',
        element: 'structured-data',
        message: 'No structured data found',
        recommendation: 'Add structured data to improve search engine understanding'
      });
    }

    return issues;
  }

  /**
   * Generate sitemap XML for multiple pages
   */
  generateSitemap(pages: PublishedPageData[]): string {
    const publishedPages = pages.filter(page => page.publicationStatus.isPublished);
    
    const urlEntries = publishedPages.map(page => {
      const lastmod = page.metadata.lastModified.toISOString().split('T')[0];
      const priority = this.calculateSitemapPriority(page);
      const changefreq = this.calculateChangeFrequency(page);

      return `  <url>
    <loc>${this.escapeXml(page.metadata.canonicalUrl || `https://example.com${page.route}`)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
  }

  /**
   * Update meta tags in the document head
   */
  updateMetaTags(metadata: PublishedPageMetadata): void {
    // Update document title
    document.title = metadata.title;

    // Update or create meta tags
    this.updateMetaTag('name', 'description', metadata.description);
    this.updateMetaTag('name', 'keywords', metadata.keywords.join(', '));
    this.updateMetaTag('name', 'author', metadata.author || '');
    this.updateMetaTag('name', 'robots', metadata.robots || 'index,follow');
    this.updateMetaTag('name', 'viewport', metadata.viewport || 'width=device-width, initial-scale=1');

    // Update Open Graph tags
    this.updateMetaTag('property', 'og:title', metadata.ogTitle || metadata.title);
    this.updateMetaTag('property', 'og:description', metadata.ogDescription || metadata.description);
    if (metadata.ogImage) this.updateMetaTag('property', 'og:image', metadata.ogImage);
    if (metadata.ogType) this.updateMetaTag('property', 'og:type', metadata.ogType);

    // Update Twitter Card tags
    if (metadata.twitterCard) this.updateMetaTag('name', 'twitter:card', metadata.twitterCard);
    if (metadata.twitterTitle) this.updateMetaTag('name', 'twitter:title', metadata.twitterTitle);
    if (metadata.twitterDescription) this.updateMetaTag('name', 'twitter:description', metadata.twitterDescription);
    if (metadata.twitterImage) this.updateMetaTag('name', 'twitter:image', metadata.twitterImage);

    // Update canonical URL
    if (metadata.canonicalUrl) {
      this.updateCanonicalLink(metadata.canonicalUrl);
    }

    // Update structured data
    if (metadata.structuredData && metadata.structuredData.length > 0) {
      this.updateStructuredData(metadata.structuredData);
    }
  }

  /**
   * Clear SEO caches
   */
  clearCache(): void {
    this.metaTagsCache.clear();
    this.structuredDataCache.clear();
  }

  // Private helper methods

  private generateCacheKey(metadata: PublishedPageMetadata): string {
    return JSON.stringify({
      title: metadata.title,
      description: metadata.description,
      keywords: metadata.keywords,
      ogTitle: metadata.ogTitle,
      ogDescription: metadata.ogDescription,
      ogImage: metadata.ogImage,
      lastModified: metadata.lastModified.getTime()
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private updateMetaTag(attribute: string, name: string, content: string): void {
    if (!content) return;

    let meta = document.querySelector(`meta[${attribute}="${name}"]`) as HTMLMetaElement;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute(attribute, name);
      document.head.appendChild(meta);
    }
    meta.content = content;
  }

  private updateCanonicalLink(href: string): void {
    let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = href;
  }

  private updateStructuredData(data: StructuredData[]): void {
    // Remove existing structured data
    const existingScripts = document.querySelectorAll('script[type="application/ld+json"]');
    existingScripts.forEach(script => script.remove());

    // Add new structured data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = this.generateStructuredData(data).replace(/<script[^>]*>|<\/script>/g, '');
    document.head.appendChild(script);
  }

  private calculateSitemapPriority(page: PublishedPageData): string {
    // Homepage gets highest priority
    if (page.route === '/' || page.route === '/home') {
      return '1.0';
    }
    
    // Important pages get high priority
    if (page.route.includes('/about') || page.route.includes('/contact')) {
      return '0.8';
    }
    
    // Regular pages get medium priority
    return '0.6';
  }

  private calculateChangeFrequency(page: PublishedPageData): string {
    const now = new Date();
    const lastModified = page.metadata.lastModified;
    const daysSinceModified = Math.floor((now.getTime() - lastModified.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceModified < 7) return 'daily';
    if (daysSinceModified < 30) return 'weekly';
    if (daysSinceModified < 365) return 'monthly';
    return 'yearly';
  }
}

export default SEOService;