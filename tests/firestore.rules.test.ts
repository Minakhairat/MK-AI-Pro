import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const draftPath = path.resolve(process.cwd(), 'DRAFT_firestore.rules');
const activeRulesPath = fs.existsSync(draftPath) ? draftPath : rulesPath;
const rulesContent = fs.readFileSync(activeRulesPath, 'utf8');
const blueprint = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8')
);

test('Rules use rules_version 2 and global default-deny catch-all', () => {
  assert.match(rulesContent, /rules_version\s*=\s*'2'/);
  assert.match(rulesContent, /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/);
});

test('PII Isolation: /users denies blanket list and restricts get to owner/admin', () => {
  assert.match(rulesContent, /match\s+\/users\/\{userId\}[\s\S]*allow\s+list:\s*if\s+false;/);
  assert.match(rulesContent, /match\s+\/users\/\{userId\}[\s\S]*allow\s+get:[\s\S]*isOwner\(userId\)/);
});

test('Every entity in firebase-blueprint.json has a matching rules block and validation helper', () => {
  const entities = Object.keys(blueprint.entities);
  for (const entity of entities) {
    assert.match(
      rulesContent,
      new RegExp(`function\\s+isValid${entity}\\(`),
      `Missing validation helper isValid${entity}`
    );
  }
});

test('Shadow fields and unapproved keys are blocked via hasAll + hasOnly', () => {
  assert.match(rulesContent, /data\.keys\(\)\.hasAll\(/);
  assert.match(rulesContent, /data\.keys\(\)\.hasOnly\(/);
  assert.match(rulesContent, /affectedKeys\(\)\.hasOnly\(/);
});

test('Email verification is strictly enforced on writes and admin checks', () => {
  assert.match(rulesContent, /request\.auth\.token\.email_verified\s*==\s*true/);
});

test('allow list queries strictly evaluate resource.data.ownerUid without get()', () => {
  const listMatches = [...rulesContent.matchAll(/allow\s+list:\s*if\s*([^;]+);/g)];
  assert.ok(listMatches.length >= 5);
  for (const match of listMatches) {
    const expr = match[1];
    assert.ok(!expr.includes('get('), `allow list must not call get(): ${expr}`);
    assert.ok(!expr.includes('exists('), `allow list must not call exists(): ${expr}`);
    assert.ok(
      expr === 'false' || expr.includes('resource.data.'),
      `allow list must restrict resource.data or be false: ${expr}`
    );
  }
});

test('Path variable hardening isValidId enforces length and regex', () => {
  assert.match(rulesContent, /function\s+isValidId\(id\)[\s\S]*id\.size\(\)\s*<=\s*128/);
  assert.match(rulesContent, /id\.matches\('\^\[a-zA-Z0-9_\\\\-\]\+\$'\)/);
});

test('Temporal integrity and append-only audit logs are enforced', () => {
  assert.match(rulesContent, /incoming\(\)\.createdAt\s*==\s*request\.time/);
  assert.match(rulesContent, /incoming\(\)\.updatedAt\s*==\s*request\.time/);
  assert.match(rulesContent, /match\s+\/activityLogs\/\{logId\}[\s\S]*allow\s+update:\s*if\s+false;[\s\S]*allow\s+delete:\s*if\s+false;/);
});

test('Dataset split sum == 100 and anti-leakage applyOnlyToTrain == true are enforced', () => {
  assert.match(rulesContent, /\(data\.splitTrainPct\s*\+\s*data\.splitValPct\s*\+\s*data\.splitTestPct\)\s*==\s*100/);
  assert.match(rulesContent, /cfg\.applyOnlyToTrain\s*==\s*true/);
});

test('DatasetItem enforces Master Gate, bounded annotations, and strict MIME allowlist', () => {
  assert.match(rulesContent, /match\s+\/items\/\{itemId\}[\s\S]*get\(\/databases\/\$\(database\)\/documents\/datasets\/\$\(datasetId\)\)\.data\.ownerUid\s*==\s*request\.auth\.uid/);
  assert.match(rulesContent, /data\.annotations\s+is\s+list\s+&&\s+data\.annotations\.size\(\)\s*<=\s*100/);
  assert.match(rulesContent, /data\.mimeType\s+in\s+\['image\/jpeg',\s*'image\/png',\s*'image\/webp'\]/);
});

test('TrainingRun enforces hyperparameter bounds, terminal state locking, and bounded epochMetrics', () => {
  assert.match(rulesContent, /function\s+isValidHyperparameters\(hp\)/);
  assert.match(rulesContent, /data\.epochMetrics\s+is\s+list\s+&&\s+data\.epochMetrics\.size\(\)\s*<=\s*200/);
  assert.match(rulesContent, /!\(existing\(\)\.status\s+in\s+\['completed',\s*'cancelled',\s*'failed'\]\)/);
});

test('TrainedModel enforces metric [0..1] bounds, bounded confusion matrix, and immutable lineage fields', () => {
  assert.match(rulesContent, /match\s+\/trainedModels\/\{modelId\}/);
  assert.match(rulesContent, /data\.confusionFlat\s+is\s+list\s+&&\s+data\.confusionFlat\.size\(\)\s*<=\s*2500/);
  assert.match(rulesContent, /incoming\(\)\.runId\s*==\s*existing\(\)\.runId/);
});

test('EvaluationReport enforces [0..1] metrics, referential integrity, and immutable snapshots', () => {
  assert.match(rulesContent, /match\s+\/evaluationReports\/\{reportId\}/);
  assert.match(rulesContent, /function\s+isValidEvaluationReport\(data,\s*reportId\)/);
  assert.match(rulesContent, /match\s+\/evaluationReports\/\{reportId\}[\s\S]*allow\s+update:\s*if\s+false;/);
  assert.match(rulesContent, /trainedModels\/\$\(incoming\(\)\.modelId\)/);
});

test('GeneratedApp enforces PWA bounds, on-device compatibility guard, and referential integrity', () => {
  assert.match(rulesContent, /match\s+\/generatedApps\/\{appId\}/);
  assert.match(rulesContent, /function\s+isValidGeneratedApp\(data,\s*appId\)/);
  assert.match(rulesContent, /data\.shortName\.size\(\)\s*<=\s*12/);
  assert.match(rulesContent, /data\.inputSources\.hasOnly\(\['camera',\s*'upload',\s*'video'\]\)/);
  assert.match(rulesContent, /onDeviceCompatible\s*==\s*true/);
});

