import test from "node:test";
import assert from "node:assert/strict";
import { evaluate, parseExpression, formulaEcho } from "../src/formula.ts";
import { setDecimalComma } from "../src/numberformat.ts";

test("operators follow the usual precedence", () => {
  setDecimalComma(false);
  assert.equal(evaluate("2+3*4"), 14);
  assert.equal(evaluate("(2+3)*4"), 20);
  assert.equal(evaluate("10/4"), 2.5);
  assert.equal(evaluate("10-2-3"), 5);
  assert.equal(evaluate("2^3^2"), 512);
  assert.equal(evaluate("-2^2"), -4);
  assert.equal(evaluate("2^-1"), 0.5);
  assert.equal(evaluate("-(1+2)"), -3);
  assert.equal(evaluate("+5"), 5);
  assert.equal(evaluate(" 25.4 * 2 "), 50.8);
  assert.equal(evaluate(".5+.5"), 1);
  assert.equal(evaluate("((((1))))"), 1);
});

test("anything that is not a complete formula is refused", () => {
  setDecimalComma(false);
  for (const bad of ["", "  ", "2+", "*3", "(1", "1)", "()", "2 3", "2(3)", "(2)(3)", "1/0", "pi", "sqrt(4)", "2mm", "10%", "1,5+2", "1e3", "0x1", "2**3", "1..2", "^2"]) {
    assert.equal(evaluate(bad), null, bad);
  }
  assert.equal(evaluate("(".repeat(100) + "1" + ")".repeat(100)), null); // nesting limit
  assert.equal(evaluate("9^9^9"), null); // not finite
});

test("the decimal character of the setting applies inside formulas", () => {
  setDecimalComma(true);
  assert.equal(evaluate("1,5*2"), 3);
  assert.equal(evaluate("1.5*2"), null);
  assert.equal(parseExpression("2,5"), 2.5);
  setDecimalComma(false);
});

test("a field takes a plain number or a formula; the echo shows only formulas", () => {
  setDecimalComma(false);
  assert.equal(parseExpression("12.5"), 12.5);
  assert.equal(parseExpression("5*2"), 10);
  assert.equal(parseExpression(""), null);
  assert.equal(formulaEcho("12.5"), null);
  assert.equal(formulaEcho("5*2"), "= 10");
  assert.equal(formulaEcho("5*"), null);
});
