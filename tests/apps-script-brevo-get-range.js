"use strict";

/** Apps Script Sheet.getRange(row, col) or getRange(row, col, numRows, numCols). */
const createSheetGetRange = (rows) => (row, col, numRows, numCols) => {
  if (numRows === undefined && numCols === undefined) {
    return {
      getValue: () => rows[row - 1][col - 1],
      setValue(value) {
        rows[row - 1][col - 1] = value;
      },
    };
  }
  const endRow = row + numRows - 1;
  const endCol = col + numCols - 1;
  const slice = rows.slice(row - 1, endRow).map((line) =>
    line.slice(col - 1, endCol)
  );
  return {
    getValues: () => slice,
    setValue(value) {
      rows[row - 1][col - 1] = value;
    },
    setValues(values) {
      if (!Array.isArray(values) || values.length !== numRows) {
        throw new Error(
          `setValues: expected ${numRows} row(s), got ${values?.length ?? "non-array"}`
        );
      }
      for (let r = 0; r < values.length; r++) {
        if (!Array.isArray(values[r]) || values[r].length !== numCols) {
          throw new Error(
            `setValues: expected ${numCols} column(s) in row ${r}, got ${values[r]?.length ?? "non-array"}`
          );
        }
        for (let c = 0; c < values[r].length; c++) {
          rows[row - 1 + r][col - 1 + c] = values[r][c];
        }
      }
    },
  };
};

module.exports = { createSheetGetRange };
