import { error, json } from "@sveltejs/kit";
import { POEM_TEXT } from "$lib/server/poem";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ params }) => {
  const i = Number(params.i);
  if (!Number.isInteger(i) || i < 0 || i >= POEM_TEXT.length) {
    error(404, "No such character");
  }
  return json({ i, char: POEM_TEXT[i] });
};
