const ADD_EMAIL_PROMPT_KEY = "addEmailPromptPending";

export function consumeAddEmailPromptPending(): boolean {
  try {
    if (sessionStorage.getItem(ADD_EMAIL_PROMPT_KEY) !== "1") return false;
    sessionStorage.removeItem(ADD_EMAIL_PROMPT_KEY);
    return true;
  } catch {
    return false;
  }
}
