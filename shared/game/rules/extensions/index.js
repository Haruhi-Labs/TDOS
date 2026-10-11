import tsuruya from "./tsuruya.js";
import haruhi from "./haruhi.js";
import future1096 from "./future1096.js";
import koizumi from "./koizumi.js";
import shamisen from "./shamisen.js";
import yuki from "./yuki.js";
import asakura from "./asakura.js";
import bunnyHaruhi from "./bunny-haruhi.js";
import kyon from "./kyon.js";
import common from "./common.js";

function freezeDeclaration(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freezeDeclaration(child); Object.freeze(value); }
  return value;
}
// 注册顺序仅用于构造；消费顺序由各钩子的明确阶段与优先级确定。
export const CHARACTER_EXTENSIONS = freezeDeclaration([tsuruya, haruhi, future1096, koizumi, shamisen, yuki, asakura, bunnyHaruhi, kyon, common]);
