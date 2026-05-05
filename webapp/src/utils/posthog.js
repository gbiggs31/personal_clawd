const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST

let initPromise = null

function hasConfig() {
  return Boolean(POSTHOG_KEY && POSTHOG_HOST)
}

export function hasPostHogConfig() {
  return hasConfig()
}

export function initPostHog() {
  if (!hasConfig()) return Promise.resolve(null)
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)
  if (window.posthog?.__loaded) return Promise.resolve(window.posthog)
  if (initPromise) return initPromise

  initPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-posthog-loader="true"]')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.posthog || null), { once: true })
      existingScript.addEventListener('error', () => reject(new Error('Failed to load PostHog')), { once: true })
      return
    }

    !function(t,e){var o,n,p,r;e.__SV||(window.posthog && window.posthog.__loaded)||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",p.setAttribute("data-posthog-loader","true"),(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r),p.addEventListener("load",function(){resolve(window.posthog||null)},{once:!0}),p.addEventListener("error",function(){reject(new Error("Failed to load PostHog"))},{once:!0});var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="Ei Ni init zi Gi Nr Ui Xi Hi capture calculateEventProperties tn register register_once register_for_session unregister unregister_for_session an getFeatureFlag getFeatureFlagPayload getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey displaySurvey cancelPendingSurvey canRenderSurvey canRenderSurveyAsync ln identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset setIdentity clearIdentity get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException addExceptionStep captureLog startExceptionAutocapture stopExceptionAutocapture loadToolbar get_property getSessionProperty nn Qi createPersonProfile setInternalOrTestUser sn qi cn opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing get_explicit_consent_status is_capturing clear_opt_in_out_capturing Ji debug Fr rn getPageViewId captureTraceFeedback captureTraceMetric Bi".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[])

    window.posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2026-01-30',
      person_profiles: 'identified_only',
    })
  })

  return initPromise.catch(error => {
    initPromise = null
    throw error
  })
}

export function trackPostHog(event, properties = {}) {
  try {
    window.posthog?.capture(event, properties)
  } catch {}
}

export function identifyPostHog(id, properties = {}) {
  try {
    window.posthog?.identify(id, properties)
  } catch {}
}

export function resetPostHog() {
  try {
    window.posthog?.reset()
  } catch {}
}
