/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GROQ_API_KEY: string;
  readonly VITE_NETLIFY_SITE_ID: string;
  readonly VITE_NETLIFY_AUTH_TOKEN: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_STORIES_URL: string;
  readonly VITE_REFRESH_INTERVAL: string;
  readonly VITE_MAX_STORIES_PER_PAGE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
