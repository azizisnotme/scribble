export const ONBOARDING_KEY = 'scribble_onboarding_v1'
export const ONBOARDING_RESET_EVENT = 'scribble:onboarding-reset'

export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) === 'done'
  } catch {
    return false
  }
}

export function completeOnboarding(): void {
  localStorage.setItem(ONBOARDING_KEY, 'done')
}

export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDING_KEY)
  window.dispatchEvent(new CustomEvent(ONBOARDING_RESET_EVENT))
}

