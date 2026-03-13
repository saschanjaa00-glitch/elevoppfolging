export const csvFormulaCases = [
  { input: '=2+2', expected: "'=2+2" },
  { input: '+SUM(A1:A2)', expected: "'+SUM(A1:A2)" },
  { input: '-10+5', expected: "'-10+5" },
  { input: '@cmd', expected: "'@cmd" },
  { input: '  =HYPERLINK("http://x")', expected: "'  =HYPERLINK(\"http://x\")" },
  { input: 'Normal text', expected: 'Normal text' },
] as const
