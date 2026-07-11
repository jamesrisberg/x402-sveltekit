import { json } from "@sveltejs/kit";

export const GET = () =>
  json({
    report: {
      weather: "sunny",
      temperature: 70,
    },
  });
