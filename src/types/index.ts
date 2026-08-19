/**
 * Verum News — Type Definitions
 * Centralized types for the entire application
 */

/** Core story/article type */
export interface Story {
  id: string;
  title: string;
  content: string;
  author: string;
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
export type PageName =
  | 'home'
  | 'article'
  | 'category'
  | 'about'
  | 'contact'
  | 'editor'
  | 'recordationem'
  | 'search';

/** Navigation parameters */
export interface NavigationParams {
  page: PageName;
  [key: string]: string;
}

// ── RECORDATIONEM ────────────────────────────────────────────────────────────
// "The act of remembering and bringing back into record."
// Recovers stories that have faded from coverage but still matter.

/** Per-topic attention metrics computed by the discovery engine */
export interface StoryAttentionMetrics {
  peakCoverageScore: number;
  currentCoverageScore: number;
  attentionDecayRate: number;
  relevanceScore: number;
  significanceScore: number;
}

/** A configurable Recordationem source (admin-editable, no code changes) */
export interface RecordationemSource {
  name: string;
  url: string;
  type: 'rss' | 'api' | 'scraper';
  enabled: boolean;
  trustScore: number;
  updateFrequency: string;
}

/** A single point in a coverage time series (for decay visualisation) */
export interface CoveragePoint {
  period: string;
  windowsAgo: number;
  score: number;
}

export interface SourceDiversityPoint {
  period: string;
  windowsAgo: number;
  sourceCount: number;
}

/** A verified update in a Recordationem timeline */
export interface RecordationemUpdate {
  date: string;
  title: string;
  source: string;
  sourceLabel?: string;
  url?: string;
  storyId?: string;
}

/** How much each outlet covered a topic */
export interface SourceBreakdownItem {
  source: string;
  label: string;
  count: number;
  share: number;
  trust: number;
}

/** Compact stat block for the detail page */
export interface ByTheNumbers {
  reportsTracked: number;
  distinctSources: number;
  timespanDays: number;
  peakCoverage: number;
  currentCoverage: number;
  significance: number;
  relevance: number;
}

/** An upcoming milestone surfaced for "Watch Next" */
export interface WatchNextItem {
  type: string;
  title: string;
  sourceHint?: string;
  date?: string;
}

/** Editorial decisions layered on a discovered topic */
export interface RecordationemEditorial {
  approved: boolean;
  archived: boolean;
  notes: string[];
  importanceOverridden?: boolean;
  summariesOverridden?: boolean;
}

/** A discovered Recordationem topic/story */
export interface RecordationemStory {
  id: string;
  title: string;
  slug: string;
  category: string;
  categoryEmergent: boolean;
  entities: string[];
  keywords: string[];
  articleCount: number;
  image: string;
  metrics: StoryAttentionMetrics;
  recordationemScore: number;
  importance: string;
  coverageDeclinePct: number;
  status: string;
  lastVerifiedUpdate: string;
  daysSinceUpdate: number;
  coverageHistory: CoveragePoint[];
  sourceDiversity: SourceDiversityPoint[];
  whyStillImportant: string;
  whatHappened: string;
  whatIsHappeningNow: string;
  whatChanged: string;
  narrativeSource: 'ai' | 'extractive';
  updates: RecordationemUpdate[];
  watchNext: WatchNextItem[];
  memberStoryIds: string[];
  editorial: RecordationemEditorial;
  firstSeen: string;
  timespanDays: number;
  peakPeriod: string;
  sourceBreakdown: SourceBreakdownItem[];
  byTheNumbers: ByTheNumbers;
}

/** A dynamically generated category */
export interface RecordationemCategory {
  name: string;
  count: number;
  emergent: boolean;
}

/** Top-level recordationem.json payload */
export interface RecordationemData {
  mission: string;
  subtitle: string;
  generatedAt: string;
  threshold: number;
  formula: string;
  categories: RecordationemCategory[];
  stories: RecordationemStory[];
  sources: RecordationemSource[];
  stats: {
    corpusSize: number;
    topicsExamined: number;
    topicsSurfaced: number;
  };
}
