export function asList(value) {
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item) => item !== undefined && item !== null && item !== '');
}

export function asText(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}
