export const importCellCases = [
  { input: '  plain value  ', maxChars: 10000, expected: 'plain value' },
  { input: 'value\u0000with\u0000null', maxChars: 10000, expected: 'valuewithnull' },
  { input: 'abcdef', maxChars: 3, expected: 'abc' },
] as const
