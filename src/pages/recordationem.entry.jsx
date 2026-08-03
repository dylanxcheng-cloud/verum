/**
 * src/pages/recordationem.entry.jsx
 * Entry point for the Recordationem landing page.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from '../components/Layout';
import RecordationemPage from '../components/RecordationemPage';

ReactDOM.createRoot(document.getElementById('main-content')).render(
  <React.StrictMode>
    <Layout currentPage="recordationem">
      <RecordationemPage />
    </Layout>
  </React.StrictMode>
);
