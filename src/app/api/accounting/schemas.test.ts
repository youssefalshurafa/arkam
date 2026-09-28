import { describe, expect, it } from 'vitest';
import { validateActionPayload } from './schemas';

describe('restoreTrash payload', () => {
 it('accepts a batch or a list of transactions', () => {
  expect(validateActionPayload('restoreTrash', { batchId: 4 })).toBeNull();
  expect(validateActionPayload('restoreTrash', { batchId: 4, acknowledgeReconciliationOverride: true })).toBeNull();
  expect(validateActionPayload('restoreTrash', { transactionIds: [1, '2'] })).toBeNull();
 });

 it('rejects both targets at once, or neither', () => {
  expect(validateActionPayload('restoreTrash', { batchId: 4, transactionIds: [1] })).not.toBeNull();
  expect(validateActionPayload('restoreTrash', {})).not.toBeNull();
  expect(validateActionPayload('restoreTrash', { transactionIds: [] })).not.toBeNull();
 });

 it('rejects a non-numeric batch id', () => {
  expect(validateActionPayload('restoreTrash', { batchId: 'abc' })).not.toBeNull();
 });
});

describe('purgeTrash payload', () => {
 it('accepts batches, rows, or all', () => {
  expect(validateActionPayload('purgeTrash', { batchIds: [1, 2] })).toBeNull();
  expect(validateActionPayload('purgeTrash', { transactionIds: [9] })).toBeNull();
  expect(validateActionPayload('purgeTrash', { all: true })).toBeNull();
 });

 it('rejects an empty request and all: false', () => {
  expect(validateActionPayload('purgeTrash', {})).not.toBeNull();
  expect(validateActionPayload('purgeTrash', { batchIds: [] })).not.toBeNull();
  expect(validateActionPayload('purgeTrash', { all: false })).not.toBeNull();
 });
});
