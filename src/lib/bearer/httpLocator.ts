/**
 * Shared HTTP(S) locator parsing for §5.6/§5.7/§5.8 holder hints.
 * Fail-closed: one invalid token invalidates the whole hint (no silent filter).
 */

export function parseHttpLocator(loc: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(loc);
  } catch {
    return undefined;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.hostname.length === 0
  ) {
    return undefined;
  }
  return loc.replace(/\/+$/, '');
}

export type HolderLocatorParse =
  | { status: 'empty' }
  | { status: 'ok'; locators: string[] }
  | { status: 'invalid'; detail: string };

export function parseHolderLocators(hint: string | undefined): HolderLocatorParse {
  if (hint === undefined || hint.length === 0) {
    return { status: 'empty' };
  }

  if (hint.startsWith('@')) {
    const url = hint.slice(1);
    if (url.includes('://')) {
      const parsed = parseHttpLocator(url);
      if (parsed !== undefined) {
        return { status: 'ok', locators: [parsed] };
      }
      return { status: 'invalid', detail: 'holder hint contains an invalid locator' };
    }
    // @not-http / @op:… — not a Blossom http(s) hint
    return { status: 'empty' };
  }

  if (hint.includes(',')) {
    const tokens = hint.split(',');
    const locators: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!.trim();
      if (token.length === 0) {
        continue;
      }
      const parsed = parseHttpLocator(token);
      if (parsed === undefined) {
        return {
          status: 'invalid',
          detail: `holder hint contains an invalid locator at index ${i}`,
        };
      }
      locators.push(parsed);
    }
    if (locators.length === 0) {
      return { status: 'empty' };
    }
    return { status: 'ok', locators };
  }

  // Single token (no @, no comma)
  const parsed = parseHttpLocator(hint);
  if (parsed !== undefined) {
    return { status: 'ok', locators: [parsed] };
  }
  if (hint.includes('://')) {
    return { status: 'invalid', detail: 'holder hint contains an invalid locator' };
  }
  // garbage / op: without ://
  return { status: 'empty' };
}
