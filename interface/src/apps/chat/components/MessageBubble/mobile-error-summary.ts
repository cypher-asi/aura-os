/** Keep operational diagnostics available without filling a phone's transcript. */
export function mobileErrorSummary(message: string, variant?: string): string {
  if (variant === "insufficientCreditsError") {
    return "You have no credits remaining. Add credits to continue.";
  }
  if (variant === "harnessCapacityExhaustedError") {
    return "AURA is busy right now. Please try again shortly.";
  }
  if (message.includes("provider_account_unavailable")) {
    return "This model is temporarily unavailable. Try another model or try again later.";
  }
  if (variant === "agentBusyError") {
    return "This agent is busy. Please wait for its current work to finish.";
  }
  if (variant === "streamDropped") {
    return "The connection was interrupted. Check your connection and try again.";
  }
  return "The agent couldn't complete this request. Try again or view the details below.";
}
