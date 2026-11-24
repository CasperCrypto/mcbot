/**
 * Three things to ask an agent that has no conversation yet, picked from its name and what it is
 * for, so a new chat is one click away from a first answer. Pure: same agent, same prompts.
 */
const KINDS: { match: RegExp; prompts: [string, string, string] }[] = [
  // Teams that make things first: their first question should make something.
  { match: /marketing|social|campaign|brand|seo/i, prompts: ["Plan this week's posts, with an image for each", "Write a post about what we do and make its image", "Which channels should we post on, and how often?"] },
  { match: /design|image|visual|illustrat|art/i, prompts: ["Make an image for our next Instagram post", "Design three banner ideas for our website", "Make a simple logo concept, in two styles"] },
  { match: /sales|\blead\b|outreach|prospect/i, prompts: ["Find five businesses that could become customers", "Draft a short first message to a new lead", "Research a company before my call with them"] },
  { match: /research|sources?|scout|analy|compare|market/i, prompts: ["Find the latest news on AI agents and sum it up", "Compare the three most popular note-taking apps", "What should I read to understand vector databases?"] },
  { match: /writ|draft|post|copy|blog|content|edit/i, prompts: ["Draft a friendly follow-up email after a meeting", "Write three post ideas about our launch", "Make this paragraph shorter and clearer"] },
  { match: /code|coder|develop|engineer|review|bug|program/i, prompts: ["Review the code in my workspace and list the risks", "Write a script that renames photos by date", "Explain what a race condition is, with an example"] },
  { match: /support|customer|help ?desk|ticket/i, prompts: ["Draft a reply to a customer asking for a refund", "Turn these complaints into an FAQ", "Suggest a polite way to say no to a feature request"] },
  { match: /trip|travel/i, prompts: ["Plan a 3-day trip to Lisbon on a budget", "What should I pack for a week of hiking?", "Compare train and flight from Paris to Rome"] },
  { match: /learn|teach|coach|tutor|study/i, prompts: ["Explain how neural networks learn, simply", "Make me a 2-week plan to learn SQL", "Quiz me on the basics of statistics"] },
  { match: /inbox|mail/i, prompts: ["Draft a reply that says yes to Tuesday at 3pm", "Write a polite reminder for an unpaid invoice", "Turn these notes into a short status email"] },
  { match: /shop|buy|price|deal/i, prompts: ["Find a good laptop for travel under $1,000", "Compare the top three noise-cancelling headphones", "Is now a good time to buy a TV?"] },
  { match: /assist|organi[sz]|plan|personal|day|calendar|notes?/i, prompts: ["Plan my day: three meetings and a report due at 5pm", "Turn my notes into a to-do list", "Draft a message to move tomorrow's meeting"] },
];

const ANY: [string, string, string] = ["What can you do for me?", "Help me plan my week", "Summarize a topic I'm curious about"];

export function starterPrompts(name: string, description = ""): readonly string[] {
  // The name says most ("Assistant" whose description mentions drafts is still an assistant).
  return KINDS.find((k) => k.match.test(name))?.prompts ?? KINDS.find((k) => k.match.test(description))?.prompts ?? ANY;
}
