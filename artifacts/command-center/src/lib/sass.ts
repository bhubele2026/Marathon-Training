const CRUSH_TITLES = [
  "Done",
  "Nice work",
  "Logged",
  "That's a rep",
  "In the books",
  "Another one done",
  "Solid",
  "Showed up",
];

const CRUSH_LINES = [
  "Logged. Consistency is doing the work.",
  "That's how progress is built. Do it again tomorrow.",
  "Good choices stack. Today you made one.",
  "Another session banked. Keep stacking them.",
  "Showed up and put in the work. That's the whole game.",
  "One workout closer to the version of you you're building.",
  "Future-you, a little stronger, says thanks.",
  "Banked. Now hydrate, eat some protein, and rest.",
  "That's a yes. Recovery counts too — go take care of it.",
  "Consistency beats intensity. You just proved it.",
  "Strong session. Stack another tomorrow.",
  "One workout doesn't change a body. A hundred of them do.",
  "Good work today. Keep the streak honest.",
];

const SKIP_TITLES = [
  "Skipped",
  "Noted",
  "Marked off",
  "Logged as missed",
  "Rest or skip?",
  "No session today",
  "It happens",
  "Tomorrow then",
];

const SKIP_LINES = [
  "Skipped. No drama — just don't let it become two.",
  "Today didn't happen. Tomorrow can.",
  "Missed one. The plan's still here when you're ready.",
  "Skipped and logged. Consistency is the long game, not one day.",
  "One off-day won't undo your progress. A pattern of them might.",
  "No session today. Make the next one count.",
  "It's fine. Rest if you need it, then get back to it.",
  "Skipped. The plan adjusts — just show up next time.",
  "Life happens. Pick it back up tomorrow.",
  "Marked as missed. No guilt, just momentum to rebuild.",
  "Today's a zero. That's okay. Don't make it a streak.",
  "Skipped. The work's still waiting, and so is the progress.",
  "Off-day logged. Come back stronger.",
  "No session — just keep the next one on the calendar.",
];

const LOG_TITLES = [
  "Logged",
  "Saved",
  "Recorded",
  "On the board",
  "In the books",
];

const LOG_LINES = [
  "Logged. The numbers tell the story — keep adding to it.",
  "Recorded. You showed up, that's what matters.",
  "On the board. Trend beats any single session.",
  "Saved. The plan got a little less daunting today.",
  "Done. Now go drink water and eat something with protein.",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

export function crushSass(): { title: string; description: string } {
  return { title: pick(CRUSH_TITLES), description: pick(CRUSH_LINES) };
}

export function skipSass(): { title: string; description: string } {
  return { title: pick(SKIP_TITLES), description: pick(SKIP_LINES) };
}

export function logSass(): { title: string; description: string } {
  return { title: pick(LOG_TITLES), description: pick(LOG_LINES) };
}
