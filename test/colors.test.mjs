// 担当者の自動の色（distinctColors）の検証
// Tests for the automatic assignee colours (distinctColors)
import { distinctColors } from "./colors.mjs";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("  ok  -", name);
  } else {
    fail++;
    console.error("FAIL  -", name);
  }
}

// ハッシュの色相だけでは Ben と Kei がほぼ同じ色になっていた / with hashed hues alone, Ben and Kei came out nearly the same colour
const team = ["Ana", "Ben", "Ben Carter", "Dana", "Kei"];
const colors = distinctColors(team);
check("5 people get 5 different colours", new Set(colors.values()).size === 5);
check("the same order gives the same colours", JSON.stringify([...distinctColors(team)]) === JSON.stringify([...colors]));
const ten = Array.from({ length: 10 }, (_, i) => `Person ${i}`);
check("10 people never share a colour", new Set(distinctColors(ten).values()).size === 10);
check("an 11th person still gets a colour", distinctColors([...ten, "Extra"]).get("Extra")?.startsWith("#"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
