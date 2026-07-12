import { error, json } from "@sveltejs/kit";
import { setSettlementOverrides } from "@jamesrisberg/x402-sveltekit";
import { POEM_TEXT, priceForCharacters } from "$lib/server/poem";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  const from = Number(url.searchParams.get("from") ?? 0);
  const requested = Number(url.searchParams.get("count") ?? POEM_TEXT.length);
  if (!Number.isInteger(from) || from < 0 || from >= POEM_TEXT.length) {
    error(400, "from out of range");
  }
  if (!Number.isInteger(requested) || requested < 1) {
    error(400, "count must be a positive integer");
  }

  const text = POEM_TEXT.slice(from, from + requested);
  const response = json({ from, count: text.length, text });
  // upto: authorize the max, settle only what was delivered
  setSettlementOverrides(response, { amount: priceForCharacters(text.length) });
  return response;
};
