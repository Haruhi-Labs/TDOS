// 固定槽位与额外舰船只有一个发布者；容器不可变，成员关系由这里校验。
export class FleetRoster {
  #owner;
  #ships;
  #extra = Object.freeze([]);
  constructor(owner) { this.#owner = owner; }
  get ships() { return this.#ships; }
  get extra() { return this.#extra; }
  initialize(ships) {
    if (this.#ships) throw new Error("舰队固定槽位不能重复初始化");
    for (const key of ["main", "sub1", "sub2"]) {
      const ship = ships[key];
      if (!ship || ship.team !== this.#owner || ship.key !== key || ship.isAuxiliary) throw new Error("舰队固定槽位归属无效");
    }
    this.#ships = Object.freeze({ ...ships });
  }
  accepts(ship) {
    if (!ship?.isAuxiliary || ship.team.match !== this.#owner.match || ship.kind !== "ship") return false;
    if (this.#extra.some((member) => member === ship || member.id === ship.id || member.key === ship.key)) return false;
    return true;
  }
  add(ship) {
    if (ship?.team !== this.#owner || !this.accepts(ship)) return false;
    this.#extra = Object.freeze([...this.#extra, ship]);
    return true;
  }
  remove(ship) {
    if (!this.#extra.includes(ship)) return false;
    this.#extra = Object.freeze(this.#extra.filter((member) => member !== ship));
    return true;
  }
}
