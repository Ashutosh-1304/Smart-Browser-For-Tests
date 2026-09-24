export function validateAndNormalizeUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    return { valid: false, error: 'URL is required.' };
  }

  const trimmed = inputUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'URL cannot be empty.' };
  }

  const candidate = trimmed.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
    ? trimmed
    : `https://${trimmed}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: 'Only HTTP and HTTPS URLs are allowed.',
    };
  }

  if (!parsed.hostname || (parsed.hostname !== 'localhost' && !parsed.hostname.includes('.'))) {
    return {
      valid: false,
      error: 'URL must have a valid hostname.',
    };
  }

  return { valid: true, url: parsed.href };
}
