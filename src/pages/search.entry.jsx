/**
 * src/pages/search.entry.jsx
 * Entry point for the site search page (with Recordationem integration).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from '../components/Layout';
import SearchPage from '../components/SearchPage';

ReactDOM.createRoot(document.getElementById('main-content')).render(
  <React.StrictMode>
    <Layout currentPage="search">
      <SearchPage />
    </Layout>
  </React.StrictMode>
);
