import { json } from "@sveltejs/kit";
import { POEM_TITLE, POEM_AUTHOR, POEM_TEXT, PRICE_PER_CHARACTER } from "$lib/server/poem";

export const GET = () =>
  json({
    title: POEM_TITLE,
    author: POEM_AUTHOR,
    length: POEM_TEXT.length,
    pricePerCharacter: PRICE_PER_CHARACTER,
    // Line lengths reveal the poem's shape (for the redacted layout), not its content
    lines: POEM_TEXT.split("\n").map(line => line.length),
  });
