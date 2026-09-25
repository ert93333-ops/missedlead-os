import { describe, expect, it } from "vitest";
import { enforceServiceScope, isNonServiceableSubject } from "./scope.js";
import type { ModelAssessment } from "./types.js";

const assessment = (overrides: Partial<ModelAssessment> = {}): ModelAssessment => ({
  reply: "I can help with that. How many rooms need cleaning?",
  category: "handyman",
  summary: "User needs carpet cleaning and moving services.",
  issueCandidates: [{ id: "carpet_cleaning", label: "Carpet Cleaning Service", likelihood: "medium", reason: "Customer asked for carpet cleaning.", evidenceNeeded: [] }],
  questions: [{ id: "rooms", prompt: "How many rooms require carpet cleaning?", requiredForSafety: false }],
  materialsHint: ["carpet extractor"],
  details: {},
  safety: { level: "normal", hazards: [], guidance: "" },
  readyToConfirm: false,
  ...overrides,
});

describe("intake service scope", () => {
  // 아래 두 문장은 실제 인테이크 모델이 반환해 접수 직전까지 갔던 기록이다.
  it("blocks work WeCover does not perform", () => {
    for (const subject of [
      "User needs carpet cleaning and moving services. Moving services are out of scope. Carpet cleaning is a service request.",
      "User is inquiring about recurring lawn mowing and gutter cleaning services.",
      "Recurring lawn mowing and landscaping subscription.",
      "Movers to pack the apartment next week.",
      "Car engine knocking and check engine light on.",
      "Cracked laptop screen and phone battery replacement.",
      "Help filing income taxes and a lease dispute letter.",
      "Sell a home warranty and file the insurance claim.",
      "Weather forecast and restaurant recommendation request.",
      "Solicita servicio de limpieza de alfombras y mudanza.",
    ]) expect(isNonServiceableSubject(subject), subject).toBe(true);
  });

  it("keeps every serviceable trade request, including ones that mention unrelated context", () => {
    for (const subject of [
      "Water leak under the kitchen sink soaked the carpet.",
      "Movers damaged the drywall and it needs patching and paint.",
      "Outlets in the living room are dead after the breaker tripped.",
      "Heat pump blows warm air and the condenser is noisy.",
      "Repaint two bedrooms and a hallway before move-in.",
      "Roaches in the kitchen and droppings behind the fridge.",
      "Bedroom door will not latch and the hinge screws back out.",
      "Fuga debajo del fregadero de la cocina.",
      "The tenant's lease dispute is unrelated; the toilet runs constantly.",
    ]) expect(isNonServiceableSubject(subject), subject).toBe(false);
  });

  it("removes the request path for out-of-scope work instead of scoping it", () => {
    const result = enforceServiceScope(assessment(), "en");
    expect(result.issueCandidates).toEqual([]);
    expect(result.questions).toEqual([]);
    expect(result.materialsHint).toEqual([]);
    expect(result.readyToConfirm).toBe(false);
    expect(result.reply).toContain("home repair");
    expect(result.reply).not.toContain("I can help");
  });

  it("answers an out-of-scope request in the requested locale", () => {
    expect(enforceServiceScope(assessment(), "es").reply).toContain("reparación del hogar");
  });

  it("never replaces emergency guidance with the scope notice", () => {
    const emergency = enforceServiceScope(assessment({
      reply: "Leave the area and call 911.",
      safety: { level: "emergency", hazards: ["fire"], guidance: "Leave now." },
    }), "en");
    expect(emergency.reply).toBe("Leave the area and call 911.");
    expect(emergency.issueCandidates).toEqual([]);
    expect(emergency.readyToConfirm).toBe(false);
  });

  it("leaves a serviceable assessment untouched", () => {
    const plumbing = assessment({
      summary: "Toilet runs constantly and the water bill went up.",
      issueCandidates: [{ id: "flapper", label: "Worn flapper", likelihood: "medium", reason: "Continuous refill.", evidenceNeeded: [] }],
      reply: "Let us scope the running toilet.",
    });
    expect(enforceServiceScope(plumbing, "en")).toEqual(plumbing);
  });
});
