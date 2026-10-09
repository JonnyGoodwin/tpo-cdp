import { DatabaseSync } from "node:sqlite";

export class Database {
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,email TEXT,name TEXT,created_at TEXT,traits TEXT);
      CREATE TABLE IF NOT EXISTS identities(kind TEXT,value TEXT,person_id TEXT REFERENCES people(id),PRIMARY KEY(kind,value));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,person_id TEXT REFERENCES people(id),source TEXT,name TEXT,timestamp TEXT,properties TEXT);
      CREATE INDEX IF NOT EXISTS events_person ON events(person_id);
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,source TEXT,filename TEXT,type TEXT,created_at TEXT,mapping TEXT,result TEXT);
      CREATE TABLE IF NOT EXISTS segments(id TEXT PRIMARY KEY,name TEXT,definition TEXT);
    `);
  }
  all(sql, ...args) {
    return this.db.prepare(sql).all(...args);
  }
  get(sql, ...args) {
    return this.db.prepare(sql).get(...args);
  }
  run(sql, ...args) {
    return this.db.prepare(sql).run(...args);
  }
}
