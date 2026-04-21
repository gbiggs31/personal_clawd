import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function SupportPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-logo">Avenr<span>a</span></Link>
        <Link to="/" className="legal-back">Back to app</Link>
      </header>

      <div className="legal-body">
        <h1>Support</h1>
        <p className="legal-meta">We're here to help.</p>

        <h2>Common issues</h2>
        <ul>
          <li>If Strava sync stops working, disconnect and reconnect in <strong>Profile → Connected Apps</strong></li>
          <li>New activities may take a few minutes to appear after syncing</li>
          <li>You can disconnect Strava at any time from <strong>Profile → Connected Apps</strong></li>
        </ul>

        <h2>Contact</h2>
        <p>
          Email us at{' '}
          <a href="mailto:support@getavenra.com">support@getavenra.com</a>
          {' '}and we'll get back to you as soon as possible.
        </p>

        <h2>Privacy</h2>
        <p>
          Read our <Link to="/privacy">Privacy Policy</Link> to learn how we handle your data.
        </p>
      </div>
    </div>
  )
}
