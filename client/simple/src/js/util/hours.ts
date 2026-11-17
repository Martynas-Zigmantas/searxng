// SPDX-License-Identifier: AGPL-3.0-or-later

// OpenStreetMap's opening_hours, for the place card (main/placeCard.ts) and the Map tab's cards (main/mapMode.ts)

const DAYS: Record<string, string> = {
  Mo: "Mon",
  Tu: "Tue",
  We: "Wed",
  Th: "Thu",
  Fr: "Fri",
  Sa: "Sat",
  Su: "Sun",
  PH: "Holidays"
};
const DAY_RANGE = /(\w{3})-(\w{3})/g;
const OFF = /\boff\b/g;
const DAY_CODE = /\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g;
const TIME_RANGE = /(\d{2}:\d{2})-(\d{2}:\d{2})/g;

// OpenStreetMap's opening_hours ("Mo-Fr 09:00-17:00; Sa 10:00-14:00") as lines people read
export const hoursLines = (hours: string): string[] => {
  if (hours.trim() === "24/7") return ["Open 24 hours"];
  return hours
    .split(";")
    .map((part) =>
      part
        .trim()
        .replace(TIME_RANGE, "$1–$2")
        .replace(DAY_CODE, (code) => DAYS[code] ?? code)
        .replace(DAY_RANGE, "$1–$2")
        .replace(OFF, "closed")
    )
    .filter(Boolean)
    .slice(0, 8);
};
