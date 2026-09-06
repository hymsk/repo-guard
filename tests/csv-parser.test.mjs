
/**
 * tests/csv-parser.test.mjs — CSV 解析器测试。
 */

import { parse, parseTable } from "../src/csv-parser.mjs";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; } else { failed++; console.error(`FAIL: ${label}`); }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) { passed++; }
  else { failed++; console.error(`FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

{
  const csv = "name,age\nAlice,30\nBob,25";
  const records = parse(csv);
  assertEqual(records.length, 2, "basic: 2 records");
  assertEqual(records[0].name, "Alice", "basic: first name");
  assertEqual(records[0].age, "30", "basic: first age");
  assertEqual(records[1].name, "Bob", "basic: second name");
}

{
  const csv = 'a,b\n"hello, world",1';
  const records = parse(csv);
  assertEqual(records.length, 1, "quoted: 1 record");
  assertEqual(records[0].a, "hello, world", "quoted: comma in field");
}

{
  const csv = 'a,b\n"hello""world",1';
  const records = parse(csv);
  assertEqual(records.length, 1, "escaped-quotes: 1 record");
  assertEqual(records[0].a, 'hello"world', "escaped-quotes: double quote");
}

{
  const records = parse("");
  assertEqual(records.length, 0, "empty: 0 records");
}

{
  const csv = "a\r\n1\r\n2\r\n";
  const records = parse(csv);
  assertEqual(records.length, 2, "CRLF: 2 records");
}

{
  const table = parseTable('\uFEFFname,repo,details\r\nDemo,"https://example.invalid/team/demo","first\nsecond, with ""quotes"""\r\n');
  assertEqual(table.headers.join(","), "name,repo,details", "BOM removed");
  assertEqual(table.rows[0][2], 'first\nsecond, with "quotes"', "multiline quoted details");
  for (const input of ['repo\n"unclosed', 'repo\n"value"extra', 'repo\na"b', 'a,b\none', 'a\none,two']) {
    let rejected = false;
    try { parseTable(input); } catch { rejected = true; }
    assert(rejected, "malformed CSV rejected");
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
