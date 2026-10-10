import { CHARACTER_TEXT as BASE_CHARACTER_TEXT } from "./character-text.js";
import { BUNNY_CHARACTER_TEXT } from "./bunny-haruhi-text.js";
import { EN_MESSAGES } from "./messages-en.js";
import { JA_MESSAGES } from "./messages-ja.js";

export const CHARACTER_TEXT = Object.fromEntries(Object.entries(BASE_CHARACTER_TEXT)
  .map(([locale, characters]) => [locale, { ...characters, bunny_haruhi: BUNNY_CHARACTER_TEXT[locale] }]));

export const MESSAGES = {
  ja: JA_MESSAGES,
  en: EN_MESSAGES,
};
