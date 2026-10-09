'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { toolsFromLegalActions, actionFromToolCall } = require('../plays/werewolf/tools');

test('only currently legal role actions become tools', () => {
  const tools = toolsFromLegalActions([
    { name: 'wolfPick', payload: { target: 'u2' } },
    { name: 'wolfPick', payload: { target: null } },
    { name: 'seerCheck', payload: { target: 'u3' } }
  ]);
  const names = tools.map((tool) => tool.function.name);
  assert.deepEqual(names, ['wolf_kill', 'seer_check']);
  assert.ok(tools[0].function.parameters.properties.target.enum.includes('u2'));
  assert.ok(tools[0].function.parameters.properties.target.enum.includes(''));
  assert.ok(!names.includes('witch_save'));
});

test('a tool call becomes the same playAction a human button would send', () => {
  assert.deepEqual(
    actionFromToolCall({ function: { name: 'wolf_kill', arguments: '{"target":"u2"}' } }),
    { name: 'wolfPick', payload: { target: 'u2' } }
  );
  assert.deepEqual(
    actionFromToolCall({ function: { name: 'wolf_kill', arguments: '{"target":""}' } }),
    { name: 'wolfPick', payload: { target: null } }
  );
  assert.deepEqual(
    actionFromToolCall({ function: { name: 'speak', arguments: '{"text":"3号有点狼"}' } }),
    { name: 'speak', payload: { text: '3号有点狼' } }
  );
});
