import test from 'node:test';
import assert from 'node:assert/strict';
import { finalAwards } from '../src/scoring.js';

test('individual platform points award 3, 2, 1 and then zero', () => {
  const players = [{id:'a',score:12},{id:'b',score:9},{id:'c',score:7},{id:'d',score:3},{id:'e',score:0}];
  assert.deepEqual(finalAwards(players), {a:3,b:2,c:1,d:0,e:0});
});

test('tied individual scores share the same placement award', () => {
  const players = [{id:'a',score:12},{id:'b',score:12},{id:'c',score:7},{id:'d',score:3}];
  assert.deepEqual(finalAwards(players), {a:3,b:3,c:1,d:0});
});

test('team games award two points to every member of the winning team only', () => {
  const players = [{id:'a',team:'blue'},{id:'b',team:'blue'},{id:'c',team:'red'}];
  assert.deepEqual(finalAwards(players,{teamGame:true,winningTeam:'blue'}), {a:2,b:2,c:0});
});

test('a tied team game awards no team bonus', () => {
  const players = [{id:'a',team:'blue'},{id:'b',team:'red'}];
  assert.deepEqual(finalAwards(players,{teamGame:true,winningTeam:null}), {a:0,b:0});
});
