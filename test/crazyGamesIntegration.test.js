import { test } from 'node:test';
import assert from 'node:assert/strict';

const { window: originalWindow, document: originalDocument, application: originalApplication } = globalThis;

function createWindowStub({ initError }) {
  const crazyGamesStub = {
    SDK: {
      init: async () => {
        throw initError;
      },
      game: {},
      user: {},
    },
  };

  return {
    location: { hostname: 'localhost' },
    CrazyGames: crazyGamesStub,
    addEventListener: () => {},
  };
}

test('initializeCrazyGamesIntegration resolves when CrazyGames SDK is disabled', async (t) => {
  const initError = new Error('CrazyGames SDK is disabled on this domain.');
  initError.code = 'sdkDisabled';

  globalThis.window = createWindowStub({ initError });
  globalThis.document = {
    addEventListener: () => {},
    querySelector: () => null,
    head: { appendChild: () => {} },
  };
  globalThis.application = { publishEvent: () => {} };

  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.application = originalApplication;
  });

  const moduleUrl = new URL('../js/systems/crazyGamesIntegration.js', import.meta.url);
  const integrationModule = await import(moduleUrl.href);

  assert.equal(integrationModule.crazyGamesIntegrationAllowed, true);

  const result = await integrationModule.initializeCrazyGamesIntegration();

  assert.equal(result, false);
  assert.equal(integrationModule.crazyGamesWorks, false);
});
