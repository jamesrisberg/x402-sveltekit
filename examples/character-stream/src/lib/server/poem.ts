export const POEM_TITLE = "Ozymandias";
export const POEM_AUTHOR = "Percy Bysshe Shelley";
export const PRICE_PER_CHARACTER = "$0.0001";
export const POEM_MAX_PRICE = "$0.10";

/**
 * Formats the dollar cost of a character count at PRICE_PER_CHARACTER.
 *
 * @param count - Number of characters
 * @returns Dollar-denominated price string (e.g. "$0.0050")
 */
export function priceForCharacters(count: number): string {
  const perChar = Number(PRICE_PER_CHARACTER.slice(1));
  return `$${(count * perChar).toFixed(6)}`;
}

// Public-domain text, first printing in The Examiner, January 11, 1818.
export const POEM_TEXT = `I met a Traveller from an antique land,
Who said, "Two vast and trunkless legs of stone
Stand in the desart. Near them, on the sand,
Half sunk, a shattered visage lies, whose frown,
And wrinkled lip, and sneer of cold command,
Tell that its sculptor well those passions read,
Which yet survive, stamped on these lifeless things,
The hand that mocked them, and the heart that fed:
And on the pedestal these words appear:
"My name is Ozymandias, King of Kings."
Look on my works ye Mighty, and despair!
No thing beside remains. Round the decay
Of that Colossal Wreck, boundless and bare,
The lone and level sands stretch far away.
`;
