import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function TermsPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-logo">Ave<span>nra</span></Link>
        <Link to="/" className="legal-back">← Back</Link>
      </header>

      <div className="legal-body">
        <h1>Terms of Use</h1>
        <p className="legal-meta">Last updated: 20 April 2026 · Version v1</p>

        <p>Avenra is a beta software product operated by George Biggs.</p>

        <h2>1. Nature of Service</h2>
        <p>Avenra provides workout logging, AI-generated training suggestions, and training-related insights.</p>

        <h2>2. Beta Disclaimer</h2>
        <p>Avenra is provided as a beta product. This means:</p>
        <ul>
          <li>Features may change or break</li>
          <li>Data may not always be accurate</li>
          <li>Availability is not guaranteed</li>
        </ul>

        <h2>3. No Medical Advice</h2>
        <p>Avenra does not provide medical advice. It does not diagnose injuries or conditions, does not provide treatment or rehabilitation plans, and does not replace qualified medical or professional guidance. You should consult a qualified professional for any medical concerns.</p>

        <h2>4. User Responsibility</h2>
        <p>You are responsible for your training decisions, how you interpret and act on suggestions, and ensuring exercises are performed safely.</p>

        <h2>5. Acceptable Use</h2>
        <p>You agree not to misuse the service, attempt to access other users' data, or use the service for unlawful purposes.</p>

        <h2>6. Data and Feedback</h2>
        <p>By using Avenra, you agree that your usage data may be used to improve the product and feedback you provide may be used without restriction.</p>

        <h2>7. Termination</h2>
        <p>We may suspend or terminate access at any time, particularly during beta.</p>

        <h2>8. Governing Law</h2>
        <p>These terms are governed by the laws of England and Wales.</p>

        <h2>9. Contact</h2>
        <p><a href="mailto:georgebiggs1@hotmail.com">georgebiggs1@hotmail.com</a></p>
      </div>
    </div>
  )
}
