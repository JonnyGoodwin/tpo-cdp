import { initialize, sync } from "../connections/store.js";
import { Database } from "./database.js";
import { profiles } from "./profiles.js";
import { importCSV } from "./imports.js";
import { matches, segments } from "./segments.js";
export { parseCSV, defaultMapping } from "./csv.js";

export class CDP extends Database {
  constructor(path) {
    super(path);
    initialize(this);
  }
  profiles() {
    return profiles(this);
  }
  importCSV(options) {
    const result = importCSV(this, options);
    if (!options.dryRun) sync(this);
    return result;
  }
  matches(profile, definition, now) {
    return matches(this, profile, definition, now);
  }
  segments(people = this.profiles()) {
    return segments(this, people);
  }
}
