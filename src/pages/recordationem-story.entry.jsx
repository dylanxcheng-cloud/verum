/**
 * src/pages/recordationem-story.entry.jsx
 * Entry point for a single Recordationem story detail page.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from '../components/Layout';
import RecordationemStory from '../components/RecordationemStory';

ReactDOM.createRoot(document.getElementById('main-content')).render(
  <React.StrictMode>
    <Layout currentPage="recordationem">
      <RecordationemStory />
    </Layout>
  </React.StrictMode>
);
