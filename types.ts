/**
 * Verum News — Type Definitions
 * Centralized types for the entire application
 */

/** A cited source for footnote attribution */
export interface StorySource {
  n: number;
  label: string;
  url?: string;
}

/** Core story/article type */
export interface Story {
  id: string;
  title: string;
  content: string;
  author?: string; // legacy stories only; new articles attribute via `sources`
  source?: string;
  sources?: StorySource[];
  category: string;
  region?: string; // Alternative to category
  image: string;
  publishedAt: string;
  readTime: number;
  featured?: boolean;
}

/** Featured stories section */
export interface Featured {
  hero: Story | null;
  stack: Story[];
  latest: Story[];
  world: Story[];
}

/** Top-level stories data structure */
export interface StoriesData {
  stories: Record<string, Story>;
  featured: Featured;
  updatedAt?: string;
}

/** API response wrapper */
export interface ApiResponse<T> {
  status: number;
  data: T | null;
  error: string | null;
}

/** Async state tracking */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
}

/** Component props for common patterns */
export interface BaseProps {
  className?: string;
  children?: React.ReactNode;
}

/** Category names */
export type CategoryName = 'technology' | 'science' | 'politics' | 'world';

/** Page names for navigation */
export type PageName = 'home' | 'article' | 'category' | 'about' | 'contact' | 'editor';

/** Navigation parameters */
export interface NavigationParams {
  page: PageName;
  [key: string]: string;
}
