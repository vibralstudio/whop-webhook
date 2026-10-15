// Test-only: returns example content shaped like each real call. Enabled with VB_MOCK=1.
const ex = require("./example.json");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = async function mock(tool) {
  await wait(+process.env.VB_MOCK_MS || 800);
  const c = JSON.parse(JSON.stringify(ex));
  if (tool === "write_core") return { ...c, conceptSeeds: c.concepts.map((x) => ({ n: x.n, type: x.type, idea: x.why, contra: x.contra })), captionStyles: Object.keys(c.captions) };
  if (tool === "write_concepts") return { concepts: c.concepts };
  if (tool === "write_plan") return { release: c.release, plan: c.plan, phases: c.phases, dayOne: c.dayOne };
  if (tool === "write_captions") { const o = {}; for (const k of Object.keys(c.captions)) o[k] = [...c.captions[k], ...c.captions[k], c.captions[k][0]]; return { captions: o }; }
  if (tool === "write_prompt") return { promptBuilder: c.promptBuilder };
  throw new Error("unknown mock " + tool);
};
