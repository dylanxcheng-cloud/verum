/**
 * Verum News — API Layer
 * Centralized data fetching and validation
 */

import type { Story, StoriesData } from '../types/index.js';

/**
 * Load all stories from stories.json
 * @throws Error if fetch fails or JSON is invalid
 */
export async function loadStories(): Promise<StoriesData> {
  const url = import.meta.env.VITE_STORIES_URL || '/stories.json';

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to load stories: HTTP ${res.status}`);
    }

    const data: StoriesData = await res.json();
    return data;
  } catch (error) {
    console.error('[Verum API] loadStories error:', error);
    throw error;
  }
}

/**
 * Get a single story by ID
 * @param id - Story ID
 * @returns Story or null if not found
 */
export async function getStoryById(id: string): Promise<Story | null> {
  try {
    const data = await loadStories();
    return data.stories[id] ?? null;
  } catch (error) {
    console.error('[Verum API] getStoryById error:', error);
    return null;
  }
}

/**
 * Search stories by keyword
 * @param query - Search term
 * @returns Array of matching stories
 */
export function searchStories(stories: Story[], query: string): Story[] {
  const q = query.toLowerCase();
  return stories.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.content.toLowerCase().includes(q) ||
      s.author.toLowerCase().includes(q)
  );
}

/**
 * Filter stories by category
 * @param stories - Array of stories
 * @param category - Category to filter by
 * @returns Filtered stories
 */
export function filterByCategory(stories: Story[], category: string): Story[] {
  return stories.filter((s) => s.category === category);
}

/**
 * Get unique categories from stories
 */
export function getCategories(stories: Story[]): string[] {
  return Array.from(new Set(stories.map((s) => s.category)));
}

/**
 * Format relative time string
 * @param ts - Timestamp string
 * @returns Human-readable time (e.g., "2 hours ago")
 */
export function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) {
    const m = Math.floor(diff / 60);
    return `${m} minute${m > 1 ? 's' : ''} ago`;
  }
  if (diff < 86400) {
    const h = Math.floor(diff / 3600);
    return `${h} hour${h > 1 ? 's' : ''} ago`;
  }
  if (diff < 604800) {
    const d = Math.floor(diff / 86400);
    return `${d} day${d > 1 ? 's' : ''} ago`;
  }

  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format current date
 * @returns Formatted date string
 */
export function formatCurrentDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Format copyright year
 * @returns Copyright text with current year
 */
export function getCopyright(): string {
  return `© ${new Date().getFullYear()} Verum. All rights reserved.`;
}
