import { useEffect } from 'react'
import { trackPostHog } from '../utils/posthog.js'
import './SupportCTA.css'

const BMAC_URL = import.meta.env.VITE_BUYMEACOFFEE_URL

function track(event, placement) {
  trackPostHog(event, { placement })
}

/**
 * SupportCTA
 * @param {'profile_menu' | 'post_workout'} placement
 * @param {boolean} [compact] - true renders a dropdown-style link; false renders an inline card
 */
export default function SupportCTA({ placement, compact = false }) {
  if (!BMAC_URL) return null

  useEffect(() => {
    track('support_cta_viewed', placement)
  }, [placement])

  function handleClick() {
    track('support_cta_clicked', placement)
  }

  if (compact) {
    return (
      <>
        <div className="dropdown-divider" />
        <a
          className="dropdown-item support-menu-item"
          href={BMAC_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleClick}
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M4 8h12l-1.5 7H5.5L4 8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
            <path d="M7 8V6a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <path d="M16 8c1.5 0 2.5.8 2.5 2s-1 2-2.5 2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Support the project
        </a>
      </>
    )
  }

  return (
    <div className="support-inline">
      <p className="support-inline-copy">
        Avenra is an independent project. If it's useful, you can support development.
      </p>
      <a
        className="support-inline-btn"
        href={BMAC_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
      >
        ☕ Buy me a coffee
      </a>
    </div>
  )
}
