import type { Config } from "@netlify/functions";
import { sweep } from "../lib/sweep.mts";

// Scheduled automation trigger (hourly): overdue review escalation.
export default async () => {
  const result = await sweep();
  console.log("review sweep", result);
};

// Every hour on the hour (UTC). Scheduled functions only run on the published production deploy.
export const config: Config = { schedule: "0 * * * *" };
