// Absence-threshold inclusion rule.
// Normally a record must be strictly above the threshold. When the threshold is
// 0 (slider at zero or filter turned off), records with exactly 0% are included.
export function meetsThreshold(percentageAbsence: number, threshold: number): boolean {
  return percentageAbsence > threshold || (threshold === 0 && percentageAbsence === 0)
}
