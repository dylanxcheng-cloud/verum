/**
 * src/pages/home.entry.jsx
 * Entry point for the home/index page
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import Layout from '../components/Layout';
import HomePage from '../components/HomePage';

const root = ReactDOM.createRoot(document.getElementById('main-content'));

root.render(
  <React.StrictMode>
    <Layout currentPage="home">
      <HomePage />
    </Layout>
  </React.StrictMode>
);
