const CRUSH_TITLES = [
  "MISSION ACCOMPLISHED",
  "CRUSHED IT",
  "LOGGED. RESPECT.",
  "BOOM.",
  "THAT'S HOW IT'S DONE",
  "ANOTHER ONE IN THE BANK",
  "FAT CELLS WEEPING",
  "RUNNER MODE: ENGAGED",
];

const CRUSH_LINES = [
  "Logged. The fat cells just filed for unemployment.",
  "That's how you build a runner. Do it again tomorrow.",
  "281 lbs of choices, and today you chose the right one.",
  "Another brick in the half-marathon wall. Keep stacking.",
  "The couch is sad. The scale is nervous. Good.",
  "13.1 miles is one less workout away. Earned.",
  "Future-you, leaner and faster, just sent a thank-you note.",
  "Boom. Banked. Goal weight just flinched.",
  "That's a yes. Now hydrate, eat real food, sleep like a champion.",
  "Discipline > motivation. You just proved it.",
  "Tonal didn't beat you today. The bike didn't either. Stack 'em up.",
  "One workout doesn't change a body. A hundred of them do. 99 to go.",
  "Good. Now don't undo it with a bag of chips at 9pm.",
];

const SKIP_TITLES = [
  "SKIPPED. NOTED.",
  "OK THEN.",
  "COUCH WINS AGAIN",
  "THE FAT IS WINNING",
  "THAT'S A NO FROM YOU",
  "STILL FAT, STILL SLOW",
  "RACE DAY DOESN'T CARE",
  "MOTIVATION: 0",
];

const SKIP_LINES = [
  "Skipped the workout? Cool. Still fat. Still slow. The race doesn't care about your excuses.",
  "281.6 lbs of choices, and today you chose poorly. Again.",
  "Couch wins. Goal weight just got farther. Math is brutal.",
  "Cool, cool. The half marathon is still 13.1 miles. Your couch is still 0.",
  "Skipped. Logged. Documented. Future-you is throwing things at past-you right now.",
  "You know who else skipped today's workout? Nobody who's ever finished a half marathon.",
  "That's fine. Tomorrow's you will just have to do double. Compound interest, baby.",
  "Skipped. The scale didn't.",
  "Funny how the workout was 60 minutes and the excuse took 3 hours.",
  "OK. The plan is the plan. Skipping it is a choice. You made yours. Make a better one tomorrow.",
  "Imagine race day. Imagine quitting at mile 7 because you skipped today. Don't be that guy.",
  "Skipped. The miles you didn't run today are now waiting for you next week. With interest.",
  "Bummer. Anyway, you're still 281.6 lbs and the race is still in 2027.",
  "Cool excuse. Add it to the pile. The pile is fat now too.",
];

const LOG_TITLES = [
  "LOGGED",
  "ENTERED",
  "DATA RECEIVED",
  "ON THE BOARD",
  "IN THE BOOKS",
];

const LOG_LINES = [
  "Logged. Numbers don't lie — keep stacking them.",
  "Recorded. You showed up, that's what matters.",
  "On the board. Trend > any single session.",
  "Saved. The plan got a little less scary today.",
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
