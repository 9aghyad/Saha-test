import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_REGISTRY, FEUD_QUESTIONS, WORDS, TRAP_QUESTIONS, DRAW_WORDS, AUCTION_QUESTIONS, MAFIA_ROLES } from '../src/games.js';

test('all seven requested games are registered once', () => {
  assert.equal(GAME_REGISTRY.length, 7);
  assert.equal(new Set(GAME_REGISTRY.map(game => game.id)).size, GAME_REGISTRY.length);
});
test('seed content is broad enough to avoid a tiny demo-only set', () => {
  assert.ok(FEUD_QUESTIONS.length >= 20);
  assert.ok(Object.values(WORDS).flat().length >= 70);
  assert.ok(TRAP_QUESTIONS.length >= 15);
  assert.ok(DRAW_WORDS.length >= 20);
  assert.ok(AUCTION_QUESTIONS.length >= 10);
  assert.deepEqual(Object.keys(MAFIA_ROLES).sort(), ['citizen','clown','doctor','investigator','mafia'].sort());
});
test('game prompts and answers are non-empty', () => {
  for (const question of FEUD_QUESTIONS) {
    assert.ok(question.q.trim());
    assert.ok(question.a.length >= 3);
    assert.ok(question.a.every(([answer, points]) => answer.trim() && Number.isFinite(points) && points > 0));
  }
  for (const question of TRAP_QUESTIONS) {
    assert.ok(question.q.trim() && question.correct.trim());
    assert.ok(question.options.includes(question.correct));
    assert.equal(new Set(question.options).size, question.options.length);
  }
});
