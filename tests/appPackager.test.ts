import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAppIconSvg,
  buildPwaManifestJson,
  buildPwaReadme,
  buildServiceWorkerJs,
  buildStandaloneHtmlApp,
} from '../src/lib/appPackager.ts';
import type { StoredModelArtifact } from '../src/lib/localModelStore.ts';
import type { GeneratedApp, TrainedModel } from '../src/types/domain.ts';

function makeFixtureApp(overrides: Partial<GeneratedApp> = {}): GeneratedApp {
  return {
    id: 'app_test_1',
    projectId: 'proj_1',
    modelId: 'mdl_1',
    modelName: 'MK MobileNet Classifier',
    ownerUid: 'user_1',
    taskType: 'image_classification',
    name: 'PCB Inspector Pro',
    shortName: 'PCBInspect123456',
    description: 'Real-time board inspection PWA',
    tier: 'professional',
    themeColor: '#DC2626',
    backgroundColor: 'dark',
    runtimeTarget: 'on_device_pwa',
    inputSources: ['camera', 'upload', 'video'],
    confidenceThreshold: 0.4,
    iouThreshold: 0.5,
    showConfidence: true,
    showLatency: true,
    showHistory: true,
    allowCsvExport: true,
    customHeaderTitle: 'Line 4 Vision Station',
    alertEnabled: true,
    alertTargetClass: 'defect',
    alertMinConfidence: 0.8,
    status: 'ready',
    version: 3,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeFixtureModel(): TrainedModel {
  return {
    id: 'mdl_1',
    runId: 'run_1',
    projectId: 'proj_1',
    datasetId: 'ds_1',
    datasetVersion: 1,
    ownerUid: 'user_1',
    name: 'MK MobileNet Classifier',
    taskType: 'image_classification',
    backendEngine: 'tfjs_browser',
    architecture: 'mk_mobilenet_sep',
    license: 'Apache-2.0',
    classes: ['pass', 'defect'],
    inputSize: 96,
    parameterCount: 12000,
    weightSizeBytes: 48000,
    inferenceLatencyMs: 14.2,
    accuracy: 0.94,
    precision: 0.93,
    recall: 0.94,
    f1Score: 0.935,
    mAP50: 0,
    confusionLabels: ['pass', 'defect'],
    confusionFlat: [9, 1, 0, 10],
    perClassMetrics: [],
    onDeviceCompatible: true,
    isActive: true,
    createdAt: null,
    updatedAt: null,
  };
}

test('buildPwaManifestJson enforces 12-char short_name and valid hex color', () => {
  const app = makeFixtureApp({ themeColor: 'invalid-color' });
  const parsed = JSON.parse(buildPwaManifestJson(app));
  assert.equal(parsed.short_name, 'PCBInspect12');
  assert.equal(parsed.short_name.length <= 12, true);
  assert.equal(parsed.theme_color, '#DC2626');
  assert.equal(parsed.background_color, '#09090B');
  assert.equal(parsed.display, 'standalone');
  assert.equal(parsed.icons[0].src, './app-icon.svg');
});

test('buildServiceWorkerJs and buildAppIconSvg generate valid versioned assets', () => {
  const app = makeFixtureApp();
  const sw = buildServiceWorkerJs(app);
  assert.match(sw, /const CACHE_NAME = 'mk-ai-pcb-inspector-pro-v3';/);
  assert.match(sw, /\.\/pcb-inspector-pro\.html/);

  const svg = buildAppIconSvg(app);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, />PC<\/text>/);
  assert.match(svg, /#DC2626/);
});

test('buildStandaloneHtmlApp escapes HTML/script injection and embeds Base64 weights cleanly', () => {
  const xssName = '</script><script>alert(1)</script>';
  const app = makeFixtureApp({
    name: xssName,
    customHeaderTitle: xssName,
    description: '<img src=x onerror=alert(2)>',
  });
  const model = makeFixtureModel();
  const rawWeights = new Uint8Array([1, 2, 3, 4, 255]).buffer;
  const artifact: StoredModelArtifact = {
    key: 'mdl_1',
    projectId: 'proj_1',
    runId: 'run_1',
    classes: model.classes,
    inputSize: 96,
    taskType: 'image_classification',
    architecture: 'mk_mobilenet_sep',
    modelTopology: { class_name: 'Sequential' },
    weightSpecs: [{ name: 'dense/kernel', shape: [4, 2], dtype: 'float32' }],
    weightData: rawWeights,
    sizeBytes: rawWeights.byteLength,
    savedAt: '2026-11-25T00:00:00Z',
  };

  const { html, filename } = buildStandaloneHtmlApp({
    app,
    model,
    artifact,
    locale: 'ar',
  });

  assert.equal(filename, 'script-script-alert-1-script.html');
  assert.match(html, /<html lang="ar" dir="rtl">/);
  // Raw unescaped injection tags must NEVER appear inside HTML or JSON blocks
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('<img src=x onerror=alert(2)>'), false);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.match(html, /"available":true/);
  assert.match(html, /"weightDataBase64":"AQIDBP8="/);

  const withoutArtifact = buildStandaloneHtmlApp({
    app: makeFixtureApp(),
    model,
    artifact: null,
    locale: 'en',
  });
  assert.match(withoutArtifact.html, /"available":false/);

  const readme = buildPwaReadme(makeFixtureApp(), model);
  assert.match(readme, /PCB Inspector Pro/);
  assert.match(readme, /mk_mobilenet_sep/);
});

test('Custom app icon PNG data URL is embedded safely into manifest, service worker, and standalone HTML while rejecting unsafe values', () => {
  const validPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const appWithIcon = makeFixtureApp({ customIconDataUrl: validPngDataUrl });
  const manifest = JSON.parse(buildPwaManifestJson(appWithIcon));
  assert.equal(manifest.icons[0].src, './app-icon.png');
  assert.equal(manifest.icons[0].sizes, '192x192');
  assert.equal(manifest.icons[0].type, 'image/png');

  const sw = buildServiceWorkerJs(appWithIcon);
  assert.match(sw, /\.\/app-icon\.png/);

  const { html } = buildStandaloneHtmlApp({
    app: appWithIcon,
    model: makeFixtureModel(),
    artifact: null,
    locale: 'en',
  });
  assert.match(html, new RegExp(`<link rel="icon" type="image/png" href="${validPngDataUrl.replace(/[+/=]/g, '\\$&')}"`));
  assert.match(html, /<img src="data:image\/png;base64,/);

  // Invalid / XSS SVG data URLs must be rejected and fall back to app-icon.svg
  const appUnsafeIcon = makeFixtureApp({
    customIconDataUrl: 'data:image/svg+xml;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  });
  const fallbackManifest = JSON.parse(buildPwaManifestJson(appUnsafeIcon));
  assert.equal(fallbackManifest.icons[0].src, './app-icon.svg');
  const unsafeOut = buildStandaloneHtmlApp({
    app: appUnsafeIcon,
    model: makeFixtureModel(),
    artifact: null,
    locale: 'en',
  });
  assert.equal(unsafeOut.html.includes('PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), false);
});
