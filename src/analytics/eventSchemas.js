const integerBetween = (minimum, maximum) => value => Number.isInteger(value) && value >= minimum && value <= maximum;
const oneOf = (...values) => value => values.includes(value);
const boolean = value => typeof value === 'boolean';
const required = validate => ({ validate, required: true });
const optional = validate => ({ validate, required: false });

const durationMs = integerBetween(0, 86_400_000);
const wave = integerBetween(1, 100_000);
const count = integerBetween(0, 1_000_000);
const amount = integerBetween(0, 1_000_000_000);
const towerLevel = integerBetween(1, 6);
const towerColor = oneOf('red', 'blue', 'green');
const tutorialStep = oneOf(
  'story-intro', 'build-tower', 'build-four-towers', 'switch-color', 'start-wave', 'energy-economy', 'prepare-merge',
  'merge-towers', 'select-merge-towers', 'exit-merge-mode', 'remove-tower', 'score-system', 'story-wave10', 'upgrade-tower'
);

export const eventPropertySchemas = Object.freeze({
  session_start: {},
  load_complete: { durationMs: required(durationMs), assetsLoaded: optional(count) },
  first_interaction: { inputType: required(oneOf('pointer', 'touch', 'keyboard')), elapsedMs: required(durationMs) },
  tutorial_start: { tutorialVersion: required(integerBetween(1, 100)) },
  tutorial_step_complete: { stepId: required(tutorialStep), durationMs: required(durationMs) },
  tutorial_skip: { stepId: required(tutorialStep), elapsedMs: required(durationMs) },
  tutorial_complete: { durationMs: required(durationMs), livesLost: optional(count) },
  run_start: { mode: required(oneOf('standard', 'endless')) },
  wave_start: { wave: required(wave), enemyCount: required(count), energy: required(amount), lives: required(count) },
  wave_complete: {
    wave: required(wave), durationMs: required(durationMs), livesRemaining: required(count), energyRemaining: required(amount),
    leaks: optional(count), damageTaken: optional(count), enemiesKilled: optional(count)
  },
  wave_fail: {
    wave: required(wave), reason: required(oneOf('base_destroyed', 'quit', 'restart', 'runtime_error')), durationMs: required(durationMs),
    enemyType: optional(oneOf('swarm', 'tank', 'other')), livesBefore: optional(count)
  },
  run_end: {
    finalWave: required(wave), score: required(amount), durationMs: required(durationMs), towers: required(count),
    reason: required(oneOf('defeat', 'victory', 'restart', 'quit', 'runtime_error'))
  },
  gameplay_start: { reason: required(oneOf('initial_start', 'resume', 'ad_finished', 'restart')) },
  gameplay_stop: { reason: required(oneOf('pause', 'menu', 'game_over', 'blocking_screen', 'ad')) },
  tower_place: {
    wave: required(wave), towerColor: required(towerColor), towerLevel: required(towerLevel), cost: required(amount), energyRemaining: required(amount)
  },
  tower_merge: {
    wave: required(wave), inputLevel: required(towerLevel), resultLevel: required(towerLevel), towerColor: required(towerColor),
    cost: required(amount), energyRemaining: optional(amount)
  },
  tower_color_switch: {
    wave: required(wave), fromColor: required(towerColor), toColor: required(towerColor), cost: required(amount),
    energyRemaining: required(amount), duringWave: required(boolean)
  },
  energy_blocked_action: {
    action: required(oneOf('tower_place', 'tower_merge', 'tower_color_switch', 'tower_upgrade')),
    requiredEnergy: required(amount), currentEnergy: required(amount)
  },
  ad_started: { adType: required(oneOf('midgame', 'rewarded')), reason: required(oneOf('wave_milestone', 'reward_offer', 'manual')) },
  ad_finished: {
    adType: required(oneOf('midgame', 'rewarded')), reason: required(oneOf('wave_milestone', 'reward_offer', 'manual')),
    completed: required(boolean)
  },
  ad_error: {
    adType: required(oneOf('midgame', 'rewarded')), reason: required(oneOf('wave_milestone', 'reward_offer', 'manual')),
    errorCategory: required(oneOf('sdk_unavailable', 'request_rejected', 'timeout', 'provider_error', 'unknown'))
  },
  runtime_error: {
    category: required(oneOf('uncaught_exception', 'unhandled_rejection', 'asset', 'render', 'game_state', 'unknown')),
    messageHash: required(value => typeof value === 'string' && /^[a-f0-9]{16,64}$/i.test(value)),
    gameState: required(oneOf('loading', 'menu', 'gameplay', 'paused', 'ad', 'game_over', 'unknown'))
  }
});

export const runScopedEventNames = new Set([
  'tutorial_start', 'tutorial_step_complete', 'tutorial_skip', 'tutorial_complete', 'run_start', 'wave_start', 'wave_complete', 'wave_fail',
  'run_end', 'gameplay_start', 'gameplay_stop', 'tower_place', 'tower_merge', 'tower_color_switch', 'energy_blocked_action',
  'ad_started', 'ad_finished', 'ad_error'
]);
