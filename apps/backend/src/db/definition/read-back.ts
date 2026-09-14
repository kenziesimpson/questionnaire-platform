export function readBack<Row>(row: Row | undefined, written: string): Row {
  if (row === undefined) {
    throw new Error(`${written} could not be read back inside its own transaction`);
  }
  return row;
}
