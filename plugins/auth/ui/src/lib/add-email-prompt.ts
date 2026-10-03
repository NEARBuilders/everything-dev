const ADD_EMAIL_PROMPT_KEY = "addEmailPromptPending";

export function markAddEmailPromptPending() {
  try {
    sessionStorage.setItem(ADD_EMAIL_PROMPT_KEY, "1");
  } catch {}
}
