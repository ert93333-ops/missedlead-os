/**
 * 금액/날짜 파싱 테스트.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseDateInput, FormInputError } from './formValues.ts';
test('money accepts whole cents and rejects hidden rounding or nonnumeric input', () => {
  assert.equal(parseMoney('12.34'), 1234);
  for (const input of ['1.005', '-1', 'foo', 'Infinity']) assert.throws(() => parseMoney(input), FormInputError);
});
test('dates reject impossible days and require explicit minute format', () => {
  assert.equal(parseDateInput('2027-02-28'), '2027-02-28T23:59:59.000Z');
  assert.equal(parseDateInput('2027-02-28 10:30', true), '2027-02-28T10:30:00.000Z');
  for (const input of ['2027-02-30', '2027-2-2', '']) assert.throws(() => parseDateInput(input), FormInputError);
});
