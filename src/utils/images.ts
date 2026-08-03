/**
 * src/utils/images.ts
 * Image handling and placeholder generation for stories
 */

/**
 * Generate a placeholder image URL based on story content
 * Uses a combination of services for reliable fallbacks
 *
 * @param storyId - Story ID for uniqueness
 * @param title - Story title for context
 * @param category - Story category
 * @returns Placeholder image URL
 */
export function generatePlaceholderImageUrl(
  storyId: string,
  title: string,
  _category: string // Kept for future color-based placeholders
): string {
  // Self-contained deterministic SVG placeholder (no external image service).
  // Same seed + hashing as the Python pipeline so both resolve to one image.
  const seed = `verum-${storyId}-${title}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  const cx = 120 + (h % 560);
  const cy = 80 + ((h >>> 3) % 290);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='450'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='#1a1a1a'/>` +
    `<stop offset='1' stop-color='hsl(${hue},45%,16%)'/></linearGradient></defs>` +
    `<rect width='800' height='450' fill='url(#g)'/>` +
    `<circle cx='${cx}' cy='${cy}' r='140' fill='hsl(${hue2},55%,45%)' opacity='0.18'/>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Get a category color for placeholder background
 * Used for gradient-based placeholders
 */
export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    technology: '#3B82F6', // Blue
    science: '#10B981', // Green
    politics: '#EF4444', // Red
    world: '#F59E0B', // Amber
    news: '#8B5CF6', // Purple
    business: '#06B6D4', // Cyan
    sports: '#EC4899', // Pink
    health: '#14B8A6', // Teal
  };

  return colors[category.toLowerCase()] || '#6B7280'; // Default gray
}

/**
 * Create inline SVG placeholder with category color
 * Useful for immediate display before image loads
 */
export function generateSVGPlaceholder(
  category: string,
  width: number = 400,
  height: number = 300
): string {
  const color = getCategoryColor(category);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color};stop-opacity:0.8" />
          <stop offset="100%" style="stop-color:#1a1a1a;stop-opacity:0.9" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)"/>
      <text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#ffffff" font-size="24" font-family="Arial">
        📰 ${category}
      </text>
    </svg>
  `;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Validate if an image URL is accessible
 * @param url - Image URL to validate
 * @param timeout - Timeout in ms
 * @returns Promise<boolean>
 */
export async function isImageAccessible(url: string, timeout: number = 5000): Promise<boolean> {
  if (!url || !url.startsWith('http')) return false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      method: 'HEAD',
      mode: 'no-cors',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return res.status < 400;
  } catch (error) {
    return false;
  }
}

/**
 * Get optimized image URL with lazy loading attributes
 * Only accepts valid URLs (http://, https://) - file paths are rejected
 */
export function getOptimizedImageUrl(url: string | undefined, fallback: string): string {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return fallback;
  }
  // Only accept valid HTTP/HTTPS URLs or data URIs
  const validUrl = url.toLowerCase().trim();
  if (validUrl.startsWith('http://') || validUrl.startsWith('https://') || validUrl.startsWith('data:')) {
    return url;
  }
  // Reject file paths like "images/hero.jpg" - use fallback placeholder
  return fallback;
}

/**
 * Image preloader - loads image and returns blob URL
 * Useful for progressive enhancement
 */
export async function preloadImage(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn(`[Images] Failed to preload ${url}:`, error);
    throw error;
  }
}

/**
 * Batch preload multiple images
 */
export async function preloadImages(urls: string[]): Promise<string[]> {
  return Promise.all(
    urls.map((url) =>
      preloadImage(url).catch(() => {
        console.warn(`[Images] Skipping failed image: ${url}`);
        return '';
      })
    )
  ).then((results) => results.filter(Boolean));
}

/**
 * Generate BLIP (Base64 Low-Quality Image Placeholder) for progressive loading
 * Creates a tiny blurred version to show while loading
 */
export function generateBLIP(color: string, width: number = 10, height: number = 10): string {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="${color}"/>
      <filter id="blur">
        <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
      </filter>
      <rect width="${width}" height="${height}" fill="${color}" filter="url(#blur)" opacity="0.5"/>
    </svg>
  `;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Image metadata for optimization
 */
export interface ImageMetadata {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  placeholder?: string;
  srcset?: string;
}

/**
 * Create responsive image metadata
 */
export function createImageMetadata(
  src: string,
  alt: string,
  category: string,
  width: number = 400,
  height: number = 300
): ImageMetadata {
  const placeholder = generateBLIP(getCategoryColor(category), 10, 8);
  const srcset = `
    ${src}?w=400 400w,
    ${src}?w=800 800w,
    ${src}?w=1200 1200w
  `.trim();

  return {
    src,
    alt,
    width,
    height,
    placeholder,
    srcset,
  };
}
