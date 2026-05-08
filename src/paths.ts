import { homedir } from "os";
import { join } from "path";

export const IO_HOME = join(homedir(), ".io");
export const CONFIG_PATH = join(IO_HOME, "config.json");
export const DB_PATH = join(IO_HOME, "io.db");
export const WIKI_DIR = join(IO_HOME, "wiki");
export const SKILLS_DIR = join(IO_HOME, "skills");
export const SESSIONS_DIR = join(IO_HOME, "sessions");
export const LOGS_DIR = join(IO_HOME, "logs");
