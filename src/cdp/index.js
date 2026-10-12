import { initialize, sync } from "../connections/store.js";
import { Database } from "./database.js";
import { profiles } from "./profiles.js";
import { importCSV } from "./imports.js";
import { matches, segments } from "./segments.js";
export { parseCSV, defaultMapping } from "./csv.js";
export class CDP extends Database {
  constructor(path) {
    super(path);
    this.ready = this.withSession(async () => {
      await this.initialize();
      await initialize(this);
    });
  }
  static async open(path) {
    const cdp = new CDP(path);
    await cdp.ready;
    return cdp;
  }
  async profiles() {
    return await profiles(this);
  }
  async importCSV(options) {
    return this.withSession(async () => {
      const result = await importCSV(this, options);
      if (!options.dryRun) await sync(this);
      return result;
    });
  }
  matches(profile, definition, now) {
    return matches(this, profile, definition, now);
  }
  async segments(people) {
    return await segments(this, people);
  }
}
