import { describe, expect, it } from "vitest";
import { enforceSafetyFloor } from "./intake/safety.js";
import type { ModelAssessment } from "./intake/types.js";

const assessment = (): ModelAssessment => ({
  reply: "Please describe the problem.", category: "handyman", summary: "Reported household problem",
  issueCandidates: [], questions: [], details: {},
  safety: { level: "normal", hazards: [], guidance: "" }, readyToConfirm: false,
});
const emergencyCases = [
  ["No gas smell but smoke from outlet", "fire"],
  ["No gas smell, but smoke is coming out", "fire"],
  ["No gas smell, smoke is coming from outlet", "fire"],
  ["No gas smell, smoke coming from the outlet", "fire"],
  ["No gas smell, smoke from the outlet", "fire"],
  ["No gas smell, smoke billows from the outlet", "fire"],
  ["No gas smell, water is rising rapidly", "severe_flooding"],
  ["No hay olor a gas, humo saliendo del enchufe", "fire"],
  ["No hay olor a gas, sale humo del enchufe", "fire"],
  ["No gas smell. Smoke in the kitchen", "fire"],
  ["No gas smell, structural damage, but smoke is visible", "fire"],
  ["No hay olor a gas, sale humo del enchufe", "fire"],
  ["No smoke and I smell gas", "gas"],
  ["No hay olor a gas pero salen chispas del enchufe", "electrical"],
  ["Sin humo, el agua sube rápidamente", "severe_flooding"],
  ["There is a gas smell", "gas"],
  ["Huele a gas en la cocina", "gas"],
  ["Huelo a gas cerca del calentador.", "gas"],
  ["Olemos a gas en la cocina", "gas"],
  ["There are flames near the heater", "fire"],
  ["Hay humo en la cocina", "fire"],
  ["Sparks are coming from the outlet", "electrical"],
  ["Hay cables expuestos con corriente", "electrical"],
  ["The ceiling is falling", "structural"],
  ["El techo se está cayendo", "structural"],
  ["Water is rising rapidly", "severe_flooding"],
  ["Hay una inundación grave", "severe_flooding"],
  ["The smoke detector is beeping and smoke is coming from the outlet", "fire"],
  ["I am not sure if I smell gas", "gas"],
  ["No puedo descartar olor a gas", "gas"],
  ["There was smoke yesterday", "fire"],
  ["The fire has not been extinguished", "fire"],
] as const;
const normalCases = [
  "There is no gas smell, smoke, sparks, electrical exposure, structural damage or severe flooding.",
  ...['electrical exposure', 'structural damage', 'visible damage', 'unusual noises'].map(noun => 'There is no gas smell, ' + noun + ', smoke, sparks or severe flooding.'),
  ...['exposicion electrica', 'danos estructurales', 'danos visibles', 'ruidos extranos'].map(noun => 'No hay olor a gas, ' + noun + ', humo, chispas ni inundacion grave.'),
  "No gas smell, smoke, sparks, electrical contact, standing water or flooding",
  "No hay olor a gas, humo, chispas, contacto electrico ni inundacion",
  "No smoke or gas smell", "No smoke or sparks", "No hay humo ni chispas",
  "No gas smell", "I do not smell gas", "There is no smoke", "No sparks",
  "No hay humo", "No huele a gas", "Sin olor a gas", "No hay chispas",
  "The smoke detector battery is beeping", "The smoke alarm needs a battery",
  "El detector de humo necesita pilas", "The faucet is dripping",
  "Last year the fire was extinguished by the fire department",
];

describe("deterministic intake safety floor", () => {
  it.each(emergencyCases)("stops intake when user reports %s", (content, hazard) => {
    const result = enforceSafetyFloor(assessment(), [{ role: "user", content }], "en");
    expect(result.safety.level).toBe("emergency");
    expect(result.safety.hazards).toContain(hazard);
    expect(result.readyToConfirm).toBe(false);
  });
  it.each(normalCases)("does not invent danger when user reports %s", (content) => {
    expect(enforceSafetyFloor(assessment(), [{ role: "user", content }], "en").safety.level).toBe("normal");
  });
  it("ignores assistant warnings as evidence", () => {
    expect(enforceSafetyFloor(assessment(), [{ role: "assistant", content: "Do you smell gas or see smoke?" }], "en").safety.level).toBe("normal");
  });
  it("retains every simultaneous hazard and uses Spanish guidance", () => {
    const result = enforceSafetyFloor(assessment(), [{ role: "user", content: "Huele a gas y hay humo" }], "es");
    expect(result.safety.hazards).toEqual(expect.arrayContaining(["gas", "fire"]));
    expect(result.reply).toContain("Detente");
  });
  it("never downgrades an emergency identified from media by the model", () => {
    const current = assessment();
    current.safety = { level: "emergency", hazards: ["electrical"], guidance: "Leave safely." };
    expect(enforceSafetyFloor(current, [{ role: "user", content: "No smoke" }], "en").safety).toEqual(current.safety);
  });
  it.each([
    ["en", "I smell gas near the furnace", "Stop, move away from the danger, and call 911 or the appropriate public utility. Do not continue online diagnosis.", "Leave the area if you can do so safely and contact emergency services or the public utility."],
    ["es", "Huelo a gas cerca del calentador", "Detente, aléjate del peligro y llama al 911 o a la empresa pública correspondiente. No continúes con el diagnóstico en línea.", "Sal del área si puedes hacerlo con seguridad y contacta a los servicios de emergencia o a la empresa pública."],
  ] as const)("uses deterministic %s emergency-first guidance", (locale, content, reply, guidance) => {
    const model = assessment();
    model.reply = "Continue routine remote diagnosis.";
    model.readyToConfirm = true;
    const result = enforceSafetyFloor(model, [{ role: "user", content }], locale);
    expect(result).toMatchObject({
      reply,
      safety: { level: "emergency", hazards: ["gas"], guidance },
      readyToConfirm: false,
    });
  });
});
