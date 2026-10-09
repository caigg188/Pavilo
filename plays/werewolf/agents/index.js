'use strict';

// 按身份取 Agent spec。host 在发牌后才知道谁是什么身份，
// 因此 spec 的绑定发生在开局时，而不是占座时。
const SPECS = {
  werewolf: require('./werewolf'),
  seer: require('./seer'),
  witch: require('./witch'),
  hunter: require('./hunter'),
  villager: require('./villager')
};

function specFor(role) { return SPECS[role] || SPECS.villager; }

module.exports = { SPECS, specFor };
