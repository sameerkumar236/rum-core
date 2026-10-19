import { lookup as systemLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from '../../lib/errors.js';

const defaultLookup = (hostname) => systemLookup(hostname, { all: true, verbatim: true });

function ipv6Number(address) {
  let normalized = address.toLowerCase();
  if (normalized.includes('.')) {
    const colon = normalized.lastIndexOf(':');
    const bytes = normalized
      .slice(colon + 1)
      .split('.')
      .map(Number);
    normalized = `${normalized.slice(0, colon)}:${((bytes[0] << 8) + bytes[1]).toString(16)}:${((bytes[2] << 8) + bytes[3]).toString(16)}`;
  }
  const [first, second] = normalized.split('::');
  const left = first ? first.split(':') : [];
  const right = second ? second.split(':') : [];
  const words = normalized.includes('::')
    ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
    : left;
  return words.reduce((value, word) => (value << 16n) + BigInt(`0x${word}`), 0n);
}

function inIpv6Range(value, prefix, bits) {
  const shift = BigInt(128 - bits);
  return value >> shift === ipv6Number(prefix) >> shift;
}

// Conservative public-unicast rules; adapted from the original rum-core URL guard.
// In particular, mapped IPv4 and IPv6 transition ranges never bypass IPv4 restrictions.
export function isPublicAddress(input) {
  if (typeof input !== 'string') return false;
  const address = input.replace(/^\[|\]$/g, '');
  if (address.includes('%')) return false;
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) === 6) {
    const value = ipv6Number(address);
    return (
      inIpv6Range(value, '2000::', 3) &&
      !inIpv6Range(value, '2001::', 23) &&
      !inIpv6Range(value, '2001:db8::', 32) &&
      !inIpv6Range(value, '2002::', 16) &&
      !inIpv6Range(value, '3fff::', 20)
    );
  }
  return false;
}

export function validatePublicUrl(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 4096) {
    throw new AppError(400, 'Enter a public HTTP or HTTPS URL of at most 4096 characters.');
  }
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new AppError(400, 'Enter a complete URL beginning with http:// or https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new AppError(
      400,
      'Use an HTTP or HTTPS URL without embedded usernames or passwords.',
    );
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (![80, 443].includes(port))
    throw new AppError(400, 'Website checks allow only HTTP/HTTPS ports 80 and 443.');
  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname))
      throw new AppError(
        400,
        'Local, private, and reserved network addresses cannot be checked.',
      );
  } else if (
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(hostname)
  ) {
    throw new AppError(400, 'Website checks accept public internet hostnames only.');
  }
  url.hash = '';
  return url;
}

export async function resolvePublicHost(input, lookup = defaultLookup, options = {}) {
  const hostname = input.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (options.signal?.aborted) throw new AppError(504, 'The website check timed out.');
  let addresses;
  if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
  else {
    let timer;
    let abort;
    try {
      addresses = await Promise.race([
        lookup(hostname),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new AppError(502, 'The website hostname did not resolve in time.')),
            options.dnsTimeoutMs || 3500,
          );
        }),
        new Promise((_, reject) => {
          abort = () => reject(new AppError(504, 'The website check timed out.'));
          options.signal?.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, 'The website hostname could not be resolved.');
    } finally {
      clearTimeout(timer);
      if (abort) options.signal?.removeEventListener('abort', abort);
    }
  }
  if (!addresses?.length)
    throw new AppError(502, 'The website hostname did not resolve to an address.');
  if (
    addresses.some(
      (item) => !isPublicAddress(item.address) || isIP(item.address) !== item.family,
    )
  ) {
    throw new AppError(
      400,
      'This hostname resolves to a private or reserved address and cannot be checked.',
    );
  }
  return addresses;
}

export async function validatePublicTarget(input, lookup, options = {}) {
  const url = validatePublicUrl(input);
  const start = performance.now();
  const addresses = await resolvePublicHost(url.hostname, lookup, options);
  return {
    url,
    addresses,
    dnsMs: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? 0 : performance.now() - start,
  };
}
