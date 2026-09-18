/**
 * 후보 이슈 라벨(EN/ES 키워드)을 icons.tsx의 아이콘 컴포넌트로 매핑한다.
 * 예: "leak/pipe"→물방울, "gas/smoke"→경고, "AC/heat"→온도계.
 */
import { ApplianceIcon, BoltIcon, BugIcon, DropletIcon, HouseIcon, PaintRollerIcon, ThermometerIcon, WarningIcon, WrenchIcon, type IconComponent } from "./icons";

const issueIconMatchers: Array<[RegExp, IconComponent]> = [
  [/gas|smoke|fire|flame|carbon|co2|burning|gasolina|humo|fuego/i, WarningIcon],
  [/leak|water|drain|faucet|toilet|pipe|sew|flood|sink|shower|plumb|fuga|agua|tuber|drenaje|inund/i, DropletIcon],
  [/ac\b|air.?condition|hvac|heat|furnace|thermostat|cool|aire|calefac|clima/i, ThermometerIcon],
  [/electric|outlet|wire|wiring|breaker|power|light|switch|panel|corto|cable|eléctr|luz|enchufe/i, BoltIcon],
  [/ant|roach|termite|wasp|hornet|bee\b|mouse|mice|rat\b|rodent|bug|insect|pest|spider|droppings|nest|hormiga|cucaracha|termita|avispa|abeja|rat[oó]n|rata|roedor|plaga|araña|nido/i, BugIcon],
  [/paint|repaint|stain|pintura|pintar/i, PaintRollerIcon],
  [/roof|ceiling|wall|drywall|crack|foundation|structural|mold|techo|pared|grieta|moho|cimiento/i, HouseIcon],
  [/washer|dryer|dishwasher|appliance|refrigerator|fridge|oven|stove|lavadora|secadora|lavavajillas|refrigerador/i, ApplianceIcon],
  [/door|window|lock|fence|deck|gutter|floor|tile|puerta|ventana|cerradura|piso/i, WrenchIcon],
];

export function issueIcon(label: string): IconComponent {
  return issueIconMatchers.find(([pattern]) => pattern.test(label))?.[1] ?? WrenchIcon;
}

const categoryMeta: Record<string, { icon: IconComponent; en: string; es: string }> = {
  plumbing: { icon: DropletIcon, en: "Plumbing", es: "Plomería" },
  hvac: { icon: ThermometerIcon, en: "Heating & cooling", es: "Climatización" },
  electrical: { icon: BoltIcon, en: "Electrical", es: "Electricidad" },
  painting: { icon: PaintRollerIcon, en: "Painting", es: "Pintura" },
  pest_control: { icon: BugIcon, en: "Pest control", es: "Control de plagas" },
  handyman: { icon: WrenchIcon, en: "Handyman", es: "Reparaciones" },
  general: { icon: HouseIcon, en: "General", es: "General" },
};

export function categoryIcon(category?: string): IconComponent {
  return categoryMeta[category ?? ""]?.icon ?? WrenchIcon;
}

export function categoryLabel(category: string | undefined, locale: "en" | "es" = "en"): string {
  const meta = categoryMeta[category ?? ""];
  return meta ? meta[locale] : category ?? "";
}
