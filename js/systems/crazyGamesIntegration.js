export let crazyGamesWorks = false;

const blockedCrazyGamesHosts = new Set([
    // 'pavelonishenko.github.io', // TODO add github back here when not needed for testing
]);
const allowedLocalHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', 
    'pavelonishenko.github.io']); // TODO remove github when not needed for testing

function getNormalizedHost() {
    if (typeof window === 'undefined') {
        return '';
    }

    return (window.location?.hostname || '').trim().toLowerCase();
}

function isGithubPagesHost(host) {
    return host.endsWith('.github.io');
}

function isCrazyGamesHost(host) {
    return host === 'crazygames.com' || host.endsWith('.crazygames.com');
}

function isLocalDevelopmentHost(host) {
    return allowedLocalHosts.has(host);
}

export const crazyGamesIntegrationAllowed = (() => {
    const host = getNormalizedHost();
    if (!host) {
        return true;
    }
    if (blockedCrazyGamesHosts.has(host)) {
        return false;
    }
    // TODO uncommment before final release
    // if (isGithubPagesHost(host)) {
    //     return false;
    // }
    if (isCrazyGamesHost(host)) {
        return true;
    }
    if (isLocalDevelopmentHost(host)) {
        return true;
    }
    return false;
})();

export const crazyMap = { sdkGameLoadingStart: "loadingStart", sdkGameLoadingStop: "loadingStop", gameplayStart: "gameplayStart", gameplayStop: "gameplayStop" };

let crazyGamesSdkPromise = null;

function ensureCrazyGamesSdkLoaded() {
    if (!crazyGamesIntegrationAllowed) 
        return Promise.resolve(false);

    if (window.CrazyGames?.SDK) 
        return Promise.resolve(true);

    if (!crazyGamesSdkPromise) 
        crazyGamesSdkPromise = loadCrazyGamesSdk();
    return crazyGamesSdkPromise;
}

function loadCrazyGamesSdk() {
    return new Promise(resolve => {
        const handleResult = success => resolve(Boolean(success));
        const existing = findExistingCrazyGamesScript(handleResult);
        if (existing) 
            return;

        injectCrazyGamesScript(handleResult);
    });
}

function findExistingCrazyGamesScript(handleResult) {
    const script = document.querySelector('script[data-crazygames-sdk]');
    if (!script) return false;

    if (script.dataset.crazygamesSdkLoaded === 'true') {
        handleResult(true);
        return true;
    }

    const state = script.readyState;
    if (state === 'complete' || state === 'loaded') {
        handleResult(true);
        return true;
    }

    script.addEventListener('load', () => handleResult(true), { once: true });
    script.addEventListener('error', () => handleResult(false), { once: true });
    return true;
}

function injectCrazyGamesScript(handleResult) {
    const script = document.createElement('script');
    script.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
    script.async = true;
    script.dataset.crazygamesSdk = 'true';
    script.addEventListener('load', () => {
        script.dataset.crazygamesSdkLoaded = 'true';
        handleResult(true);
    }, { once: true });
    script.addEventListener('error', () => handleResult(false), { once: true });
    document.head.appendChild(script);
}

export function callCrazyGamesEvent(fnName) {
    if (!crazyGamesIntegrationAllowed || !crazyGamesWorks) {
        return;
    }
    try {
        const realFn = crazyMap[fnName] || fnName;
        window.CrazyGames.SDK.game[realFn]();
    }
    catch (e) {
        console.error(`error while calling [${fnName}] event: [${e.message}].`);
    }
}

export async function initializeCrazyGamesIntegration() {
    crazyGamesWorks = false;
    if (!crazyGamesIntegrationAllowed) {
        return false;
    }

    const sdkLoaded = await ensureCrazyGamesSdkLoaded();
    if (!sdkLoaded || !window.CrazyGames?.SDK) {
        return false;
    }

    configureForCrazyGames();
    try {
        await window.CrazyGames.SDK.init();
    }
    catch (error) {
        handleCrazyGamesInitError(error);
        return false;
    }
    const integrationWorks = checkCrazyGamesIntegration();
    if (integrationWorks) {
        crazyGamesWorks = true;
    }
    return crazyGamesWorks;
}

function handleCrazyGamesInitError(error) {
    crazyGamesWorks = false;
    if (isSdkDisabledError(error)) {
        console.warn('CrazyGames SDK init skipped: SDK disabled for this domain.', error);
        return;
    }

    console.error('CrazyGames SDK init failed. Continuing without SDK.', error);
}

function isSdkDisabledError(error) {
    if (!error) {
        return false;
    }

    if (error.code === 'sdkDisabled') {
        return true;
    }

    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    return message.includes('sdk is disabled');
}

function configureForCrazyGames() {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('wheel', event => event.preventDefault(), { passive: false });
        window.addEventListener('keydown', event => {
            if (['ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
                event.preventDefault();
            }
        });
    }

    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc || typeof doc.addEventListener !== 'function') {
        return;
    }

    // This is a fix for handling visibility change
    // on webview, it's for an issue reported for Samsung App.
    doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState) {
            if (doc.visibilityState === 'hidden') {
                application.publishEvent('OnWebDocumentPause', 'True');
            } else if (doc.visibilityState === 'visible') {
                application.publishEvent('OnWebDocumentPause', 'False');
            }
        }
    });

    // Disable context menu appearing after right click outside of the canvas.
    doc.addEventListener('contextmenu', event => event.preventDefault());
}

export function checkCrazyGamesIntegration() {
    if (!crazyGamesIntegrationAllowed) {
        return false;
    }
    console.log(`Environment: ${window.CrazyGames?.SDK?.environment}`);
    if (window.CrazyGames?.SDK?.environment === 'disabled') {
        console.warn('CrazyGames SDK is disabled on this domain.');
        crazyGamesWorks = false;
        return false;
    }

    if (window.CrazyGames && window.CrazyGames.SDK) {
        console.log("CrazyGames SDK loaded (v3)");
        return true;
    } else {
        console.log("CrazyGames SDK not found");
        return false;
    }
}
