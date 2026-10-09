import { Database } from "./database.js";
import { profiles } from "./profiles.js";
import { importCSV } from "./imports.js";
import { matches, segments } from "./segments.js";
export { parseCSV, defaultMapping } from "./csv.js";

export class CDP extends Database {
  profiles() {
    return profiles(this);
  }
  importCSV(options) {
    return importCSV(this, options);
  }
  matches(profile, definition) {
    return matches(this, profile, definition);
  }
  segments(people = this.profiles()) {
    return segments(this, people);
  }
}
