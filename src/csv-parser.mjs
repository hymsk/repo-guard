/** Strict CSV parsing; expose headers so authorization can reject ambiguity. */
export function parseTable(text) {
  if (typeof text !== "string") throw new Error("CSV must be text");
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", state = "start", active = false;
  const finishField = () => { row.push(field); field = ""; state = "start"; };
  const finishRow = () => {
    finishField();
    if (active || row.length > 1 || row[0] !== "") rows.push(row);
    row = []; active = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === "quoted") {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = "closed";
      } else field += ch;
      continue;
    }
    if (ch === ",") { finishField(); active = true; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      finishRow(); continue;
    }
    if (state === "closed") throw new Error("Unexpected text after quoted field");
    if (ch === '"') {
      if (state !== "start") throw new Error("Unexpected quote in CSV field");
      state = "quoted";
    } else { field += ch; state = "plain"; }
    active = true;
  }
  if (state === "quoted") throw new Error("Unclosed CSV quote");
  if (active || row.length || field) finishRow();
  const headers = rows.shift() || [];
  if (rows.some(values => values.length !== headers.length)) throw new Error("CSV column count mismatch");
  return { headers, rows };
}

export function parse(text) {
  const { headers, rows } = parseTable(text);
  return rows.map(values => Object.fromEntries(headers.map((header, i) => [header, values[i]])));
}
