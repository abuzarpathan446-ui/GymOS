export const gymSlugMessage = 'Use 3–60 characters: lowercase letters (a–z), numbers (0–9), or hyphens (-). Example: iron-fitness.';
export const normalizeGymSlug = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');
export const validateGymSlug = (value: string) => /^[a-z0-9-]{3,60}$/.test(value) ? undefined : gymSlugMessage;
