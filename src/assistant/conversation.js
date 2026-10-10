// Chat commands are handled locally. Neither conversations nor uploads go to AI.
export function chatReply(question) {
  if (typeof question !== "string" || question.length > 1000) return null;
  const text = question
    .trim()
    .toLowerCase()
    .replace(/[?!.,]+$/, "");
  if (/^(?:hi|hello|hey|thanks|thank you)$/.test(text))
    return {
      message:
        "I can help you explore your audience, build a segment, or bring in a new list. What would you like to work on?",
      actions: ["upload"],
    };
  if (
    /^(?:(?:can i|can you|please|i want to|help me|lets|let’s|let's) )?(?:upload|import|add)(?: (?:a|my|our|this|new))?(?: (?:csv|list|lists|file|subscribers|people|data|customer data))?(?: (?:list|file))?$/.test(
      text,
    )
  )
    return {
      message:
        "Sure—choose a CSV, map its columns, and review the changes before importing. Your list stays local and is never sent to AI.",
      actions: ["upload"],
    };
  if (/^(?:help|what can you do|what can i ask|how does this work)$/.test(text))
    return {
      message:
        "Ask me about signup counts, cold audiences, engaged readers, or first pages after signup. Then refine the result with “just Instagram”, “what about last month?”, or “show the top 20”. You can also upload a list or save a result as a segment using the buttons here.",
      actions: ["upload"],
    };
  return null;
}
