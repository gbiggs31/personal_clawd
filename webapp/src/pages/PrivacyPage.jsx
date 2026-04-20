import { Link } from 'react-router-dom'
import './LegalPage.css'

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-logo">Ave<span>nra</span></Link>
        <Link to="/" className="legal-back">← Back</Link>
      </header>

      <div className="legal-body">
        <h1>Privacy Policy</h1>
        <p className="legal-meta">Last updated: 20 April 2026 · Version v1</p>

        <p>Avenra is operated by George Biggs, trading as Avenra ("Avenra", "we", "us"). This Privacy Policy explains how we collect, use, and protect your personal data when you use Avenra.</p>

        <h2>1. Information We Collect</h2>
        <p><strong>Account Data</strong></p>
        <ul>
          <li>Email address (for authentication via magic link)</li>
        </ul>
        <p><strong>Training Data</strong></p>
        <ul>
          <li>Workout logs (exercises, sets, weights, reps)</li>
          <li>Bodyweight entries (if provided)</li>
          <li>Free-text inputs and notes (including chat messages with the AI coach)</li>
        </ul>
        <p><strong>Usage Data</strong></p>
        <ul>
          <li>Device and interaction data necessary to operate the service</li>
        </ul>

        <h2>2. Important Note on Sensitive Information</h2>
        <p>Avenra allows free-text input. You should avoid entering sensitive medical or health information beyond general training-related notes. Any such information you choose to provide is submitted at your own discretion.</p>

        <h2>3. How We Use Your Data</h2>
        <p>We use your data to:</p>
        <ul>
          <li>Provide workout logging and tracking</li>
          <li>Generate training recommendations</li>
          <li>Respond to your questions via AI models</li>
          <li>Improve product functionality and user experience</li>
          <li>Analyse usage patterns in aggregate</li>
        </ul>
        <p>We may also use data (including anonymised or aggregated data) to improve AI prompts and system behaviour, develop future product features, and improve model performance.</p>

        <h2>4. AI Processing</h2>
        <p>Avenra uses third-party AI providers including Anthropic and OpenAI. Your inputs (such as workout logs and questions) are sent to these providers for processing in order to generate responses.</p>

        <h2>5. Legal Basis for Processing</h2>
        <p>We process your data under:</p>
        <ul>
          <li><strong>Contract:</strong> to provide the Avenra service</li>
          <li><strong>Legitimate interests:</strong> to improve and operate the product</li>
          <li><strong>Consent:</strong> where required (e.g. beta participation and data use)</li>
        </ul>

        <h2>6. Data Storage and Retention</h2>
        <p>Your data is stored using Supabase (database and authentication) and Vercel (hosting infrastructure). Data is retained until you request deletion, or we determine it is no longer necessary for service operation.</p>

        <h2>7. Your Rights</h2>
        <p>You have the right to request access to your data, request deletion of your data, and request correction of inaccurate data. To exercise these rights, contact <a href="mailto:georgebiggs1@hotmail.com">georgebiggs1@hotmail.com</a>. We aim to respond within 30 days.</p>

        <h2>8. Data Security</h2>
        <p>We implement reasonable technical and organisational measures to protect your data. However, no system is completely secure.</p>

        <h2>9. International Transfers</h2>
        <p>Your data may be processed outside the UK/EU by our service providers. We rely on appropriate safeguards provided by those vendors.</p>

        <h2>10. Changes to This Policy</h2>
        <p>We may update this policy. Continued use of Avenra constitutes acceptance of the updated policy.</p>

        <h2>11. Contact</h2>
        <p><a href="mailto:georgebiggs1@hotmail.com">georgebiggs1@hotmail.com</a></p>
      </div>
    </div>
  )
}
