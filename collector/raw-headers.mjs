export function formatRawHeaders(rawHeaders = []) {
  if (rawHeaders.length % 2 !== 0) {
    throw new Error('Raw headers must contain name/value pairs');
  }

  const lines = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = String(rawHeaders[index]);
    const value = String(rawHeaders[index + 1]);
    if (name.includes('\r') || name.includes('\n') ||
        value.includes('\r') || value.includes('\n')) {
      throw new Error('Raw header names and values must not contain line breaks');
    }
    lines.push(`${name}: ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

export function parseRawHeaders(text) {
  const pairs = [];
  const headers = {};
  const lines = String(text).split('\n');
  if (lines.at(-1) === '') lines.pop();

  for (const [index, line] of lines.entries()) {
    const separator = line.indexOf(': ');
    if (separator < 1) {
      throw new Error(`Invalid raw header at line ${index + 1}`);
    }
    const name = line.slice(0, separator);
    const value = line.slice(separator + 2);
    pairs.push([name, value]);

    const current = headers[name];
    if (current === undefined) headers[name] = value;
    else if (Array.isArray(current)) current.push(value);
    else headers[name] = [current, value];
  }

  return { pairs, headers };
}
