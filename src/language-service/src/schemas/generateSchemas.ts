import { resolve } from "path";
import * as TJS from "typescript-json-schema";
import * as fs from "fs";
import * as path from "path";
import { PathToSchemaMapping } from "./schemaService";
import { exit } from "process";

const settings: TJS.PartialArgs = {
  required: true,
  noExtraProps: true,
};

const compilerOptions: TJS.CompilerOptions = {
  strictNullChecks: true,
};

const jsonPath = path.join(__dirname, "mappings.json");
const filecontents = fs.readFileSync(jsonPath, "utf-8");

const outputFolder = path.join(__dirname, "json");

if (!fs.existsSync(outputFolder)) {
  fs.mkdirSync(outputFolder);
}

const pathToSchemaMappings: PathToSchemaMapping[] = JSON.parse(filecontents);

/** The newest modification time of the schema sources: every .ts file here, and mappings.json */
function newestSourceTime(folder: string): number {
  let newest = 0;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      if (entryPath !== outputFolder) {
        newest = Math.max(newest, newestSourceTime(entryPath));
      }
    } else if (entry.name.endsWith(".ts") || entryPath === jsonPath) {
      newest = Math.max(newest, fs.statSync(entryPath).mtimeMs);
    }
  }
  return newest;
}

/**
 * Whether every generated schema exists and is newer than all schema sources. Types are shared
 * between schemas, so any source change regenerates all of them.
 */
function schemasAreUpToDate(): boolean {
  const sourceTime = newestSourceTime(__dirname);
  return pathToSchemaMappings.every((mapping) => {
    const outputPath = path.join(outputFolder, mapping.file);
    return fs.existsSync(outputPath) && fs.statSync(outputPath).mtimeMs >= sourceTime;
  });
}

if (process.argv[2] === "--quick" && schemasAreUpToDate()) {
  console.debug("Skipping schema generation because the schemas are up to date");
} else {
  console.log("Generating schemas...");
  pathToSchemaMappings.forEach((mapping) => {
    console.log(mapping.path);
    const program = TJS.getProgramFromFiles(
      [resolve(path.join(__dirname, mapping.tsFile))],
      compilerOptions,
    );
    const schema = TJS.generateSchema(program, mapping.fromType, settings);
    if (schema === null) {
      console.error("Schema generation failed");
      exit(1);
    }
    fs.writeFileSync(
      path.join(outputFolder, mapping.file),
      JSON.stringify(schema),
    );
  });
}
