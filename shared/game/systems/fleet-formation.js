// 编队拥有分离状态与成员归属规则，共享资源只经成员能力读写。
export class FleetFormation {
  #port;
  #level = 0;
  #turnPenalties;
  constructor(port, turnPenalties) { this.#port = port; this.#turnPenalties = Object.freeze({ ...turnPenalties }); }
  get level() { return this.#level; }
  configure(level) {
    if (![0, 1, 2].includes(level)) throw new RangeError("编队分离层级必须为 0、1 或 2");
    this.#level = level;
  }
  fleetKeyForShip(shipOrKey) {
    const key = shipOrKey;
    if (!this.#port.participates(this.#port.lookup(key))) return key;
    if (key === "sub1" && this.#level >= 1) {
      return "sub1";
    }
    if (key === "sub2" && this.#level >= 2) {
      return "sub2";
    }
    return "main";
  }

  fleetMembersByKey(fleetKey) {
    const members = [];
    if (fleetKey === "main") {
      if (this.#port.primary.main.alive) {
        members.push(this.#port.primary.main);
      }
      if (this.#level < 1 && this.#port.primary.sub1.alive) {
        members.push(this.#port.primary.sub1);
      }
      if (this.#level < 2 && this.#port.primary.sub2.alive) {
        members.push(this.#port.primary.sub2);
      }
      for (const ship of this.#port.extras) {
        if (ship.alive && this.#port.participates(ship)) {
          members.push(ship);
        }
      }
      return members;
    }
    const ship = this.#port.primary[fleetKey] || this.#port.extras.find((candidate) => candidate.key === fleetKey && !this.#port.participates(candidate));
    if (ship && ship.alive) {
      members.push(ship);
    }
    return members;
  }

  fleetMembersForShip(shipOrKey) {
    return this.fleetMembersByKey(this.fleetKeyForShip(shipOrKey));
  }

  fleetMemberCountForShip(shipOrKey) {
    return this.fleetMembersForShip(shipOrKey).length;
  }

  turnModifierForShip(shipOrKey) {
    const count = this.fleetMemberCountForShip(shipOrKey);
    const penalty = this.#turnPenalties[count] || 0.62;
    return count <= 1 ? 1.16 : penalty;
  }

  accelerationModifierForShip(shipOrKey) {
    return this.#port.accelerationMultiplier();
  }

  fleetSpeedForShip(shipOrKey) {
    const members = this.fleetMembersForShip(shipOrKey);
    if (members.length === 0) {
      return 0;
    }
    return members.reduce((min, ship) => Math.min(min, ship.baseSpeed()), Infinity);
  }

  fleetEnergyForShip(shipOrKey) {
    const members = this.fleetMembersForShip(shipOrKey);
    return {
      current: members.reduce((sum, ship) => sum + Math.max(0, ship.energy), 0),
      max: members.reduce((sum, ship) => sum + ship.maxEnergy, 0),
    };
  }

  availableEnergyForShip(shipOrKey) {
    return this.fleetEnergyForShip(shipOrKey).current;
  }

  spendEnergyForShip(shipOrKey, cost) {
    const members = this.fleetMembersForShip(shipOrKey).filter((ship) => ship.alive && ship.energy > 0);
    if (members.length === 0) {
      return false;
    }
    const total = members.reduce((sum, ship) => sum + ship.energy, 0);
    if (total < cost) {
      return false;
    }
    let spent = 0;
    for (let i = 0; i < members.length; i += 1) {
      const ship = members[i];
      const remaining = cost - spent;
      if (remaining <= 0) {
        break;
      }
      const slice = i === members.length - 1 ? remaining : Math.min(ship.energy, (cost * ship.energy) / total);
      ship.spendEnergy(slice);
      spent += slice;
    }
    if (spent < cost) {
      const richest = [...members].sort((a, b) => b.energy - a.energy)[0];
      if (richest) {
        richest.spendEnergy(cost - spent);
      }
    }
    return true;
  }

  normalizeSplitLevel() {
    let level = this.#level;
    while (level < 1 && !this.#port.primary.sub1.alive) {
      level = 1;
    }
    while (level < 2 && level >= 1 && !this.#port.primary.sub2.alive) {
      level = 2;
    }
    this.#level = level;
  }

  releaseShipAfterFlagshipLoss(ship, lateralSign = 1) {
    if (!ship || !ship.alive) {
      return;
    }
    const padding = Math.max(this.#port.mapPadding, ship.radius + 6);
    const forwardX = Math.cos(ship.angle || 0);
    const forwardY = Math.sin(ship.angle || 0);
    const sideX = -forwardY;
    const sideY = forwardX;
    ship.setBezierRoute(
      undefined,
      undefined,
      this.#port.clampX(ship.x + forwardX * 90 + sideX * 88 * lateralSign, padding),
      this.#port.clampY(ship.y + forwardY * 90 + sideY * 88 * lateralSign, padding),
      1,
      false,
    );
  }

  resolvePostCasualtyState(match = null) {
    this.normalizeSplitLevel();

    if (!this.#port.primary.main.alive) {
      if (this.#level < 1) {
        this.#level = 1;
        this.releaseShipAfterFlagshipLoss(this.#port.primary.sub1, 1);
      }
      this.normalizeSplitLevel();
      if (this.#level < 2) {
        this.#level = 2;
        this.releaseShipAfterFlagshipLoss(this.#port.primary.sub2, -1);
      }
    }

    this.normalizeSplitLevel();
  }

  split(level) {
    this.resolvePostCasualtyState();
    const releasedShip = level === 1 ? this.#port.primary.sub1 : level === 2 ? this.#port.primary.sub2 : null;
    if (
      this.#port.primary.main.isControlLocked()
      || releasedShip?.isControlLocked()
    ) {
      return false;
    }
    if (level === 1 && this.#level === 0 && this.#port.primary.sub1.alive) {
      this.#level = 1;
      this.#port.primary.sub1.setBezierRoute(undefined, undefined, this.#port.primary.main.x - 90, this.#port.primary.main.y + 100, 1, false);
      this.#port.recordSplit();
      return true;
    }
    if (level === 2 && this.#level === 1 && this.#port.primary.sub2.alive) {
      this.#level = 2;
      this.#port.primary.sub2.setBezierRoute(undefined, undefined, this.#port.primary.main.x - 90, this.#port.primary.main.y - 100, 1, false);
      this.#port.recordSplit();
      return true;
    }
    return false;
  }

}
