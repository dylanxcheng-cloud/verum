/**
 * src/pages/recordationem-admin.entry.jsx
 * Entry point for the Recordationem editorial controls.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from '../components/Layout';
import RecordationemAdmin from '../components/RecordationemAdmin';

ReactDOM.createRoot(document.getElementById('main-content')).render(
  <React.StrictMode>
    <Layout currentPage="recordationem">
      <h1 className="rec-admin-pagetitle">Recordationem — Editorial Controls</h1>
      <RecordationemAdmin />
    </Layout>
  </React.StrictMode>
);
