import * as assert from "assert";
import { CompletionItem } from "vscode-languageserver-protocol";
import { TextDocument } from "vscode-languageserver-textdocument";
import { getLanguageService } from "yaml-language-server/out/src/languageservice/yamlLanguageService";
import { HomeAssistantConfiguration } from "../../language-service/src/haConfig/haConfig";
import { HomeAssistantLanguageService } from "../../language-service/src/haLanguageService";
import { SchemaServiceForIncludes } from "../../language-service/src/schemas/schemaService";

class MockFileAccessor {
  getFileContents(): string {
    return "";
  }
}

// Not connected: no entity, area or other registry validation runs
class DisconnectedHaConnection {
  async getAreaCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getDeviceCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getFloorCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getLabelCompletions(): Promise<CompletionItem[]> {
    return [];
  }
  async getHassEntities(): Promise<any> {
    return undefined;
  }
  async getHassServices(): Promise<any> {
    return undefined;
  }
}

// Every value must be an object, so any scalar produces a schema diagnostic
const schema = {
  type: "object",
  additionalProperties: { type: "object" },
};

const customTags = [
  "!include scalar",
  "!include_dir_list scalar",
  "!include_dir_named scalar",
  "!include_dir_merge_list scalar",
  "!include_dir_merge_named scalar",
  "!env_var scalar",
  "!input scalar",
  "!secret scalar",
  "!unknown scalar",
];

/**
 * yaml-language-server strips custom tags before validating, so `!include_dir_named packages`
 * is validated as the string "packages". Errors on such values are meaningless and are skipped.
 */
suite("Tagged Value Diagnostics Mock Test", () => {
  let languageService: HomeAssistantLanguageService;

  setup(async () => {
    const yamlLanguageService = getLanguageService({
      schemaRequestService: async () => JSON.stringify(schema),
      workspaceContext: { resolveRelativePath: (relativePath: string) => relativePath } as any,
      telemetry: undefined,
    });
    yamlLanguageService.configure({
      validate: true,
      customTags,
      schemas: [{ uri: "http://test/schema.json", fileMatch: ["*.yaml"], schema }],
    });
    languageService = new HomeAssistantLanguageService(
      yamlLanguageService,
      new HomeAssistantConfiguration(new MockFileAccessor() as any),
      new DisconnectedHaConnection() as any,
      [],
      await SchemaServiceForIncludes.create(),
      () => { /* not needed in this test */ },
      () => { /* not needed in this test */ },
      { isConfigured: true, autoRenderTemplates: true } as any,
    );
  });

  // yaml-language-server caches parsed documents by URI and version, so each test needs its own URI
  let documentCount = 0;

  const linesWithDiagnostics = async (content: string): Promise<number[]> => {
    documentCount++;
    const document = TextDocument.create(
      `file:///config/test${documentCount}.yaml`,
      "yaml",
      1,
      content,
    );
    const diagnostics = await languageService.getDiagnostics(document);
    return diagnostics.map((d) => d.range.start.line).sort((a, b) => a - b);
  };

  test("values behind include, !env_var, !secret and !input tags are skipped", async () => {
    const lines = await linesWithDiagnostics(`a: !include file.yaml
b: !include_dir_list folder
c: !include_dir_named folder
d: !include_dir_merge_list folder
e: !include_dir_merge_named folder
f: !env_var TZ
g: !secret password
h: !input value
`);

    assert.deepStrictEqual(lines, []);
  });

  test("untagged values and unknown tags are still reported", async () => {
    const lines = await linesWithDiagnostics(`a: plain
b: !include_dir_named folder
c: !unknown value
`);

    assert.deepStrictEqual(lines, [0, 2]);
  });
});
