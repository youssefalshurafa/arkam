import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountingApi } from '@/lib/accountingApi';
import { useActionHistoryStore } from './actionHistoryStore';
import { useAppStatusStore } from './appStatusStore';

// A reversible counter change, standing in for a server round-trip.
function counterAction(state: { value: number }, delta: number) {
 return {
  undo: vi.fn(async () => {
   state.value -= delta;
  }),
  redo: vi.fn(async () => {
   state.value += delta;
  }),
 };
}

const store = () => useActionHistoryStore.getState();

beforeEach(() => {
 useActionHistoryStore.setState({ past: [], future: [], busy: false });
 useAppStatusStore.setState({ error: '' });
 vi.spyOn(accountingApi, 'getActiveWorkspaceId').mockReturnValue('ws-1');
});

afterEach(() => {
 vi.restoreAllMocks();
});

describe('actionHistoryStore', () => {
 it('undoes and redoes in order, newest first', async () => {
  const state = { value: 0 };
  state.value += 1;
  store().push(counterAction(state, 1));
  state.value += 10;
  store().push(counterAction(state, 10));

  await store().undo();
  expect(state.value).toBe(1);
  await store().undo();
  expect(state.value).toBe(0);
  await store().redo();
  expect(state.value).toBe(1);
  await store().redo();
  expect(state.value).toBe(11);
  expect(store().future).toHaveLength(0);
 });

 it('a new change clears the redo side', async () => {
  const state = { value: 0 };
  store().push(counterAction(state, 1));
  await store().undo();
  expect(store().future).toHaveLength(1);
  store().push(counterAction(state, 5));
  expect(store().future).toHaveLength(0);
 });

 it('drop removes an entry whose write never landed', async () => {
  const state = { value: 0 };
  const kept = store().push(counterAction(state, 1));
  const failed = store().push(counterAction(state, 2));
  store().drop(failed);
  expect(store().past).toEqual([kept]);
 });

 it('undoAction (the toast) undoes that exact entry, so the toolbar cannot undo it again', async () => {
  const state = { value: 3 };
  const entry = store().push(counterAction(state, 3));
  await store().undoAction(entry);
  expect(state.value).toBe(0);
  expect(store().past).toHaveLength(0);
  expect(store().future).toEqual([entry]);
  await store().undoAction(entry);
  expect(entry.undo).toHaveBeenCalledTimes(1);
 });

 it('drops a step whose undo fails and reports why, instead of blocking older steps', async () => {
  const state = { value: 0 };
  const older = store().push(counterAction(state, 1));
  store().push({
   undo: async () => {
    throw new Error('gone');
   },
   redo: async () => {},
  });
  await store().undo();
  expect(useAppStatusStore.getState().error).toBe('gone');
  expect(store().past).toEqual([older]);
  expect(store().future).toHaveLength(0);
  expect(store().busy).toBe(false);
 });

 it('discards history recorded in another workspace rather than replaying it', async () => {
  const state = { value: 0 };
  const action = counterAction(state, 1);
  store().push(action);
  vi.spyOn(accountingApi, 'getActiveWorkspaceId').mockReturnValue('ws-2');
  await store().undo();
  expect(action.undo).not.toHaveBeenCalled();
  expect(store().past).toHaveLength(0);
 });

 it('keeps at most 30 steps', () => {
  const state = { value: 0 };
  for (let i = 0; i < 40; i++) store().push(counterAction(state, 1));
  expect(store().past).toHaveLength(30);
 });
});
