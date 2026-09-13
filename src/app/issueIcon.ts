/**
 * 후보 이슈 라벨(EN/ES 키워드)을 icons.tsx의 아이콘 컴포넌트로 매핑한다.
 * 예: "leak/pipe"→물방울, "gas/smoke"→경고, "AC/heat"→온도계.
 */
import { ApplianceIcon, BoltIcon, DropletIcon, HouseIcon, ThermometerIcon, WarningIcon, WrenchIcon, type IconComponent } from "./icons";

const issueIconMatchers: Array<[RegExp, IconComponent]> = [
  [/gas|smoke|fire|flame|carbon|co2|burning|gasolina|humo|fuego/i, WarningIcon],
  [/leak|water|drain|faucet|toilet|pipe|sew|flood|sink|shower|plumb|fuga|agua|tuber|drenaje|inund/i, DropletIcon],
  [/ac\b|air.?condition|hvac|heat|furnace|thermostat|cool|aire|calefac|clima/i, ThermometerIcon],
  [/electric|outlet|wire|wiring|breaker|power|light|switch|panel|corto|cable|eléctr|luz|enchufe/i, BoltIcon],
  [/roof|ceiling|wall|drywall|crack|foundation|structural|mold|techo|pared|grieta|moho|cimiento/i, HouseIcon],
  [/washer|dryer|dishwasher|appliance|refrigerator|fridge|oven|stove|lavadora|secadora|lavavajillas|refrigerador/i, ApplianceIcon],
  [/door|window|lock|fence|deck|gutter|paint|floor|tile|puerta|ventana|cerradura|pintura|piso/i, WrenchIcon],
];

export function issueIcon(label: string): IconComponent {
  return issueIconMatchers.find(([pattern]) => pattern.test(label))?.[1] ?? WrenchIcon;
}
