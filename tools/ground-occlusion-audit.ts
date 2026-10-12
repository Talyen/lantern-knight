import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { projectRoot } from './assets/paths';
import { parseSceneDocument } from '../src/content/scene-document';
import {
  auditGroundOcclusion,
  auditProbe,
  contactDepthRepair,
} from './diagnostics/ground-occlusion-audit';

const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    'write-plan': { type: 'string' },
    'contact-region': { type: 'string', multiple: true },
    'apply-plan': { type: 'string' },
  },
});
if (values['apply-plan'] && (values['write-plan'] || values['contact-region']))
  throw new Error('Apply a reviewed plan separately from generating it.');
if (values['contact-region']?.length && !values['write-plan'])
  throw new Error(
    '--contact-region scene-id:region-id requires --write-plan. Review the painting first.',
  );
const directory = path.join(projectRoot, 'authoring/scenes');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const scenes = await Promise.all(
  (await fs.readdir(directory))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map(async (file) => {
      const text = await fs.readFile(path.join(directory, file), 'utf8');
      return { file, text, document: parseSceneDocument(JSON.parse(text)) };
    }),
);
const reports = scenes
  .filter((s) => s.document.groundInteraction)
  .map((s) => ({
    scene: s.document.id,
    file: s.file,
    sha256: hash(s.text),
    regions: s.document.groundInteraction!.regions.length,
    masked: s.document.groundInteraction!.regions.filter((r) => r.mask?.length).length,
    findings: auditGroundOcclusion(s.document),
  }));
const repairs = [];
for (const selection of values['contact-region'] ?? []) {
  const [sceneId, regionId, extra] = selection.split(':');
  const scene = scenes.find((s) => s.document.id === sceneId);
  if (!scene || !regionId || extra) throw new Error('Unknown scene:region selection: ' + selection);
  repairs.push({
    scene: sceneId,
    region: regionId,
    sha256: hash(scene.text),
    depth: contactDepthRepair(scene.document, regionId),
  });
}
if (values['write-plan']) {
  if (!repairs.length) throw new Error('Select at least one visually reviewed contact region.');
  await fs.writeFile(values['write-plan'], JSON.stringify({ version: 1, repairs }, null, 2) + '\n');
  console.log('Contact repair plan: ' + values['write-plan']);
}
let repaired = 0;
if (values['apply-plan']) {
  const plan = JSON.parse(await fs.readFile(values['apply-plan'], 'utf8'));
  if (plan.version !== 1 || !Array.isArray(plan.repairs) || !plan.repairs.length)
    throw new Error('Invalid repair plan');
  const updated = new Map<
    string,
    { scene: (typeof scenes)[number]; document: ReturnType<typeof parseSceneDocument> }
  >();
  // Validate every selection and exact scene revision before writing any scene.
  const selected = new Set<string>();
  for (const repair of plan.repairs) {
    const scene = scenes.find((s) => s.document.id === repair.scene);
    const key = repair.scene + ':' + repair.region;
    if (selected.has(key)) throw new Error('Duplicate repair: ' + key);
    selected.add(key);
    if (!scene || repair.sha256 !== hash(scene.text))
      throw new Error('Scene changed since repair review: ' + key);
    const expected = contactDepthRepair(scene.document, repair.region);
    if (JSON.stringify(expected) !== JSON.stringify(repair.depth))
      throw new Error('Repair differs from reviewed contact proposal: ' + key);
    const entry = updated.get(scene.file) ?? { scene, document: structuredClone(scene.document) };
    entry.document.groundInteraction!.regions.find((r) => r.id === repair.region)!.depth = expected;
    updated.set(scene.file, entry);
    repaired++;
  }
  for (const { scene, document } of updated.values()) {
    parseSceneDocument(document);
    if ((await fs.readFile(path.join(directory, scene.file), 'utf8')) !== scene.text)
      throw new Error('Scene changed while preparing repairs: ' + scene.document.id);
  }
  for (const { scene, document } of updated.values()) {
    parseSceneDocument(document);
    // Preserve omitted defaults and all unrelated authored fields.
    const raw = JSON.parse(scene.text);
    for (const region of document.groundInteraction!.regions)
      if (selected.has(document.id + ':' + region.id))
        raw.groundInteraction.regions.find((r: { id: string }) => r.id === region.id).depth =
          region.depth;
    await fs.writeFile(path.join(directory, scene.file), JSON.stringify(raw) + '\n');
  }
}
const output =
  values.output ??
  path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'lantern-occlusion-')), 'report.json');
await fs.writeFile(
  output,
  JSON.stringify(
    {
      version: 1,
      advisory: true,
      probe: auditProbe,
      description:
        'Geometry warnings and collision-valid rectangular actor probes; not artwork judgments. Findings describe the input scenes before any repairs.',
      scenes: reports,
      repaired,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `${reports.length} scenes; ${reports.reduce((n, s) => n + s.masked, 0)} masks; ${reports.reduce((n, s) => n + s.findings.length, 0)} warnings; ${repaired} repairs. Report: ${output}`,
);
