import React from 'react';
import '../styles/shared.css';

/**
 * Layout — Wraps page content with shared header, nav, and footer
 */
export default function Layout({ children, currentPage }) {
  React.useEffect(() => {
    // Set header date and footer year
    const dateEl = document.getElementById('site-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    const footerEl = document.getElementById('footer-copy');
    if (footerEl) {
      footerEl.textContent = `© ${new Date().getFullYear()} Verum. All rights reserved.`;
    }

    // Highlight nav item
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.page === currentPage);
    });
  }, [currentPage]);

  return (
    <>
      {/* TOPBAR */}
      <div className="topbar">
        <span className="topbar-date" id="site-date"></span>
        <div className="topbar-links">
          <a href="/about.html">About</a>
          <a href="/contact.html">Submit a Tip</a>
          <a href="/contact.html">Contact</a>
        </div>
      </div>

      {/* MASTHEAD */}
      <header>
        <a href="/">
          <div className="masthead">
            <div className="masthead-logo">
              Ver<span className="bull">u</span>m
            </div>
            <div className="masthead-rule"></div>
            <div className="masthead-tagline">"The truth for all."</div>
          </div>
        </a>
      </header>

      {/* NAV */}
      <nav aria-label="Main navigation">
        <div className="nav-inner">
          <span className="nav-item" data-page="home" onClick={() => (location.href = '/')}>
            Home
          </span>
          <span
            className="nav-item"
            data-page="news"
            onClick={() => (location.href = '/category.html?cat=News')}
          >
            News
          </span>
          <span
            className="nav-item"
            data-page="world"
            onClick={() => (location.href = '/category.html?cat=World')}
          >
            World
          </span>
          <span
            className="nav-item"
            data-page="politics"
            onClick={() => (location.href = '/category.html?cat=Politics')}
          >
            Politics
          </span>
          <span
            className="nav-item"
            data-page="sports"
            onClick={() => (location.href = '/category.html?cat=Sports')}
          >
            Sports
          </span>
          <span
            className="nav-item"
            data-page="health"
            onClick={() => (location.href = '/category.html?cat=Health')}
          >
            Health
          </span>
          <span
            className="nav-item"
            data-page="science"
            onClick={() => (location.href = '/category.html?cat=Science')}
          >
            Science
          </span>
          <span
            className="nav-item nav-item--recordationem"
            data-page="recordationem"
            onClick={() => (location.href = '/recordationem.html')}
            title="Recovering stories that still matter"
          >
            Recordationem
          </span>
          <span
            className="nav-item nav-item--search"
            data-page="search"
            onClick={() => (location.href = '/search.html')}
            aria-label="Search"
          >
            Search
          </span>
        </div>
      </nav>

      {/* BREAKING NEWS */}
      <div className="breaking" role="marquee" aria-live="polite" aria-label="Breaking news">
        <span className="breaking-label">Breaking</span>
        <div className="breaking-ticker">
          <span id="breaking-text">Loading...</span>
        </div>
      </div>

      {/* PAGE CONTENT */}
      <main className="page">{children}</main>

      {/* FOOTER */}
      <footer>
        <div className="footer-logo">
          Ver<span className="bull">u</span>m
        </div>
        <div className="footer-tagline">"The truth for all."</div>
        <nav className="footer-links" aria-label="Footer navigation">
          <a href="/">Home</a>
          <a href="/category.html?cat=News">News</a>
          <a href="/category.html?cat=World">World</a>
          <a href="/category.html?cat=Politics">Politics</a>
          <a href="/category.html?cat=Sports">Sports</a>
          <a href="/category.html?cat=Health">Health</a>
          <a href="/category.html?cat=Science">Science</a>
          <a href="/recordationem.html">Recordationem</a>
          <a href="/search.html">Search</a>
          <a href="/about.html">About</a>
          <a href="/contact.html">Contact</a>
        </nav>
        <div className="footer-copy" id="footer-copy"></div>
      </footer>
    </>
  );
}
