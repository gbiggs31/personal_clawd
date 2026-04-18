import { useEffect, useState } from 'react'
import './InstallPrompt.css'

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

function isInStandaloneMode() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  )
}

function isIOSSafari() {
  return isIOS() &&
    !navigator.userAgent.includes('CriOS') &&
    !navigator.userAgent.includes('FxiOS') &&
    !navigator.userAgent.includes('OPiOS')
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showIOSHint, setShowIOSHint]       = useState(false)
  const [hidden, setHidden]                 = useState(false)

  useEffect(() => {
    if (isInStandaloneMode()) return
    if (sessionStorage.getItem('avenra-install-dismissed')) return

    const handler = e => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // iOS Safari — show hint after 4 seconds on first visit
    if (isIOSSafari() && !localStorage.getItem('avenra-install-dismissed')) {
      const t = setTimeout(() => setShowIOSHint(true), 4000)
      return () => { clearTimeout(t); window.removeEventListener('beforeinstallprompt', handler) }
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    setHidden(true)
    sessionStorage.setItem('avenra-install-dismissed', '1')
    localStorage.setItem('avenra-install-dismissed', '1')
  }

  async function install() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setDeferredPrompt(null)
    dismiss()
  }

  if (hidden) return null

  if (deferredPrompt) {
    return (
      <div className="install-banner" role="banner">
        <div className="install-banner-body">
          <img src="/icons/icon-192.png" className="install-banner-icon" alt="" />
          <div className="install-banner-text">
            <strong>Install Avenra</strong>
            <span>Add to home screen for quick gym access</span>
          </div>
        </div>
        <div className="install-banner-actions">
          <button className="install-btn primary" onClick={install}>Install</button>
          <button className="install-btn ghost" onClick={dismiss}>Not now</button>
        </div>
      </div>
    )
  }

  if (showIOSHint) {
    return (
      <div className="install-banner" role="banner">
        <div className="install-banner-body">
          <img src="/icons/icon-192.png" className="install-banner-icon" alt="" />
          <div className="install-banner-text">
            <strong>Add Avenra to your home screen</strong>
            <span>Tap the share button then "Add to Home Screen"</span>
          </div>
        </div>
        <button className="install-btn ghost dismiss-x" onClick={dismiss} aria-label="Dismiss">✕</button>
      </div>
    )
  }

  return null
}
