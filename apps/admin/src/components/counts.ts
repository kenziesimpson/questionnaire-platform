export function questionCount(count: number): string {
  return count === 1 ? "1 question" : `${count} questions`;
}

export function problemCount(count: number): string {
  return count === 1 ? "1 problem" : `${count} problems`;
}
